/**
 * AI 输出转换层测试。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { convertAIGenerated, aiProjectToST } from '../src/ai/convert.ts';
import { parseST } from '../src/dialect/parser.ts';
import { analyzeST } from '../src/dialect/analyzer.ts';
import { extractJson } from '../src/ai/client.ts';

const AI_OUTPUT = {
  pous: [
    {
      pouType: 'program',
      name: 'Main',
      comment: '主程序',
      vars: [
        { name: 'nCount', typeName: 'INT', section: 'VAR', initialValue: '0', comment: '计数' },
        { name: 'bStart', typeName: 'BOOL', section: 'VAR', initialValue: 'FALSE', comment: '' },
      ],
      body: 'IF bStart THEN\n    nCount := nCount + 1;\nEND_IF;',
    },
    {
      pouType: 'functionBlock',
      name: 'FB_Motor',
      comment: '电机功能块',
      vars: [
        { name: 'bEnable', typeName: 'BOOL', section: 'VAR_INPUT', comment: '' },
        { name: 'bRunning', typeName: 'BOOL', section: 'VAR_OUTPUT', comment: '' },
      ],
      body: 'bRunning := bEnable;',
    },
  ],
  types: [
    {
      name: 'ST_Motor',
      members: [
        { name: 'bRun', typeName: 'BOOL', comment: '运行' },
        { name: 'nSpeed', typeName: 'INT', comment: '转速' },
      ],
    },
  ],
  globalVars: [{ name: 'nSpeedSet', typeName: 'INT', address: 'D100', comment: '设定值' }],
};

test('转换：AI JSON 还原为可解析的 ST', () => {
  const result = convertAIGenerated(AI_OUTPUT);
  assert.equal(result.stSources.length, 2);
  assert.equal(result.stSources[0].name, 'Main');

  // 生成的 ST 必须能被真实解析器解析
  const ast = parseST(result.combined);
  assert.equal(ast.pous.length, 2);
  assert.equal(ast.pous[0].name, 'Main');
  assert.equal(ast.pous[1].name, 'FB_Motor');
  assert.equal(ast.types.length, 1);
});

test('转换：变量段正确分区', () => {
  const result = convertAIGenerated(AI_OUTPUT);
  const ast = parseST(result.combined);
  const fb = ast.pous.find((p) => p.name === 'FB_Motor')!;
  assert.equal(fb.vars.find((v) => v.name === 'bEnable')?.section, 'VAR_INPUT');
  assert.equal(fb.vars.find((v) => v.name === 'bRunning')?.section, 'VAR_OUTPUT');
});

test('转换：初始值与地址被保留', () => {
  const result = convertAIGenerated(AI_OUTPUT);
  const ast = parseST(result.combined);
  const main = ast.pous.find((p) => p.name === 'Main')!;
  const nCount = main.vars.find((v) => v.name === 'nCount')!;
  assert.equal(nCount.initialValue?.kind, 'literal');
  assert.equal(nCount.initialValue?.value, '0');
});

test('转换：全局变量进入 VAR_GLOBAL 段', () => {
  const result = convertAIGenerated(AI_OUTPUT);
  assert.match(result.combined, /VAR_GLOBAL/);
  assert.match(result.combined, /nSpeedSet : INT AT D100;/);
});

test('转换：缺少 name/typeName 的变量被跳过并告警', () => {
  const result = convertAIGenerated({
    pous: [
      {
        pouType: 'program',
        name: 'P',
        vars: [
          { name: 'good', typeName: 'INT', section: 'VAR' },
          { name: 'bad', section: 'VAR' },
        ],
        body: '',
      },
    ],
  });
  assert.ok(result.warnings.some((w) => w.includes('typeName')));
  assert.match(result.combined, /good : INT;/);
  assert.ok(!result.combined.includes('bad'));
});

test('转换：AI 输出语法错误时给出告警但保留源码', () => {
  const result = convertAIGenerated({
    pous: [
      {
        pouType: 'program',
        name: 'Broken',
        vars: [],
        body: 'nX := ;',
      },
    ],
  });
  // 语句级错误会被恢复，但必须作为告警上报，不能静默丢弃
  assert.ok(
    result.warnings.some((w) => w.includes('语法错误')),
    `应产生告警，实际: ${JSON.stringify(result.warnings)}`,
  );
  // 源码仍被保留，便于人工检查
  assert.match(result.combined, /PROGRAM Broken/);
});

test('转换：全局变量在 POU 中可见（VAR_GLOBAL 作用域）', () => {
  const result = convertAIGenerated({
    pous: [
      {
        pouType: 'program',
        name: 'Main',
        vars: [],
        body: 'g_Pump := TRUE;',
      },
    ],
    globalVars: [{ name: 'g_Pump', typeName: 'BOOL', address: 'Y0' }],
  });

  // 全局变量必须进入 AST 的 globalVars，POU 内引用不应报「未定义」
  assert.equal(result.ast.globalVars.length, 1);
  assert.equal(result.ast.globalVars[0].name, 'g_Pump');

  const diags = analyzeST(result.ast, { target: 'FX5U' });
  const undefinedErrors = diags.filter((d) => d.code === 'E008');
  assert.equal(
    undefinedErrors.length,
    0,
    `不应报未定义标识符，实际: ${JSON.stringify(undefinedErrors)}`,
  );
});

test('转换：结构体类型在 POU 中可见', () => {
  const result = convertAIGenerated({
    types: [
      {
        name: 'ST_Motor',
        members: [{ name: 'bRun', typeName: 'BOOL' }],
      },
    ],
    pous: [
      {
        pouType: 'program',
        name: 'Main',
        vars: [{ name: 'stMotor', typeName: 'ST_Motor', section: 'VAR' }],
        body: 'stMotor.bRun := TRUE;',
      },
    ],
  });

  assert.equal(result.ast.types.length, 1);
  const diags = analyzeST(result.ast, { target: 'FX5U' });
  const errors = diags.filter((d) => d.severity === 'error');
  assert.equal(errors.length, 0, `不应有错误，实际: ${JSON.stringify(errors)}`);
});

test('转换：注释在分号之后（防止注释吞掉语句终止符）', () => {
  const result = convertAIGenerated({
    pous: [
      {
        pouType: 'program',
        name: 'P',
        vars: [{ name: 'nA', typeName: 'INT', section: 'VAR', comment: '计数器' }],
        body: '',
      },
    ],
    globalVars: [{ name: 'g_B', typeName: 'INT', address: 'D200', comment: '全局值' }],
  });

  // 分号必须在注释之前，否则注释会吃掉终止符导致下一行解析失败
  assert.match(result.combined, /nA : INT; \/\/ 计数器/);
  assert.match(result.combined, /g_B : INT AT D200; \/\/ 全局值/);

  // 且必须能被解析器接受
  const ast = parseST(result.combined);
  assert.equal(ast.pous.length, 1);
});

test('转换：生成结果通过静态检查', () => {
  const result = convertAIGenerated(AI_OUTPUT);
  const diags = analyzeST(result.ast, { target: 'FX5U' });
  const errors = diags.filter((d) => d.severity === 'error');
  assert.equal(errors.length, 0, `不应有错误: ${JSON.stringify(errors)}`);
});

test('转换：aiProjectToST 与 convertAIGenerated 一致', () => {
  assert.equal(aiProjectToST(AI_OUTPUT), convertAIGenerated(AI_OUTPUT).combined);
});

test('JSON 提取：处理 markdown 包裹与前后噪声', () => {
  const wrapped = '```json\n{"a": 1}\n```';
  assert.equal(extractJson(wrapped), '{"a": 1}');

  const noisy = '好的，这是结果：\n{"b": 2}\n希望对你有帮助';
  assert.equal(extractJson(noisy), '{"b": 2}');

  assert.throws(() => extractJson('完全不是 JSON'), /找不到 JSON/);
});

test('转换：未知的 POU 类型退化为 program', () => {
  const result = convertAIGenerated({
    pous: [{ pouType: 'somethingElse', name: 'X', vars: [], body: '' }],
  });
  assert.match(result.combined, /PROGRAM X/);
});
