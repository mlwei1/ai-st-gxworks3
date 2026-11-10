/**
 * 仿真场景 DSL（M2）。
 *
 * 目标：把「给输入 → 等一会 → 读输出 → 断言」固化成可版本化、可回归的场景文件，
 * 供半自动仿真执行器（观测文件驱动）与后续全自动执行器共用。
 *
 * 场景是纯数据（JSON），不依赖 GX Works3；设备地址按 FX5U profile 校验。
 */

import { parseDeviceAddress } from '../dialect/instructions.ts';
import { checkDeviceNumber } from '../profile/index.ts';
import type { CpuModel } from '../profile/index.ts';

export type SimValue = boolean | number | string;

export interface SimStep {
  /** 步骤名（人类可读，如「按下启动 X0=1」）。 */
  name: string;
  /** 写入的输入设备（完成后保持到下一步）。 */
  set?: Record<string, SimValue>;
  /** 写入后等待时间（毫秒），给 PLC 扫描/定时器时间。 */
  waitMs?: number;
  /** 期望读到的设备值。 */
  expect?: Record<string, SimValue>;
  /** 备注/操作提示。 */
  note?: string;
}

export interface SimScenario {
  /** 场景唯一标识（合法标识符）。 */
  name: string;
  title?: string;
  /** 关联的 spec 文件（相对仓库根，可选）。 */
  spec?: string;
  cpu?: CpuModel;
  /** 被验证的程序（GX Works3 导航树中的程序名）。 */
  program?: { resource: string; name?: string };
  /** 上电初始值（可选）。 */
  initial?: Record<string, SimValue>;
  steps: SimStep[];
  meta?: Record<string, unknown>;
}

export interface SimObservationStep {
  /** 1 起的步骤序号，对应 scenario.steps 下标 +1。 */
  step: number;
  name?: string;
  /** 该步骤完成后读到的设备值。 */
  values: Record<string, SimValue>;
  note?: string;
}

export interface SimObservationFile {
  scenario: string;
  observedAt?: string;
  steps: SimObservationStep[];
}

export type SimSeverity = 'error' | 'warning';

export interface SimDiagnostic {
  severity: SimSeverity;
  code: string;
  path: string;
  message: string;
}

export interface SimValidateResult {
  ok: boolean;
  scenario: SimScenario | null;
  diagnostics: SimDiagnostic[];
}

const DEVICE_RE = /^[A-Za-z]{1,3}[0-9A-Fa-f]+$/;

/** 校验设备地址（FX5U/FX5UJ 范围与进制由 profile 决定）。 */
export function validateDeviceAddress(device: string, model: CpuModel): SimDiagnostic[] {
  const out: SimDiagnostic[] = [];
  const text = device.trim().toUpperCase();
  if (!DEVICE_RE.test(text)) {
    out.push({
      severity: 'error',
      code: 'SIM_E_DEVICE_FORMAT',
      path: device,
      message: `设备地址格式非法：${device}（示例：X0 / Y10 / D100）`,
    });
    return out;
  }
  const parsed = parseDeviceAddress(text);
  if (!parsed) {
    out.push({
      severity: 'error',
      code: 'SIM_E_DEVICE_FORMAT',
      path: device,
      message: `无法解析设备地址：${device}`,
    });
    return out;
  }
  if (!parsed.validDigits) {
    out.push({
      severity: 'error',
      code: 'SIM_E_DEVICE_BASE',
      path: device,
      message: `设备地址 ${device} 的编号进制非法（X/Y 为八进制，B/W 等为十六进制）`,
    });
    return out;
  }
  const check = checkDeviceNumber(parsed.prefix, parsed.number, model);
  if (check !== 'ok') {
    const code =
      check === 'unknown-prefix'
        ? 'SIM_E_DEVICE_PREFIX'
        : check === 'out-of-range'
          ? 'SIM_E_DEVICE_RANGE'
          : 'SIM_E_DEVICE';
    out.push({
      severity: 'error',
      code,
      path: device,
      message: `设备地址 ${device} 校验失败（${check}）`,
    });
  }
  return out;
}

function isScalar(v: unknown): v is SimValue {
  return typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string';
}

function validateValueMap(
  map: Record<string, SimValue> | undefined,
  path: string,
  model: CpuModel,
  diagnostics: SimDiagnostic[],
): void {
  if (map === undefined) return;
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    diagnostics.push({
      severity: 'error',
      code: 'SIM_E_VALUE_MAP',
      path,
      message: `${path} 必须是「设备地址 → 值」对象`,
    });
    return;
  }
  for (const [device, value] of Object.entries(map)) {
    diagnostics.push(...validateDeviceAddress(device, model).map((d) => ({ ...d, path: `${path}.${device}` })));
    if (!isScalar(value)) {
      diagnostics.push({
        severity: 'error',
        code: 'SIM_E_VALUE_TYPE',
        path: `${path}.${device}`,
        message: `${device} 的值必须是 boolean/number/string，收到 ${JSON.stringify(value)}`,
      });
    }
  }
}

/** 校验场景结构性错误（不读取 GX，仅静态）。 */
export function validateScenario(input: unknown): SimValidateResult {
  const diagnostics: SimDiagnostic[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      ok: false,
      scenario: null,
      diagnostics: [{ severity: 'error', code: 'SIM_E_ROOT', path: '$', message: '场景必须是 JSON 对象' }],
    };
  }
  const sc = input as Partial<SimScenario>;
  if (typeof sc.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(sc.name)) {
    diagnostics.push({
      severity: 'error',
      code: 'SIM_E_NAME',
      path: 'name',
      message: 'name 必须是合法标识符（字母/数字/下划线，字母或下划线开头）',
    });
  }
  const model: CpuModel = sc.cpu === 'FX5UJ' ? 'FX5UJ' : 'FX5U';
  if (!Array.isArray(sc.steps) || sc.steps.length === 0) {
    diagnostics.push({
      severity: 'error',
      code: 'SIM_E_STEPS',
      path: 'steps',
      message: 'steps 必须是非空数组',
    });
    return { ok: false, scenario: null, diagnostics };
  }

  validateValueMap(sc.initial, 'initial', model, diagnostics);
  let hasAction = false;
  sc.steps.forEach((step, i) => {
    const path = `steps[${i}]`;
    if (!step || typeof step !== 'object') {
      diagnostics.push({ severity: 'error', code: 'SIM_E_STEP', path, message: '步骤必须是对象' });
      return;
    }
    if (typeof step.name !== 'string' || !step.name.trim()) {
      diagnostics.push({
        severity: 'error',
        code: 'SIM_E_STEP_NAME',
        path: `${path}.name`,
        message: '步骤 name 不能为空',
      });
    }
    if (step.set !== undefined) {
      hasAction = true;
      validateValueMap(step.set, `${path}.set`, model, diagnostics);
    }
    if (step.expect !== undefined) {
      hasAction = true;
      validateValueMap(step.expect, `${path}.expect`, model, diagnostics);
    }
    if (step.waitMs !== undefined && (typeof step.waitMs !== 'number' || step.waitMs < 0)) {
      diagnostics.push({
        severity: 'error',
        code: 'SIM_E_WAIT',
        path: `${path}.waitMs`,
        message: 'waitMs 必须是非负数',
      });
    }
  });
  if (!hasAction) {
    diagnostics.push({
      severity: 'warning',
      code: 'SIM_W_NO_ACTION',
      path: 'steps',
      message: '场景中没有任何 set/expect，可能没有验证意义',
    });
  }
  const ok = !diagnostics.some((d) => d.severity === 'error');
  return { ok, scenario: ok ? (input as SimScenario) : null, diagnostics };
}

/** 把诊断格式化为可读文本。 */
export function formatSimDiagnostics(diagnostics: SimDiagnostic[]): string {
  return diagnostics.map((d) => `${d.severity.toUpperCase()} ${d.code} [${d.path}] ${d.message}`).join('\n');
}
