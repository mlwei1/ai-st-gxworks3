/**
 * 提示词与 LLM 层的测试。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSystemPrompt, buildUserPrompt, OUTPUT_FORMAT } from '../src/ai/prompt.ts';
import { extractJson } from '../src/ai/client.ts';

test('提示词：包含 FX5U 指令白名单与关键方言规则', () => {
  const p = buildSystemPrompt('FX5U');
  assert.ok(p.includes('TON'), '应包含 TON');
  assert.ok(p.includes('MC_MOVE_ABSOLUTE'), '应包含运动控制指令');
  assert.ok(p.includes('IREF'), '应列出禁止的跨品牌函数');
  assert.ok(p.includes('RAMP_REAL'), '应提示 RAMP_REAL 陷阱');
  assert.ok(p.includes('REAL_TO_INT'), '应提示显式类型转换');
  assert.ok(p.includes('X0-X511'), '应包含 FX5U 设备范围');
});

test('提示词：iQ-R 与 FX5U 的设备范围不同', () => {
  const fx5u = buildSystemPrompt('FX5U');
  const iqr = buildSystemPrompt('iQ-R');
  assert.notEqual(fx5u, iqr);
  assert.ok(iqr.includes('M0-M32767'), 'iQ-R 的 M 范围更大');
});

test('提示词：包含标准功能块形参表（防止 AI 写成 SET/RESET1）', () => {
  const p = buildSystemPrompt('FX5U');
  assert.ok(p.includes('RS'), '应包含 RS');
  assert.ok(p.includes('R1'), '应包含 R1 形参');
  assert.ok(p.includes('Q1'), '应包含 Q1 形参');
  assert.ok(p.includes('RESET1'), '应明确指出 RESET1 是错误写法');
});

test('提示词：不得含有会破坏模板字面量的反引号', () => {
  // 反引号出现在模板字面量内部会导致 TS 语法错误，这里做回归保护
  const p = buildSystemPrompt('FX5U');
  assert.ok(!p.includes('`'), '提示词中不应出现反引号');
});

test('提示词：输出格式说明包含必要字段', () => {
  assert.ok(OUTPUT_FORMAT.includes('pous'));
  assert.ok(OUTPUT_FORMAT.includes('vars'));
  assert.ok(OUTPUT_FORMAT.includes('body'));
  assert.ok(OUTPUT_FORMAT.includes('globalVars'));
});

test('用户提示词：包含需求与 IO 表', () => {
  const u = buildUserPrompt('水箱液位控制', {
    ioTable: 'X0 启动按钮',
    existingVariables: 'nCount : INT',
  });
  assert.ok(u.includes('水箱液位控制'));
  assert.ok(u.includes('X0 启动按钮'));
  assert.ok(u.includes('nCount : INT'));
});
