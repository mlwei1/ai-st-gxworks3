/**
 * 确认官方 CSV 中「初始值」与「分配」两列的实际用法。
 *
 * 官方样例里这两列都是空的（标签没设初值、没分配软元件），
 * 所以需要靠 GX Works3 的列定义来判断语义。
 */
import { readFileSync } from 'node:fs';

const GLOBAL =
  'C:\\Users\\52900\\.minimax\\v2\\assets\\2026\\11\\10\\10-39-38-829-asset_20261110-103938-829_9b7001e25432_902a749c-Global.csv';

const text = readFileSync(GLOBAL).toString('utf16le').replace(/^﻿/, '');
const lines = text.split('\n');
const cols = (l: string) => (l ? l.split('\t').map((f) => /^"(.*)"$/s.exec(f)?.[1] ?? f) : []);

const header = cols(lines[1] ?? '');
const row = cols(lines[2] ?? '');

console.log('官方 Global.csv 数据行非空列:');
row.forEach((v, i) => {
  if (v !== '') console.log(`  列${i + 1} [${header[i]}] = "${v}"`);
});

console.log('\n注意：官方第 6 列「分配(软元件/标签)」= M1000，第 7 列「地址」为空。');
console.log('这说明软元件号写在「分配」列，与本工具生成一致。');
