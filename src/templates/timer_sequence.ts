/**
 * 模板：timer_sequence —— 多步定时时序（步数可配置）。
 *
 * IO 约定：X0 启动、X1 复位；Y0..Y(n-1) 分别对应第 1..n 步输出。
 * 参数：stepCount（1..8，默认 3）；step1Sec..step8Sec 为每步持续时间（秒）。
 */

import type { StTemplate, TemplateContext } from './types.ts';
import { headerFor, numParam, pickDevice, renderProgram, timeLiteral } from './helpers.ts';

const DEFAULT_STEP_COUNT = 3;
const MAX_STEP_COUNT = 8;
const DEFAULT_SECONDS = [2, 3, 5, 4, 4, 4, 4, 4];

function instantiate(ctx: TemplateContext): string {
  const stepCount = Math.trunc(numParam(ctx, 'stepCount', DEFAULT_STEP_COUNT));
  if (!Number.isFinite(stepCount) || stepCount < 1 || stepCount > MAX_STEP_COUNT) {
    throw new Error(`模板 timer_sequence 的 stepCount 必须在 1..${MAX_STEP_COUNT}，收到 ${stepCount}`);
  }

  const xStart = pickDevice(ctx, 'X', 0, 'X0');
  const xReset = pickDevice(ctx, 'X', 1, 'X1');

  const stepSeconds: number[] = [];
  for (let i = 0; i < stepCount; i++) {
    stepSeconds.push(numParam(ctx, `step${i + 1}Sec`, DEFAULT_SECONDS[i]));
  }
  const ptList = stepSeconds.map((s) => timeLiteral(s));
  const yList = stepSeconds.map((_, i) => pickDevice(ctx, 'Y', i, `Y${i}`));

  const body: string[] = [];
  body.push('// 1) 复位优先');
  body.push(`IF ${xReset} THEN`);
  body.push('    nSeq := 0;');
  body.push('END_IF;');
  body.push('');

  body.push('// 2) 时序状态机：0=待机，1..N=第 1..N 步');
  body.push('CASE nSeq OF');
  body.push('    0:');
  body.push(`        tStep1(IN := FALSE, PT := ${ptList[0]});`);
  body.push(`        IF ${xStart} THEN`);
  body.push('            nSeq := 1;');
  body.push('        END_IF;');
  for (let i = 0; i < stepCount; i++) {
    const step = i + 1;
    const next = step < stepCount ? step + 1 : 0;
    body.push(`    ${step}:`);
    body.push(`        tStep${step}(IN := TRUE, PT := ${ptList[i]});`);
    body.push(`        IF tStep${step}.Q THEN`);
    body.push(`            nSeq := ${next};`);
    body.push('        END_IF;');
  }
  body.push('    ELSE');
  body.push('        nSeq := 0;');
  body.push('END_CASE;');
  body.push('');

  body.push('// 3) 步输出');
  for (let i = 0; i < stepCount; i++) {
    body.push(`${yList[i]} := nSeq = ${i + 1};`);
  }

  const vars = [
    { line: 'nSeq : INT := 0;', comment: `时序步号 0..${stepCount}` },
    ...stepSeconds.map((_, i) => ({ line: `tStep${i + 1} : TON;`, comment: `第 ${i + 1} 步定时器` })),
  ];

  return renderProgram({
    header: headerFor('timer_sequence', `多步定时时序（${stepCount} 步）`, ctx, [
      `stepCount=${stepCount}`,
      ...stepSeconds.map((s, i) => `step${i + 1}Sec=${s}`),
    ]),
    vars,
    body: body.join('\n'),
  });
}

export const timerSequenceTemplate: StTemplate = {
  name: 'timer_sequence',
  description: '多步定时时序：N 步依次延时输出，可复位（TON 链 + CASE，N=1..8）',
  params: [
    { name: 'stepCount', type: 'number', description: '步数（1..8）', default: DEFAULT_STEP_COUNT },
    ...DEFAULT_SECONDS.map((s, i) => ({
      name: `step${i + 1}Sec`,
      type: 'number' as const,
      description: `第 ${i + 1} 步持续时间（秒）`,
      default: s,
    })),
  ],
  instantiate,
};
