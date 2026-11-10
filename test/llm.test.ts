/**
 * LLM 兜底 + 修复循环骨架测试（注入假生成器，不触网）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { generateWithLlmFallback, specToRequirement } from '../src/gen/llm.ts';
import type { RequirementSpec } from '../src/spec/index.ts';

const SPEC: RequirementSpec = {
  name: 'llm_demo',
  title: 'LLM 兜底示例',
  cpu: { series: 'FX5U', model: 'FX5U-32MT/ES' },
  template: { name: 'state_machine' },
  io: [
    { device: 'X0', name: 'bStart', type: 'BOOL', comment: '启动' },
    { device: 'Y0', name: 'bRun', type: 'BOOL', comment: '运行' },
  ],
  requirements: [
    { id: 'R1', text: '按下启动后保持运行' },
    { id: 'R2', text: '停止按钮断开输出' },
  ],
};

const GOOD_ST = `PROGRAM Main
VAR
    bRun : BOOL := FALSE;
END_VAR
    IF X0 THEN
        bRun := TRUE;
    END_IF;
    Y0 := bRun;
END_PROGRAM
`;

test('specToRequirement：包含 CPU、验收条款、IO 地址与名称', () => {
  const text = specToRequirement(SPEC);
  assert.match(text, /FX5U/);
  assert.match(text, /\[R1\] 按下启动后保持运行/);
  assert.match(text, /X0 → bStart : BOOL \/\/ 启动/);
  assert.match(text, /Y0 → bRun : BOOL/);
});

test('LLM 兜底：首轮有方言错误，反馈后次轮通过', async () => {
  const sources = [
    `PROGRAM Main
VAR
    bRun : BOOL := FALSE;
END_VAR
    bRun := bNotDefined;
    Y0 := bRun;
END_PROGRAM
`,
    GOOD_ST,
  ];
  const feedbacks: string[] = [];
  let calls = 0;
  const result = await generateWithLlmFallback(SPEC, {
    maxAttempts: 3,
    generate: async ({ feedback }) => {
      feedbacks.push(feedback);
      return sources[Math.min(calls++, sources.length - 1)]!;
    },
  });
  assert.equal(result.ok, true, `诊断: ${JSON.stringify(result.diagnostics)}`);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.stSource, GOOD_ST);
  assert.ok(result.ast);
  assert.equal(feedbacks[0], '');
  assert.match(feedbacks[1], /bNotDefined|E008|未定义/);
});

test('LLM 兜底：多轮仍失败时返回 ok=false 与最终诊断', async () => {
  const result = await generateWithLlmFallback(SPEC, {
    maxAttempts: 2,
    generate: async () =>
      `PROGRAM Main
VAR
    bRun : BOOL := FALSE;
END_VAR
    bRun := bStillMissing;
    Y0 := bRun;
END_PROGRAM
`,
  });
  assert.equal(result.ok, false);
  assert.equal(result.attempts.length, 2);
  assert.ok(result.diagnostics.some((d) => d.severity === 'error'));
  assert.ok(result.note && result.note.length > 0);
});

test('LLM 兜底：生成器抛错时以 LLM_E_CALL 结束，不崩溃', async () => {
  const result = await generateWithLlmFallback(SPEC, {
    maxAttempts: 2,
    generate: async () => {
      throw new Error('网络超时');
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((d) => d.code === 'LLM_E_CALL' && d.message.includes('网络超时')));
});
