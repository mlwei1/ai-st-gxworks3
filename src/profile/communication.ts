/**
 * FX5U 通信指令的 ST 形态与操作数（来自 JY997D58901 第 13、17 章）。
 *
 * ST 中通信指令同样写成函数调用并返回 ENO，例如：
 *   ENO := SP_SOCOPEN(EN, U0, s1, s2, d);
 *
 * 注意：`U0`/`U` 是模块号（字符串操作数），ST 语言中显示为 U0；手册注明
 * “无论使用哪种编程语言，都要在软元件指定。请勿指定标签。” 本工具暂不生成
 * 通信指令的模板（还需要连接参数/协议设置知识），先记录已核实的事实。
 */

import type { VerifiedStatus } from './fx5u.ts';

export interface CommOperand {
  name: string;
  direction: 'IN' | 'OUT';
  type: string;
  comment: string;
}

export interface CommInstructionFact {
  name: string;
  /** 手册 ST 列给出的调用形式（含 ENO 赋值）。 */
  stForm: string;
  operands: readonly CommOperand[];
  verified: VerifiedStatus;
  source: string;
  note?: string;
}

export const FX5_COMMUNICATION_INSTRUCTIONS: readonly CommInstructionFact[] = [
  {
    name: 'SP_SOCOPEN',
    stForm: 'ENO:=SP_SOCOPEN(EN,U0,s1,s2,d);',
    verified: 'verified',
    source: 'JY997D58901 13.1 内置以太网功能用指令 SP.SOCOPEN p981（PDF 983）',
    operands: [
      { name: 'EN', direction: 'IN', type: 'BOOL', comment: '执行条件' },
      { name: 'U0', direction: 'IN', type: 'STRING', comment: '模块号（ST 中写 U0）' },
      { name: 's1', direction: 'IN', type: 'WORD', comment: '连接编号（1~8）' },
      { name: 's2', direction: 'IN', type: 'WORD[]', comment: '控制数据起始软元件（10 个字）' },
      { name: 'd', direction: 'OUT', type: 'BOOL[]', comment: '完成/异常完成标志（2 位）' },
    ],
    note: '套接字连接打开',
  },
  {
    name: 'SP_SOCRCV',
    stForm: 'ENO:=SP_SOCRCV(EN,U0,s1,s2,d1,d2);',
    verified: 'verified',
    source: 'JY997D58901 13.2 套接字通信功能指令 SP.SOCRCV p986（PDF 988）',
    operands: [
      { name: 'EN', direction: 'IN', type: 'BOOL', comment: '执行条件' },
      { name: 'U0', direction: 'IN', type: 'STRING', comment: '模块号（ST 中写 U0）' },
      { name: 's1', direction: 'IN', type: 'WORD', comment: '连接编号（1~8）' },
      { name: 's2', direction: 'IN', type: 'WORD[]', comment: '控制数据起始软元件（2 个字）' },
      { name: 'd1', direction: 'OUT', type: 'WORD', comment: '接收数据起始软元件' },
      { name: 'd2', direction: 'OUT', type: 'BOOL[]', comment: '完成/异常完成标志（2 位）' },
    ],
    note: 'END 处理时读取接收数据',
  },
  {
    name: 'SP_SOCSND',
    stForm: 'ENO:=SP_SOCSND(EN,U0,s1,s2,s3,d);',
    verified: 'verified',
    source: 'JY997D58901 13.2 套接字通信功能指令 SP.SOCSND p989（PDF 991）',
    operands: [
      { name: 'EN', direction: 'IN', type: 'BOOL', comment: '执行条件' },
      { name: 'U0', direction: 'IN', type: 'STRING', comment: '模块号（ST 中写 U0）' },
      { name: 's1', direction: 'IN', type: 'WORD', comment: '连接编号（1~8）' },
      { name: 's2', direction: 'IN', type: 'WORD[]', comment: '控制数据起始软元件（2 个字）' },
      { name: 's3', direction: 'IN', type: 'WORD', comment: '发送数据起始软元件' },
      { name: 'd', direction: 'OUT', type: 'BOOL[]', comment: '完成/异常完成标志（2 位）' },
    ],
    note: '套接字数据发送',
  },
  {
    name: 'GP_SOCRCV',
    stForm: 'ENO:=GP_SOCRCV(EN,U,s1,s2,d1,d2);',
    verified: 'verified',
    source: 'JY997D58901 13 以太网指令 GP.SOCRCV p1019（PDF 1021）',
    operands: [
      { name: 'EN', direction: 'IN', type: 'BOOL', comment: '执行条件' },
      { name: 'U', direction: 'IN', type: 'STRING', comment: '模块号' },
      { name: 's1', direction: 'IN', type: 'WORD', comment: '连接编号' },
      { name: 's2', direction: 'IN', type: 'WORD[]', comment: '控制数据起始软元件' },
      { name: 'd1', direction: 'OUT', type: 'WORD', comment: '接收数据起始软元件' },
      { name: 'd2', direction: 'OUT', type: 'BOOL[]', comment: '完成/异常完成标志' },
    ],
  },
  {
    name: 'GP_SOCSND',
    stForm: 'ENO:=GP_SOCSND(EN,U,s1,s2,s3,d);',
    verified: 'verified',
    source: 'JY997D58901 13 以太网指令 GP.SOCSND p1021（PDF 1023）',
    operands: [
      { name: 'EN', direction: 'IN', type: 'BOOL', comment: '执行条件' },
      { name: 'U', direction: 'IN', type: 'STRING', comment: '模块号' },
      { name: 's1', direction: 'IN', type: 'WORD', comment: '连接编号' },
      { name: 's2', direction: 'IN', type: 'WORD[]', comment: '控制数据起始软元件' },
      { name: 's3', direction: 'IN', type: 'WORD', comment: '发送数据起始软元件' },
      { name: 'd', direction: 'OUT', type: 'BOOL[]', comment: '完成/异常完成标志' },
    ],
  },
  {
    name: 'RS2',
    stForm: 'ENO:=RS2(EN,s,n1,n2,n3,d);',
    verified: 'verified',
    source: 'JY997D58901 17.1 串行数据传送2 RS2 p1059（PDF 1061）',
    operands: [
      { name: 'EN', direction: 'IN', type: 'BOOL', comment: '执行条件' },
      { name: 's', direction: 'IN', type: 'ANY16', comment: '发送数据起始软元件' },
      { name: 'n1', direction: 'IN', type: 'WORD', comment: '发送字节数（0~4096）' },
      { name: 'n2', direction: 'IN', type: 'WORD', comment: '接收字节数（0~4096）' },
      { name: 'n3', direction: 'IN', type: 'WORD', comment: '通信通道（FX5U K1~K4）' },
      { name: 'd', direction: 'OUT', type: 'ANY16', comment: '接收数据起始软元件' },
    ],
    note: '无协议串行通信（RS-232C/RS-485）',
  },
  {
    name: 'ADPRW',
    stForm: 'ENO:=ADPRW(EN,s1,s2,s3,s4,s5,d2);',
    verified: 'unverified',
    source: 'JY997D58901 17.3 MODBUS指令 ADPRW p1073（PDF 1075）',
    operands: [
      { name: 'EN', direction: 'IN', type: 'BOOL', comment: '执行条件' },
      { name: 's1', direction: 'IN', type: 'INT', comment: '从站站号（0~F7H）' },
      { name: 's2', direction: 'IN', type: 'INT', comment: '功能代码（01H~06H/0FH/10H）' },
      { name: 's3', direction: 'IN', type: 'INT', comment: '功能参数 1' },
      { name: 's4', direction: 'IN', type: 'INT', comment: '功能参数 2（1~2000）' },
      { name: 's5', direction: 'IN', type: 'ANY_ELEMENTARY', comment: '功能参数 3（写数据/读数据也复用为 d1）' },
      { name: 'd2', direction: 'OUT', type: 'BOOL[]', comment: '指令执行状态起始位（3 位）' },
    ],
    note: 'MODBUS 串行主站读写；手册 ST 原文抽取为 "...s5d1..."（逗号缺失），参数个数与顺序待原生验证，暂不生成',
  },
] as const;

/** 按名称查通信指令（大写）；不存在返回 undefined。 */
export function getCommunicationInstruction(name: string): CommInstructionFact | undefined {
  const upper = name.toUpperCase();
  return FX5_COMMUNICATION_INSTRUCTIONS.find((f) => f.name === upper);
}

/** 是否已记录的通信指令。 */
export function isCommunicationInstruction(name: string): boolean {
  return getCommunicationInstruction(name) !== undefined;
}
