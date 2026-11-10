/**
 * 模板：motor_start_stop —— 电机启停 / 故障联锁 / 自锁回路。
 *
 * IO 约定（按 spec.io 顺序取）：
 *   X0 启动按钮、X1 停止按钮、X2 故障/过载、X3 复位按钮、Y0 运行输出。
 *
 * 参数：
 *   faultReset = manual | auto
 *     manual：故障消失后，按停止或复位按钮才复位故障
 *     auto  ：故障输入消失后自动复位故障
 */

import type { StTemplate, TemplateContext } from './types.ts';
import { headerFor, pickDevice, renderProgram, strParam } from './helpers.ts';

function instantiate(ctx: TemplateContext): string {
  const xStart = pickDevice(ctx, 'X', 0, 'X0');
  const xStop = pickDevice(ctx, 'X', 1, 'X1');
  const xFault = pickDevice(ctx, 'X', 2, 'X2');
  const xReset = pickDevice(ctx, 'X', 3, 'X3');
  const yRun = pickDevice(ctx, 'Y', 0, 'Y0');

  const faultReset = strParam(ctx, 'faultReset', 'manual').toLowerCase();
  const autoReset = faultReset === 'auto';

  const resetBlock = autoReset
    ? [
        `// 2) 故障复位（auto）：故障输入消失后自动复位`,
        `IF bFault AND NOT ${xFault} THEN`,
        `    bFault := FALSE;`,
        `END_IF;`,
      ]
    : [
        `// 2) 故障复位（manual）：故障消失后按停止或复位按钮复位`,
        `IF bFault AND NOT ${xFault} THEN`,
        `    IF ${xStop} OR ${xReset} THEN`,
        `        bFault := FALSE;`,
        `    END_IF;`,
        `END_IF;`,
      ];

  const body = [
    `// 1) 故障锁存：故障输入为 ON 时置位故障标志`,
    `IF ${xFault} THEN`,
    `    bFault := TRUE;`,
    `END_IF;`,
    ``,
    ...resetBlock,
    ``,
    `// 3) 启动自锁：启动按钮按下、无停止且无故障时自锁`,
    `IF ${xStart} AND NOT ${xStop} AND NOT bFault THEN`,
    `    bRun := TRUE;`,
    `END_IF;`,
    ``,
    `// 4) 停止优先：停止按钮或故障立即解除自锁`,
    `IF ${xStop} OR bFault THEN`,
    `    bRun := FALSE;`,
    `END_IF;`,
    ``,
    `// 5) 输出驱动`,
    `${yRun} := bRun;`,
  ].join('\n');

  return renderProgram({
    header: headerFor('motor_start_stop', '电机启停 / 故障联锁 / 自锁回路', ctx, [`faultReset=${faultReset}`]),
    vars: [
      { line: 'bRun : BOOL := FALSE;', comment: '运行状态（自锁）' },
      { line: 'bFault : BOOL := FALSE;', comment: '故障锁存' },
    ],
    body,
  });
}

export const motorStartStopTemplate: StTemplate = {
  name: 'motor_start_stop',
  description: '电机启停：启动/停止/故障联锁 + 自锁，支持手动或自动故障复位',
  params: [
    {
      name: 'faultReset',
      type: 'string',
      description: '故障复位方式：manual=按停止/复位按钮复位，auto=故障消失自动复位',
      default: 'manual',
    },
  ],
  instantiate,
};
