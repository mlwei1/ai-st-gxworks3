// RAG 手册知识固化的规则测试（docs/RAG）。
//
// 依据：MELSEC iQ-R/MELSEC iQ-F 结构化文本(ST)编程指南（SH-081465CHN）
//   - p13/88：注释支持 (* ... *)、C 风格块注释、// 行注释
//   - p31/91：ASCII 字符串单引号、Unicode 字符串双引号
//   - 附3 p98：iQ-F 不支持 LREAL、Unicode 字符串常数

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseWithRecovery } from '../src/dialect/recovery.ts';
import { analyzeST } from '../src/dialect/analyzer.ts';

function analyze(src: string) {
  return analyzeST(parseWithRecovery(src).ast, { target: 'FX5U' });
}

function codes(src: string): string[] {
  return analyze(src).map((d) => d.code);
}

test('官方手册：C 风格 /* */ 块注释可解析（多行 + 中文）', () => {
  const src = [
    'PROGRAM Main',
    'VAR',
    '    bFlag : BOOL;',
    'END_VAR',
    '/* 官方手册支持 C 语言风格注释',
    '   第二行说明 */',
    'bFlag := TRUE;',
    'END_PROGRAM',
  ].join('\n');
  const { errors } = parseWithRecovery(src);
  assert.equal(errors.length, 0, errors.map((e) => e.message).join('; '));
  assert.equal(analyze(src).filter((d) => d.severity === 'error').length, 0);
});

test('官方手册：/* 未闭合应报块注释未闭合', () => {
  assert.throws(
    () => parseWithRecovery('PROGRAM Main\n/* 没有闭合\nEND_PROGRAM'),
    /块注释未闭合/,
  );
});

test('官方手册附3：iQ-F 不支持 Unicode 字符串常数（双引号）→ W010', () => {
  const src = [
    'PROGRAM Main',
    'VAR',
    '    sMsg : STRING;',
    'END_VAR',
    'sMsg := "ABC";',
    'END_PROGRAM',
  ].join('\n');
  const result = codes(src);
  assert.ok(result.includes('W010'), `期望 W010，实际：${result.join(',')}`);

  const ascii = [
    'PROGRAM Main',
    'VAR',
    '    sMsg : STRING;',
    'END_VAR',
    "sMsg := 'ABC';",
    'END_PROGRAM',
  ].join('\n');
  assert.ok(!codes(ascii).includes('W010'));
});

test('指令篇：ST 中 LIMIT 是 3 参通用功能，不再误报方言陷阱', () => {
  const src = [
    'PROGRAM Main',
    'VAR',
    '    nIn : INT;',
    '    nOut : INT;',
    'END_VAR',
    'nOut := LIMIT(0, nIn, 100);',
    'END_PROGRAM',
  ].join('\n');
  const result = codes(src);
  assert.ok(!result.includes('W006'), `不应再报 LIMIT 陷阱，实际：${result.join(',')}`);
  assert.ok(!result.includes('E011'), `3 参 LIMIT 参数个数应正确，实际：${result.join(',')}`);
});

test('指令篇：LIMIT 4 操作数指令形式在 ST 中应报参数个数错误', () => {
  const src = [
    'PROGRAM Main',
    'VAR',
    '    nIn : INT;',
    '    nOut : INT;',
    'END_VAR',
    'LIMIT(0, 100, nIn, nOut);',
    'END_PROGRAM',
  ].join('\n');
  assert.ok(codes(src).includes('E011'), ' 4 参 LIMIT 应报 E011（梯形图指令不支持 ST）');
});

test('指令篇：RAMPF 指令（ST 形式 ENO:=RAMPF(EN,s1,s2,n,d)）可识别', () => {
  const src = [
    'PROGRAM Main',
    'VAR',
    '    bEn : BOOL;',
    '    bEno : BOOL;',
    '    nOut : INT;',
    'END_VAR',
    'bEno := RAMPF(bEn, 0, 100, 10, nOut);',
    'END_PROGRAM',
  ].join('\n');
  const result = codes(src);
  assert.ok(!result.includes('W007'), `RAMPF 不应再报“无法确认”，实际：${result.join(',')}`);
  assert.ok(!result.includes('E011'), `RAMPF 5 参应匹配，实际：${result.join(',')}`);
});
