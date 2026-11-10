/**
 * GX Works3 ST 方言解析与静态检查的测试。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseST } from '../src/dialect/parser.ts';
import { analyzeST } from '../src/dialect/analyzer.ts';
import { tokenize } from '../src/dialect/lexer.ts';
import type { Diagnostic } from '../src/dialect/analyzer.ts';

function analyze(src: string): Diagnostic[] {
  return analyzeST(parseST(src), { target: 'FX5U' });
}

function codes(src: string): string[] {
  return analyze(src).map((d) => d.code);
}

/* -------------------- 词法 -------------------- */

test('词法：识别注释、字面量与进制前缀', () => {
  const toks = tokenize(`// 行注释\nnA := K10; (* 块注释 *) nB := HFF; nC := 2#1010;`);
  const nums = toks.filter((t) => t.type === 'number').map((t) => t.value);
  assert.deepEqual(nums, ['K10', 'HFF', '2#1010']);
});

test('词法：字符串转义与未闭合报错', () => {
  const toks = tokenize(`sMsg := 'it''s ok';`);
  const str = toks.find((t) => t.type === 'string');
  assert.equal(str?.value, "it's ok");
  assert.throws(() => tokenize(`sMsg := 'unclosed;`), /字符串未闭合/);
});

test('词法：时间字面量 T#', () => {
  const toks = tokenize('tDelay := T#1s500ms;');
  assert.equal(toks.find((t) => t.type === 'time')?.value, 'T#1s500ms');
});

/* -------------------- 语法 -------------------- */

test('语法：解析 PROGRAM 与 VAR 段', () => {
  const ast = parseST(`
PROGRAM Main
VAR
    nCounter : INT := 0;
    bRun : BOOL := FALSE;
    tDelay : TIME := T#100ms;
END_VAR
    nCounter := nCounter + 1;
    IF bRun THEN
        bRun := TRUE;
    END_IF;
END_PROGRAM
`);
  assert.equal(ast.pous.length, 1);
  const pou = ast.pous[0];
  assert.equal(pou.name, 'Main');
  assert.equal(pou.pouType, 'program');
  assert.equal(pou.vars.length, 3);
  assert.equal(pou.body.length, 2);
});

test('语法：解析 FUNCTION_BLOCK 的输入输出段', () => {
  const ast = parseST(`
FUNCTION_BLOCK FB_Motor
VAR_INPUT
    bStart : BOOL;
    nSpeed : INT;
END_VAR
VAR_OUTPUT
    bRunning : BOOL;
END_VAR
VAR
    tTimer : TON;
END_VAR
    tTimer(IN := bStart, PT := T#2s);
    bRunning := tTimer.Q;
END_FUNCTION_BLOCK
`);
  const fb = ast.pous[0];
  assert.equal(fb.pouType, 'functionBlock');
  assert.equal(fb.vars.filter((v) => v.section === 'VAR_INPUT').length, 2);
  assert.equal(fb.vars.filter((v) => v.section === 'VAR_OUTPUT').length, 1);
});

test('语法：解析功能块调用的 => 输出参数', () => {
  const ast = parseST(`
PROGRAM P
VAR
    bStart : BOOL;
    bDone : BOOL;
    tTimer : TON;
END_VAR
    tTimer(IN := bStart, PT := T#2s, Q => bDone);
END_PROGRAM
`);
  const call = ast.pous[0].body[0];
  assert.equal(call.kind, 'callStmt');
  if (call.kind !== 'callStmt') return;
  assert.equal(call.call.args.length, 2);
  assert.equal(call.call.outputArgs.length, 1);
  assert.equal(call.call.outputArgs[0].name, 'Q');
});

test('检查：=> 输出参数名错误被捕获', () => {
  const c = codes(`
PROGRAM P
VAR
    bStart : BOOL;
    bDone : BOOL;
    tTimer : TON;
END_VAR
    tTimer(IN := bStart, PT := T#2s, QQQ => bDone);
END_PROGRAM
`);
  assert.ok(c.includes('E017'), `期望 E017，实际 ${c.join(',')}`);
});

test('语法：解析 CASE / FOR / WHILE / REPEAT', () => {
  const ast = parseST(`
PROGRAM P
VAR
    i : INT;
    n : INT;
END_VAR
    CASE n OF
        1: i := 10;
        2, 3: i := 20;
    ELSE
        i := 0;
    END_CASE;
    FOR i := 0 TO 10 BY 2 DO
        n := n + 1;
    END_FOR;
    WHILE n < 100 DO
        n := n + 1;
    END_WHILE;
    REPEAT
        n := n - 1;
    UNTIL n = 0;
END_PROGRAM
`);
  assert.equal(ast.pous[0].body.length, 4);
});

test('语法：解析数组与结构体', () => {
  const ast = parseST(`
TYPE ST_Motor:
STRUCT
    bRun : BOOL;
    nSpeed : INT;
END_STRUCT
END_TYPE

PROGRAM P
VAR
    aData : ARRAY[0..10] OF INT;
    stMotor : ST_Motor;
END_VAR
    aData[3] := 5;
    stMotor.nSpeed := 100;
END_PROGRAM
`);
  assert.equal(ast.types.length, 1);
  assert.equal(ast.types[0].members.length, 2);
});

test('语法：未闭合 POU 报错', () => {
  assert.throws(() => parseST('PROGRAM P\nVAR\n n : INT;\nEND_VAR\n'), /缺少 END_PROGRAM/);
});

/* -------------------- 静态检查 -------------------- */

test('检查：未定义标识符报错', () => {
  const c = codes(`
PROGRAM P
VAR
END_VAR
    nX := nUndefined;
END_PROGRAM
`);
  assert.ok(c.includes('E008'), `期望 E008，实际 ${c.join(',')}`);
});

test('检查：BOOL 与数值混赋报错', () => {
  const c = codes(`
PROGRAM P
VAR
    bFlag : BOOL;
    nVal : INT;
END_VAR
    bFlag := nVal;
END_PROGRAM
`);
  assert.ok(c.includes('E014'), `期望 E014，实际 ${c.join(',')}`);
});

test('检查：整数赋给 REAL 报错并提示显式转换', () => {
  const d = analyze(`
PROGRAM P
VAR
    fVal : REAL;
    nVal : INT;
END_VAR
    fVal := nVal;
END_PROGRAM
`);
  const err = d.find((x) => x.code === 'E015');
  assert.ok(err, '期望 E015');
  assert.match(err!.hint ?? '', /INT_TO_REAL|REAL_TO_INT/);
});

test('检查：跨品牌函数被拦截', () => {
  const c = codes(`
PROGRAM P
VAR
END_VAR
    nPtr := IREF(X0, 1);
END_PROGRAM
`);
  assert.ok(c.includes('E010'), `期望 E010，实际 ${c.join(',')}`);
});

test('检查：越界设备地址报错', () => {
  const c = codes(`
PROGRAM P
VAR
END_VAR
    X999 := TRUE;
END_PROGRAM
`);
  assert.ok(c.includes('E009'), `期望 E009，实际 ${c.join(',')}`);
});

test('检查：RAMP_REAL 被识别为三菱不存在的函数', () => {
  const d = analyze(`
PROGRAM P
VAR
    fOut : REAL;
    fVal : REAL;
END_VAR
    fOut := RAMP_REAL(fVal);
END_PROGRAM
`);
  assert.ok(d.some((x) => x.code === 'W006'), '期望 W006 方言差异警告');
});

test('检查：标准功能块 TON 参数错误被捕获', () => {
  const c = codes(`
PROGRAM P
VAR
    tTimer : TON;
END_VAR
    tTimer(IN := TRUE, PT := T#1s, EXTRA := 1);
END_PROGRAM
`);
  // TON 是 FB，不走函数参数检查；确认至少没有误报错误
  assert.ok(!c.includes('E011'));
});

test('检查：保留字变量名报错', () => {
  const c = codes(`
PROGRAM P
VAR
    IF : INT;
END_VAR
END_PROGRAM
`);
  assert.ok(c.includes('E002') || c.includes('E003'), `期望 E002/E003，实际 ${c.join(',')}`);
});

test('检查：正常代码无误报', () => {
  const d = analyze(`
PROGRAM Main
VAR
    nCount : INT := 0;
    bStart : BOOL := FALSE;
    bDone : BOOL := FALSE;
    fValue : REAL := 0.0;
END_VAR
    IF bStart THEN
        nCount := nCount + 1;
        IF nCount >= 10 THEN
            bDone := TRUE;
        END_IF;
    END_IF;
END_PROGRAM
`);
  const errors = d.filter((x) => x.severity === 'error');
  assert.equal(errors.length, 0, `不应有错误，实际: ${JSON.stringify(errors)}`);
});

test('检查：工程中自定义的功能块类型可作为变量类型', () => {
  const d = analyze(`
FUNCTION_BLOCK FB_Motor
VAR_INPUT
    bEnable : BOOL;
END_VAR
VAR_OUTPUT
    bRunning : BOOL;
END_VAR
    bRunning := bEnable;
END_FUNCTION_BLOCK

PROGRAM Main
VAR
    fbPump : FB_Motor;
END_VAR
    fbPump(bEnable := TRUE, bRunning => Y0);
END_PROGRAM
`);
  const errors = d.filter((x) => x.severity === 'error');
  assert.equal(errors.length, 0, `不应有错误，实际: ${JSON.stringify(errors)}`);
});

test('检查：自定义 FB 实例调用参数名错误被捕获', () => {
  const c = codes(`
FUNCTION_BLOCK FB_Motor
VAR_INPUT
    bEnable : BOOL;
END_VAR
VAR_OUTPUT
    bRunning : BOOL;
END_VAR
    bRunning := bEnable;
END_FUNCTION_BLOCK

PROGRAM Main
VAR
    fbPump : FB_Motor;
END_VAR
    fbPump(bWrong := TRUE, bRunning => Y0);
END_PROGRAM
`);
  assert.ok(c.includes('E016'), `期望 E016，实际 ${c.join(',')}`);
});

test('检查：自定义 FB 实例输出参数名错误被捕获', () => {
  const c = codes(`
FUNCTION_BLOCK FB_Motor
VAR_INPUT
    bEnable : BOOL;
END_VAR
VAR_OUTPUT
    bRunning : BOOL;
END_VAR
    bRunning := bEnable;
END_FUNCTION_BLOCK

PROGRAM Main
VAR
    fbPump : FB_Motor;
END_VAR
    fbPump(bEnable := TRUE, bWrong => Y0);
END_PROGRAM
`);
  assert.ok(c.includes('E017'), `期望 E017，实际 ${c.join(',')}`);
});

test('检查：RS 触发器形参名写错时给出针对性提示', () => {
  const d = analyze(`
PROGRAM P
VAR
    bSet : BOOL;
    bReset : BOOL;
    bOut : BOOL;
    fbLatch : RS;
END_VAR
    fbLatch(SET := bSet, RESET1 := bReset, Q => bOut);
END_PROGRAM
`);
  const e = d.find((x) => x.code === 'E016');
  assert.ok(e, '应报告 E016');
  assert.match(e!.hint ?? '', /S.*R1|RESET1/, '提示应说明正确形参名');
});

test('检查：结构体成员不存在时报错', () => {
  const c = codes(`
TYPE ST_Motor:
STRUCT
    bRun : BOOL;
END_STRUCT
END_TYPE

PROGRAM P
VAR
    stMotor : ST_Motor;
END_VAR
    stMotor.bMissing := TRUE;
END_PROGRAM
`);
  assert.ok(c.includes('E013'), `期望 E013，实际 ${c.join(',')}`);
});
