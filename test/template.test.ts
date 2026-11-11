/**
 * ST 模板库测试（M1-2）。
 *
 * 覆盖：
 *  - 12 个模板各自用最小 spec 实例化 → 无语法错误、analyzer 0 error；
 *  - 关键片段断言（TON、互锁、CASE、REAL 转换、首出等）；
 *  - 参数默认值/覆盖、IO 地址来自 spec、确定性、模板注册表契约。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { analyzeST } from '../src/dialect/analyzer.ts';
import { parseWithRecovery } from '../src/dialect/recovery.ts';
import {
  getTemplate,
  listTemplates,
  mergeParams,
  requireTemplate,
  TEMPLATE_NAMES,
} from '../src/templates/index.ts';
import type { TemplateContext } from '../src/templates/types.ts';

/** 通用最小 IO 集：覆盖 8 个模板需要的所有 X/Y/D 角色。 */
const BASE_IO = [
  { device: 'X0', name: '启动按钮', type: 'BOOL' },
  { device: 'X1', name: '停止按钮', type: 'BOOL' },
  { device: 'X2', name: '故障输入', type: 'BOOL' },
  { device: 'X3', name: '复位按钮', type: 'BOOL' },
  { device: 'X4', name: '确认按钮', type: 'BOOL' },
  { device: 'Y0', name: '运行输出', type: 'BOOL' },
  { device: 'Y1', name: '反转输出', type: 'BOOL' },
  { device: 'Y2', name: '完成输出', type: 'BOOL' },
  { device: 'D100', name: '模拟量输入', type: 'INT' },
  { device: 'D101', name: '标定输出', type: 'INT' },
];

function makeCtx(
  name: string,
  io = BASE_IO,
  params: Record<string, string | number | boolean | undefined> = {},
): TemplateContext {
  const template = requireTemplate(name);
  return {
    spec: {
      name: `${name}_demo`,
      cpu: { series: 'FX5U', model: 'FX5U' },
      io: io.map((i) => ({ ...i })),
    },
    params: mergeParams(template, params),
  };
}

/** 实例化 + 解析 + 分析；返回错误列表。 */
function checkSource(src: string): { syntax: string[]; errors: string[] } {
  const { ast, errors } = parseWithRecovery(src);
  const diagnostics = analyzeST(ast, { target: 'FX5U' });
  return {
    syntax: errors.map((e) => `${e.line}:${e.column} ${e.message}`),
    errors: diagnostics
      .filter((d) => d.severity === 'error')
      .map((d) => `${d.code} ${d.message}（第 ${d.line} 行）`),
  };
}

/* -------------------- 注册表契约 -------------------- */

test('注册表：12 个模板、顺序固定、get/require 行为正确', () => {
  assert.equal(TEMPLATE_NAMES.length, 12);
  const list = listTemplates();
  assert.equal(list.length, 12);
  assert.deepEqual(
    list.map((t) => t.name),
    [...TEMPLATE_NAMES],
  );
  assert.equal(getTemplate('motor_start_stop')?.name, 'motor_start_stop');
  assert.equal(getTemplate('no_such_template'), undefined);
  assert.throws(() => requireTemplate('no_such_template'), /未知模板/);
});

test('参数元数据：name/type/description/default 齐全且默认值类型合法', () => {
  for (const t of listTemplates()) {
    for (const p of t.params) {
      assert.ok(p.name.length > 0, `${t.name}.${p.name} 名称`);
      assert.ok(p.description.length > 0, `${t.name}.${p.name} 描述`);
      assert.ok(['number', 'string', 'boolean'].includes(p.type), `${t.name}.${p.name} 类型`);
      if (p.default !== undefined) {
        assert.equal(typeof p.default, p.type, `${t.name}.${p.name} 默认值类型应为 ${p.type}`);
      }
    }
  }
});

test('mergeParams：默认值打底，外部参数覆盖，undefined 不覆盖', () => {
  const t = requireTemplate('motor_auto_stop');
  assert.deepEqual(mergeParams(t, {}), { autoStopSec: 10 });
  assert.deepEqual(mergeParams(t, { autoStopSec: 3 }), { autoStopSec: 3 });
  assert.deepEqual(mergeParams(t, { autoStopSec: undefined }), { autoStopSec: 10 });
});

test('确定性：同一 ctx 两次实例化输出完全一致', () => {
  for (const name of TEMPLATE_NAMES) {
    const ctx = makeCtx(name);
    const template = requireTemplate(name);
    assert.equal(template.instantiate(ctx), template.instantiate(ctx), `${name} 输出不确定`);
  }
});

/* -------------------- 12 个模板：语法 + 语义 -------------------- */

for (const name of TEMPLATE_NAMES) {
  test(`模板 ${name}：最小 spec 可实例化，且 0 语法错误 / 0 analyzer error`, () => {
    const ctx = makeCtx(name);
    const src = requireTemplate(name).instantiate(ctx);
    assert.ok(src.includes('PROGRAM Main'), '应包含 PROGRAM Main');
    assert.ok(src.includes('END_PROGRAM'), '应包含 END_PROGRAM');
    assert.ok(src.includes('END_VAR'), '应包含 VAR 声明块');
    const { syntax, errors } = checkSource(src);
    assert.deepEqual(syntax, [], `${name} 语法错误：\n${syntax.join('\n')}`);
    assert.deepEqual(errors, [], `${name} analyzer 错误：\n${errors.join('\n')}`);
  });
}

test('IO 地址：来自 spec.io（X/Y/D 直接使用），而非硬编码默认值', () => {
  const io = [
    { device: 'X10', name: '启动', type: 'BOOL' },
    { device: 'X11', name: '停止', type: 'BOOL' },
    { device: 'X12', name: '故障', type: 'BOOL' },
    { device: 'X13', name: '复位', type: 'BOOL' },
    { device: 'X14', name: '确认', type: 'BOOL' },
    { device: 'Y10', name: '正转', type: 'BOOL' },
    { device: 'Y11', name: '反转', type: 'BOOL' },
    { device: 'Y12', name: '完成', type: 'BOOL' },
    { device: 'D200', name: '模拟输入', type: 'INT' },
    { device: 'D201', name: '模拟输出', type: 'INT' },
  ];
  const rev = requireTemplate('motor_reverse_interlock').instantiate(makeCtx('motor_reverse_interlock', io));
  assert.ok(rev.includes('X10') && rev.includes('X11') && rev.includes('Y10') && rev.includes('Y11'));
  const analog = requireTemplate('analog_scale').instantiate(makeCtx('analog_scale', io));
  assert.ok(analog.includes('INT_TO_REAL(D200)'));
  assert.ok(analog.includes('D201 := REAL_TO_INT(fEng);'));
});

/* -------------------- 关键片段断言 -------------------- */

test('motor_auto_stop：含 TON 声明与调用，参数 autoStopSec 生效', () => {
  const t = requireTemplate('motor_auto_stop');
  const dflt = t.instantiate(makeCtx('motor_auto_stop'));
  assert.ok(dflt.includes('tAutoStop : TON;'), '应声明 TON 实例');
  assert.ok(dflt.includes('tAutoStop(IN := bRun, PT := T#10000ms);'), '默认 10s → T#10000ms');
  assert.ok(dflt.includes('IF bRun AND tAutoStop.Q THEN'), '应读取 .Q');

  const fast = t.instantiate(makeCtx('motor_auto_stop', BASE_IO, { autoStopSec: 0.5 }));
  assert.ok(fast.includes('PT := T#500ms'), '0.5s → T#500ms');
});

test('motor_reverse_interlock：互锁输出与换向死区', () => {
  const t = requireTemplate('motor_reverse_interlock');
  const src = t.instantiate(makeCtx('motor_reverse_interlock'));
  assert.ok(src.includes('nDirOut = 1;') && src.includes('nDirOut = 2;'), '正反转互锁输出');
  assert.ok(src.includes('Y0 := nDirOut = 1;'), 'Y0 正转输出');
  assert.ok(src.includes('Y1 := nDirOut = 2;'), 'Y1 反转输出');
  assert.ok(src.includes('tDead(IN := TRUE, PT := T#500ms);'), '默认死区 0.5s');

  const slow = t.instantiate(makeCtx('motor_reverse_interlock', BASE_IO, { deadTimeSec: 2 }));
  assert.ok(slow.includes('PT := T#2000ms'), '自定义死区 2s');
});

test('state_machine：CASE 状态机 + 非法转移保护', () => {
  const src = requireTemplate('state_machine').instantiate(makeCtx('state_machine'));
  assert.ok(src.includes('CASE nState OF'), '应有 CASE');
  assert.ok(src.includes('IF nState < 0 OR nState > 2 THEN'), '应有越界保护');
  assert.ok(src.includes('ELSE // 兜底：未知状态回待机'), '应有 ELSE 兜底');
  assert.ok(src.includes('Y0 := nState = 1;'), '运行输出');
});

test('analog_scale：显式 INT_TO_REAL/REAL_TO_INT + 线性标定 + 限幅', () => {
  const t = requireTemplate('analog_scale');
  const src = t.instantiate(makeCtx('analog_scale'));
  assert.ok(src.includes('fSpan := INT_TO_REAL(nRawMax - nRawMin);'));
  assert.ok(src.includes('fRatio := (INT_TO_REAL(D100) - INT_TO_REAL(nRawMin)) / fSpan;'));
  assert.ok(src.includes('D101 := REAL_TO_INT(fEng);'));
  assert.ok(src.includes('fSpan <= 0.0') && src.includes('fEng > fEngMax'), '应有除零/限幅保护');

  const custom = t.instantiate(makeCtx('analog_scale', BASE_IO, { rawMin: 400, rawMax: 2000, engMin: -50, engMax: 50 }));
  assert.ok(custom.includes('nRawMin : INT := 400;'));
  assert.ok(custom.includes('nRawMax : INT := 2000;'));
  assert.ok(custom.includes('fEngMin : REAL := -50.0;'), '负的工程量程下限');
  assert.ok(custom.includes('fEngMax : REAL := 50.0;'));
});

test('timer_sequence：3 个 TON + 参数化每步时间', () => {
  const t = requireTemplate('timer_sequence');
  const src = t.instantiate(makeCtx('timer_sequence'));
  assert.ok(src.includes('tStep1 : TON;') && src.includes('tStep2 : TON;') && src.includes('tStep3 : TON;'));
  assert.ok(src.includes('PT := T#2000ms') && src.includes('PT := T#3000ms') && src.includes('PT := T#5000ms'));
  const custom = t.instantiate(makeCtx('timer_sequence', BASE_IO, { step1Sec: 1, step2Sec: 2, step3Sec: 3 }));
  assert.ok(custom.includes('PT := T#1000ms') && custom.includes('PT := T#2000ms') && custom.includes('PT := T#3000ms'));
});

test('timer_sequence：步数可配置（3→5 步 / 1 步），非法步数抛错', () => {
  const t = requireTemplate('timer_sequence');
  const five = t.instantiate(
    makeCtx('timer_sequence', BASE_IO, {
      stepCount: 5,
      step4Sec: 1,
      step5Sec: 2,
    }),
  );
  assert.ok(five.includes('tStep5 : TON;'), '5 步应有第 5 个定时器');
  assert.ok(five.includes('nSeq = 5;'), '第 5 步输出');
  assert.ok(five.includes('PT := T#1000ms') && five.includes('PT := T#2000ms'), 'step4/5 秒参数生效');
  // 第 5 步完成后返回 0
  assert.ok(five.includes('nSeq := 0;'));

  const one = t.instantiate(makeCtx('timer_sequence', BASE_IO, { stepCount: 1 }));
  assert.ok(one.includes('tStep1 : TON;') && !one.includes('tStep2'));
  assert.throws(() => t.instantiate(makeCtx('timer_sequence', BASE_IO, { stepCount: 9 })), /1\.\.8/);
});

test('counter_batch：R_TRIG + CTU + 批量复位', () => {
  const t = requireTemplate('counter_batch');
  const src = t.instantiate(makeCtx('counter_batch'));
  assert.ok(src.includes('fbEdge : R_TRIG;') && src.includes('fbCount : CTU;'));
  assert.ok(src.includes('PV := 10)'), '默认批量 10');
  assert.ok(src.includes('R := bBatchDone OR X1,'), '复位含批量完成与复位按钮');
  const custom = t.instantiate(makeCtx('counter_batch', BASE_IO, { batchSize: 25 }));
  assert.ok(custom.includes('PV := 25)'));
});

test('alarm_first_out：3 路首出 + 确认 + 复位；非法 alarmCount 抛错', () => {
  const t = requireTemplate('alarm_first_out');
  const src = t.instantiate(makeCtx('alarm_first_out'));
  assert.ok(src.includes('bFirst1 : BOOL') && src.includes('bFirstLatched : BOOL'));
  assert.ok(src.includes('(bFirst1 OR bFirst2 OR bFirst3) AND NOT bAck'), '确认后首出指示熄灭');
  assert.throws(() => t.instantiate(makeCtx('alarm_first_out', BASE_IO, { alarmCount: 0 })), /1\.\.16/);
  assert.throws(() => t.instantiate(makeCtx('alarm_first_out', BASE_IO, { alarmCount: 17 })), /1\.\.16/);
});

test('alarm_first_out：路数可配置（2 路 / 4 路）', () => {
  const t = requireTemplate('alarm_first_out');
  const two = t.instantiate(makeCtx('alarm_first_out', BASE_IO, { alarmCount: 2 }));
  assert.ok(two.includes('bAlarm2 : BOOL') && !two.includes('bAlarm3 : BOOL'), '2 路不应生成第 3 路');
  assert.ok(two.includes('(bFirst1 OR bFirst2) AND NOT bAck'));
  // 确认/复位设备顺延：2 路时确认=X2、复位=X3
  assert.ok(two.includes('IF X2 THEN'), '确认按钮应为 X2');
  assert.ok(two.includes('IF X3 THEN'), '复位按钮应为 X3');

  const four = t.instantiate(makeCtx('alarm_first_out', BASE_IO, { alarmCount: 4 }));
  assert.ok(four.includes('bAlarm4 : BOOL') && four.includes('bFirst4 : BOOL'));
  assert.ok(four.includes('(bFirst1 OR bFirst2 OR bFirst3 OR bFirst4) AND NOT bAck'));
  assert.ok(four.includes('IF X4 THEN') && four.includes('IF X5 THEN'), '4 路时确认/复位顺延');
});

test('motor_start_stop：manual / auto 两种故障复位分支', () => {
  const t = requireTemplate('motor_start_stop');
  const manual = t.instantiate(makeCtx('motor_start_stop'));
  assert.ok(manual.includes('IF X1 OR X3 THEN'), 'manual：停止或复位按钮复位');
  const auto = t.instantiate(makeCtx('motor_start_stop', BASE_IO, { faultReset: 'auto' }));
  assert.ok(auto.includes('故障复位（auto）'));
  assert.ok(!auto.includes('IF X1 OR X3 THEN'), 'auto 不应要求按钮复位');
});
