/**
 * FX5U 通信指令知识测试：名称、ST 形式、操作数与出处均已核实。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FX5_COMMUNICATION_INSTRUCTIONS,
  getCommunicationInstruction,
} from '../src/profile/index.ts';

const EXPECTED: Record<string, { stForm: string; verified: string; params: number }> = {
  SP_SOCOPEN: { stForm: 'ENO:=SP_SOCOPEN(EN,U0,s1,s2,d);', verified: 'verified', params: 5 },
  SP_SOCRCV: { stForm: 'ENO:=SP_SOCRCV(EN,U0,s1,s2,d1,d2);', verified: 'verified', params: 6 },
  SP_SOCSND: { stForm: 'ENO:=SP_SOCSND(EN,U0,s1,s2,s3,d);', verified: 'verified', params: 6 },
  GP_SOCRCV: { stForm: 'ENO:=GP_SOCRCV(EN,U,s1,s2,d1,d2);', verified: 'verified', params: 6 },
  GP_SOCSND: { stForm: 'ENO:=GP_SOCSND(EN,U,s1,s2,s3,d);', verified: 'verified', params: 6 },
  RS2: { stForm: 'ENO:=RS2(EN,s,n1,n2,n3,d);', verified: 'verified', params: 6 },
  ADPRW: { stForm: 'ENO:=ADPRW(EN,s1,s2,s3,s4,s5,d2);', verified: 'unverified', params: 7 },
};

test('通信指令：7 条事实齐全，ST 形式与核实状态与手册一致', () => {
  assert.equal(FX5_COMMUNICATION_INSTRUCTIONS.length, Object.keys(EXPECTED).length);
  for (const [name, exp] of Object.entries(EXPECTED)) {
    const f = getCommunicationInstruction(name);
    assert.ok(f, `缺少 ${name}`);
    assert.equal(f!.stForm, exp.stForm, `${name} ST 形式`);
    assert.equal(f!.verified, exp.verified, `${name} 核实状态`);
    assert.equal(f!.operands.length, exp.params, `${name} 参数个数`);
    assert.match(f!.source, /p\d{3,4}/, `${name} source 应带印刷页码`);
  }
});

test('通信指令：RS2 操作数含义（发送/接收字节数、通道）', () => {
  const rs2 = getCommunicationInstruction('RS2')!;
  const map = Object.fromEntries(rs2.operands.map((o) => [o.name, o.comment]));
  assert.match(map.s, /发送数据/);
  assert.match(map.n1, /发送字节数/);
  assert.match(map.n2, /接收字节数/);
  assert.match(map.n3, /通信通道/);
  assert.match(map.d, /接收数据/);
});

test('通信指令：ADPRW 保留未核实标记（ST 原文逗号缺失）', () => {
  const adprw = getCommunicationInstruction('ADPRW')!;
  assert.equal(adprw.verified, 'unverified');
  assert.match(adprw.note!, /逗号缺失|待原生验证/);
  assert.match(adprw.source, /p1073/);
});

test('通信指令：SP_* 的 U0 模块号操作数被明确记录', () => {
  for (const name of ['SP_SOCOPEN', 'SP_SOCRCV', 'SP_SOCSND']) {
    const f = getCommunicationInstruction(name)!;
    const u0 = f.operands.find((o) => o.name === 'U0');
    assert.ok(u0, `${name} 缺少 U0`);
    assert.match(u0!.comment, /模块号/);
  }
});
