/**
 * 检查生成的标签 CSV 的编码与内容。
 */
import { readFileSync } from 'node:fs';

for (const f of [
  'examples/out_motor/Main_local_labels.csv',
  'examples/out_motor/FB_Motor_local_labels.csv',
  'examples/out_motor/Global.csv',
]) {
  const b = readFileSync(f);
  const text = b.toString('utf16le').replace(/^﻿/, '');
  const lines = text.split('\n');
  const cols = (l: string) => (l ? l.split('\t').length : 0);

  console.log(`\n===== ${f} =====`);
  console.log(`  BOM: ${b[0] === 0xff && b[1] === 0xfe} | 字节: ${b.length}`);
  console.log(`  第1行(工程名): ${JSON.stringify(lines[0])}`);
  console.log(`  第2行列数: ${cols(lines[1] ?? '')}`);
  lines.slice(2).forEach((l, i) => {
    if (!l) return;
    const c = (l.split('\t').map((x) => /^"(.*)"$/s.exec(x)?.[1] ?? x));
    const filled = c
      .map((v, idx) => (v ? `${idx + 1}:${v}` : ''))
      .filter(Boolean)
      .join(' ');
    console.log(`  行${i + 3} (${c.length}列): ${filled}`);
  });
}
