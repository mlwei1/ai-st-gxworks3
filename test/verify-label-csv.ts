/**
 * 逐行逐列比���生成的 CSV 与 GX Works3 真实导出文件。
 */
import { readFileSync } from 'node:fs';

import { parseST } from '../src/dialect/parser.ts';
import {
  generateGlobalLabelsCSV,
  generateLocalLabelsCSV,
  toUtf16LE,
} from '../src/emit/label-csv.ts';

const LOCAL =
  'C:\\Users\\52900\\.minimax\\v2\\assets\\2026\\11\\10\\10-39-38-837-asset_20261110-103938-837_73ee374e8886_7fac50f4-ProgPou1.csv';
const GLOBAL =
  'C:\\Users\\52900\\.minimax\\v2\\assets\\2026\\11\\10\\10-39-38-829-asset_20261110-103938-829_9b7001e25432_902a749c-Global.csv';

function readUtf16(p: string): string {
  const b = readFileSync(p);
  // 去掉 BOM 字符（U+FEFF），它是编码层标记，不是文件内容
  return b.toString('utf16le').replace(/^﻿/, '');
}

/** 按 TAB 切分并去引号。 */
function cols(line: string): string[] {
  if (!line) return [];
  return line.split('\t').map((f) => {
    const m = /^"(.*)"$/s.exec(f);
    return m ? m[1].replace(/""/g, '"') : f;
  });
}

let ok = true;

// ---- 局部标签 ----
{
  const official = readUtf16(LOCAL);
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

  console.log('=== 局部标签 ===');
  console.log(`官方 ${ol.length} 行, 我的 ${ml.length} 行`);

  for (let i = 0; i < Math.max(ol.length, ml.length); i++) {
    if ((ol[i] ?? '') === (ml[i] ?? '')) continue;
    ok = false;
    console.log(`第 ${i + 1} 行不同:`);
    console.log(`  官方: ${JSON.stringify(ol[i])}`);
    console.log(`  我的: ${JSON.stringify(ml[i])}`);
    const oc = cols(ol[i] ?? '');
    const mc = cols(ml[i] ?? '');
    if (oc.length !== mc.length) {
      console.log(`  列数不同: 官方 ${oc.length} 列, 我的 ${mc.length} 列`);
    } else {
      for (let c = 0; c < oc.length; c++) {
        if (oc[c] !== mc[c]) {
          console.log(`  列 ${c + 1}: 官方 "${oc[c]}" vs 我的 "${mc[c]}"`);
        }
      }
    }
  }
}

// ---- 全局标签 ----
{
  const official = readUtf16(GLOBAL);
  const mine = generateGlobalLabelsCSV([
    { name: 'label_global', typeName: 'BOOL', address: 'M1000' },
  ]);

  const ol = official.split('\n');
  const ml = mine.split('\n');

  console.log('\n=== 全局标签 ===');
  console.log(`官方 ${ol.length} 行, 我的 ${ml.length} 行`);

  for (let i = 0; i < Math.max(ol.length, ml.length); i++) {
    if ((ol[i] ?? '') === (ml[i] ?? '')) continue;
    ok = false;
    console.log(`第 ${i + 1} 行不同:`);
    console.log(`  官方: ${JSON.stringify(ol[i])}`);
    console.log(`  我的: ${JSON.stringify(ml[i])}`);
    const oc = cols(ol[i] ?? '');
    const mc = cols(ml[i] ?? '');
    if (oc.length !== mc.length) {
      console.log(`  列数不同: 官方 ${oc.length} 列, 我的 ${mc.length} 列`);
    } else {
      for (let c = 0; c < oc.length; c++) {
        if (oc[c] !== mc[c]) {
          console.log(`  列 ${c + 1} (${oc.length} 列中): 官方 "${oc[c]}" vs 我的 "${mc[c]}"`);
        }
      }
    }
  }
}

console.log('');
console.log(ok ? '✓ 与真实导出逐行逐列一致' : '✗ 存在差异');
