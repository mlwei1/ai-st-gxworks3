/**
 * GX Works3 标签 CSV 生成器的回归测试。
 *
 * 基准：GX Works3 1.128J 实际导出的标签 CSV。
 *
 * 关键约束（都是实测踩出来的）：
 *   - 标签**只能导入 CSV**（XML 仅支持导出）
 *   - 分隔符是 **TAB**，不是逗号
 *   - 每个字段都带双引号
 *   - 第 1 行是工程名，第 2 行才是表头
 *   - 编码 UTF-16LE + BOM
 *   - 局部标签 27 列，全局标签 28 列（多「外部设备的访问」列）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import { parseST } from '../src/dialect/parser.ts';
import {
  GLOBAL_HEADER,
  LOCAL_HEADER,
  generateGlobalLabelsCSV,
  generateLabelCsvFiles,
  generateLocalLabelsCSV,
  toUtf16LE,
} from '../src/emit/label-csv.ts';

const LOCAL_SAMPLE =
  'C:\\Users\\52900\\.minimax\\v2\\assets\\2026\\11\\10\\10-39-38-837-asset_20261110-103938-837_73ee374e8886_7fac50f4-ProgPou1.csv';
const GLOBAL_SAMPLE =
  'C:\\Users\\52900\\.minimax\\v2\\assets\\2026\\11\\10\\10-39-38-829-asset_20261110-103938-829_9b7001e25432_902a749c-Global.csv';

const hasLocal = existsSync(LOCAL_SAMPLE);
const hasGlobal = existsSync(GLOBAL_SAMPLE);

function readUtf16(p: string): string {
  return readFileSync(p).toString('utf16le').replace(/^﻿/, '');
}

/** 按 TAB 切列并去引号。 */
function cols(line: string): string[] {
  if (!line) return [];
  return line.split('\t').map((f) => {
    const m = /^"(.*)"$/s.exec(f);
    return m ? m[1].replace(/""/g, '"') : f;
  });
}

test('CSV：表头列数与官方一致', () => {
  assert.equal(LOCAL_HEADER.length, 27, '局部标签应为 27 列');
  assert.equal(GLOBAL_HEADER.length, 28, '全局标签应为 28 列');
  assert.equal(LOCAL_HEADER[0], '类');
  assert.equal(LOCAL_HEADER[1], '标签名');
  assert.equal(LOCAL_HEADER[2], '数据类型');
  assert.equal(LOCAL_HEADER[5], '分配(软元件/标签)');
  assert.equal(GLOBAL_HEADER[GLOBAL_HEADER.length - 1], '外部设备的访问');
});

test('CSV：使用 TAB 分隔而非逗号', () => {
  const ast = parseST('PROGRAM P\nVAR\n    nA : INT;\nEND_VAR\nEND_PROGRAM');
  const csv = generateLocalLabelsCSV(ast.pous[0]);
  const dataLine = csv.split('\n')[2] ?? '';
  assert.ok(dataLine.includes('\t'), '应含 TAB');
  assert.ok(!dataLine.includes(','), '不应含逗号分隔');
});

test('CSV：每个字段都带双引号', () => {
  const ast = parseST('PROGRAM P\nVAR\n    nA : INT;\nEND_VAR\nEND_PROGRAM');
  const csv = generateLocalLabelsCSV(ast.pous[0]);
  const fields = (csv.split('\n')[2] ?? '').split('\t');
  for (const f of fields) {
    assert.match(f, /^".*"$/, `字段应带引号: ${f}`);
  }
});

test('CSV：第 1 行是工程名，第 2 行是表头', () => {
  const ast = parseST('PROGRAM P\nVAR\n    nA : INT;\nEND_VAR\nEND_PROGRAM');
  const csv = generateLocalLabelsCSV(ast.pous[0], { projectName: 'MyProject' });
  const lines = csv.split('\n');
  assert.equal(lines[0], '"MyProject"');
  assert.equal(cols(lines[1] ?? '').length, LOCAL_HEADER.length);
  assert.equal(cols(lines[1] ?? '')[0], '类');
});

test('CSV：默认工程名为「(工程未设置)」', () => {
  const ast = parseST('PROGRAM P\nVAR\nEND_VAR\nEND_PROGRAM');
  const csv = generateLocalLabelsCSV(ast.pous[0]);
  assert.equal(csv.split('\n')[0], '"(工程未设置)"');
});

test('CSV：局部标签的「类」为 VAR / VAR_INPUT / VAR_OUTPUT', () => {
  const ast = parseST(`
FUNCTION_BLOCK FB_Motor
VAR_INPUT
    bEnable : BOOL;
END_VAR
VAR_OUTPUT
    bRunning : BOOL;
END_VAR
VAR
    nStep : INT := 0;
END_VAR
    bRunning := bEnable;
END_FUNCTION_BLOCK
`);
  const csv = generateLocalLabelsCSV(ast.pous[0]);
  const rows = csv.split('\n').slice(2).filter(Boolean).map(cols);
  const byName = new Map(rows.map((r) => [r[1], r[0]]));
  assert.equal(byName.get('bEnable'), 'VAR_INPUT');
  assert.equal(byName.get('bRunning'), 'VAR_OUTPUT');
  assert.equal(byName.get('nStep'), 'VAR');
});

test('CSV：局部标签行与官方导出逐行逐列一致', { skip: !hasLocal && '无基准文件' }, () => {
  const official = readUtf16(LOCAL_SAMPLE);
  const ast = parseST(`
PROGRAM ProgPou1
VAR
    label_x : BOOL;
    label_y : WORD;
END_VAR
    label_x := TRUE;
END_PROGRAM
`);
  const mine = generateLocalLabelsCSV(ast.pous[0]);

  const ol = official.split('\n');
  const ml = mine.split('\n');
  assert.equal(ml.length, ol.length, '行数应一致');
  for (let i = 0; i < ol.length; i++) {
    assert.equal(ml[i], ol[i], `第 ${i + 1} 行应完全一致`);
  }
});

test('CSV：全局标签行与官方导出逐行逐列一致', { skip: !hasGlobal && '无基准文件' }, () => {
  const official = readUtf16(GLOBAL_SAMPLE);
  const mine = generateGlobalLabelsCSV([
    { name: 'label_global', typeName: 'BOOL', address: 'M1000' },
  ]);

  const ol = official.split('\n');
  const ml = mine.split('\n');
  assert.equal(ml.length, ol.length, '行数应一致');
  for (let i = 0; i < ol.length; i++) {
    assert.equal(ml[i], ol[i], `第 ${i + 1} 行应完全一致`);
  }
});

test('CSV：全局标签类为 VAR_GLOBAL，末列「外部设备的访问」为 0', () => {
  const csv = generateGlobalLabelsCSV([
    { name: 'g_A', typeName: 'BOOL', address: 'X0' },
  ]);
  const row = cols(csv.split('\n')[2] ?? '');
  assert.equal(row.length, 28);
  assert.equal(row[0], 'VAR_GLOBAL');
  assert.equal(row[5], 'X0', '软元件号放在「分配(软元件/标签)」列');
  assert.equal(row[6], '', '「地址」列留空');
  assert.equal(row[27], '0', '「外部设备的访问」为 0');
});

test('CSV：初始值与注释写入对应列', () => {
  const ast = parseST(`
PROGRAM P
VAR
    nCount : INT := 42;
    bFlag : BOOL := TRUE;
END_VAR
END_PROGRAM
`);
  const csv = generateLocalLabelsCSV(ast.pous[0]);
  const rows = csv.split('\n').slice(2).filter(Boolean).map(cols);
  const nCount = rows.find((r) => r[1] === 'nCount')!;
  const bFlag = rows.find((r) => r[1] === 'bFlag')!;
  assert.equal(nCount[4], '42', '初始值列');
  assert.equal(bFlag[4], 'TRUE');
});

test('CSV：软元件号写入「分配(软元件/标签)」列', () => {
  const ast = parseST(`
PROGRAM P
VAR
    nA : INT AT D100;
END_VAR
END_PROGRAM
`);
  const csv = generateLocalLabelsCSV(ast.pous[0]);
  const row = cols(csv.split('\n')[2] ?? '');
  assert.equal(row[5], 'D100');
});

test('CSV：输出为 UTF-16LE + BOM', () => {
  const buf = toUtf16LE('"a"\t"b"\n');
  assert.equal(buf[0], 0xff, '应有 BOM 高字节');
  assert.equal(buf[1], 0xfe, '应有 BOM 低字节');
});

test('CSV：generateLabelCsvFiles 产出每个 POU + 全局标签文件', () => {
  const ast = parseST(`
VAR_GLOBAL
    g_A : BOOL AT X0;
END_VAR

FUNCTION_BLOCK FB_A
VAR_INPUT
    bEnable : BOOL;
END_VAR
    bEnable := TRUE;
END_FUNCTION_BLOCK

PROGRAM Main
VAR
    fbA : FB_A;
END_VAR
    fbA(bEnable := TRUE);
END_PROGRAM
`);
  const files = generateLabelCsvFiles(ast);
  const names = files.map((f) => f.name);
  assert.ok(names.includes('FB_A_local_labels.csv'));
  assert.ok(names.includes('Main_local_labels.csv'));
  assert.ok(names.includes('Global.csv'));
  for (const f of files) {
    assert.equal(f.content[0], 0xff, `${f.name} 应带 BOM`);
  }
});
