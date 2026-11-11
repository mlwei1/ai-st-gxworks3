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
  assert.ok(p.includes('COUNTER_FB_M'), '应包含真实存在的 FX5 通用 FB 名');
  assert.ok(p.includes('IREF'), '应列出禁止的跨品牌函数');
  assert.ok(p.includes('RAMP_REAL'), '应提示 RAMP/RAMP_REAL 不存在');
  assert.ok(p.includes('REAL_TO_INT'), '应提示显式类型转换');
  assert.ok(p.includes('X1777'), '应包含修正后的 FX5U X 范围（八进制）');
  assert.ok(p.includes('八进制'), '应说明 X/Y 为八进制');
  assert.ok(p.includes('单引号'), '应包含字符串引号规则');
});

test('提示词：iQ-R 与 FX5U 的设备范围不同', () => {
  const fx5u = buildSystemPrompt('FX5U');
  const iqr = buildSystemPrompt('iQ-R');
  assert.notEqual(fx5u, iqr);
  assert.ok(iqr.includes('未验证') || iqr.includes('尚未验证'), 'iQ-R 应明确标注未验证，而不是给出错误范围');
});

test('提示词：包含标准功能块形参表（防止 AI 写成 SET/RESET1）', () => {
  const p = buildSystemPrompt('FX5U');
  assert.ok(p.includes('RS'), '应包含 RS');
  assert.ok(p.includes('R1'), '应包含 R1 形参');
  assert.ok(p.includes('Q1'), '应包含 Q1 形参');
  assert.ok(p.includes('RESET1'), '应明确指出 RESET1 是错误写法');
});

test('提示词：包含通信模板与 RS2 操作数限制（实测坑）', () => {
  const p = buildSystemPrompt('FX5U');
  assert.ok(p.includes('modbus_read'), '应包含 modbus_read 模板');
  assert.ok(p.includes('serial_send_recv'), '应包含 serial_send_recv 模板');
  assert.ok(p.includes('ADPRW'), '应包含 ADPRW 指令形式');
  assert.ok(p.includes('SM8401'), '应包含 RS2 发送待机标志');
  assert.ok(p.includes('SD8403'), '应包含接收点数判定');
  assert.ok(p.includes('0x12011070'), '应提示 RS2 标签不可用的实测错误');
});

test('提示词：不得含有会破坏模板字面量的反引号', () => {
  // 反引号出现在模板字面量内部会导致 TS 语法错误，这里做回归保护
  const p = buildSystemPrompt('FX5U');
  assert.ok(!p.includes('`'), '提示词中不应出现反引号');
});

test('提示词：包含工业步进程序骨架规则（模式/气缸报警/停止序列/HMI）', () => {
  const p = buildSystemPrompt('FX5U');
  assert.ok(p.includes('停止中'), '应包含停止中模式');
  assert.ok(p.includes('气缸动作监视'), '应包含气缸超时监视规则');
  assert.ok(p.includes('报警'), '应包含报警处理规则');
  assert.ok(p.includes('停止序列'), '应包含停止序列规则');
  assert.ok(p.includes('急停'), '应包含急停暂停规则');
  assert.ok(p.includes('spec.sequence.industrial.hmi'), '应指向工业 HMI 地址表字段');
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
