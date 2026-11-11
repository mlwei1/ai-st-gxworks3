/**
 * modbus_read 模板测试：ADPRW ST 形态、状态位、超时与参数校验。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { requireTemplate } from '../src/templates/index.ts';
import { mergeParams } from '../src/templates/index.ts';
import type { TemplateContext } from '../src/templates/types.ts';

function makeCtx(params: Record<string, number> = {}): TemplateContext {
  const template = requireTemplate('modbus_read');
  return {
    spec: {
      name: 'modbus_read_demo',
      cpu: { series: 'FX5U', model: 'FX5U' },
      io: [
        { device: 'X10', name: '启动', type: 'BOOL' },
        { device: 'X11', name: '复位', type: 'BOOL' },
        { device: 'Y10', name: '通信中', type: 'BOOL' },
        { device: 'Y11', name: '完成', type: 'BOOL' },
        { device: 'Y12', name: '异常', type: 'BOOL' },
        { device: 'D200', name: '数据区', type: 'INT' },
        { device: 'M200', name: '状态位', type: 'BOOL' },
      ],
    },
    params: mergeParams(template, params),
  };
}

test('modbus_read：生成 ADPRW 调用与状态位（来自 spec.io）', () => {
  const src = requireTemplate('modbus_read').instantiate(makeCtx());
  assert.match(src, /bEno := ADPRW\(TRUE, nSlave, nFunc, nAddr, nCount, D200, M200\);/);
  assert.ok(src.includes('IF M201 THEN'), '正常结束状态位应为 M201');
  assert.ok(src.includes('IF M202 THEN'), '异常结束状态位应为 M202');
  assert.ok(src.includes('tTimeout(IN := bReq, PT := T#3000ms);'));
  assert.ok(src.includes('Y10 := bReq;'));
  assert.ok(src.includes('Y11 := bDone;'));
  assert.ok(src.includes('Y12 := bErr;'));
});

test('modbus_read：参数覆盖（从站/功能码/地址/数量/超时）', () => {
  const src = requireTemplate('modbus_read').instantiate(
    makeCtx({ slave: 5, func: 4, addr: 100, count: 10, timeoutMs: 500 }),
  );
  assert.ok(src.includes('nSlave : INT := 5;'));
  assert.ok(src.includes('nFunc : INT := 4;'));
  assert.ok(src.includes('nAddr : INT := 100;'));
  assert.ok(src.includes('nCount : INT := 10;'));
  assert.ok(src.includes('T#500ms'));
});

test('modbus_read：非法参数抛错', () => {
  const t = requireTemplate('modbus_read');
  assert.throws(() => t.instantiate(makeCtx({ slave: 0 })), /slave/);
  assert.throws(() => t.instantiate(makeCtx({ func: 5 })), /func/);
  assert.throws(() => t.instantiate(makeCtx({ addr: 40000 })), /addr/);
  assert.throws(() => t.instantiate(makeCtx({ count: 0 })), /count/);
  assert.throws(() => t.instantiate(makeCtx({ count: 200 })), /count/);
  assert.throws(() => t.instantiate(makeCtx({ timeoutMs: 50 })), /timeoutMs/);
});
