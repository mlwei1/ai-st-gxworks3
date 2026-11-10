/**
 * 修复循环骨架测试（不依赖 LLM/spec）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFeedback,
  formatDiagnosticsForFeedback,
  hasNoErrors,
  runRepairLoop,
  type DiagnosticLike,
} from '../src/gen/repair.ts';

function err(code: string, message: string, line = 1): DiagnosticLike {
  return { severity: 'error', code, message, line };
}

test('首轮成功：只调用一次，ok=true', async () => {
  let calls = 0;
  const result = await runRepairLoop<{ n: number }>({
    generate: () => {
      calls++;
      return { output: { n: 1 }, diagnostics: [] };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
  assert.deepEqual(result.result, { n: 1 });
  assert.equal(result.attempts.length, 1);
});

test('首轮失败、次轮成功：反馈文本回灌给第二轮', async () => {
  const seen: string[] = [];
  const result = await runRepairLoop<number>({
    maxAttempts: 3,
    generate: (attempt, feedback) => {
      seen.push(feedback);
      if (attempt === 1) return { output: 1, diagnostics: [err('E008', "未定义的标识符 'bFault'", 12)] };
      return { output: 2, diagnostics: [] };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.result, 2);
  assert.equal(result.attempts.length, 2);
  assert.equal(seen[0], '');
  assert.match(seen[1], /E008/);
  assert.match(seen[1], /bFault/);
});

test('超过最大轮数仍失败：返回最后结果与历史', async () => {
  let calls = 0;
  const result = await runRepairLoop<string>({
    maxAttempts: 2,
    generate: () => {
      calls++;
      return { output: `try${calls}`, diagnostics: [err('E004', '未知数据类型')] };
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.ok, false);
  assert.equal(result.result, 'try2');
  assert.equal(result.attempts.length, 2);
  assert.deepEqual(result.diagnostics.map((d) => d.code), ['E004']);
});

test('warning 不阻断（默认判定）；isSuccess 可自定义', async () => {
  const result = await runRepairLoop<number>({
    generate: () => ({ output: 7, diagnostics: [{ severity: 'warning', code: 'W001', message: 'x' }] }),
  });
  assert.equal(result.ok, true);

  const strict = await runRepairLoop<number>({
    isSuccess: (ds) => ds.length === 0,
    maxAttempts: 1,
    generate: () => ({ output: 8, diagnostics: [{ severity: 'warning', code: 'W001', message: 'x' }] }),
  });
  assert.equal(strict.ok, false);
});

test('反馈格式化：包含位置/规则号/提示，且可包含 warning', () => {
  const d: DiagnosticLike = {
    severity: 'error',
    code: 'E009',
    message: '设备地址 X198 含非法八进制数字',
    line: 3,
    column: 5,
    pou: 'Main',
    hint: 'X 的编号为八进制',
  };
  const text = formatDiagnosticsForFeedback(d);
  assert.match(text, /ERROR E009:3:5 \[Main\]/);
  assert.match(text, /提示: X 的编号为八进制/);

  const feedback = buildFeedback(
    [d, { severity: 'warning', code: 'W001', message: 'w' }, { severity: 'info', code: 'I001', message: 'i' }],
    true,
  );
  assert.match(feedback, /E009/);
  assert.match(feedback, /W001/);
  assert.doesNotMatch(feedback, /I001/);
});

test('只有 info 时无法形成反馈，提前结束', async () => {
  let calls = 0;
  const result = await runRepairLoop<number>({
    maxAttempts: 3,
    // 强制判定失败，才能走到「反馈为空」分支
    isSuccess: () => false,
    generate: () => {
      calls++;
      return { output: 1, diagnostics: [{ severity: 'info', code: 'I001', message: 'i' }] };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, false);
  assert.equal(hasNoErrors([{ severity: 'warning', code: 'W', message: 'x' }]), true);
});
