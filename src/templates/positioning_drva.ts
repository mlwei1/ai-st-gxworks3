/**
 * 模板：positioning_drva —— 单轴绝对定位（DRVA 指令的 ST 形态）。
 *
 * 适用：由内置定位（脉冲输出）驱动一个轴走到指定绝对地址。
 *
 * IO 约定：X0 启动、X1 停止/复位；Y0 脉冲输出、Y1 方向输出
 *          （可用参数 pulseY/dirY 覆盖，需与 GX 模块参数中的轴分配一致）。
 *
 * 参数：axis（1..4，对应 SM5500~SM5503 定位驱动中标志）、
 *       target（INT，-32768~32767）、speed（WORD，1~65535）、
 *       pulseY/dirY（Y 编号）。
 *
 * 重要前提：
 *  - 必须在 GX Works3 的模块参数里配置定位参数（脉冲输出模式、单位、加减速等）；
 *  - 本模板只生成“启动 / 完成 / 异常”逻辑；实际脉冲输出需实机或支持定位的仿真环境验证；
 *  - 手册 ST 形式为 `ENO := DRVA(EN, s1, s2, d1, d2);`（见 docs/RAG/知识要点-定位.md）。
 */

import type { StTemplate, TemplateContext } from './types.ts';
import { headerFor, numParam, pickDevice, renderProgram } from './helpers.ts';

const DEFAULT_AXIS = 1;
const DEFAULT_TARGET = 10000;
const DEFAULT_SPEED = 5000;
const DEFAULT_PULSE_Y = 0;
const DEFAULT_DIR_Y = 1;

function instantiate(ctx: TemplateContext): string {
  const axis = Math.trunc(numParam(ctx, 'axis', DEFAULT_AXIS));
  if (!Number.isFinite(axis) || axis < 1 || axis > 4) {
    throw new Error(`模板 positioning_drva 的 axis 必须在 1..4（FX5U 内置定位轴），收到 ${axis}`);
  }
  const target = Math.trunc(numParam(ctx, 'target', DEFAULT_TARGET));
  if (!Number.isFinite(target) || target < -32768 || target > 32767) {
    throw new Error(`模板 positioning_drva 的 target 必须在 -32768..32767，收到 ${target}`);
  }
  const speed = Math.trunc(numParam(ctx, 'speed', DEFAULT_SPEED));
  if (!Number.isFinite(speed) || speed < 1 || speed > 65535) {
    throw new Error(`模板 positioning_drva 的 speed 必须在 1..65535，收到 ${speed}`);
  }
  const pulseY = Math.trunc(numParam(ctx, 'pulseY', DEFAULT_PULSE_Y));
  const dirY = Math.trunc(numParam(ctx, 'dirY', DEFAULT_DIR_Y));
  if (!Number.isFinite(pulseY) || pulseY < 0 || pulseY > 7) {
    throw new Error(`模板 positioning_drva 的 pulseY 必须是 Y0~Y7，收到 ${pulseY}`);
  }
  if (!Number.isFinite(dirY) || dirY < 0 || dirY > 7) {
    throw new Error(`模板 positioning_drva 的 dirY 必须是 Y0~Y7，收到 ${dirY}`);
  }
  if (pulseY === dirY) {
    throw new Error('模板 positioning_drva 的 pulseY 与 dirY 不能相同');
  }

  const xStart = pickDevice(ctx, 'X', 0, 'X0');
  const xReset = pickDevice(ctx, 'X', 1, 'X1');
  const smDriving = `SM${5500 + axis - 1}`; // 定位指令驱动中（轴 1~4）
  const smErr = `SM${5532 + axis - 1}`; // 定位发生出错（轴 1~4）
  const yPulse = `Y${pulseY}`;
  const yDir = `Y${dirY}`;

  const body: string[] = [];
  body.push('// 1) 停止/复位（X1）：清除运行、完成、异常');
  body.push(`IF ${xReset} THEN`);
  body.push('    bMove := FALSE;');
  body.push('    bDriving := FALSE;');
  body.push('    bDone := FALSE;');
  body.push('    bErr := FALSE;');
  body.push('END_IF;');
  body.push('');

  body.push('// 2) 启动（X0 上升沿）：仅空闲时允许启动');
  body.push(`IF ${xStart} AND NOT bStartLast AND NOT bMove THEN`);
  body.push('    bMove := TRUE;');
  body.push('    bDriving := FALSE;');
  body.push('    bDone := FALSE;');
  body.push('    bErr := FALSE;');
  body.push('END_IF;');
  body.push(`bStartLast := ${xStart};`);
  body.push('');

  body.push('// 3) DRVA 绝对定位：ENO := DRVA(EN, s1, s2, d1, d2)');
  body.push('//    s1=目标地址, s2=指令速度, d1=脉冲输出Y, d2=方向输出Y');
  body.push('IF bMove THEN');
  body.push(`    bEno := DRVA(TRUE, nTarget, nSpeed, ${yPulse}, ${yDir});`);
  body.push('');

  body.push('    // 4) 完成判定：定位驱动中标志先 ON 后 OFF（下降沿表示定位结束）');
  body.push(`    IF ${smDriving} THEN`);
  body.push('        bDriving := TRUE;');
  body.push('    END_IF;');
  body.push(`    IF bDriving AND NOT ${smDriving} THEN`);
  body.push('        bMove := FALSE;');
  body.push('        bDriving := FALSE;');
  body.push('        bDone := TRUE;');
  body.push('    END_IF;');
  body.push('');

  body.push('    // 5) 异常：2s 内未进入定位驱动中，或定位出错标志 ON');
  body.push('    tTimeout(IN := bMove AND NOT bDriving, PT := T#2s);');
  body.push('    IF tTimeout.Q THEN');
  body.push('        bMove := FALSE;');
  body.push('        bErr := TRUE;');
  body.push('    END_IF;');
  body.push(`    IF ${smErr} THEN`);
  body.push('        bMove := FALSE;');
  body.push('        bErr := TRUE;');
  body.push('    END_IF;');
  body.push('END_IF;');

  const vars = [
    { line: 'bStartLast : BOOL;', comment: '启动信号上一扫描（上升沿）' },
    { line: 'bMove : BOOL := FALSE;', comment: '定位执行中' },
    { line: 'bDriving : BOOL := FALSE;', comment: '已进入定位驱动中' },
    { line: 'bDone : BOOL := FALSE;', comment: '定位完成' },
    { line: 'bErr : BOOL := FALSE;', comment: '定位异常/超时' },
    { line: 'bEno : BOOL;', comment: 'DRVA 指令执行结果（ENO）' },
    { line: `nTarget : INT := ${target};`, comment: '目标位置（绝对地址）' },
    { line: `nSpeed : WORD := ${speed};`, comment: '定位速度' },
    { line: 'tTimeout : TON;', comment: '启动超时监控（2s）' },
  ];

  return renderProgram({
    header: headerFor('positioning_drva', `单轴绝对定位（轴${axis}，DRVA）`, ctx, [
      `axis=${axis}`,
      `target=${target}`,
      `speed=${speed}`,
      `pulseY=${pulseY}`,
      `dirY=${dirY}`,
    ]),
    vars,
    body: body.join('\n'),
  });
}

export const positioningDrvaTemplate: StTemplate = {
  name: 'positioning_drva',
  description: '单轴绝对定位：DRVA 指令 + 完成/超时/出错处理（需 GX 模块参数配置定位）',
  params: [
    { name: 'axis', type: 'number', description: '轴号（1..4）', default: DEFAULT_AXIS },
    { name: 'target', type: 'number', description: '目标位置（-32768~32767）', default: DEFAULT_TARGET },
    { name: 'speed', type: 'number', description: '定位速度（1~65535，单位由模块参数决定）', default: DEFAULT_SPEED },
    { name: 'pulseY', type: 'number', description: '脉冲输出 Y 编号（0~7）', default: DEFAULT_PULSE_Y },
    { name: 'dirY', type: 'number', description: '方向输出 Y 编号（0~7）', default: DEFAULT_DIR_Y },
  ],
  instantiate,
};
