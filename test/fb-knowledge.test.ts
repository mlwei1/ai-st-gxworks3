/**
 * 标准 FB 形参知识（来自指令篇手册逐页核对，2026-11-11）。
 *  - profile 中 FB 形参必须 verified，且名称/类型与手册参数表一致
 *  - analyzer 按形参名校验命名参数（E016/E017）、必填缺失（W009）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FX5_STANDARD_FBS } from '../src/profile/index.ts';
import { parseST } from '../src/dialect/parser.ts';
import { analyzeST } from '../src/dialect/analyzer.ts';

function codes(src: string): string[] {
  const r = analyzeST(parseST(src), { target: 'FX5U' });
  return r.map((d) => d.code);
}

function fb(name: string) {
  const f = FX5_STANDARD_FBS.find((x) => x.name === name);
  assert.ok(f, `profile 缺少 FB ${name}`);
  return f!;
}

const EXPECTED: Record<string, { inputs: string[]; outputs: string[]; types: Record<string, string> }> = {
  TON: { inputs: ['IN', 'PT'], outputs: ['Q', 'ET'], types: { IN: 'BOOL', PT: 'TIME', Q: 'BOOL', ET: 'TIME' } },
  TOF: { inputs: ['IN', 'PT'], outputs: ['Q', 'ET'], types: { IN: 'BOOL', PT: 'TIME', Q: 'BOOL', ET: 'TIME' } },
  TP: { inputs: ['IN', 'PT'], outputs: ['Q', 'ET'], types: { IN: 'BOOL', PT: 'TIME', Q: 'BOOL', ET: 'TIME' } },
  CTU: { inputs: ['CU', 'R', 'PV'], outputs: ['Q', 'CV'], types: { CU: 'BOOL', R: 'BOOL', PV: 'INT', Q: 'BOOL', CV: 'INT' } },
  CTD: { inputs: ['CD', 'LD', 'PV'], outputs: ['Q', 'CV'], types: { CD: 'BOOL', LD: 'BOOL', PV: 'INT', Q: 'BOOL', CV: 'INT' } },
  CTUD: {
    inputs: ['CU', 'CD', 'R', 'LD', 'PV'],
    outputs: ['QU', 'QD', 'CV'],
    types: { CU: 'BOOL', CD: 'BOOL', R: 'BOOL', LD: 'BOOL', PV: 'INT', QU: 'BOOL', QD: 'BOOL', CV: 'INT' },
  },
  R_TRIG: { inputs: ['CLK'], outputs: ['Q'], types: { CLK: 'BOOL', Q: 'BOOL' } },
  F_TRIG: { inputs: ['CLK'], outputs: ['Q'], types: { CLK: 'BOOL', Q: 'BOOL' } },
  RS: { inputs: ['S', 'R1'], outputs: ['Q1'], types: { S: 'BOOL', R1: 'BOOL', Q1: 'BOOL' } },
  SR: { inputs: ['S1', 'R'], outputs: ['Q1'], types: { S1: 'BOOL', R: 'BOOL', Q1: 'BOOL' } },
};

test('FB 知识：10 个标准 FB 形参均已核实，名称/类型与手册一致', () => {
  for (const [name, exp] of Object.entries(EXPECTED)) {
    const f = fb(name);
    assert.equal(f.paramsVerified, 'verified', `${name} 应已核实`);
    assert.deepEqual([...f.inputs], exp.inputs, `${name} 输入参数`);
    assert.deepEqual([...f.outputs], exp.outputs, `${name} 输出参数`);
    assert.ok(f.params, `${name} 应记录完整形参表`);
    const map = Object.fromEntries(f.params!.map((p) => [p.name, p.type]));
    assert.deepEqual(map, exp.types, `${name} 形参类型`);
    assert.match(f.source, /p\d{4}/, `${name} source 应带印刷页码`);
  }
});

test('FB 知识：TON 合法命名参数不报警', () => {
  const src = [
    'PROGRAM Main',
    'VAR',
    '    t1 : TON;',
    '    bStart : BOOL;',
    '    bOut : BOOL;',
    '    tElapsed : TIME;',
    'END_VAR',
    't1(IN := bStart, PT := T#2s, Q => bOut, ET => tElapsed);',
    'END_PROGRAM',
  ].join('\n');
  const c = codes(src);
  assert.ok(!c.includes('E016'), `不应有 E016：${c.join(',')}`);
  assert.ok(!c.includes('E017'), `不应有 E017：${c.join(',')}`);
  assert.ok(!c.includes('W009'), `不应有 W009：${c.join(',')}`);
});

test('FB 知识：TON 未知输入参数 → E016', () => {
  const src = [
    'PROGRAM Main',
    'VAR',
    '    t1 : TON;',
    '    bStart : BOOL;',
    'END_VAR',
    't1(IN := bStart, XX := TRUE);',
    'END_PROGRAM',
  ].join('\n');
  const c = codes(src);
  assert.ok(c.includes('E016'), `应报 E016：${c.join(',')}`);
});

test('FB 知识：TON 未知输出参数 → E017', () => {
  const src = [
    'PROGRAM Main',
    'VAR',
    '    t1 : TON;',
    '    bStart : BOOL;',
    '    bOut : BOOL;',
    'END_VAR',
    't1(IN := bStart, PT := T#1s, ZZ => bOut);',
    'END_PROGRAM',
  ].join('\n');
  const c = codes(src);
  assert.ok(c.includes('E017'), `应报 E017：${c.join(',')}`);
});

test('FB 知识：TON 缺少必填输入 IN → W009', () => {
  const src = [
    'PROGRAM Main',
    'VAR',
    '    t1 : TON;',
    '    bOut : BOOL;',
    'END_VAR',
    't1(PT := T#1s, Q => bOut);',
    'END_PROGRAM',
  ].join('\n');
  const c = codes(src);
  assert.ok(c.includes('W009'), `应报 W009：${c.join(',')}`);
});

test('FB 知识：CTU 合法调用（CU/R/PV → Q/CV）不报警', () => {
  const src = [
    'PROGRAM Main',
    'VAR',
    '    c1 : CTU;',
    '    bPulse : BOOL;',
    '    bDone : BOOL;',
    '    nCount : INT;',
    'END_VAR',
    'c1(CU := bPulse, R := FALSE, PV := 10, Q => bDone, CV => nCount);',
    'END_PROGRAM',
  ].join('\n');
  const c = codes(src);
  assert.ok(!c.includes('E016'), `不应有 E016：${c.join(',')}`);
  assert.ok(!c.includes('E017'), `不应有 E017：${c.join(',')}`);
  assert.ok(!c.includes('W009'), `不应有 W009：${c.join(',')}`);
});

test('FB 知识：R_TRIG 形参 CLK/Q 可用，错误名 CU 报 E016', () => {
  const ok = [
    'PROGRAM Main',
    'VAR',
    '    r1 : R_TRIG;',
    '    bIn : BOOL;',
    '    bOut : BOOL;',
    'END_VAR',
    'r1(CLK := bIn, Q => bOut);',
    'END_PROGRAM',
  ].join('\n');
  assert.ok(!codes(ok).includes('E016'));

  const bad = [
    'PROGRAM Main',
    'VAR',
    '    r1 : R_TRIG;',
    '    bIn : BOOL;',
    'END_VAR',
    'r1(CU := bIn);',
    'END_PROGRAM',
  ].join('\n');
  assert.ok(codes(bad).includes('E016'));
});
