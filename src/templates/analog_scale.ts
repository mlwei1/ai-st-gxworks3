/**
 * 模板：analog_scale —— 模拟量线性标定（原始值 D100 → 工程值 REAL 百分比）。
 *
 * IO 约定：第一个 D 设备为原始值输入，第二个 D 设备为标定结果输出（INT，写回 D 寄存器）。
 * 参数：rawMin / rawMax / engMin / engMax（默认 0 / 4000 / 0 / 100）。
 *
 * 注意：GX Works3 不允许整数与浮点隐式混算，本模板统一用 INT_TO_REAL / REAL_TO_INT 显式转换。
 */

import type { StTemplate, TemplateContext } from './types.ts';
import {
  headerFor,
  intLiteral,
  numParam,
  pickDevice,
  realLiteral,
  renderProgram,
} from './helpers.ts';

function instantiate(ctx: TemplateContext): string {
  const dRaw = pickDevice(ctx, 'D', 0, 'D100');
  const dOut = pickDevice(ctx, 'D', 1, 'D101');
  const rawMin = Math.trunc(numParam(ctx, 'rawMin', 0));
  const rawMax = Math.trunc(numParam(ctx, 'rawMax', 4000));
  const engMin = numParam(ctx, 'engMin', 0);
  const engMax = numParam(ctx, 'engMax', 100);

  const body = [
    `// 1) 原始量程跨度（INT → REAL 显式转换）`,
    `fSpan := INT_TO_REAL(nRawMax - nRawMin);`,
    ``,
    `// 2) 线性标定：raw → eng，结果限幅在 [engMin, engMax]`,
    `IF fSpan <= 0.0 THEN`,
    `    fEng := fEngMin;`,
    `ELSE`,
    `    fRatio := (INT_TO_REAL(${dRaw}) - INT_TO_REAL(nRawMin)) / fSpan;`,
    `    fEng := fEngMin + fRatio * (fEngMax - fEngMin);`,
    `END_IF;`,
    `IF fEng < fEngMin THEN`,
    `    fEng := fEngMin;`,
    `END_IF;`,
    `IF fEng > fEngMax THEN`,
    `    fEng := fEngMax;`,
    `END_IF;`,
    ``,
    `// 3) 写回：REAL → INT 后输出到 D 寄存器`,
    `${dOut} := REAL_TO_INT(fEng);`,
  ].join('\n');

  return renderProgram({
    header: headerFor('analog_scale', '模拟量线性标定（REAL 百分比）', ctx, [
      `rawMin=${intLiteral(rawMin)}`,
      `rawMax=${intLiteral(rawMax)}`,
      `engMin=${engMin}`,
      `engMax=${engMax}`,
    ]),
    vars: [
      { line: `nRawMin : INT := ${intLiteral(rawMin)};`, comment: '原始量程下限' },
      { line: `nRawMax : INT := ${intLiteral(rawMax)};`, comment: '原始量程上限' },
      { line: `fEngMin : REAL := ${realLiteral(engMin)};`, comment: '工程量程下限' },
      { line: `fEngMax : REAL := ${realLiteral(engMax)};`, comment: '工程量程上限' },
      { line: 'fSpan : REAL := 0.0;', comment: '量程跨度' },
      { line: 'fRatio : REAL := 0.0;', comment: '归一化比例 0.0~1.0' },
      { line: 'fEng : REAL := 0.0;', comment: '工程值（标定结果）' },
    ],
    body,
  });
}

export const analogScaleTemplate: StTemplate = {
  name: 'analog_scale',
  description: '模拟量线性标定：D 寄存器原始值 → REAL 工程值（百分比），含限幅与显式类型转换',
  params: [
    { name: 'rawMin', type: 'number', description: '原始量程下限', default: 0 },
    { name: 'rawMax', type: 'number', description: '原始量程上限', default: 4000 },
    { name: 'engMin', type: 'number', description: '工程量程下限', default: 0 },
    { name: 'engMax', type: 'number', description: '工程量程上限', default: 100 },
  ],
  instantiate,
};
