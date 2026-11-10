/**
 * 模板：alarm_first_out —— 报警首出 / 确认 / 复位（固定 3 路报警）。
 *
 * IO 约定：X0/X1/X2 三路报警输入、X3 确认、X4 复位、Y0 报警汇总、Y1 首出指示。
 * 参数：alarmCount（本版本固定 3，传入其它值会显式报错）。
 *
 * 逻辑：
 *   1) 各路报警分别锁存；
 *   2) 首出锁存：第一个出现的报警被记录为首出，直到复位前不再改变；
 *   3) 确认后 Y1 首出指示熄灭（报警本身仍保持锁存，直到复位）。
 */

import type { StTemplate, TemplateContext } from './types.ts';
import { headerFor, numParam, pickDevice, renderProgram } from './helpers.ts';

const ALARM_COUNT = 3;

function instantiate(ctx: TemplateContext): string {
  const alarmCount = Math.trunc(numParam(ctx, 'alarmCount', ALARM_COUNT));
  if (alarmCount !== ALARM_COUNT) {
    throw new Error(`模板 alarm_first_out 当前仅支持 alarmCount=${ALARM_COUNT}，收到 ${alarmCount}`);
  }

  const xA1 = pickDevice(ctx, 'X', 0, 'X0');
  const xA2 = pickDevice(ctx, 'X', 1, 'X1');
  const xA3 = pickDevice(ctx, 'X', 2, 'X2');
  const xAck = pickDevice(ctx, 'X', 3, 'X3');
  const xReset = pickDevice(ctx, 'X', 4, 'X4');
  const yAlarm = pickDevice(ctx, 'Y', 0, 'Y0');
  const yFirst = pickDevice(ctx, 'Y', 1, 'Y1');

  const body = [
    `// 1) 报警锁存：任一路报警出现即保持`,
    `IF ${xA1} THEN`,
    `    bAlarm1 := TRUE;`,
    `END_IF;`,
    `IF ${xA2} THEN`,
    `    bAlarm2 := TRUE;`,
    `END_IF;`,
    `IF ${xA3} THEN`,
    `    bAlarm3 := TRUE;`,
    `END_IF;`,
    ``,
    `// 2) 首出锁存：第一个出现的报警被记录，之后不再改变`,
    `IF NOT bFirstLatched THEN`,
    `    IF bAlarm1 THEN`,
    `        bFirst1 := TRUE;`,
    `        bFirstLatched := TRUE;`,
    `    ELSIF bAlarm2 THEN`,
    `        bFirst2 := TRUE;`,
    `        bFirstLatched := TRUE;`,
    `    ELSIF bAlarm3 THEN`,
    `        bFirst3 := TRUE;`,
    `        bFirstLatched := TRUE;`,
    `    END_IF;`,
    `END_IF;`,
    ``,
    `// 3) 报警确认：确认后首出指示熄灭（报警锁存保持）`,
    `IF ${xAck} THEN`,
    `    bAck := TRUE;`,
    `END_IF;`,
    ``,
    `// 4) 复位：清除全部报警与首出状态`,
    `IF ${xReset} THEN`,
    `    bAlarm1 := FALSE;`,
    `    bAlarm2 := FALSE;`,
    `    bAlarm3 := FALSE;`,
    `    bFirst1 := FALSE;`,
    `    bFirst2 := FALSE;`,
    `    bFirst3 := FALSE;`,
    `    bFirstLatched := FALSE;`,
    `    bAck := FALSE;`,
    `END_IF;`,
    ``,
    `// 5) 输出驱动`,
    `${yAlarm} := bAlarm1 OR bAlarm2 OR bAlarm3;`,
    `${yFirst} := (bFirst1 OR bFirst2 OR bFirst3) AND NOT bAck;`,
  ].join('\n');

  return renderProgram({
    header: headerFor('alarm_first_out', '报警首出 / 确认 / 复位（3 路）', ctx, [`alarmCount=${ALARM_COUNT}`]),
    vars: [
      { line: 'bAlarm1 : BOOL := FALSE;', comment: '报警 1 锁存' },
      { line: 'bAlarm2 : BOOL := FALSE;', comment: '报警 2 锁存' },
      { line: 'bAlarm3 : BOOL := FALSE;', comment: '报警 3 锁存' },
      { line: 'bFirst1 : BOOL := FALSE;', comment: '首出：报警 1' },
      { line: 'bFirst2 : BOOL := FALSE;', comment: '首出：报警 2' },
      { line: 'bFirst3 : BOOL := FALSE;', comment: '首出：报警 3' },
      { line: 'bFirstLatched : BOOL := FALSE;', comment: '首出已记录' },
      { line: 'bAck : BOOL := FALSE;', comment: '报警已确认' },
    ],
    body,
  });
}

export const alarmFirstOutTemplate: StTemplate = {
  name: 'alarm_first_out',
  description: '报警首出：3 路报警锁存 + 首出记录 + 确认 + 复位',
  params: [
    { name: 'alarmCount', type: 'number', description: '报警路数（本版本固定 3）', default: 3 },
  ],
  instantiate,
};
