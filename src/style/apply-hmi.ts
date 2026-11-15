/**
 * 把习惯档案里的 HMI 地址规划应用到 spec（显式 opt-in：gen --hmi-from-style）。
 *
 * 与 mergeStyleIntoSpec 的区别：HMI 地址在 spec 中是必填项，无法用“未设置才填”的规则；
 * 因此这里作为显式覆盖动作，生成时用 warning 记录被覆盖的地址。
 */

import type { RequirementSpec } from '../spec/schema.ts';
import type { StyleProfile } from './index.ts';
import { profileHmiAddresses, type RoleKey } from './check-spec.ts';

interface ApplyResult {
  applied: string[];
}

/** 应用档案 HMI 地址（角色 → 地址），返回覆盖记录。 */
export function applyStyleHmiAddresses(spec: RequirementSpec, style: StyleProfile): ApplyResult {
  const ind = spec.sequence?.industrial;
  if (!ind) return { applied: [] };
  const exp = profileHmiAddresses(style);
  const applied: string[] = [];
  const h = ind.hmi;

  const set = (
    role: RoleKey,
    current: string | undefined,
    assign: (v: string) => void,
  ) => {
    const next = exp[role]?.address;
    if (!next || current === next) return;
    assign(next);
    applied.push(`${exp[role]?.desc ?? role}: ${current ?? '-'} → ${next}`);
  };

  set('start', h.start, (v) => (h.start = v));
  set('stop', h.stop, (v) => (h.stop = v));
  set('reset', h.reset, (v) => (h.reset = v));
  set('manual', h.manual, (v) => (h.manual = v));
  set('exitManual', h.exitManual, (v) => (h.exitManual = v));
  set('continueRun', h.continueRun, (v) => (h.continueRun = v));
  set('restart', h.restart, (v) => (h.restart = v));

  h.status = h.status ?? {};
  set('idle', h.status.idle, (v) => (h.status!.idle = v));
  set('auto', h.status.auto, (v) => (h.status!.auto = v));
  set('manualing', h.status.manual, (v) => (h.status!.manual = v));
  set('stopping', h.status.stopping, (v) => (h.status!.stopping = v));
  set('alarm', h.status.alarm, (v) => (h.status!.alarm = v));
  set('paused', h.status.paused, (v) => (h.status!.paused = v));

  h.data = h.data ?? {};
  set('step', h.data.step, (v) => (h.data!.step = v));
  set('mode', h.data.mode, (v) => (h.data!.mode = v));
  set('alarmCode', h.data.alarmCode, (v) => (h.data!.alarmCode = v));
  set('alarmStep', h.data.alarmStep, (v) => (h.data!.alarmStep = v));

  // 手动按钮：档案描述里含气缸名 → 期望地址
  const manual = style.hmi?.manualButtons;
  if (manual && typeof manual === 'object') {
    for (const b of ind.manualButtons) {
      for (const [addr, descRaw] of Object.entries(manual as Record<string, unknown>)) {
        if (String(descRaw).includes(b.cylinder) && b.button !== addr) {
          applied.push(`手动按钮 ${b.cylinder}: ${b.button} → ${addr}`);
          b.button = addr;
          break;
        }
      }
    }
  }

  return { applied };
}
