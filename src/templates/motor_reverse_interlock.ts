/**
 * 模板：motor_reverse_interlock —— 正反转互锁 + 换向死区。
 *
 * IO 约定：X0 正转按钮、X1 反转按钮、X2 停止按钮、Y0 正转输出、Y1 反转输出。
 * 参数：deadTimeSec = 换向死区时间（秒，默认 0.5）。
 *
 * 安全逻辑：
 *   1) 正/反转按钮同时按下视为停止（互斥优先）；
 *   2) 方向切换时先断开当前输出，等死区时间到后再接通新方向；
 *   3) 输出侧做互锁（同一时刻最多一个方向）。
 */

import type { StTemplate, TemplateContext } from './types.ts';
import { headerFor, numParam, pickDevice, renderProgram, timeLiteral } from './helpers.ts';

function instantiate(ctx: TemplateContext): string {
  const xFwd = pickDevice(ctx, 'X', 0, 'X0');
  const xRev = pickDevice(ctx, 'X', 1, 'X1');
  const xStop = pickDevice(ctx, 'X', 2, 'X2');
  const yFwd = pickDevice(ctx, 'Y', 0, 'Y0');
  const yRev = pickDevice(ctx, 'Y', 1, 'Y1');
  const deadTimeSec = numParam(ctx, 'deadTimeSec', 0.5);
  const pt = timeLiteral(deadTimeSec);

  const body = [
    `// 1) 目标方向：0=停止，1=正转，2=反转（同时按下按停止处理）`,
    `nDirCmd := 0;`,
    `IF ${xFwd} AND NOT ${xRev} THEN`,
    `    nDirCmd := 1;`,
    `END_IF;`,
    `IF ${xRev} AND NOT ${xFwd} THEN`,
    `    nDirCmd := 2;`,
    `END_IF;`,
    `IF ${xStop} THEN`,
    `    nDirCmd := 0;`,
    `END_IF;`,
    ``,
    `// 2) 换向死区：切换方向前先断开当前输出并等待死区时间`,
    `IF nDirCmd = 0 THEN`,
    `    nDirOut := 0;`,
    `    tDead(IN := FALSE, PT := ${pt});`,
    `ELSIF nDirOut = 0 THEN`,
    `    nDirOut := nDirCmd;`,
    `    tDead(IN := FALSE, PT := ${pt});`,
    `ELSIF nDirCmd <> nDirOut THEN`,
    `    tDead(IN := TRUE, PT := ${pt});`,
    `    IF tDead.Q THEN`,
    `        nDirOut := 0;`,
    `        tDead(IN := FALSE, PT := ${pt});`,
    `    END_IF;`,
    `ELSE`,
    `    tDead(IN := FALSE, PT := ${pt});`,
    `END_IF;`,
    ``,
    `// 3) 互锁输出：同一时刻最多一个方向`,
    `${yFwd} := nDirOut = 1;`,
    `${yRev} := nDirOut = 2;`,
  ].join('\n');

  return renderProgram({
    header: headerFor('motor_reverse_interlock', '正反转互锁 + 换向死区', ctx, [`deadTimeSec=${deadTimeSec}`]),
    vars: [
      { line: 'nDirCmd : INT := 0;', comment: '目标方向 0/1/2' },
      { line: 'nDirOut : INT := 0;', comment: '当前输出方向 0/1/2' },
      { line: 'tDead : TON;', comment: '换向死区定时器' },
    ],
    body,
  });
}

export const motorReverseInterlockTemplate: StTemplate = {
  name: 'motor_reverse_interlock',
  description: '正反转互锁：按钮互斥 + 换向死区延时 + 输出互锁',
  params: [
    { name: 'deadTimeSec', type: 'number', description: '换向死区时间（秒）', default: 0.5 },
  ],
  instantiate,
};
