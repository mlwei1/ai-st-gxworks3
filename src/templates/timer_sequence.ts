/**
 * 模板：timer_sequence —— 多步定时时序（固定 3 步）。
 *
 * IO 约定：X0 启动、X1 复位、Y0/Y1/Y2 分别对应第 1/2/3 步输出。
 * 参数：step1Sec / step2Sec / step3Sec 每步持续时间（秒）。
 */

import type { StTemplate, TemplateContext } from './types.ts';
import { headerFor, numParam, pickDevice, renderProgram, timeLiteral } from './helpers.ts';

function instantiate(ctx: TemplateContext): string {
  const xStart = pickDevice(ctx, 'X', 0, 'X0');
  const xReset = pickDevice(ctx, 'X', 1, 'X1');
  const y0 = pickDevice(ctx, 'Y', 0, 'Y0');
  const y1 = pickDevice(ctx, 'Y', 1, 'Y1');
  const y2 = pickDevice(ctx, 'Y', 2, 'Y2');
  const step1 = numParam(ctx, 'step1Sec', 2);
  const step2 = numParam(ctx, 'step2Sec', 3);
  const step3 = numParam(ctx, 'step3Sec', 5);
  const pt1 = timeLiteral(step1);
  const pt2 = timeLiteral(step2);
  const pt3 = timeLiteral(step3);

  const body = [
    `// 1) 复位优先`,
    `IF ${xReset} THEN`,
    `    nSeq := 0;`,
    `END_IF;`,
    ``,
    `// 2) 时序状态机：0=待机，1/2/3=第 1/2/3 步`,
    `CASE nSeq OF`,
    `    0:`,
    `        tStep1(IN := FALSE, PT := ${pt1});`,
    `        IF ${xStart} THEN`,
    `            nSeq := 1;`,
    `        END_IF;`,
    `    1:`,
    `        tStep1(IN := TRUE, PT := ${pt1});`,
    `        IF tStep1.Q THEN`,
    `            nSeq := 2;`,
    `        END_IF;`,
    `    2:`,
    `        tStep2(IN := TRUE, PT := ${pt2});`,
    `        IF tStep2.Q THEN`,
    `            nSeq := 3;`,
    `        END_IF;`,
    `    3:`,
    `        tStep3(IN := TRUE, PT := ${pt3});`,
    `        IF tStep3.Q THEN`,
    `            nSeq := 0;`,
    `        END_IF;`,
    `    ELSE`,
    `        nSeq := 0;`,
    `END_CASE;`,
    ``,
    `// 3) 步输出`,
    `${y0} := nSeq = 1;`,
    `${y1} := nSeq = 2;`,
    `${y2} := nSeq = 3;`,
  ].join('\n');

  return renderProgram({
    header: headerFor('timer_sequence', '多步定时时序（3 步）', ctx, [
      `step1Sec=${step1}`,
      `step2Sec=${step2}`,
      `step3Sec=${step3}`,
    ]),
    vars: [
      { line: 'nSeq : INT := 0;', comment: '时序步号 0..3' },
      { line: 'tStep1 : TON;', comment: '第 1 步定时器' },
      { line: 'tStep2 : TON;', comment: '第 2 步定时器' },
      { line: 'tStep3 : TON;', comment: '第 3 步定时器' },
    ],
    body,
  });
}

export const timerSequenceTemplate: StTemplate = {
  name: 'timer_sequence',
  description: '多步定时时序：3 步依次延时输出，可复位（TON 链 + CASE）',
  params: [
    { name: 'step1Sec', type: 'number', description: '第 1 步持续时间（秒）', default: 2 },
    { name: 'step2Sec', type: 'number', description: '第 2 步持续时间（秒）', default: 3 },
    { name: 'step3Sec', type: 'number', description: '第 3 步持续时间（秒）', default: 5 },
  ],
  instantiate,
};
