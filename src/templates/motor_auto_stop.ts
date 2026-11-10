/**
 * 模板：motor_auto_stop —— 启动后延时自动停止。
 *
 * IO 约定：X0 启动、X1 停止、X2 故障、Y0 运行输出。
 * 参数：autoStopSec = 自动停止时间（秒，默认 10）。
 */

import type { StTemplate, TemplateContext } from './types.ts';
import {
  headerFor,
  intLiteral,
  numParam,
  pickDevice,
  renderProgram,
  timeLiteral,
} from './helpers.ts';

function instantiate(ctx: TemplateContext): string {
  const xStart = pickDevice(ctx, 'X', 0, 'X0');
  const xStop = pickDevice(ctx, 'X', 1, 'X1');
  const xFault = pickDevice(ctx, 'X', 2, 'X2');
  const yRun = pickDevice(ctx, 'Y', 0, 'Y0');
  const autoStopSec = numParam(ctx, 'autoStopSec', 10);
  const pt = timeLiteral(autoStopSec);

  const body = [
    `// 1) 故障锁存与联锁`,
    `IF ${xFault} THEN`,
    `    bFault := TRUE;`,
    `END_IF;`,
    `IF bFault OR ${xStop} THEN`,
    `    bRun := FALSE;`,
    `END_IF;`,
    ``,
    `// 2) 启动自锁`,
    `IF ${xStart} AND NOT ${xStop} AND NOT bFault THEN`,
    `    bRun := TRUE;`,
    `END_IF;`,
    ``,
    `// 3) 运行延时：运行期间计时，到 ${intLiteral(autoStopSec)} 秒自动停止`,
    `tAutoStop(IN := bRun, PT := ${pt});`,
    `IF bRun AND tAutoStop.Q THEN`,
    `    bRun := FALSE;`,
    `END_IF;`,
    ``,
    `// 4) 输出驱动`,
    `${yRun} := bRun;`,
  ].join('\n');

  return renderProgram({
    header: headerFor('motor_auto_stop', '启动后延时自动停止', ctx, [`autoStopSec=${intLiteral(autoStopSec)}`]),
    vars: [
      { line: 'bRun : BOOL := FALSE;', comment: '运行状态（自锁）' },
      { line: 'bFault : BOOL := FALSE;', comment: '故障锁存' },
      { line: 'tAutoStop : TON;', comment: '自动停止定时器' },
    ],
    body,
  });
}

export const motorAutoStopTemplate: StTemplate = {
  name: 'motor_auto_stop',
  description: '电机启动后按设定时间自动停止（TON 定时 + 启停自锁）',
  params: [
    { name: 'autoStopSec', type: 'number', description: '启动后自动停止的延时（秒）', default: 10 },
  ],
  instantiate,
};
