/**
 * 模板：serial_send_recv —— 串口无协议收发（RS2 指令的 ST 形态）。
 *
 * 适用：FX5U 内置 RS-485/RS-232C 以无协议方式向对方发送一段数据并接收响应。
 *
 * IO 约定（按 spec.io 顺序取）：
 *   X0 启动（上升沿触发一次收发）、X1 复位；
 *   Y0 通信中、Y1 正常结束、Y2 异常/超时；
 *   第一个 D 为发送数据区（默认 D100），第二个 D 为接收数据区（默认 D200）。
 *
 * 参数：
 *   channel    通信通道（1..4，对应 FX5U 的 CH1~CH4；需与模块参数一致）
 *   sendBytes  发送字节数（1..1024）
 *   recvBytes  接收字节数（1..1024）
 *   timeoutMs  通信超时（毫秒，100..10000）
 *
 * 完成判定（依据 FX5 特殊软元件，应用篇 p789/p790/p827）：
 *   - SM8401/SM8421… 发送待机标志：ON=发送中；
 *   - SM8409/SM8429… 超时判定标志：ON=发生超时；
 *   - SD8403/SD8423… 接收点数：接收到数据的字节数。
 *   通道 n：SM 发送待机 = 8401+(n-1)*20，SM 超时 = 8409+(n-1)*20，
 *           SD 接收点数 = 8403+(n-1)*20。
 *
 * 重要前提：
 *  - 必须在 GX Works3 模块参数里配置串口通信格式（波特率/数据位/校验/停止位/超时）；
 *  - 指令 ST 形式 `ENO:=RS2(EN,s,n1,n2,n3,d);` 来自手册 p1059；
 *  - 实际收发需实机或支持串口的仿真环境验证。
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

const DEFAULT_CHANNEL = 1;
const DEFAULT_SEND_BYTES = 8;
const DEFAULT_RECV_BYTES = 8;
const DEFAULT_TIMEOUT_MS = 3000;

function instantiate(ctx: TemplateContext): string {
  const channel = Math.trunc(numParam(ctx, 'channel', DEFAULT_CHANNEL));
  if (!Number.isFinite(channel) || channel < 1 || channel > 4) {
    throw new Error(`模板 serial_send_recv 的 channel 必须在 1..4，收到 ${channel}`);
  }
  const sendBytes = Math.trunc(numParam(ctx, 'sendBytes', DEFAULT_SEND_BYTES));
  if (!Number.isFinite(sendBytes) || sendBytes < 1 || sendBytes > 1024) {
    throw new Error(`模板 serial_send_recv 的 sendBytes 必须在 1..1024，收到 ${sendBytes}`);
  }
  const recvBytes = Math.trunc(numParam(ctx, 'recvBytes', DEFAULT_RECV_BYTES));
  if (!Number.isFinite(recvBytes) || recvBytes < 1 || recvBytes > 1024) {
    throw new Error(`模板 serial_send_recv 的 recvBytes 必须在 1..1024，收到 ${recvBytes}`);
  }
  const timeoutMs = Math.trunc(numParam(ctx, 'timeoutMs', DEFAULT_TIMEOUT_MS));
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 10000) {
    throw new Error(`模板 serial_send_recv 的 timeoutMs 必须在 100..10000，收到 ${timeoutMs}`);
  }

  const xStart = pickDevice(ctx, 'X', 0, 'X0');
  const xReset = pickDevice(ctx, 'X', 1, 'X1');
  const yBusy = pickDevice(ctx, 'Y', 0, 'Y0');
  const yDone = pickDevice(ctx, 'Y', 1, 'Y1');
  const yErr = pickDevice(ctx, 'Y', 2, 'Y2');
  const sendStart = pickDevice(ctx, 'D', 0, 'D100');
  const recvStart = pickDevice(ctx, 'D', 1, 'D200');
  const sendNo = deviceNumber(sendStart);
  const recvNo = deviceNumber(recvStart);
  const recvArea = sendNo >= 0 && recvNo === sendNo + 1 ? `D${sendNo + sendBytes}` : recvStart;

  const base = 8400 + (channel - 1) * 20;
  const smSending = `SM${base + 1}`; // 发送待机（ON=发送中）
  const smTimeout = `SM${base + 9}`; // 超时判定
  const sdRecvCount = `SD${base + 3}`; // 接收点数（字节）

  const body: string[] = [];
  body.push('// 1) 复位（X1）：清除请求/完成/异常');
  body.push(`IF ${xReset} THEN`);
  body.push('    bReq := FALSE;');
  body.push('    bDone := FALSE;');
  body.push('    bErr := FALSE;');
  body.push('    bSending := FALSE;');
  body.push('END_IF;');
  body.push('');

  body.push('// 2) 启动（X0 上升沿）：触发一次串口收发');
  body.push(`IF ${xStart} AND NOT bStartLast AND NOT bReq THEN`);
  body.push('    bReq := TRUE;');
  body.push('    bDone := FALSE;');
  body.push('    bErr := FALSE;');
  body.push('    bSending := FALSE;');
  body.push('END_IF;');
  body.push(`bStartLast := ${xStart};`);
  body.push('');

  body.push('// 3) RS2 无协议收发：ENO := RS2(EN, s, n1, n2, n3, d)');
  body.push(
    `//    s=${sendStart} 发送区, n1=${sendBytes} 发送字节, n2=${recvBytes} 接收字节,`,
  );
  body.push(`//    n3=${channel} 通道, d=${recvArea} 接收区`);
  body.push('// 注意：RS2 的 n1/n2/n3 必须是指定软元件/常数，不能是未分配软元件的标签，');
  body.push('//       因此这里直接写常数。');
  body.push('IF bReq THEN');
  body.push(
    `    bEno := RS2(TRUE, ${sendStart}, ${sendBytes}, ${recvBytes}, ${channel}, ${recvArea});`,
  );
  body.push('');
  body.push(`    // 4) 发送中：${smSending} ON 表示发送待机`);
  body.push(`    IF ${smSending} THEN`);
  body.push('        bSending := TRUE;');
  body.push('    END_IF;');
  body.push('');
  body.push(`    // 5) 完成：发送结束（${smSending} OFF）且 ${sdRecvCount} 收到数据`);
  body.push(`    IF bSending AND NOT ${smSending} AND ${sdRecvCount} > 0 THEN`);
  body.push('        bReq := FALSE;');
  body.push('        bDone := TRUE;');
  body.push('    END_IF;');
  body.push('');
  body.push(`    // 6a) 串口超时判定（${smTimeout}）`);
  body.push(`    IF ${smTimeout} THEN`);
  body.push('        bReq := FALSE;');
  body.push('        bErr := TRUE;');
  body.push('    END_IF;');
  body.push('');
  body.push(`    // 6b) 软件超时监控（${timeoutMs}ms）`);
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
    header: headerFor('serial_send_recv', `串口无协议收发（CH${channel}，${sendBytes}B 发 / ${recvBytes}B 收）`, ctx, [
      `channel=${channel}`,
      `sendBytes=${sendBytes}`,
      `recvBytes=${recvBytes}`,
      `timeoutMs=${timeoutMs}`,
    ]),
    vars: [
      { line: 'bStartLast : BOOL := FALSE;', comment: '启动信号上一扫描（上升沿）' },
      { line: 'bReq : BOOL := FALSE;', comment: '收发请求（通信中）' },
      { line: 'bSending : BOOL := FALSE;', comment: '发送待机标志已出现（用于完成判定）' },
      { line: 'bDone : BOOL := FALSE;', comment: '正常结束标志' },
      { line: 'bErr : BOOL := FALSE;', comment: '异常/超时标志' },
      { line: 'bEno : BOOL := FALSE;', comment: 'RS2 执行结果' },
      { line: 'tTimeout : TON;', comment: `通信超时（${timeoutMs}ms）` },
    ],
    body: body.join('\n'),
  });
}

export const serialSendRecvTemplate: StTemplate = {
  name: 'serial_send_recv',
  description:
    '串口无协议收发（RS2）：发送/接收字节数可配，带完成/超时/异常状态',
  params: [
    { name: 'channel', type: 'number', description: '通信通道（1..4）', default: DEFAULT_CHANNEL },
    { name: 'sendBytes', type: 'number', description: '发送字节数（1..1024）', default: DEFAULT_SEND_BYTES },
    { name: 'recvBytes', type: 'number', description: '接收字节数（1..1024）', default: DEFAULT_RECV_BYTES },
    {
      name: 'timeoutMs',
      type: 'number',
      description: '通信超时（毫秒，100..10000）',
      default: DEFAULT_TIMEOUT_MS,
    },
  ],
  instantiate,
};
