/**
 * 模板：counter_batch —— 计数到批量复位。
 *
 * IO 约定：X0 计数脉冲、X1 复位、Y0 批量完成输出。
 * 参数：batchSize = 批量大小（默认 10）。
 *
 * 逻辑：
 *   1) R_TRIG 取计数脉冲上升沿；
 *   2) CTU 计数，PV = batchSize；
 *   3) 达到 PV 后锁存批量完成输出，按复位按钮清除并复位计数器。
 */

import type { StTemplate, TemplateContext } from './types.ts';
import { headerFor, intLiteral, numParam, pickDevice, renderProgram } from './helpers.ts';

function instantiate(ctx: TemplateContext): string {
  const xPulse = pickDevice(ctx, 'X', 0, 'X0');
  const xReset = pickDevice(ctx, 'X', 1, 'X1');
  const yDone = pickDevice(ctx, 'Y', 0, 'Y0');
  const batchSize = Math.max(1, Math.trunc(numParam(ctx, 'batchSize', 10)));

  const body = [
    `// 1) 计数脉冲取上升沿（避免长按重复计数）`,
    `fbEdge(CLK := ${xPulse});`,
    ``,
    `// 2) 批量计数：CV >= ${intLiteral(batchSize)} 时 Q 置位`,
    `fbCount(CU := fbEdge.Q, R := bBatchDone OR ${xReset}, PV := ${intLiteral(batchSize)});`,
    `IF fbCount.Q THEN`,
    `    bBatchDone := TRUE;`,
    `END_IF;`,
    ``,
    `// 3) 复位：清除完成标志（同时复位计数器）`,
    `IF ${xReset} THEN`,
    `    bBatchDone := FALSE;`,
    `END_IF;`,
    ``,
    `// 4) 输出驱动`,
    `${yDone} := bBatchDone;`,
  ].join('\n');

  return renderProgram({
    header: headerFor('counter_batch', '计数到批量复位', ctx, [`batchSize=${intLiteral(batchSize)}`]),
    vars: [
      { line: 'bBatchDone : BOOL := FALSE;', comment: '批量完成锁存' },
      { line: 'fbEdge : R_TRIG;', comment: '计数脉冲上升沿' },
      { line: 'fbCount : CTU;', comment: '批量计数器' },
    ],
    body,
  });
}

export const counterBatchTemplate: StTemplate = {
  name: 'counter_batch',
  description: '计数到批量复位：脉冲上升沿计数，达到批量值锁存输出，复位清除',
  params: [
    { name: 'batchSize', type: 'number', description: '批量大小（计数值）', default: 10 },
  ],
  instantiate,
};
