/**
 * AST → IEC XML DTO 映射测试。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { parseWithRecovery } from '../src/dialect/recovery.ts';
import { astToIecProject } from '../src/emit/iec-project.ts';
import { emitIecXml } from '../src/emit/iecxml.ts';

const here = dirname(fileURLToPath(import.meta.url));
const motorDemo = readFileSync(resolve(here, '../examples/motor_demo.st'), 'utf8');

function parse(source: string) {
  const { ast, errors } = parseWithRecovery(source);
  assert.equal(errors.length, 0, `解析错误: ${JSON.stringify(errors)}`);
  return ast;
}

test('映射：motor_demo 同时导出 Program 与 FunctionBlock', () => {
  const ast = parse(motorDemo);
  const { project, warnings } = astToIecProject(ast, { contentName: 'motor_demo' });
  assert.equal(project.programs.length, 1);
  assert.equal(project.programs[0].name, 'Main');
  assert.equal(project.functionBlocks?.length, 1);
  const fb = project.functionBlocks?.[0];
  assert.equal(fb?.name, 'FB_Motor');
  assert.deepEqual(fb?.inputs?.map((v) => v.name), ['bEnable', 'nTarget']);
  assert.deepEqual(fb?.outputs?.map((v) => v.name), ['bRunning', 'nSpeed']);
  assert.ok(!warnings.some((w) => w.includes('暂不支持')), `不应再有跳过告警: ${warnings.join('; ')}`);
});

test('映射：结构体与全局变量完整保留', () => {
  const ast = parse(motorDemo);
  const { project } = astToIecProject(ast);
  assert.equal(project.types?.length, 1);
  assert.equal(project.types?.[0].name, 'ST_Motor');
  assert.deepEqual(
    project.types?.[0].members.map((m) => m.name),
    ['bRunning', 'bFault', 'nSpeed'],
  );
  const globals = project.globalVars ?? [];
  assert.equal(globals.length, 2);
  const speedSet = globals.find((g) => g.name === 'nSpeedSet');
  assert.ok(speedSet);
  assert.equal(speedSet?.address, 'D200');
  assert.equal(speedSet?.initial, '100');
});

test('映射：Program 正文来自 body（不含 VAR 段/PROGRAM 外壳）', () => {
  const ast = parse(motorDemo);
  const xml = emitIecXml(astToIecProject(ast).project);
  assert.ok(xml.includes('xsi:type="ST"'));
  assert.ok(xml.includes('CASE nStep OF'));
  assert.ok(!xml.includes('END_PROGRAM'), '正文不应包含 END_PROGRAM');
  assert.ok(!xml.includes('PROGRAM Main'), '正文不应包含 PROGRAM 外壳');
  assert.ok(!xml.includes('tRunTimer : TON'), 'VAR 段不应混入 ST 正文');
});

test('映射：VAR_INPUT 等形参类变量被跳过并告警', () => {
  const ast = parse(`PROGRAM P
VAR
    a : INT;
END_VAR
    a := 1;
END_PROGRAM
`);
  // 构造一个带 VAR_INPUT 的 POU（通过手工改 AST，避免写依赖解析器行为）
  const pou = ast.pous[0];
  pou.vars.push({
    kind: 'varDecl',
    name: 'bIn',
    typeName: 'BOOL',
    retain: false,
    constant: false,
    section: 'VAR_INPUT',
    loc: pou.loc,
  });
  const { project } = astToIecProject(ast);
  assert.equal(project.programs[0].vars.length, 1);
  assert.ok(!project.programs[0].vars.some((v) => v.name === 'bIn'), 'VAR_INPUT 不应进入 Program 的局部标签');
});

test('映射：只有 FB、没有 Program 时仍可导出 FunctionBlock', () => {
  const ast = parse(`FUNCTION_BLOCK FB_Only
VAR
    a : INT;
END_VAR
    a := 1;
END_FUNCTION_BLOCK
`);
  const { project } = astToIecProject(ast);
  assert.equal(project.programs.length, 0);
  assert.equal(project.functionBlocks?.length, 1);
  const xml = emitIecXml(project);
  assert.ok(xml.includes('<FunctionBlock name="FB_Only">'));
  assert.ok(xml.includes('<MainBody>'));
});

test('映射：Function 导出 ResultType 与 TempVars', () => {
  const ast = parse(`FUNCTION F_Add : INT
VAR_INPUT
    a : INT;
    b : INT;
END_VAR
VAR_TEMP
    t : INT;
END_VAR
    t := a + b;
    F_Add := t;
END_FUNCTION
`);
  const { project } = astToIecProject(ast);
  assert.equal(project.functions?.length, 1);
  const fn = project.functions?.[0];
  assert.equal(fn?.name, 'F_Add');
  assert.equal(fn?.returnType, 'INT');
  assert.deepEqual(fn?.inputs?.map((v) => v.name), ['a', 'b']);
  assert.deepEqual(fn?.temps?.map((v) => v.name), ['t']);
  const xml = emitIecXml(project);
  assert.ok(xml.includes('<Function name="F_Add">'));
  assert.ok(xml.includes('<ResultType>'));
  assert.ok(xml.includes('<TempVars>'));
});

test('映射：FB 实例化与调用（fbMotor : FB_Motor; fbMotor.bRunning）完整进入 XML', () => {
  const src = readFileSync(resolve(here, '../examples/fb_call_demo.st'), 'utf8');
  const ast = parse(src);
  const { project } = astToIecProject(ast);
  const main = project.programs.find((p) => p.name === 'Main');
  assert.ok(main);
  const fbVar = main.vars.find((v) => v.name === 'fbMotor');
  assert.equal(fbVar?.type, 'FB_Motor');
  const fb = project.functionBlocks?.find((f) => f.name === 'FB_Motor');
  assert.ok(fb);
  const xml = emitIecXml(project);
  assert.ok(xml.includes('<Variable name="fbMotor">'));
  assert.ok(xml.includes('<TypeName>FB_Motor</TypeName>'));
  assert.ok(xml.includes('fbMotor(bEnable := bStart, nTarget := 100);'));
  assert.ok(xml.includes('IF fbMotor.bRunning THEN'));
});
