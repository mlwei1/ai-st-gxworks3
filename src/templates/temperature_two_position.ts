/**
 * 模板：temperature_two_position —— 位式（ON/OFF）温度控制。
 *
 * 适用：加热/冷却双输出、带回差的位式温控（无需 PID 参数整定，工业现场最常见的基础温控）。
 *
 * IO 约定：
 *   X0 启动、X1 停止；
 *   Y0 加热输出、Y1 冷却输出；
 *   D100 当前温度（INT，0.1°C 单位，由模拟量模块/通信写入）。
 *
 * 参数：
 *   setpoint   设定温度（0.1°C，默认 600 = 60.0°C）
 *   hysteresis 回差（0.1°C，默认 20 = 2.0°C）
 *   tempMin/tempMax 传感器量程（0.1°C，默认 -500 / 1500），超量程置 bErr 并停输出
 *
 * 控制逻辑（带回差，避免临界点频繁动作）：
 *   加热：温度 ≤ 设定-回差 → 开；温度 ≥ 设定 → 关
 *   冷却：温度 ≥ 设定+回差 → 开；温度 ≤ 设定 → 关
 *   停止/传感器故障时加热、冷却均 OFF。
 */

import type { StTemplate, TemplateContext } from './types.ts';
import { headerFor, numParam, pickDevice, renderProgram } from './helpers.ts';

const DEFAULT_SETPOINT = 600; // 0.1°C → 60.0°C
const DEFAULT_HYSTERESIS = 20; // 0.1°C → 2.0°C
const DEFAULT_TEMP_MIN = -500; // -50.0°C
const DEFAULT_TEMP_MAX = 1500; // 150.0°C

function instantiate(ctx: TemplateContext): string {
  const setpoint = Math.trunc(numParam(ctx, 'setpoint', DEFAULT_SETPOINT));
  const hysteresis = Math.trunc(numParam(ctx, 'hysteresis', DEFAULT_HYSTERESIS));
  const tempMin = Math.trunc(numParam(ctx, 'tempMin', DEFAULT_TEMP_MIN));
  const tempMax = Math.trunc(numParam(ctx, 'tempMax', DEFAULT_TEMP_MAX));
  if (!Number.isFinite(setpoint) || setpoint < -1000 || setpoint > 3000) {
    throw new Error(`模板 temperature_two_position 的 setpoint 必须在 -1000..3000（0.1°C），收到 ${setpoint}`);
  }
  if (!Number.isFinite(hysteresis) || hysteresis < 0 || hysteresis > 500) {
    throw new Error(`模板 temperature_two_position 的 hysteresis 必须在 0..500（0.1°C），收到 ${hysteresis}`);
  }
  if (!Number.isFinite(tempMin) || !Number.isFinite(tempMax) || tempMin >= tempMax) {
    throw new Error(`模板 temperature_two_position 的 tempMin 必须小于 tempMax，收到 ${tempMin}/${tempMax}`);
  }

  const xStart = pickDevice(ctx, 'X', 0, 'X0');
  const xStop = pickDevice(ctx, 'X', 1, 'X1');
  const yHeat = pickDevice(ctx, 'Y', 0, 'Y0');
  const yCool = pickDevice(ctx, 'Y', 1, 'Y1');
  const dTemp = pickDevice(ctx, 'D', 0, 'D100');

  const body: string[] = [];
  body.push(`// 1) 当前温度：${dTemp}（0.1°C，由模拟量/通信写入）`);
  body.push(`nTemp := ${dTemp};`);
  body.push('');

  body.push('// 2) 传感器量程检查：超量程时停止运行（回到量程内可重新启动）');
  body.push('bErr := FALSE;');
  body.push('IF nTemp <= nTempMin OR nTemp >= nTempMax THEN');
  body.push('    bErr := TRUE;');
  body.push('    bRun := FALSE;');
  body.push('END_IF;');
  body.push('');

  body.push(`// 3) 启动/停止`);
  body.push(`IF ${xStop} THEN`);
  body.push('    bRun := FALSE;');
  body.push('END_IF;');
  body.push(`IF ${xStart} AND NOT bStartLast AND NOT bErr THEN`);
  body.push('    bRun := TRUE;');
  body.push('END_IF;');
  body.push(`bStartLast := ${xStart};`);
  body.push('');

  body.push('// 4) 位式温控（带回差，避免临界点频繁动作）');
  body.push('IF bRun AND NOT bErr THEN');
  body.push('    // 加热：低于(设定-回差)开，达到设定关');
  body.push('    IF nTemp <= nSet - nHyst THEN');
  body.push('        bHeat := TRUE;');
  body.push('    END_IF;');
  body.push('    IF nTemp >= nSet THEN');
  body.push('        bHeat := FALSE;');
  body.push('    END_IF;');
  body.push('    // 冷却：高于(设定+回差)开，降到设定关');
  body.push('    IF nTemp >= nSet + nHyst THEN');
  body.push('        bCool := TRUE;');
  body.push('    END_IF;');
  body.push('    IF nTemp <= nSet THEN');
  body.push('        bCool := FALSE;');
  body.push('    END_IF;');
  body.push('ELSE');
  body.push('    bHeat := FALSE;');
  body.push('    bCool := FALSE;');
  body.push('END_IF;');
  body.push('');

  body.push('// 5) 输出');
  body.push(`${yHeat} := bRun AND bHeat;`);
  body.push(`${yCool} := bRun AND bCool;`);

  const vars = [
    { line: 'bStartLast : BOOL;', comment: '启动信号上一扫描（上升沿）' },
    { line: 'bRun : BOOL := FALSE;', comment: '温控运行中' },
    { line: 'bErr : BOOL := FALSE;', comment: '传感器超量程故障' },
    { line: 'bHeat : BOOL := FALSE;', comment: '加热请求' },
    { line: 'bCool : BOOL := FALSE;', comment: '冷却请求' },
    { line: 'nTemp : INT;', comment: '当前温度（0.1°C）' },
    { line: `nSet : INT := ${setpoint};`, comment: '设定温度（0.1°C）' },
    { line: `nHyst : INT := ${hysteresis};`, comment: '回差（0.1°C）' },
    { line: `nTempMin : INT := ${tempMin};`, comment: '传感器量程下限（0.1°C）' },
    { line: `nTempMax : INT := ${tempMax};`, comment: '传感器量程上限（0.1°C）' },
  ];

  return renderProgram({
    header: headerFor('temperature_two_position', '位式温度控制（加热/冷却 + 回差）', ctx, [
      `setpoint=${setpoint}`,
      `hysteresis=${hysteresis}`,
      `tempMin=${tempMin}`,
      `tempMax=${tempMax}`,
    ]),
    vars,
    body: body.join('\n'),
  });
}

export const temperatureTwoPositionTemplate: StTemplate = {
  name: 'temperature_two_position',
  description: '位式温度控制：加热/冷却双输出、带回差、传感器超量程保护（0.1°C 单位）',
  params: [
    { name: 'setpoint', type: 'number', description: '设定温度（0.1°C，600=60.0°C）', default: DEFAULT_SETPOINT },
    { name: 'hysteresis', type: 'number', description: '回差（0.1°C，20=2.0°C）', default: DEFAULT_HYSTERESIS },
    { name: 'tempMin', type: 'number', description: '传感器量程下限（0.1°C）', default: DEFAULT_TEMP_MIN },
    { name: 'tempMax', type: 'number', description: '传感器量程上限（0.1°C）', default: DEFAULT_TEMP_MAX },
  ],
  instantiate,
};
