/**
 * 仿真场景 DSL + 半自动执行器测试（不启动 GX Works3）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  runScenarioWithDriver,
  runScenarioWithObservations,
  validateScenario,
  valuesMatch,
  type SimObservationFile,
  type SimScenario,
} from '../src/sim/index.ts';

const SCENARIO: SimScenario = {
  name: 'motor_demo_sim',
  title: '测试场景',
  cpu: 'FX5U',
  steps: [
    { name: '启动', set: { X0: 1 }, waitMs: 100, expect: { Y0: 1 } },
    { name: '停止', set: { X1: 1 }, waitMs: 100, expect: { Y0: 0 } },
  ],
};

function obs(steps: Array<{ step: number; values: Record<string, boolean | number | string> }>): SimObservationFile {
  return { scenario: 'motor_demo_sim', steps };
}

test('validateScenario：合法场景通过', () => {
  const r = validateScenario(SCENARIO);
  assert.equal(r.ok, true, JSON.stringify(r.diagnostics));
  assert.equal(r.scenario?.name, 'motor_demo_sim');
});

test('validateScenario：设备/名称/步骤/等待时间错误', () => {
  const bad = validateScenario({
    name: '1bad',
    steps: [
      { name: '', set: { X198: 1 }, waitMs: -5 },
    ],
  });
  assert.equal(bad.ok, false);
  const codes = bad.diagnostics.map((d) => d.code);
  assert.ok(codes.includes('SIM_E_NAME'));
  assert.ok(codes.includes('SIM_E_STEP_NAME'));
  assert.ok(codes.includes('SIM_E_DEVICE_BASE'));
  assert.ok(codes.includes('SIM_E_WAIT'));

  assert.equal(validateScenario({ name: 'x', steps: [] }).ok, false);
});

test('valuesMatch：BOOL/数值的宽松比较', () => {
  assert.equal(valuesMatch(true, 1), true);
  assert.equal(valuesMatch('TRUE', true), true);
  assert.equal(valuesMatch('false', 0), true);
  assert.equal(valuesMatch(1, '1'), true);
  assert.equal(valuesMatch(10, 10.0), true);
  assert.equal(valuesMatch(true, 0), false);
  assert.equal(valuesMatch(5, undefined), false);
});

test('观测文件断言：全部符合 → PASS', () => {
  const r = runScenarioWithObservations(
    SCENARIO,
    obs([
      { step: 1, values: { Y0: 1 } },
      { step: 2, values: { Y0: 0 } },
    ]),
  );
  assert.equal(r.ok, true, JSON.stringify(r.steps));
  assert.equal(r.mismatchCount, 0);
  assert.deepEqual(r.steps.map((s) => s.status), ['pass', 'pass']);
});

test('观测文件断言：不一致 → FAIL 并定位设备', () => {
  const r = runScenarioWithObservations(
    SCENARIO,
    obs([
      { step: 1, values: { Y0: 1 } },
      { step: 2, values: { Y0: 1 } },
    ]),
  );
  assert.equal(r.ok, false);
  assert.equal(r.mismatchCount, 1);
  const fail = r.steps[1]!;
  assert.equal(fail.status, 'fail');
  assert.deepEqual(fail.mismatches, [{ device: 'Y0', expected: 0, observed: 1 }]);
});

test('观测文件断言：缺步骤 → missing，不算通过', () => {
  const r = runScenarioWithObservations(SCENARIO, obs([{ step: 1, values: { Y0: 1 } }]));
  assert.equal(r.ok, false);
  assert.equal(r.steps[1]!.status, 'missing');
});

test('执行器驱动：写入/读取顺序与断言', async () => {
  const writes: Array<Record<string, unknown>> = [];
  const reads: string[][] = [];
  const driver = {
    write: (v: Record<string, unknown>) => {
      writes.push(v);
    },
    read: (devices: string[]) => {
      reads.push(devices);
      return devices.includes('Y0') && reads.length === 1 ? { Y0: true } : { Y0: false };
    },
    wait: () => undefined,
  };
  const r = await runScenarioWithDriver(SCENARIO, driver);
  assert.equal(r.ok, true, JSON.stringify(r.steps));
  assert.deepEqual(writes, [{ X0: 1 }, { X1: 1 }]);
  assert.deepEqual(reads, [['Y0'], ['Y0']]);
});
