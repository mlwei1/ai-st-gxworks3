/**
 * 语法错误恢复测试。
 *
 * 检查器必须能在一次运行中报告文件的多个问题，
 * 而不是遇到第一个错误就中止。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseWithRecovery } from '../src/dialect/recovery.ts';
import { analyzeST } from '../src/dialect/analyzer.ts';

test('恢复：无错误时正常解析', () => {
  const { ast, errors } = parseWithRecovery(`
PROGRAM Main
VAR
    nA : INT;
END_VAR
    nA := 1;
END_PROGRAM
`);
  assert.equal(errors.length, 0);
  assert.equal(ast.pous.length, 1);
  assert.equal(ast.pous[0].name, 'Main');
});

test('恢复：语句级错误后继续解析同一 POU 的后续语句', () => {
  const { ast, errors } = parseWithRecovery(`
PROGRAM Main
VAR
    nA : INT;
    bB : BOOL;
END_VAR
    nA := ;
    nA := 2;
    bB := TRUE;
END_PROGRAM
`);
  assert.equal(errors.length, 1, `应报告 1 个语法错误，实际 ${errors.length}`);
  // POU 仍被解析出来，说明恢复成功
  assert.equal(ast.pous.length, 1);
  assert.equal(ast.pous[0].name, 'Main');
});

test('恢复：某个 POU 出错不影响其他 POU 被检查', () => {
  const { ast, errors } = parseWithRecovery(`
PROGRAM Broken
VAR
END_VAR
    nX := ;
END_PROGRAM

PROGRAM Good
VAR
    nY : INT;
END_VAR
    nY := 5;
END_PROGRAM
`);
  assert.ok(errors.length >= 1);
  // Good POU 仍被解析
  const good = ast.pous.find((p) => p.name === 'Good');
  assert.ok(good, 'Good POU 应被解析出来');
  assert.equal(good!.body.length, 1);
});

test('恢复：同一位置的重复错误只报告一次', () => {
  const { errors } = parseWithRecovery(`
PROGRAM Main
VAR
END_VAR
    IF := 1;
END_PROGRAM
`);
  const keys = errors.map((e) => `${e.line}:${e.column}:${e.message}`);
  assert.equal(new Set(keys).size, keys.length, '不应有重复错误');
  assert.ok(errors.length <= 3, `错误数应被去重，实际 ${errors.length}`);
});

test('恢复：恢复过程不会死循环', () => {
  const src = `
PROGRAM Main
VAR
END_VAR
    nX := ;
    IF := 1;
    CASE := 2;
END_PROGRAM
`;
  const start = Date.now();
  const { errors } = parseWithRecovery(src);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 3000, `恢复耗时过长: ${elapsed}ms`);
  assert.ok(errors.length > 0);
});

test('恢复：恢复后的 AST 仍可用于语义检查', () => {
  const { ast, errors } = parseWithRecovery(`
PROGRAM Main
VAR
    nA : INT;
    bB : BOOL;
END_VAR
    nA := ;
    bB := 5;
END_PROGRAM
`);
  assert.ok(errors.length >= 1);
  const diags = analyzeST(ast);
  // bB := 5 是 BOOL 赋整数，应被语义层捕获
  assert.ok(
    diags.some((d) => d.code === 'E014'),
    `应报告 E014，实际: ${diags.map((d) => d.code).join(',')}`,
  );
});
