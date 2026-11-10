/**
 * 读取 GX Works3 导出的标签 CSV（原始字节 + 解析），确定导入格式。
 */
import { readFileSync } from 'node:fs';

const files = [
  ['C:\\Users\\52900\\.minimax\\v2\\assets\\2026\\11\\10\\10-39-38-829-asset_20261110-103938-829_9b7001e25432_902a749c-Global.csv', 'Global.csv（全局标签）'],
  ['C:\\Users\\52900\\.minimax\\v2\\assets\\2026\\11\\10\\10-39-38-837-asset_20261110-103938-837_73ee374e8886_7fac50f4-ProgPou1.csv', 'ProgPou1.csv（局部标签）'],
];

for (const [path, label] of files) {
  const buf = readFileSync(path);
  console.log(`\n========== ${label} ==========`);
  console.log(`字节数: ${buf.length}`);
  console.log(`前 8 字节: ${buf.subarray(0, 8).toString('hex')}`);
  console.log(`BOM: ${buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? 'UTF-8 BOM' : '无'}`);
  console.log(`UTF-16: ${buf[0] === 0xff && buf[1] === 0xfe ? '是' : '否'}`);

  // 判断编码
  let text: string;
  if (buf[0] === 0xff && buf[1] === 0xfe) text = buf.toString('utf16le');
  else if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) text = buf.toString('utf8');
  else text = buf.toString('utf8');

  // 换行符
  let crlf = 0;
  let lf = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) {
      if (i > 0 && buf[i - 1] === 0x0d) crlf++;
      else lf++;
    }
  }
  console.log(`换行: CRLF=${crlf} 裸LF=${lf}`);

  console.log('--- 原文（转义显示）---');
  console.log(JSON.stringify(text).slice(0, 2000));
  console.log('--- 逐行 ---');
  text.split(/\r?\n/).forEach((l, i) => console.log(`[${i + 1}] ${JSON.stringify(l)}`));
}
