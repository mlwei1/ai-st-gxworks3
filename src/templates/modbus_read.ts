/**
 * 模板：modbus_read —— MODBUS 串行主站读取（ADPRW 指令的 ST 形态）。
 *
 * 适用：FX5U 作为 MODBUS 主站，通过 RS-485 读取从站的保持寄存器/输入寄存器。
 *
 * IO 约定（按 spec.io 顺序取）：
 *   X0 启动（上升沿触发一次读取）、X1 复位；
 *   Y0 通信中、Y1 正常结束、Y2 异常结束（可用 spec.io 覆盖）；
 *   第一个 D 为读数据区起始（默认 D100），第一个 M 为状态位起始（默认 M100，
 *   占用 M100/M101/M102 三点：执行中 / 正常结束 / 异常结束）。
 *
 * 参数：
 *   slave     从站站号（1..247）
 *   func      功能码：3=读保持寄存器（03H）、4=读输入寄存器（04H）
 *   addr      起始寄存器地址（0..32767）
 *   count     读取数量（1..125，MODBUS 03H/04H 标准上限）
 *   timeoutMs 通信超时（毫秒，100..10000）
 *
 * 重要前提：
 *  - 必须在 GX Works3 的模块参数中配置 RS-485 通信格式与 MODBUS 主站参数；
 *  - 指令 ST 形式 `ENO:=ADPRW(EN,s1,s2,s3,s4,s5,d2);` 已通过 GX Works3 全部转换
 *    （Error:0，见 docs/evidence/M3/08-adprw-gx-compile.png）；
 *  - 实际从站通信需实机/支持 MODBUS 的仿真环境验证。
 */

import type { StTemplate, TemplateContext } from './types.ts';
import {
  deviceNumber,
  headerFor,
  numParam,
  pickDevice,
  renderProgram,
  timeLiteral,
} from './helpers.ts';

const DEFAULT_SLAVE = 1;
const DEFAULT_FUNC = 3;
const DEFAULT_ADDR = 0;
const DEFAULT_COUNT = 1;
const DEFAULT_TIMEOUT_MS = 3000;

function instantiate(ctx: TemplateContext): string {
  const slave = Math.trunc(numParam(ctx, 'slave', DEFAULT_SLAVE));
  if (!Number.isFinite(slave) || slave < 1 || slave > 247) {
    throw new Error(`模板 modbus_read 的 slave 必须在 1..247，收到 ${slave}`);
  }
  const func = Math.trunc(numParam(ctx, 'func', DEFAULT_FUNC));
  if (func !== 3 && func !== 4) {
    throw new Error(`模板 modbus_read 的 func 只能是 3（保持寄存器）或 4（输入寄存器），收到 ${func}`);
  }
  const addr = Math.trunc(numParam(ctx, 'addr', DEFAULT_ADDR));
  if (!Number.isFinite(addr) || addr < 0 || addr > 32767) {
    throw new Error(`模板 modbus_read 的 addr 必须在 0..32767，收到 ${addr}`);
  }
  const count = Math.trunc(numParam(ctx, 'count', DEFAULT_COUNT));
  if (!Number.isFinite(count) || count < 1 || count > 125) {
    throw new Error(`模板 modbus_read 的 count 必须在 1..125，收到 ${count}`);
  }
  const timeoutMs = Math.trunc(numParam(ctx, 'timeoutMs', DEFAULT_TIMEOUT_MS));
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 10000) {
    throw new Error(`模板 modbus_read 的 timeoutMs 必须在 100..10000，收到 ${timeoutMs}`);
  }

  const xStart = pickDevice(ctx, 'X', 0, 'X0');
  const xReset = pickDevice(ctx, 'X', 1, 'X1');
  const yBusy = pickDevice(ctx, 'Y', 0, 'Y0');
  const yDone = pickDevice(ctx, 'Y', 1, 'Y1');
  const yErr = pickDevice(ctx, 'Y', 2, 'Y2');
  const dataStart = pickDevice(ctx, 'D', 0, 'D100');
  const statusStart = pickDevice(ctx, 'M', 0, 'M100');
  const statusNo = deviceNumber(statusStart);
  const statusBusy = statusNo >= 0 ? `M${statusNo}` : 'M100';
  const statusDone = statusNo >= 0 ? `M${statusNo + 1}` : 'M101';
  const statusErr = statusNo >= 0 ? `M${statusNo + 2}` : 'M102';
  const funcText = func === 3 ? '03H 读保持寄存器' : '04H 读输入寄存器';

  const body: string[] = [];
  body.push('// 1) 复位（X1）：清除请求/完成/异常');
  body.push(`IF ${xReset} THEN`);
  body.push('    bReq := FALSE;');
  body.push('    bDone := FALSE;');
  body.push('    bErr := FALSE;');
  body.push('END_IF;');
  body.push('');

  body.push('// 2) 启动（X0 上升沿）：触发一次读取');
  body.push(`IF ${xStart} AND NOT bStartLast AND NOT bReq THEN`);
  body.push('    bReq := TRUE;');
  body.push('    bDone := FALSE;');
  body.push('    bErr := FALSE;');
  body.push('END_IF;');
  body.push(`bStartLast := ${xStart};`);
  body.push('');

  body.push(`// 3) MODBUS 读取（功能码 ${funcText}）：ENO := ADPRW(EN, s1, s2, s3, s4, s5, d2)`);
  body.push(`//    s1=站号${slave}, s2=功能码${func}, s3=起始地址${addr}, s4=数量${count},`);
  body.push(`//    s5=读数据区 ${dataStart}，d2=状态位 ${statusBusy}/${statusDone}/${statusErr}`);
  body.push('IF bReq THEN');
  body.push(
    `    bEno := ADPRW(TRUE, nSlave, nFunc, nAddr, nCount, ${dataStart}, ${statusBusy});`,
  );
  body.push('');
  body.push(`    // 4) 正常结束（状态位 ${statusDone} ON，ON 持续 1 个扫描）`);
  body.push(`    IF ${statusDone} THEN`);
  body.push('        bReq := FALSE;');
  body.push('        bDone := TRUE;');
  body.push('    END_IF;');
  body.push('');
  body.push(`    // 5) 异常结束（状态位 ${statusErr} ON）`);
  body.push(`    IF ${statusErr} THEN`);
  body.push('        bReq := FALSE;');
  body.push('        bErr := TRUE;');
  body.push('    END_IF;');
  body.push('');
  body.push(`    // 6) 超时监控：${timeoutMs}ms 内未结束判通信异常`);
  body.push(`    tTimeout(IN := bReq, PT := ${timeLiteral(timeoutMs / 1000)});`);
  body.push('    IF tTimeout.Q THEN');
  body.push('        bReq := FALSE;');
  body.push('        bErr := TRUE;');
  body.push('    END_IF;');
  body.push('END_IF;');
  body.push('');

  body.push('// 7) 状态输出');
  body.push(`${yBusy} := bReq;`);
  body.push(`${yDone} := bDone;`);
  body.push(`${yErr} := bErr;`);

  return renderProgram({
    header: headerFor('modbus_read', `MODBUS 主站读取（从站 ${slave}，${funcText}）`, ctx, [
      `slave=${slave}`,
      `func=${func}`,
      `addr=${addr}`,
      `count=${count}`,
      `timeoutMs=${timeoutMs}`,
    ]),
    vars: [
      { line: 'bStartLast : BOOL := FALSE;', comment: '启动信号上一扫描（上升沿）' },
      { line: 'bReq : BOOL := FALSE;', comment: '读取请求（通信中）' },
      { line: 'bDone : BOOL := FALSE;', comment: '正常结束标志' },
      { line: 'bErr : BOOL := FALSE;', comment: '异常结束/超时标志' },
      { line: 'bEno : BOOL := FALSE;', comment: 'ADPRW 执行结果' },
      { line: `nSlave : INT := ${slave};`, comment: '从站站号' },
      { line: `nFunc : INT := ${func};`, comment: `功能码（${funcText}）` },
      { line: `nAddr : INT := ${addr};`, comment: '起始寄存器地址' },
      { line: `nCount : INT := ${count};`, comment: '读取寄存器数量' },
      { line: 'tTimeout : TON;', comment: `通信超时（${timeoutMs}ms）` },
    ],
    body: body.join('\n'),
  });
}

export const modbusReadTemplate: StTemplate = {
  name: 'modbus_read',
  description:
    'MODBUS 串行主站读取（ADPRW）：读保持/输入寄存器，带完成/异常/超时状态',
  params: [
    { name: 'slave', type: 'number', description: '从站站号（1..247）', default: DEFAULT_SLAVE },
    {
      name: 'func',
      type: 'number',
      description: '功能码：3=读保持寄存器（03H），4=读输入寄存器（04H）',
      default: DEFAULT_FUNC,
    },
    { name: 'addr', type: 'number', description: '起始寄存器地址（0..32767）', default: DEFAULT_ADDR },
    { name: 'count', type: 'number', description: '读取数量（1..125）', default: DEFAULT_COUNT },
    {
      name: 'timeoutMs',
      type: 'number',
      description: '通信超时（毫秒，100..10000）',
      default: DEFAULT_TIMEOUT_MS,
    },
  ],
  instantiate,
};
