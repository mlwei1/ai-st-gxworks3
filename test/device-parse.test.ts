/**
 * 软元件解析与 BOM 容忍测试（FX5U 八进制/十六进制/十进制地址）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseWithRecovery } from '../src/dialect/recovery.ts';
import { analyzeST } from '../src/dialect/analyzer.ts';

function analyze(src: string) {
  const { ast, errors } = parseWithRecovery(src);
  assert.equal(errors.length, 0, `解析错误: ${JSON.stringify(errors)}`);
  return analyzeST(ast, { target: 'FX5U' });
}

function codes(src: string): string[] {
  return analyze(src).map((d) => d.code);
}

test('FX5U 八进制：X1777 合法、X2000 越界、X198 非法八进制', () => {
  assert.deepEqual(codes('PROGRAM P\nVAR a : BOOL; END_VAR\n a := X1777;\nEND_PROGRAM'), []);
  assert.ok(codes('PROGRAM P\nVAR a : BOOL; END_VAR\n a := X2000;\nEND_PROGRAM').includes('E009'));
  assert.ok(codes('PROGRAM P\nVAR a : BOOL; END_VAR\n a := X198;\nEND_PROGRAM').includes('E009'));
});

test('FX5U 十六进制：B7FFF / W7FFF 是合法软元件', () => {
  assert.deepEqual(
    codes('PROGRAM P\nVAR a : BOOL; END_VAR\n a := B7FFF;\nEND_PROGRAM'),
    [],
  );
  assert.deepEqual(
    codes('PROGRAM P\nVAR a : WORD; END_VAR\n a := W7FFF;\nEND_PROGRAM'),
    [],
  );
});

test('FX5U 十进制：M1000 合法、M40000 越界、D7999 合法', () => {
  assert.deepEqual(codes('PROGRAM P\nVAR a : BOOL; END_VAR\n a := M1000;\nEND_PROGRAM'), []);
  assert.ok(codes('PROGRAM P\nVAR a : BOOL; END_VAR\n a := M40000;\nEND_PROGRAM').includes('E009'));
  assert.deepEqual(codes('PROGRAM P\nVAR a : DINT; END_VAR\n a := D7999;\nEND_PROGRAM'), []);
});

test('普通变量名不会被误判为软元件（bStart / tTimer）', () => {
  const src = `PROGRAM P
VAR
    bStart : BOOL;
    tTimer : TON;
END_VAR
    IF bStart THEN
        tTimer(IN := TRUE, PT := T#1s);
    END_IF;
END_PROGRAM
`;
  assert.deepEqual(codes(src), []);
});

test('UTF-8 BOM 不影响解析', () => {
  const src = '\uFEFFPROGRAM P\nVAR a : BOOL; END_VAR\n a := X0;\nEND_PROGRAM';
  assert.deepEqual(codes(src), []);
});
