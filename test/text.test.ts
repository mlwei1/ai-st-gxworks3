/**
 * GX Works3 ST 文本输出格式测试。
 *
 * 背景：GX Works3 强制结构化工程模式，变量声明与 ST 本体分离存储，
 * 无法通过粘贴 ST 文本自动创建局部标签。本模块验证输出格式正确。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseST } from '../src/dialect/parser.ts';
import {
  DECLARE_END,
  DECLARE_START,
  renderGlobalLabelCSV,
  renderLocalLabelTable,
  renderPOUAsText,
  renderPOUDeclarations,
  renderProjectAsText,
} from '../src/emit/text.ts';

const SRC = `
PROGRAM Main
VAR
    nCount : INT := 0;
    bStart : BOOL := FALSE;
END_VAR
    IF bStart THEN
        nCount := nCount + 1;
    END_IF;
END_PROGRAM

FUNCTION_BLOCK FB_Motor
VAR_INPUT
    bEnable : BOOL;
END_VAR
VAR_OUTPUT
    bRunning : BOOL;
END_VAR
VAR
    tRampTimer : TON;
    nRampStep : INT := 0;
END_VAR
    bRunning := bEnable;
END_FUNCTION_BLOCK
`;

test('文本：程序本体不含 VAR 声明段（GX Works3 要求标签独立维护）', () => {
  const ast = parseST(SRC);
  const main = ast.pous.find((p) => p.name === 'Main')!;
  const text = renderPOUAsText(main);

  // 正文不能有 VAR_INPUT / END_VAR 等声明块
  assert.ok(!/\bEND_VAR\b/.test(text), '程序本体不应包含 END_VAR');
  assert.ok(!/^\s*VAR(_INPUT|_OUTPUT)?\s*$/m.test(text), '程序本体不应包含 VAR 段');
  // 但应保留语句
  assert.ok(text.includes('IF bStart THEN'));
  assert.ok(text.includes('nCount := nCount + 1;'));
});

test('文本：程序本体顶部附声明速查注释', () => {
  const ast = parseST(SRC);
  const main = ast.pous.find((p) => p.name === 'Main')!;
  const text = renderPOUAsText(main);
  assert.ok(text.includes('标签设置'), '应提示标签设置工作表');
  assert.ok(text.includes('nCount : INT'), '应列出变量类型');
  assert.ok(text.includes(':= 0'), '应列出初始值');
});

test('文本：可关闭顶部注释', () => {
  const ast = parseST(SRC);
  const main = ast.pous.find((p) => p.name === 'Main')!;
  const text = renderPOUAsText(main, { includeComments: false });
  assert.ok(!text.includes('标签设置'));
  assert.ok(text.includes('IF bStart THEN'));
});

test('声明块：带 //!DECLARE 包裹且声明以分号结尾', () => {
  const ast = parseST(SRC);
  const fb = ast.pous.find((p) => p.name === 'FB_Motor')!;
  const decl = renderPOUDeclarations(fb);

  assert.ok(decl.startsWith(DECLARE_START));
  assert.ok(decl.endsWith(DECLARE_END));
  assert.ok(decl.includes('VAR_INPUT'));
  assert.ok(decl.includes('VAR_OUTPUT'));
  assert.ok(decl.includes('bEnable : BOOL;'), '声明必须以分号结尾');
  assert.ok(decl.includes('nRampStep : INT := 0;'), '初始值声明也要分号结尾');
});

test('声明块：无变量时返回空串', () => {
  const ast = parseST('PROGRAM P\nVAR\nEND_VAR\nEND_PROGRAM');
  const p = ast.pous[0];
  assert.equal(renderPOUDeclarations(p), '');
});

test('标签录入表：区分输入/输出/局部', () => {
  const ast = parseST(SRC);
  const fb = ast.pous.find((p) => p.name === 'FB_Motor')!;
  const table = renderLocalLabelTable(fb);
  assert.ok(table.includes('输入'));
  assert.ok(table.includes('输出'));
  assert.ok(table.includes('局部'));
  assert.ok(table.includes('bEnable'));
  assert.ok(table.includes('TON'));
});

test('全局标签 CSV：含 BOM 与表头', () => {
  const csv = renderGlobalLabelCSV([
    { name: 'g_Start', typeName: 'BOOL', address: 'X0', comment: '启动按钮' },
    { name: 'g_Pump', typeName: 'BOOL', address: 'Y0', comment: '水泵输出' },
  ]);
  assert.ok(csv.charCodeAt(0) === 0xfeff, '应带 UTF-8 BOM');
  assert.ok(csv.includes('名称,数据类型,软元件号,注释'));
  assert.ok(csv.includes('g_Start,BOOL,X0,启动按钮'));
  // 逗号需转义，避免破坏列结构
  const csv2 = renderGlobalLabelCSV([
    { name: 'a', typeName: 'INT', address: 'D0', comment: '值,含逗号' },
  ]);
  assert.ok(csv2.includes('值，含逗号'));
});

test('工程文本：每个 POU 一段且带分隔标记', () => {
  const ast = parseST(SRC);
  const text = renderProjectAsText(ast);
  assert.ok(text.includes('程序：Main'));
  assert.ok(text.includes('功能块：FB_Motor'));
  assert.ok(text.includes('IF bStart THEN'));
  assert.ok(text.includes('bRunning := bEnable;'));
});

test('文本：粘贴用的正文本身是合法 ST（可被解析器接受）', () => {
  const ast = parseST(SRC);
  for (const pou of ast.pous) {
    const text = renderPOUAsText(pou, { includeComments: false });
    // 包一层 POU 后应能解析（变量未声明会报语义错，但语法必须通过）
    const wrapped = `PROGRAM Probe\nVAR\nEND_VAR\n${text}\nEND_PROGRAM`;
    assert.doesNotThrow(() => parseST(wrapped), `${pou.name} 的正文语法应合法`);
  }
});
