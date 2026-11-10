/**
 * 打印官方 CSV 的表头与数据行的列数对齐关系。
 */
import { readFileSync } from 'node:fs';

const LOCAL =
  'C:\\Users\\52900\\.minimax\\v2\\assets\\2026\\11\\10\\10-39-38-837-asset_20261110-103938-837_73ee374e8886_7fac50f4-ProgPou1.csv';
const GLOBAL =
  'C:\\Users\\52900\\.minimax\\v2\\assets\\2026\\11\\10\\10-39-38-829-asset_20261110-103938-829_9b7001e25432_902a749c-Global.csv';

function readUtf16(p: string): string {
  const b = readFileSync(p);
  return b.toString('utf16le');
}

function cols(line: string): string[] {
  if (!line) return [];
  return line.split('\t').map((f) => {
    const m = /^"(.*)"$/s.exec(f);
    return m ? m[1] : f;
  });
}

for (const [label, path] of [
  ['局部标签 ProgPou1.csv', LOCAL],
  ['全局标签 Global.csv', GLOBAL],
] as const) {
  const text = readUtf16(path);
  const lines = text.split('\n');
  console.log(`\n===== ${label} =====`);

  const header = cols(lines[1] ?? '');
  console.log(`表头 ${header.length} 列:`);
  header.forEach((h, i) => console.log(`  ${String(i + 1).padStart(2)}. ${h}`));

  for (let li = 2; li < lines.length; li++) {
    if (!lines[li]) continue;
    const c = cols(lines[li]);
    console.log(`\n数据行 ${li + 1}: ${c.length} 列`);
    c.forEach((v, i) => {
      if (v !== '') console.log(`  ${String(i + 1).padStart(2)}. [${header[i] ?? '?'}] = "${v}"`);
    });
  }
}
