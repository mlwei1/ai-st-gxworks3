/**
 * FX5U 定位指令的 ST 形态与操作数（来自 JY997D58901 第 8.18 / 18 章）。
 *
 * ST 中定位指令写成函数调用形式并返回 ENO，例如：
 *   ENO := DRVA(EN, s1, s2, d1, d2);
 * 其中 EN 为执行条件，d1/d2 是输出脉冲/方向的 Y 软元件编号。
 *
 * 已核实（2026-11-11，PDF 页序 → 印刷页）：
 *   PLSY/DPLSY 8.18(p761)、DSZR 18.1(p1079)、DVIT(p1085)、DRVTBL(p1095)、
 *   PLSV(p1101)、DRVI(p1107)、DRVA(p1115)。
 */

import type { VerifiedStatus } from './fx5u.ts';

export interface PositioningOperand {
  name: string;
  direction: 'IN' | 'OUT';
  type: string;
  comment: string;
}

export interface PositioningInstructionFact {
  name: string;
  /** 手册 ST 列给出的调用形式（含 ENO 赋值）。 */
  stForm: string;
  operands: readonly PositioningOperand[];
  verified: VerifiedStatus;
  source: string;
  note?: string;
}

const SRC_POS = 'JY997D58901 18 定位指令 18.1 定位功能专用指令';

export const FX5_POSITIONING_INSTRUCTIONS: readonly PositioningInstructionFact[] = [
  {
    name: 'DRVA',
    stForm: 'ENO:=DRVA(EN,s1,s2,d1,d2);',
    verified: 'verified',
    source: `${SRC_POS} DRVA p1115（PDF 1117）`,
    operands: [
      { name: 'EN', direction: 'IN', type: 'BOOL', comment: '执行条件' },
      { name: 's1', direction: 'IN', type: 'INT', comment: '定位地址（-32768~+32767）' },
      { name: 's2', direction: 'IN', type: 'WORD', comment: '指令速度（1~65535）' },
      { name: 'd1', direction: 'OUT', type: 'BOOL(Y)', comment: '输出脉冲的位软元件（FX5U: Y0~Y3）' },
      { name: 'd2', direction: 'OUT', type: 'BOOL(Y)', comment: '输出旋转方向的位软元件' },
    ],
    note: '绝对定位；驱动中/脉冲输出中/出错标志见 SM5500~5503 / SM5516~5519 / SM5532~5535（轴 1~4）',
  },
  {
    name: 'DRVI',
    stForm: 'ENO:=DRVI(EN,s1,s2,d1,d2);',
    verified: 'verified',
    source: `${SRC_POS} DRVI p1107（PDF 1109）`,
    operands: [
      { name: 'EN', direction: 'IN', type: 'BOOL', comment: '执行条件' },
      { name: 's1', direction: 'IN', type: 'INT', comment: '定位地址（相对量，-32768~+32767）' },
      { name: 's2', direction: 'IN', type: 'WORD', comment: '指令速度（1~65535）' },
      { name: 'd1', direction: 'OUT', type: 'BOOL(Y)', comment: '输出脉冲的位软元件（FX5U: Y0~Y3）' },
      { name: 'd2', direction: 'OUT', type: 'BOOL(Y)', comment: '输出旋转方向的位软元件' },
    ],
    note: '相对定位',
  },
  {
    name: 'DSZR',
    stForm: 'ENO:=DSZR(EN,s1,s2,d1,d2);',
    verified: 'verified',
    source: `${SRC_POS} DSZR p1079（PDF 1081）`,
    operands: [
      { name: 'EN', direction: 'IN', type: 'BOOL', comment: '执行条件' },
      { name: 's1', direction: 'IN', type: 'BOOL', comment: '输入近点狗信号的位软元件编号' },
      { name: 's2', direction: 'IN', type: 'BOOL', comment: '输入零点信号的位软元件编号' },
      { name: 'd1', direction: 'OUT', type: 'BOOL(Y)', comment: '输出脉冲的位软元件（Y）' },
      { name: 'd2', direction: 'OUT', type: 'BOOL(Y)', comment: '输出旋转方向的位软元件' },
    ],
    note: '原点回归（带近点狗/零点信号）',
  },
  {
    name: 'DVIT',
    stForm: 'ENO:=DVIT(EN,s1,s2,d1,d2);',
    verified: 'verified',
    source: `${SRC_POS} DVIT p1085（PDF 1087）`,
    operands: [
      { name: 'EN', direction: 'IN', type: 'BOOL', comment: '执行条件' },
      { name: 's1', direction: 'IN', type: 'INT', comment: '中断输入后的定位地址（-32768~+32767）' },
      { name: 's2', direction: 'IN', type: 'WORD', comment: '指令速度（1~65535）' },
      { name: 'd1', direction: 'OUT', type: 'BOOL(Y)', comment: '输出脉冲的位软元件（Y）' },
      { name: 'd2', direction: 'OUT', type: 'BOOL(Y)', comment: '输出旋转方向的位软元件' },
    ],
    note: '中断定位（中断输入后走指定地址）',
  },
  {
    name: 'DRVTBL',
    stForm: 'ENO:=DRVTBL(EN,n1,n2,n3,d1,d2);',
    verified: 'verified',
    source: `${SRC_POS} DRVTBL p1095（PDF 1097）`,
    operands: [
      { name: 'EN', direction: 'IN', type: 'BOOL', comment: '执行条件' },
      { name: 'n1', direction: 'IN', type: 'WORD', comment: '执行的起始表编号（1~100）' },
      { name: 'n2', direction: 'IN', type: 'WORD', comment: '执行的最终表编号（1~100）' },
      { name: 'n3', direction: 'IN', type: 'WORD', comment: '表执行方法（K0/K1）' },
      { name: 'd1', direction: 'OUT', type: 'WORD', comment: '输出脉冲的轴编号（FX5U: K1~K12）' },
      { name: 'd2', direction: 'OUT', type: 'BOOL[2]', comment: '定位结束/异常结束标志（2 位）' },
    ],
    note: '多表格运行；d2 是 2 个位软元件（定位结束、异常结束）',
  },
  {
    name: 'PLSV',
    stForm: 'ENO:=PLSV(EN,s,d1,d2);',
    verified: 'verified',
    source: `${SRC_POS} PLSV p1101（PDF 1103）`,
    operands: [
      { name: 'EN', direction: 'IN', type: 'BOOL', comment: '执行条件' },
      { name: 's', direction: 'IN', type: 'INT', comment: '指令速度（-32768~+32767，符号=方向）' },
      { name: 'd1', direction: 'OUT', type: 'BOOL(Y)', comment: '输出脉冲的位软元件（Y）' },
      { name: 'd2', direction: 'OUT', type: 'BOOL(Y)', comment: '输出旋转方向的位软元件' },
    ],
    note: '可变速脉冲输出（运行中可改速度）',
  },
  {
    name: 'PLSY',
    stForm: 'ENO:=PLSY(EN,s,n,d);',
    verified: 'verified',
    source: 'JY997D58901 8.18 脉冲系统指令 PLSY p761（PDF 763）',
    operands: [
      { name: 'EN', direction: 'IN', type: 'BOOL', comment: '执行条件' },
      { name: 's', direction: 'IN', type: 'WORD', comment: '指令速度（0~65535）' },
      { name: 'n', direction: 'IN', type: 'WORD', comment: '定位地址/脉冲数（0~65535）' },
      { name: 'd', direction: 'OUT', type: 'BOOL(Y)', comment: '输出脉冲的位软元件（FX5U: Y0~Y3）' },
    ],
    note: 'FX5 操作数版；FX3 兼容操作数版见手册 p761 说明',
  },
  {
    name: 'DPLSY',
    stForm: 'ENO:=DPLSY(EN,s,n,d);',
    verified: 'verified',
    source: 'JY997D58901 8.18 脉冲系统指令 DPLSY p763（PDF 765）',
    operands: [
      { name: 'EN', direction: 'IN', type: 'BOOL', comment: '执行条件' },
      { name: 's', direction: 'IN', type: 'DWORD', comment: '指令速度（32 位，0~4294967295）' },
      { name: 'n', direction: 'IN', type: 'DWORD', comment: '定位地址/脉冲数（32 位）' },
      { name: 'd', direction: 'OUT', type: 'BOOL(Y)', comment: '输出脉冲的位软元件（Y）' },
    ],
    note: '32 位版本；ST 形式与 PLSY 相同',
  },
] as const;

/** 按名称查定位指令（大写）；不存在返回 undefined。 */
export function getPositioningInstruction(name: string): PositioningInstructionFact | undefined {
  const upper = name.toUpperCase();
  return FX5_POSITIONING_INSTRUCTIONS.find((f) => f.name === upper);
}

/** 名称是否为已核实的定位指令。 */
export function isPositioningInstruction(name: string): boolean {
  return getPositioningInstruction(name) !== undefined;
}
