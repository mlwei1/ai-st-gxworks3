/**
 * 仿真场景执行器（M2，半自动）。
 *
 * 两种运行方式：
 *  - `runScenarioWithObservations`：读入人工/工具采集的观测文件，按 DSL 断言（当前主路径）；
 *  - `runScenarioWithDriver`：注入驱动（未来接 OpenIF/UI 自动化，全自动）。
 *
 * 说明：GX Works3 没有公开的仿真读写 API，当前真实执行由操作者（或 Agent 的 UI 自动化）
 * 在 GX Simulator3 里完成「写设备 → 读设备」，再把观测值写成 JSON 交给本模块断言。
 */

import type { CpuModel } from '../profile/index.ts';
import {
  validateScenario,
  type SimDiagnostic,
  type SimObservationFile,
  type SimScenario,
  type SimValue,
} from './scenario.ts';

export interface SimMismatch {
  device: string;
  expected: SimValue;
  observed: SimValue | undefined;
}

export interface SimStepResult {
  step: number;
  name: string;
  status: 'pass' | 'fail' | 'missing' | 'skipped';
  mismatches: SimMismatch[];
  observed?: Record<string, SimValue>;
  note?: string;
}

export interface SimRunResult {
  ok: boolean;
  scenario: string;
  source: 'observations' | 'driver';
  steps: SimStepResult[];
  diagnostics: SimDiagnostic[];
  mismatchCount: number;
}

/** 单个值的宽松比较：BOOL 支持 true/1/'TRUE'，数值支持字符串数字。 */
export function valuesMatch(expected: SimValue, observed: SimValue | undefined): boolean {
  if (observed === undefined) return false;
  const norm = (v: SimValue): string => String(v).trim().toUpperCase();
  const e = norm(expected);
  const o = norm(observed);
  if (e === o) return true;
  // BOOL 等价：TRUE/1、FALSE/0
  const boolMap: Record<string, boolean> = { TRUE: true, '1': true, FALSE: false, '0': false };
  if (e in boolMap && o in boolMap) return boolMap[e] === boolMap[o];
  // 数值等价（避免 '1.0' vs '1' 误报）
  const en = Number(expected);
  const on = Number(observed);
  if (Number.isFinite(en) && Number.isFinite(on)) return en === on;
  return false;
}

function compareStep(
  stepIndex: number,
  stepName: string,
  expect: Record<string, SimValue> | undefined,
  observed: Record<string, SimValue> | undefined,
  note?: string,
): SimStepResult {
  if (!expect || Object.keys(expect).length === 0) {
    return { step: stepIndex + 1, name: stepName, status: 'skipped', mismatches: [], observed, note };
  }
  if (!observed) {
    return {
      step: stepIndex + 1,
      name: stepName,
      status: 'missing',
      mismatches: Object.entries(expect).map(([device, expected]) => ({ device, expected, observed: undefined })),
      note,
    };
  }
  const mismatches: SimMismatch[] = [];
  for (const [device, expected] of Object.entries(expect)) {
    const actual = observed[device];
    if (!valuesMatch(expected, actual)) mismatches.push({ device, expected, observed: actual });
  }
  return {
    step: stepIndex + 1,
    name: stepName,
    status: mismatches.length === 0 ? 'pass' : 'fail',
    mismatches,
    observed,
    note,
  };
}

/**
 * 用观测文件断言场景。
 *
 * 观测文件需覆盖所有带 expect 的步骤；缺失步骤记为 missing（不算通过）。
 */
export function runScenarioWithObservations(
  scenario: SimScenario,
  observations: SimObservationFile,
): SimRunResult {
  const validated = validateScenario(scenario);
  const diagnostics: SimDiagnostic[] = [...validated.diagnostics];
  if (!validated.ok || !validated.scenario) {
    return { ok: false, scenario: scenario?.name ?? '(invalid)', source: 'observations', steps: [], diagnostics, mismatchCount: 0 };
  }
  const obsByStep = new Map<number, Record<string, SimValue>>();
  if (observations && Array.isArray(observations.steps)) {
    for (const o of observations.steps) {
      if (typeof o?.step !== 'number' || !o.values || typeof o.values !== 'object') {
        diagnostics.push({
          severity: 'warning',
          code: 'SIM_W_OBS_ENTRY',
          path: 'observations.steps',
          message: `忽略无法识别的观测条目：${JSON.stringify(o)}`,
        });
        continue;
      }
      obsByStep.set(o.step, o.values);
    }
  } else {
    diagnostics.push({
      severity: 'error',
      code: 'SIM_E_OBS_SHAPE',
      path: 'observations.steps',
      message: '观测文件必须包含 steps 数组',
    });
  }

  const steps = scenario.steps.map((s, i) =>
    compareStep(i, s.name, s.expect, obsByStep.get(i + 1), s.note),
  );
  for (const key of obsByStep.keys()) {
    if (key < 1 || key > scenario.steps.length) {
      diagnostics.push({
        severity: 'warning',
        code: 'SIM_W_OBS_EXTRA',
        path: `observations.steps[${key}]`,
        message: `观测步骤 ${key} 超出场景步骤数（${scenario.steps.length}）`,
      });
    }
  }
  const mismatchCount = steps.reduce((n, s) => n + s.mismatches.length, 0);
  const ok = steps.every((s) => s.status === 'pass' || s.status === 'skipped');
  return { ok, scenario: scenario.name, source: 'observations', steps, diagnostics, mismatchCount };
}

/** 全自动执行器接口（未来接 OpenIF / UI 自动化）。 */
export interface SimDriver {
  write(devices: Record<string, SimValue>): Promise<void> | void;
  read(devices: string[]): Promise<Record<string, SimValue>> | Record<string, SimValue>;
  wait(ms: number): Promise<void> | void;
}

/** 用驱动执行场景（写 → 等 → 读 → 断言）。 */
export async function runScenarioWithDriver(scenario: SimScenario, driver: SimDriver): Promise<SimRunResult> {
  const validated = validateScenario(scenario);
  const diagnostics: SimDiagnostic[] = [...validated.diagnostics];
  if (!validated.ok || !validated.scenario) {
    return { ok: false, scenario: scenario?.name ?? '(invalid)', source: 'driver', steps: [], diagnostics, mismatchCount: 0 };
  }
  const steps: SimStepResult[] = [];
  for (let i = 0; i < scenario.steps.length; i++) {
    const step = scenario.steps[i]!;
    if (step.set && Object.keys(step.set).length > 0) await driver.write(step.set);
    const delay = step.waitMs ?? 300;
    if (delay > 0) await driver.wait(delay);
    let observed: Record<string, SimValue> | undefined;
    const expectKeys = step.expect ? Object.keys(step.expect) : [];
    if (expectKeys.length > 0) observed = await driver.read(expectKeys);
    steps.push(compareStep(i, step.name, step.expect, observed, step.note));
  }
  const mismatchCount = steps.reduce((n, s) => n + s.mismatches.length, 0);
  const ok = steps.every((s) => s.status === 'pass' || s.status === 'skipped');
  return { ok, scenario: scenario.name, source: 'driver', steps, diagnostics, mismatchCount };
}

/** 把结果格式化成报告文本。 */
export function formatSimReport(result: SimRunResult): string {
  const lines: string[] = [];
  lines.push(`场景 ${result.scenario}（${result.source === 'observations' ? '观测文件' : '驱动'}）`);
  for (const s of result.steps) {
    const icon = s.status === 'pass' ? '✓' : s.status === 'skipped' ? '-' : '✗';
    lines.push(`  ${icon} 步骤 ${s.step} ${s.name} [${s.status}]`);
    for (const m of s.mismatches) {
      lines.push(`      ${m.device}: 期望 ${String(m.expected)}，实际 ${m.observed === undefined ? '(未观测)' : String(m.observed)}`);
    }
  }
  lines.push(
    result.ok
      ? `结果：PASS（${result.steps.filter((s) => s.status === 'pass').length} 步通过，0 处不一致）`
      : `结果：FAIL（${result.mismatchCount} 处不一致）`,
  );
  return lines.join('\n');
}

/** 供 CLI 写报告用：去掉 scenario 内不必要的字段。 */
export function simCpu(scenario: SimScenario): CpuModel {
  return scenario.cpu === 'FX5UJ' ? 'FX5UJ' : 'FX5U';
}
