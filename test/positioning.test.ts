/**
 * 定位指令知识测试：ST 形态、操作数个数、analyzer 参数校验。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FX5_POSITIONING_INSTRUCTIONS, getPositioningInstruction } from '../src/profile/index.ts';
import { parseST } from '../src/dialect/parser.ts';
import { analyzeST } from '../src/dialect/analyzer.ts';

function codes(src: string): string[] {
  return analyzeST(parseST(src), { target: 'FX5U' }).map((d) => d.code);
}

test('定位知识：8 条定位指令均已核实且带 ST 形式/操作数/页码', () => {
  const names = FX5_POSITIONING_INSTRUCTIONS.map((f) => f.name);
  for (const n of ['DRVA', 'DRVI', 'DSZR', 'DVIT', 'DRVTBL', 'PLSV', 'PLSY', 'DPLSY']) {
    assert.ok(names.includes(n), `缺少 ${n}`);
    const f = getPositioningInstruction(n)!;
    assert.equal(f.verified, 'verified', `${n} 应已核实`);
    assert.match(f.stForm, /^ENO:=/, `${n} ST 形式应以 ENO:= 开头`);
    assert.ok(f.operands.length >= 4, `${n} 操作数应至少 4 个`);
    assert.match(f.source, /p\d{3,4}/, `${n} source 应带印刷页码`);
  }
  assert.equal(getPositioningInstruction('DRVA')!.stForm, 'ENO:=DRVA(EN,s1,s2,d1,d2);');
  assert.equal(getPositioningInstruction('PLSV')!.stForm, 'ENO:=PLSV(EN,s,d1,d2);');
  assert.equal(getPositioningInstruction('DRVTBL')!.stForm, 'ENO:=DRVTBL(EN,n1,n2,n3,d1,d2);');
});

test('定位知识：DRVA 合法 ST 调用（5 参）不报参数错误', () => {
  const src = [
    'PROGRAM Main',
    'VAR',
    '    bEno : BOOL;',
    '    bStart : BOOL;',
    '    nTarget : INT;',
    '    nSpeed : WORD;',
    'END_VAR',
    'bEno := DRVA(EN := bStart, s1 := nTarget, s2 := nSpeed, d1 := Y0, d2 := Y1);',
    'END_PROGRAM',
  ].join('\n');
  const c = codes(src);
  assert.ok(!c.includes('E011'), `不应有 E011：${c.join(',')}`);
  assert.ok(!c.includes('W007'), `不应有 W007：${c.join(',')}`);
});

test('定位知识：DRVA 参数个数错误 → E011', () => {
  const src = [
    'PROGRAM Main',
    'VAR',
    '    bEno : BOOL;',
    '    nTarget : INT;',
    'END_VAR',
    'bEno := DRVA(TRUE, nTarget, 100, Y0);',
    'END_PROGRAM',
  ].join('\n');
  assert.ok(codes(src).includes('E011'));
});

test('定位知识：DRVTBL 6 参合法、PLSV 4 参合法', () => {
  const ok1 = [
    'PROGRAM Main',
    'VAR',
    '    bEno : BOOL;',
    '    nStart : WORD := 1;',
    '    nEnd : WORD := 3;',
    '    nMeth : WORD := 0;',
    '    bDone : BOOL;',
    'END_VAR',
    'bEno := DRVTBL(EN := TRUE, n1 := nStart, n2 := nEnd, n3 := nMeth, d1 := 1, d2 := M100);',
    'END_PROGRAM',
  ].join('\n');
  assert.ok(!codes(ok1).includes('E011'));

  const ok2 = [
    'PROGRAM Main',
    'VAR',
    '    bEno : BOOL;',
    '    nSpeed : INT;',
    'END_VAR',
    'bEno := PLSV(EN := TRUE, s := nSpeed, d1 := Y0, d2 := Y1);',
    'END_PROGRAM',
  ].join('\n');
  assert.ok(!codes(ok2).includes('E011'));
  assert.ok(!codes(ok2).includes('W007'));
});

test('定位知识：PLSY 的 ST 形式为 4 参（EN,s,n,d）', () => {
  const src = [
    'PROGRAM Main',
    'VAR',
    '    bEno : BOOL;',
    'END_VAR',
    'bEno := PLSY(EN := TRUE, s := 1000, n := 5000, d := Y0);',
    'END_PROGRAM',
  ].join('\n');
  const c = codes(src);
  assert.ok(!c.includes('E011'), c.join(','));
  assert.ok(!c.includes('W007'), c.join(','));
});
