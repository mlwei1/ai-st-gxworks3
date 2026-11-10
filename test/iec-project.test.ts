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

test('映射：motor_demo 只保留 Program，FB 给出 warning', () => {
  const ast = parse(motorDemo);
  const { project, warnings } = astToIecProject(ast, { contentName: 'motor_demo' });
  assert.equal(project.programs.length, 1);
  assert.equal(project.programs[0].name, 'Main');
  assert.ok(warnings.some((w) => w.includes('FB_Motor') && w.includes('暂不支持')));
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
  const { project, warnings } = astToIecProject(ast);
  assert.equal(project.programs[0].vars.length, 1);
  assert.ok(warnings.some((w) => w.includes('VAR_INPUT')));
});

test('映射：只有 FB、没有 Program 时发射器报错', () => {
  const ast = parse(`FUNCTION_BLOCK FB_Only
VAR
    a : INT;
END_VAR
    a := 1;
END_FUNCTION_BLOCK
`);
  const { project, warnings } = astToIecProject(ast);
  assert.equal(project.programs.length, 0);
  assert.ok(warnings.length > 0);
  assert.throws(() => emitIecXml(project), /programs 不能为空/);
});
