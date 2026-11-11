/**
 * serial_send_recv 模板测试：RS2 ST 形态、特殊软元件判定、超时与参数校验。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mergeParams, requireTemplate } from '../src/templates/index.ts';
import type { TemplateContext } from '../src/templates/types.ts';

function makeCtx(params: Record<string, number> = {}): TemplateContext {
  const template = requireTemplate('serial_send_recv');
  return {
    spec: {
      name: 'serial_send_recv_demo',
      cpu: { series: 'FX5U', model: 'FX5U' },
      io: [
        { device: 'X10', name: '启动', type: 'BOOL' },
        { device: 'X11', name: '复位', type: 'BOOL' },
        { device: 'Y10', name: '通信中', type: 'BOOL' },
        { device: 'Y11', name: '完成', type: 'BOOL' },
        { device: 'Y12', name: '异常', type: 'BOOL' },
        { device: 'D300', name: '发送区', type: 'INT' },
        { device: 'D400', name: '接收区', type: 'INT' },
      ],
    },
    params: mergeParams(template, params),
  };
}

test('serial_send_recv：生成 RS2 调用与 CH1 特殊软元件', () => {
  const src = requireTemplate('serial_send_recv').instantiate(makeCtx());
  assert.match(src, /bEno := RS2\(TRUE, D300, 8, 8, 1, D400\);/);
  assert.ok(src.includes('IF SM8401 THEN'), 'CH1 发送待机标志 SM8401');
  assert.ok(src.includes('IF SM8409 THEN'), 'CH1 超时标志 SM8409');
  assert.ok(src.includes('SD8403 > 0'), 'CH1 接收点数 SD8403');
  assert.ok(src.includes('Y10 := bReq;'));
  assert.ok(src.includes('Y11 := bDone;'));
  assert.ok(src.includes('Y12 := bErr;'));
});

test('serial_send_recv：通道 2 映射到 SM8421/SM8429/SD8423', () => {
  const src = requireTemplate('serial_send_recv').instantiate(makeCtx({ channel: 2 }));
  assert.ok(src.includes('IF SM8421 THEN'));
  assert.ok(src.includes('IF SM8429 THEN'));
  assert.ok(src.includes('SD8423 > 0'));
});

test('serial_send_recv：参数覆盖（字节数/超时）', () => {
  const src = requireTemplate('serial_send_recv').instantiate(
    makeCtx({ sendBytes: 32, recvBytes: 64, timeoutMs: 500 }),
  );
  assert.match(src, /RS2\(TRUE, D300, 32, 64, 1, D400\);/);
  assert.ok(src.includes('T#500ms'));
});

test('serial_send_recv：非法参数抛错', () => {
  const t = requireTemplate('serial_send_recv');
  assert.throws(() => t.instantiate(makeCtx({ channel: 0 })), /channel/);
  assert.throws(() => t.instantiate(makeCtx({ channel: 5 })), /channel/);
  assert.throws(() => t.instantiate(makeCtx({ sendBytes: 0 })), /sendBytes/);
  assert.throws(() => t.instantiate(makeCtx({ recvBytes: 2000 })), /recvBytes/);
  assert.throws(() => t.instantiate(makeCtx({ timeoutMs: 50 })), /timeoutMs/);
});
