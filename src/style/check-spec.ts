/**
 * 用习惯档案检查 spec 是否偏离用户习惯（生成前/评审时使用）。
 *
 * 与 `mergeStyleIntoSpec` 的区别：
 * - merge 只填充 spec 未设置的项（会改 spec）；
 * - check 只报告偏差，不修改 spec，便于人工决定是否采纳。
 */

import type { RequirementSpec } from '../spec/schema.ts';
import type { StyleProfile } from './index.ts';
import type { StyleRuleDiagnostic } from './validate.ts';

type RoleKey =
  | 'start'
  | 'stop'
  | 'reset'
  | 'manual'
  | 'exitManual'
  | 'continueRun'
  | 'restart'
  | 'idle'
  | 'auto'
  | 'manualing'
  | 'stopping'
  | 'alarm'
  | 'paused'
  | 'step'
  | 'mode'
  | 'alarmCode'
  | 'alarmStep';

const COMMAND_KEYWORDS: Array<[RoleKey, string[]]> = [
  ['start', ['启动']],
  ['stop', ['停止']],
  ['reset', ['复位', '清除报警']],
  ['exitManual', ['退出手动', '回待机']],
  ['continueRun', ['继续']],
  ['restart', ['从头']],
  ['manual', ['手动']],
];

const STATUS_KEYWORDS: Array<[RoleKey, string[]]> = [
  ['idle', ['待机']],
  ['auto', ['自动']],
  ['manualing', ['手动']],
  ['stopping', ['停止中', '停止']],
  ['alarm', ['报警']],
  ['paused', ['急停', '暂停']],
];

const DATA_KEYWORDS: Array<[RoleKey, string[]]> = [
  ['alarmStep', ['冻结', '报警步号']],
  ['alarmCode', ['报警代码', '报警码']],
  ['step', ['步号']],
  ['mode', ['模式']],
];

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** 从档案 hmi 描述（地址 → 说明）推断各角色的期望地址。 */
export function profileHmiAddresses(style: StyleProfile): Partial<Record<RoleKey, { address: string; desc: string }>> {
  const hmi = asRecord(style.hmi);
  const out: Partial<Record<RoleKey, { address: string; desc: string }>> = {};
  const scan = (section: Record<string, unknown>, keywords: Array<[RoleKey, string[]]>) => {
    for (const [address, descRaw] of Object.entries(section)) {
      const desc = String(descRaw);
      for (const [role, words] of keywords) {
        if (out[role]) continue;
        if (words.some((w) => desc.includes(w))) {
          out[role] = { address, desc };
          // 一个地址只归入第一个匹配角色（避免「退出手动」同时命中 exitManual/manual）
          break;
        }
      }
    }
  };
  scan(asRecord(hmi.commands), COMMAND_KEYWORDS);
  scan(asRecord(hmi.status), STATUS_KEYWORDS);
  scan(asRecord(hmi.data), DATA_KEYWORDS);
  return out;
}

/** 检查 spec 与习惯档案的偏差（只报告，不改 spec）。 */
export function checkSpecAgainstStyle(
  spec: RequirementSpec,
  style: StyleProfile,
): StyleRuleDiagnostic[] {
  const diags: StyleRuleDiagnostic[] = [];
  const ind = spec.sequence?.industrial;
  if (!ind) return diags;
  const warn = (code: string, message: string) => diags.push({ code, severity: 'warning', message });

  // ---- 1) 气缸超时是否偏离档案默认值 ----
  const defaultTimeout = style.defaults?.cylinderTimeoutMs;
  if (typeof defaultTimeout === 'number') {
    for (const c of ind.cylinders) {
      if (c.timeoutMs !== undefined && c.timeoutMs !== defaultTimeout) {
        warn(
          'STYLE_SPEC_TIMEOUT',
          `气缸「${c.name}」超时 ${c.timeoutMs}ms 与档案默认 ${defaultTimeout}ms 不一致`,
        );
      }
    }
  }

  // ---- 2) HMI 地址是否偏离档案规划 ----
  const expected = profileHmiAddresses(style);
  const h = ind.hmi;
  const actual: Partial<Record<RoleKey, string | undefined>> = {
    start: h.start,
    stop: h.stop,
    reset: h.reset,
    manual: h.manual,
    exitManual: h.exitManual,
    continueRun: h.continueRun,
    restart: h.restart,
    idle: h.status?.idle,
    auto: h.status?.auto,
    manualing: h.status?.manual,
    stopping: h.status?.stopping,
    alarm: h.status?.alarm,
    paused: h.status?.paused,
    step: h.data?.step,
    mode: h.data?.mode,
    alarmCode: h.data?.alarmCode,
    alarmStep: h.data?.alarmStep,
  };
  for (const [role, exp] of Object.entries(expected) as Array<[RoleKey, { address: string; desc: string }]>) {
    const got = actual[role];
    if (got && got !== exp.address) {
      warn(
        'STYLE_SPEC_HMI',
        `HMI「${exp.desc}」地址 spec=${got}，档案规划=${exp.address}`,
      );
    }
  }

  // ---- 3) 手动按钮是否覆盖全部气缸、地址是否与档案一致 ----
  const profileManual = asRecord(asRecord(style.hmi).manualButtons);
  for (const c of ind.cylinders) {
    const specBtn = ind.manualButtons.find((b) => b.cylinder === c.name);
    if (!specBtn) {
      warn('STYLE_SPEC_MANUAL', `气缸「${c.name}」缺少手动翻转按钮（档案习惯：每个执行元件一个）`);
      continue;
    }
    for (const [addr, descRaw] of Object.entries(profileManual)) {
      const desc = String(descRaw);
      if (desc.includes(c.name) && addr !== specBtn.button) {
        warn(
          'STYLE_SPEC_MANUAL',
          `气缸「${c.name}」手动按钮 spec=${specBtn.button}，档案规划=${addr}`,
        );
      }
    }
  }

  // ---- 4) 报警码是否偏离档案分配 ----
  const mapping = asRecord(asRecord(style.alarmCodes).mapping);
  for (const c of ind.cylinders) {
    const m = asRecord(mapping[c.name]);
    const num = (v: unknown): number | undefined =>
      typeof v === 'number' && Number.isFinite(v) ? v : undefined;
    const single = c.valve === 'single';
    const ext = num(m.extend) ?? num(m.clamp);
    const ret = num(m.retract) ?? num(m.release);
    if (ext !== undefined && c.alarmExtend?.code !== undefined && c.alarmExtend.code !== ext) {
      warn(
        'STYLE_SPEC_ALARM',
        `气缸「${c.name}」${single ? '夹紧' : '伸出'}报警码 spec=${c.alarmExtend.code}，档案=${ext}`,
      );
    }
    if (ret !== undefined && c.alarmRetract?.code !== undefined && c.alarmRetract.code !== ret) {
      warn(
        'STYLE_SPEC_ALARM',
        `气缸「${c.name}」${single ? '松开' : '缩回'}报警码 spec=${c.alarmRetract.code}，档案=${ret}`,
      );
    }
  }

  // ---- 5) 模式数量（档案 modes 有 6 个名称，spec 逻辑固定 6 模式，只提示自定义名） ----
  const modes = style.codeStructure?.modes;
  if (Array.isArray(modes) && modes.length !== 6) {
    warn('STYLE_SPEC_MODES', `档案 modes 数量 ${modes.length} ≠ 6，生成时会回退默认模式名`);
  }

  return diags;
}
