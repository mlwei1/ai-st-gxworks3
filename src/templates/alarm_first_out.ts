/**
 * 模板：alarm_first_out —— 报警首出 / 确认 / 复位（路数可配置）。
 *
 * IO 约定（按 X 顺序）：
 *   X0..X(n-1) 报警输入、X(n) 确认、X(n+1) 复位；Y0 报警汇总、Y1 首出指示。
 * 参数：alarmCount（1..16，默认 3）。
 *
 * 逻辑：
 *   1) 各路报警分别锁存；
 *   2) 首出锁存：第一个出现的报警被记录为首出，直到复位前不再改变；
 *   3) 确认后首出指示熄灭（报警本身仍保持锁存，直到复位）；
 *   4) 复位清除全部报警与首出状态。
 */

import type { StTemplate, TemplateContext } from './types.ts';
import { headerFor, numParam, pickDevice, renderProgram } from './helpers.ts';

const DEFAULT_ALARM_COUNT = 3;
const MAX_ALARM_COUNT = 16;

function instantiate(ctx: TemplateContext): string {
  const alarmCount = Math.trunc(numParam(ctx, 'alarmCount', DEFAULT_ALARM_COUNT));
  if (!Number.isFinite(alarmCount) || alarmCount < 1 || alarmCount > MAX_ALARM_COUNT) {
    throw new Error(`模板 alarm_first_out 的 alarmCount 必须在 1..${MAX_ALARM_COUNT}，收到 ${alarmCount}`);
  }

  // 报警输入按 X 顺序取前 n 路；确认/复位紧跟其后。
  const xAlarms: string[] = [];
  for (let i = 0; i < alarmCount; i++) {
    xAlarms.push(pickDevice(ctx, 'X', i, `X${i}`));
  }
  const xAck = pickDevice(ctx, 'X', alarmCount, `X${alarmCount}`);
  const xReset = pickDevice(ctx, 'X', alarmCount + 1, `X${alarmCount + 1}`);
  const yAlarm = pickDevice(ctx, 'Y', 0, 'Y0');
  const yFirst = pickDevice(ctx, 'Y', 1, 'Y1');

  const alarmVars = xAlarms.map((_, i) => `bAlarm${i + 1}`);
  const firstVars = xAlarms.map((_, i) => `bFirst${i + 1}`);

  const body: string[] = [];
  body.push('// 1) 报警锁存：任一路报警出现即保持');
  xAlarms.forEach((x, i) => {
    body.push(`IF ${x} THEN`);
    body.push(`    ${alarmVars[i]} := TRUE;`);
    body.push('END_IF;');
  });
  body.push('');

  body.push('// 2) 首出锁存：第一个出现的报警被记录，之后不再改变');
  body.push('IF NOT bFirstLatched THEN');
  alarmVars.forEach((a, i) => {
    const keyword = i === 0 ? 'IF' : 'ELSIF';
    body.push(`    ${keyword} ${a} THEN`);
    body.push(`        ${firstVars[i]} := TRUE;`);
    body.push('        bFirstLatched := TRUE;');
  });
  body.push('    END_IF;');
  body.push('END_IF;');
  body.push('');

  body.push('// 3) 报警确认：确认后首出指示熄灭（报警锁存保持）');
  body.push(`IF ${xAck} THEN`);
  body.push('    bAck := TRUE;');
  body.push('END_IF;');
  body.push('');

  body.push('// 4) 复位：清除全部报警与首出状态');
  body.push(`IF ${xReset} THEN`);
  for (const v of [...alarmVars, ...firstVars]) body.push(`    ${v} := FALSE;`);
  body.push('    bFirstLatched := FALSE;');
  body.push('    bAck := FALSE;');
  body.push('END_IF;');
  body.push('');

  body.push('// 5) 输出驱动');
  body.push(`${yAlarm} := ${alarmVars.join(' OR ')};`);
  body.push(`${yFirst} := (${firstVars.join(' OR ')}) AND NOT bAck;`);

  const vars = [
    ...alarmVars.map((v, i) => ({ line: `${v} : BOOL := FALSE;`, comment: `报警 ${i + 1} 锁存` })),
    ...firstVars.map((v, i) => ({ line: `${v} : BOOL := FALSE;`, comment: `首出：报警 ${i + 1}` })),
    { line: 'bFirstLatched : BOOL := FALSE;', comment: '首出已记录' },
    { line: 'bAck : BOOL := FALSE;', comment: '报警已确认' },
  ];

  return renderProgram({
    header: headerFor('alarm_first_out', `报警首出 / 确认 / 复位（${alarmCount} 路）`, ctx, [
      `alarmCount=${alarmCount}`,
    ]),
    vars,
    body: body.join('\n'),
  });
}

export const alarmFirstOutTemplate: StTemplate = {
  name: 'alarm_first_out',
  description: '报警首出：N 路报警锁存 + 首出记录 + 确认 + 复位（N=1..16）',
  params: [
    { name: 'alarmCount', type: 'number', description: '报警路数（1..16）', default: DEFAULT_ALARM_COUNT },
  ],
  instantiate,
};
