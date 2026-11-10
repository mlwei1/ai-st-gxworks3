/**
 * GX Works3 编译诊断回灌：解析（JSON/文本）+ 格式化 + 转诊断。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compilerErrorsToDiagnostics,
  formatCompilerFeedback,
  parseCompilerErrors,
} from '../src/gen/compiler-feedback.ts';

test('JSON 数组：完整条目保留 code/line/pou', () => {
  const { entries, diagnostics } = parseCompilerErrors(
    JSON.stringify([
      { code: '0x11021040', message: '锁存区标签必须为 RETAIN', line: 12, pou: 'Main' },
      { message: '未定义的标识符 bFault', line: 30 },
    ]),
  );
  assert.equal(diagnostics.length, 0);
  assert.equal(entries.length, 2);
  assert.equal(entries[0]!.code, '0x11021040');
  assert.equal(entries[0]!.line, 12);
  assert.equal(entries[0]!.pou, 'Main');
  assert.equal(entries[1]!.message, '未定义的标识符 bFault');
});

test('JSON 对象 errors / compilerErrors 两种包装都支持', () => {
  const a = parseCompilerErrors({ errors: [{ message: 'a' }] });
  assert.equal(a.entries.length, 1);
  const b = parseCompilerErrors({ compilerErrors: [{ message: 'b' }] });
  assert.equal(b.entries.length, 1);
  const bad = parseCompilerErrors({ foo: 1 });
  assert.ok(bad.diagnostics.some((d) => d.code === 'CFB_W_SHAPE'));
});

test('纯文本：GX Works3 Output 常见行可解析出错误码/行号/POU', () => {
  const text = [
    'No.  Result  Data Name  Category  Content  Error Code',
    '----------------------------------------------------',
    '1    Error   Main       Compile   标签未定义  0x11021040 第 12 行',
    '2    Error   Main       Compile   非法设备地址 X198  第 20 行',
  ].join('\n');
  const { entries } = parseCompilerErrors(text);
  assert.equal(entries.length, 2);
  assert.equal(entries[0]!.code, '0x11021040');
  assert.equal(entries[0]!.line, 12);
  assert.equal(entries[0]!.pou, 'Main');
  assert.equal(entries[1]!.line, 20);
});

test('formatCompilerFeedback / compilerErrorsToDiagnostics', () => {
  const entries = [
    { code: '0x11021040', message: '锁存区标签必须为 RETAIN', line: 12, pou: 'Main' },
  ];
  const feedback = formatCompilerFeedback(entries);
  assert.ok(feedback.includes('【GX Works3 全部转换错误】'));
  assert.ok(feedback.includes('0x11021040'));
  assert.ok(feedback.includes('Main'));

  const diags = compilerErrorsToDiagnostics(entries);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.severity, 'error');
  assert.equal(diags[0]!.code, 'GXW3_0x11021040');
  assert.equal(diags[0]!.line, 12);
});

test('空输入 / 无法识别条目：不崩溃，给出诊断', () => {
  assert.equal(parseCompilerErrors('').entries.length, 0);
  const { entries, diagnostics } = parseCompilerErrors(['', { foo: 'bar' }]);
  assert.equal(entries.length, 0);
  assert.ok(diagnostics.some((d) => d.code === 'CFB_W_ENTRY'));
});
