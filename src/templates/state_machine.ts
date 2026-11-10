/**
 * 模板：state_machine —— CASE 状态机（待机 → 运行 → 停止，含非法转移保护）。
 *
 * IO 约定：X0 启动、X1 停止、X2 故障、Y0 运行输出。
 *
 * 状态：0=待机，1=运行，2=停止（故障/停止后进入）。
 * 非法转移保护：
 *   1) 状态号越界（<0 或 >2）直接回待机；
 *   2) CASE 的 ELSE 分支兜底回待机。
 */

import type { StTemplate, TemplateContext } from './types.ts';
import { headerFor, pickDevice, renderProgram } from './helpers.ts';

function instantiate(ctx: TemplateContext): string {
  const xStart = pickDevice(ctx, 'X', 0, 'X0');
  const xStop = pickDevice(ctx, 'X', 1, 'X1');
  const xFault = pickDevice(ctx, 'X', 2, 'X2');
  const yRun = pickDevice(ctx, 'Y', 0, 'Y0');

  const body = [
    `// 1) 非法状态保护：状态号越界时强制回待机`,
    `IF nState < 0 OR nState > 2 THEN`,
    `    nState := 0;`,
    `END_IF;`,
    ``,
    `// 2) 状态机：0=待机，1=运行，2=停止`,
    `CASE nState OF`,
    `    0: // 待机：启动条件满足则进入运行`,
    `        IF ${xFault} THEN`,
    `            nState := 2;`,
    `        ELSIF ${xStart} AND NOT ${xStop} THEN`,
    `            nState := 1;`,
    `        END_IF;`,
    `    1: // 运行：停止或故障进入停止`,
    `        IF ${xFault} OR ${xStop} THEN`,
    `            nState := 2;`,
    `        END_IF;`,
    `    2: // 停止：故障与停止按钮均解除后回待机`,
    `        IF NOT ${xFault} AND NOT ${xStop} THEN`,
    `            nState := 0;`,
    `        END_IF;`,
    `    ELSE // 兜底：未知状态回待机`,
    `        nState := 0;`,
    `END_CASE;`,
    ``,
    `// 3) 输出驱动：仅运行状态输出`,
    `${yRun} := nState = 1;`,
  ].join('\n');

  return renderProgram({
    header: headerFor('state_machine', 'CASE 状态机（待机→运行→停止，含非法转移保护）', ctx, []),
    vars: [{ line: 'nState : INT := 0;', comment: '状态机当前状态 0/1/2' }],
    body,
  });
}

export const stateMachineTemplate: StTemplate = {
  name: 'state_machine',
  description: 'CASE 状态机：待机→运行→停止三态，含越界与 ELSE 兜底保护',
  params: [],
  instantiate,
};
