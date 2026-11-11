/**
 * MELSEC iQ-F FX5 系列事实库（FX5U 默认 + FX5UJ 变体）。
 *
 * 设计原则：
 *  - 每条事实都带 `verified` 与 `source`（手册号 + 手册内页 / 审计结论）；
 *  - 未核实的事实必须标 `unverified`，禁止在检查器/提示词中当作已确认使用；
 *  - 设备地址的 `range` 使用**十进制等价数值**保存，`base` 表示软元件编号的进制
 *    （X/Y 八进制、B/W/SB/SW 十六进制、其余十进制）；
 *  - `range: null` 表示“软元件存在但编号上限未核实”，此时只校验进制、不校验范围。
 *
 * 来源（本机 MELSOFT e-Manual）：
 *  - JY997D58701《MELSEC iQ-F FX5用户手册(应用篇)》
 *      text/06000.html 软元件一览（进制）
 *      text/08003.html 软元件点数的使用范围（FX5S/FX5U/FX5UC 与 FX5UJ 差异）
 *      text/06004.html 变址寄存器 Z/LZ
 *      text/15002.html / text/2C003.html 系统时钟特殊继电器
 *  - JY997D58901《MELSEC iQ-F FX5编程手册(指令/通用FUN/FB篇)》
 *      text/03001.html 数据类型（含 FX5 不支持 LINT/ULINT/LREAL）
 *      text/08009.html 通用 FB 一览
 *      text/29001.html TON 形参；text/26001.html RS 形参
 *      text/0C056.html RAMPF 指令；text/0C073.html SQRT 指令不支持 ST
 */

/* ------------------------------------------------------------------ */
/* 通用类型                                                            */
/* ------------------------------------------------------------------ */

/** 事实核实状态。 */
export type VerifiedStatus = 'verified' | 'unverified' | 'assumption';

/** 软元件编号进制。 */
export type DeviceBase = 8 | 10 | 16;

/** 软元件类型。 */
export type DeviceKind = 'bit' | 'word';

/** 一条软元件事实。 */
export interface DeviceFact {
  symbol: string;
  label: string;
  kind: DeviceKind;
  base: DeviceBase;
  /** 十进制等价范围；null = 存在但范围未核实（只校验进制）。 */
  range: [number, number] | null;
  verified: VerifiedStatus;
  source: string;
  note?: string;
}

/** 一个 CPU 机型的事实集合。 */
export interface CpuProfile {
  model: CpuModel;
  label: string;
  devices: Readonly<Record<string, DeviceFact>>;
  notes: readonly string[];
}

export type CpuModel = 'FX5U' | 'FX5UJ';

/* ------------------------------------------------------------------ */
/* 软元件事实                                                          */
/* ------------------------------------------------------------------ */

const SRC_DEVICE_LIST = 'JY997D58701 应用篇 text/06000（软元件一览：X/Y=8进制、B/W=16进制）';
const SRC_DEVICE_RANGE = 'JY997D58701 应用篇 text/08003（软元件点数的使用范围）';
const SRC_INDEX_REG = 'JY997D58701 应用篇 text/06004（Z/LZ 点数与设置范围）';

function dev(
  symbol: string,
  label: string,
  kind: DeviceKind,
  base: DeviceBase,
  range: [number, number] | null,
  verified: VerifiedStatus,
  source: string,
  note?: string,
): DeviceFact {
  return { symbol, label, kind, base, range, verified, source, note };
}

/** FX5U / FX5S / FX5UC 共用范围（FX5UJ 见下方覆盖表）。 */
const FX5_COMMON_DEVICES: Record<string, DeviceFact> = {
  X: dev('X', '输入继电器', 'bit', 8, [0, 0o1777], 'verified', SRC_DEVICE_RANGE, '8进制；X0~X1777（十进制 0~1023）'),
  Y: dev('Y', '输出继电器', 'bit', 8, [0, 0o1777], 'verified', SRC_DEVICE_RANGE, '8进制；Y0~Y1777'),
  M: dev('M', '内部继电器', 'bit', 10, [0, 32767], 'verified', SRC_DEVICE_RANGE, 'M0~M32767'),
  L: dev('L', '锁存继电器', 'bit', 10, [0, 32767], 'verified', SRC_DEVICE_RANGE, 'L0~L32767'),
  B: dev('B', '链接继电器', 'bit', 16, [0, 0x7fff], 'verified', SRC_DEVICE_RANGE, '16进制；B0~B7FFF'),
  SB: dev('SB', '链接特殊继电器', 'bit', 16, [0, 0x7fff], 'verified', SRC_DEVICE_RANGE, '16进制；SB0~SB7FFF'),
  F: dev('F', '报警器', 'bit', 10, [0, 32767], 'verified', SRC_DEVICE_RANGE, 'F0~F32767'),
  S: dev('S', '步进继电器', 'bit', 10, [0, 4095], 'verified', SRC_DEVICE_RANGE, 'S0~S4095'),
  T: dev('T', '定时器', 'word', 10, [0, 1023], 'verified', SRC_DEVICE_RANGE, 'T0~T1023'),
  ST: dev('ST', '累计定时器', 'word', 10, [0, 1023], 'verified', SRC_DEVICE_RANGE, 'ST0~ST1023'),
  C: dev('C', '计数器', 'word', 10, [0, 1023], 'verified', SRC_DEVICE_RANGE, 'C0~C1023'),
  LC: dev('LC', '长计数器', 'word', 10, [0, 1023], 'verified', SRC_DEVICE_RANGE, 'LC0~LC1023'),
  D: dev('D', '数据寄存器', 'word', 10, [0, 7999], 'verified', SRC_DEVICE_RANGE, 'D0~D7999'),
  W: dev('W', '链接寄存器', 'word', 16, [0, 0x7fff], 'verified', SRC_DEVICE_RANGE, '16进制；W0~W7FFF'),
  SW: dev('SW', '链接特殊寄存器', 'word', 16, [0, 0x7fff], 'verified', SRC_DEVICE_RANGE, '16进制；SW0~SW7FFF'),
  R: dev('R', '文件寄存器', 'word', 10, [0, 32767], 'verified', SRC_DEVICE_RANGE, 'R0~R32767'),
  Z: dev('Z', '变址寄存器', 'word', 10, [0, 19], 'verified', SRC_INDEX_REG, '默认 Z0~Z19（20 点）；可配 0~24，与 LZ 合计 24 字'),
  LZ: dev('LZ', '长变址寄存器', 'word', 10, [0, 1], 'verified', SRC_INDEX_REG, '默认 LZ0~LZ1（2 点），可配 0~12，与 Z 合计 24 字'),
  ER: dev('ER', '扩展文件寄存器', 'word', 10, [0, 32767], 'verified', SRC_DEVICE_RANGE, 'ER0~ER32767（SD 卡）'),
  SM: dev('SM', '特殊继电器', 'bit', 10, null, 'unverified', 'JY997D58701 应用篇 text/06000（存在性）；编号范围未核实', '系统软元件，存在；编号上限未在本任务核实 → 只校验十进制'),
  SD: dev('SD', '特殊寄存器', 'word', 10, null, 'unverified', 'JY997D58701 应用篇 text/06000（存在性）；编号范围未核实', '系统软元件，存在；编号上限未在本任务核实 → 只校验十进制'),
};

/** FX5UJ 的覆盖（同页手册：FX5UJ 更小）。 */
const FX5UJ_OVERRIDES: Record<string, DeviceFact> = {
  M: dev('M', '内部继电器', 'bit', 10, [0, 7679], 'verified', SRC_DEVICE_RANGE, 'FX5UJ：M0~M7679'),
  L: dev('L', '锁存继电器', 'bit', 10, [0, 7679], 'verified', SRC_DEVICE_RANGE, 'FX5UJ：L0~L7679'),
  B: dev('B', '链接继电器', 'bit', 16, [0, 0x7ff], 'verified', SRC_DEVICE_RANGE, 'FX5UJ：B0~B7FF'),
  SB: dev('SB', '链接特殊继电器', 'bit', 16, [0, 0x7ff], 'verified', SRC_DEVICE_RANGE, 'FX5UJ：SB0~SB7FF'),
  F: dev('F', '报警器', 'bit', 10, [0, 127], 'verified', SRC_DEVICE_RANGE, 'FX5UJ：F0~F127'),
  T: dev('T', '定时器', 'word', 10, [0, 511], 'verified', SRC_DEVICE_RANGE, 'FX5UJ：T0~T511'),
  ST: dev('ST', '累计定时器', 'word', 10, [0, 15], 'verified', SRC_DEVICE_RANGE, 'FX5UJ：ST0~ST15'),
  C: dev('C', '计数器', 'word', 10, [0, 255], 'verified', SRC_DEVICE_RANGE, 'FX5UJ：C0~C255'),
  LC: dev('LC', '长计数器', 'word', 10, [0, 63], 'verified', SRC_DEVICE_RANGE, 'FX5UJ：LC0~LC63'),
  W: dev('W', '链接寄存器', 'word', 16, [0, 0x3ff], 'verified', SRC_DEVICE_RANGE, 'FX5UJ：W0~W3FF'),
  SW: dev('SW', '链接特殊寄存器', 'word', 16, [0, 0x3ff], 'verified', SRC_DEVICE_RANGE, 'FX5UJ：SW0~SW3FF'),
};

/** FX5U 事实集合。 */
export const FX5U_PROFILE: CpuProfile = {
  model: 'FX5U',
  label: 'MELSEC iQ-F FX5U（与 FX5S/FX5UC 共用软元件范围）',
  devices: FX5_COMMON_DEVICES,
  notes: [
    'X/Y 编号为 8 进制（X0~X1777，十进制 0~1023）。',
    'B/W/SB/SW 编号为 16 进制。',
    '标签不分配软元件时进入标签存储器/锁存标签区域（SH081271 text/0A023），不存在“自动分配设备地址”的保证。',
  ],
};

/** FX5UJ 事实集合（在 FX5U 基础上覆盖更小范围）。 */
export const FX5UJ_PROFILE: CpuProfile = {
  model: 'FX5UJ',
  label: 'MELSEC iQ-F FX5UJ',
  devices: { ...FX5_COMMON_DEVICES, ...FX5UJ_OVERRIDES },
  notes: [
    'FX5UJ 范围比 FX5U 小：M0~M7679、L0~L7679、B0~B7FF、F0~F127、T0~T511、ST0~ST15、C0~C255、LC0~LC63、W0~W3FF、SW0~SW3FF。',
  ],
};

/* ------------------------------------------------------------------ */
/* 类型事实                                                            */
/* ------------------------------------------------------------------ */

export interface TypeFact {
  name: string;
  label: string;
  verified: VerifiedStatus;
  source: string;
  note?: string;
}

const SRC_TYPES = 'JY997D58901 指令/通用FUN/FB篇 text/03001（数据类型）';

/** FX5 支持的数据类型（顺序与手册一致）。 */
export const FX5_TYPE_FACTS: readonly TypeFact[] = [
  { name: 'BOOL', label: '位', verified: 'verified', source: SRC_TYPES },
  { name: 'WORD', label: '字[无符号]/位串[16位]', verified: 'verified', source: SRC_TYPES },
  { name: 'DWORD', label: '双字[无符号]/位串[32位]', verified: 'verified', source: SRC_TYPES },
  { name: 'INT', label: '字[带符号]', verified: 'verified', source: SRC_TYPES },
  { name: 'DINT', label: '双字[带符号]', verified: 'verified', source: SRC_TYPES },
  { name: 'REAL', label: '单精度实数', verified: 'verified', source: SRC_TYPES },
  { name: 'TIME', label: '时间', verified: 'verified', source: SRC_TYPES },
  { name: 'STRING', label: '字符串（单引号）', verified: 'verified', source: SRC_TYPES, note: 'ST 中 STRING 常数必须用单引号' },
  { name: 'WSTRING', label: '字符串[Unicode]（双引号）', verified: 'verified', source: SRC_TYPES, note: 'ST 中 WSTRING 常数必须用双引号' },
  { name: 'TIMER', label: '定时器型', verified: 'verified', source: SRC_TYPES },
  { name: 'RETENTIVETIMER', label: '累计定时器型', verified: 'verified', source: SRC_TYPES },
  { name: 'COUNTER', label: '计数器型', verified: 'verified', source: SRC_TYPES },
  { name: 'LCOUNTER', label: '超长计数器型', verified: 'verified', source: SRC_TYPES },
  { name: 'POINTER', label: '指针型', verified: 'verified', source: SRC_TYPES },
] as const;

/** FX5 不支持、iQ-R 才有的类型（v0.1 曾错误放行）。 */
export const IQ_R_ONLY_TYPES: readonly string[] = ['LINT', 'ULINT', 'LREAL', 'UINT', 'UDINT'];

/** FX5 支持的类型名集合。 */
export const FX5_TYPE_NAMES: ReadonlySet<string> = new Set(FX5_TYPE_FACTS.map((t) => t.name));

/* ------------------------------------------------------------------ */
/* 标准 FB 与通用 FB                                                   */
/* ------------------------------------------------------------------ */

/** 标准 FB 的单个形参（名称/方向/数据类型，均来自手册参数表）。 */
export interface FbParamFact {
  name: string;
  direction: 'IN' | 'OUT';
  type: string;
  comment?: string;
}

export interface FbFact {
  name: string;
  inputs: readonly string[];
  outputs: readonly string[];
  /** 形参名是否已用手册原文核实（名称存在性另外保证）。 */
  paramsVerified: VerifiedStatus;
  source: string;
  note?: string;
  /** 完整形参表（名称/方向/类型），来自手册「设置数据」表；核实后填写。 */
  params?: readonly FbParamFact[];
  /** 必填输入参数（缺省 = 全部 inputs）。 */
  required?: readonly string[];
}

const SRC_FB_LIST = 'JY997D58901 指令/通用FUN/FB篇 text/08009（通用FB一览）；SH081322 text/07009（iQ-R 同名）';

/**
 * 标准 FB（IEC 通用部分）。
 *
 * 形参表已逐页核对（2026-11-11，PDF 页序 → 印刷页）：
 *  SR 29.1(p1298)、RS 29.2(p1300)、R_TRIG 30.1(p1302)、F_TRIG 30.2(p1304)、
 *  CTU 31.1(p1306)、CTD 31.2(p1308)、CTUD 31.3(p1310)、
 *  TP 32.1(p1315)、TON 32.2(p1317)、TOF 32.3(p1319)。
 *  EN/ENO 不是普通形参：无 EN 版直接调用；带 EN 版为 `_E` 类型（如 TON_E），另行支持。
 */
export const FX5_STANDARD_FBS: readonly FbFact[] = [
  {
    name: 'TON',
    inputs: ['IN', 'PT'],
    outputs: ['Q', 'ET'],
    paramsVerified: 'verified',
    source: 'JY997D58901 32.2 ON延迟定时器 p1317（PDF 1319）',
    required: ['IN', 'PT'],
    params: [
      { name: 'IN', direction: 'IN', type: 'BOOL', comment: '时间计测' },
      { name: 'PT', direction: 'IN', type: 'TIME', comment: '延迟时间设置值（0~32767ms）' },
      { name: 'Q', direction: 'OUT', type: 'BOOL', comment: '输出' },
      { name: 'ET', direction: 'OUT', type: 'TIME', comment: '经过时间' },
    ],
  },
  {
    name: 'TOF',
    inputs: ['IN', 'PT'],
    outputs: ['Q', 'ET'],
    paramsVerified: 'verified',
    source: 'JY997D58901 32.3 OFF延迟定时器 p1319（PDF 1321）',
    required: ['IN', 'PT'],
    params: [
      { name: 'IN', direction: 'IN', type: 'BOOL', comment: '时间计测' },
      { name: 'PT', direction: 'IN', type: 'TIME', comment: '延迟时间设置值' },
      { name: 'Q', direction: 'OUT', type: 'BOOL', comment: '输出' },
      { name: 'ET', direction: 'OUT', type: 'TIME', comment: '经过时间' },
    ],
  },
  {
    name: 'TP',
    inputs: ['IN', 'PT'],
    outputs: ['Q', 'ET'],
    paramsVerified: 'verified',
    source: 'JY997D58901 32.1 脉冲定时器 p1315（PDF 1317）',
    required: ['IN', 'PT'],
    params: [
      { name: 'IN', direction: 'IN', type: 'BOOL', comment: '输出开始' },
      { name: 'PT', direction: 'IN', type: 'TIME', comment: '输出时间设置值' },
      { name: 'Q', direction: 'OUT', type: 'BOOL', comment: '输出' },
      { name: 'ET', direction: 'OUT', type: 'TIME', comment: '经过时间' },
    ],
  },
  {
    name: 'CTU',
    inputs: ['CU', 'R', 'PV'],
    outputs: ['Q', 'CV'],
    paramsVerified: 'verified',
    source: 'JY997D58901 31.1 升计数器 p1306（PDF 1308）',
    required: ['CU', 'R', 'PV'],
    params: [
      { name: 'CU', direction: 'IN', type: 'BOOL', comment: '计数信号输入（OFF→ON 加 1）' },
      { name: 'R', direction: 'IN', type: 'BOOL', comment: '计数值复位' },
      { name: 'PV', direction: 'IN', type: 'INT', comment: '计数最大值（0~32767）' },
      { name: 'Q', direction: 'OUT', type: 'BOOL', comment: '计数完成' },
      { name: 'CV', direction: 'OUT', type: 'INT', comment: '计数值' },
    ],
  },
  {
    name: 'CTD',
    inputs: ['CD', 'LD', 'PV'],
    outputs: ['Q', 'CV'],
    paramsVerified: 'verified',
    source: 'JY997D58901 31.2 降值计数器 p1308（PDF 1310）',
    required: ['CD', 'LD', 'PV'],
    params: [
      { name: 'CD', direction: 'IN', type: 'BOOL', comment: '计数信号输入（OFF→ON 减 1）' },
      { name: 'LD', direction: 'IN', type: 'BOOL', comment: '计数值设置' },
      { name: 'PV', direction: 'IN', type: 'INT', comment: '计数开始值（0~32767）' },
      { name: 'Q', direction: 'OUT', type: 'BOOL', comment: '计数完成' },
      { name: 'CV', direction: 'OUT', type: 'INT', comment: '计数值' },
    ],
  },
  {
    name: 'CTUD',
    inputs: ['CU', 'CD', 'R', 'LD', 'PV'],
    outputs: ['QU', 'QD', 'CV'],
    paramsVerified: 'verified',
    source: 'JY997D58901 31.3 升/降计数器 p1310（PDF 1312）',
    required: ['CU', 'CD', 'R', 'LD', 'PV'],
    params: [
      { name: 'CU', direction: 'IN', type: 'BOOL', comment: '递增计数信号' },
      { name: 'CD', direction: 'IN', type: 'BOOL', comment: '递减计数信号' },
      { name: 'R', direction: 'IN', type: 'BOOL', comment: '计数值复位' },
      { name: 'LD', direction: 'IN', type: 'BOOL', comment: '计数值设置' },
      { name: 'PV', direction: 'IN', type: 'INT', comment: '计数最大值/开始值' },
      { name: 'QU', direction: 'OUT', type: 'BOOL', comment: '递增计数完成' },
      { name: 'QD', direction: 'OUT', type: 'BOOL', comment: '递减计数完成' },
      { name: 'CV', direction: 'OUT', type: 'INT', comment: '当前计数值' },
    ],
  },
  {
    name: 'R_TRIG',
    inputs: ['CLK'],
    outputs: ['Q'],
    paramsVerified: 'verified',
    source: 'JY997D58901 30.1 上升沿边缘检测 p1302（PDF 1304）',
    required: ['CLK'],
    params: [
      { name: 'CLK', direction: 'IN', type: 'BOOL', comment: '上升沿边缘检测输入' },
      { name: 'Q', direction: 'OUT', type: 'BOOL', comment: '输出（1 个扫描）' },
    ],
  },
  {
    name: 'F_TRIG',
    inputs: ['CLK'],
    outputs: ['Q'],
    paramsVerified: 'verified',
    source: 'JY997D58901 30.2 下降沿边缘检测 p1304（PDF 1306）',
    required: ['CLK'],
    params: [
      { name: 'CLK', direction: 'IN', type: 'BOOL', comment: '下降沿边缘检测输入' },
      { name: 'Q', direction: 'OUT', type: 'BOOL', comment: '输出（1 个扫描）' },
    ],
  },
  {
    name: 'RS',
    inputs: ['S', 'R1'],
    outputs: ['Q1'],
    paramsVerified: 'verified',
    source: 'JY997D58901 29.2 双稳态功能块(复位优先) p1300（PDF 1302）',
    required: ['S', 'R1'],
    params: [
      { name: 'S', direction: 'IN', type: 'BOOL', comment: '设置指令' },
      { name: 'R1', direction: 'IN', type: 'BOOL', comment: '复位指令（优先）' },
      { name: 'Q1', direction: 'OUT', type: 'BOOL', comment: '输出' },
    ],
  },
  {
    name: 'SR',
    inputs: ['S1', 'R'],
    outputs: ['Q1'],
    paramsVerified: 'verified',
    source: 'JY997D58901 29.1 双稳态功能块(设置优先) p1298（PDF 1300）',
    required: ['S1', 'R'],
    params: [
      { name: 'S1', direction: 'IN', type: 'BOOL', comment: '设置指令（优先）' },
      { name: 'R', direction: 'IN', type: 'BOOL', comment: '复位指令' },
      { name: 'Q1', direction: 'OUT', type: 'BOOL', comment: '输出' },
    ],
  },
] as const;

/** FX5 专有通用 FB（不属于 IEC 标准）。 */
export const FX5_NATIVE_FBS: readonly FbFact[] = [
  { name: 'COUNTER_FB_M', inputs: [], outputs: [], paramsVerified: 'unverified', source: SRC_FB_LIST, note: '存在性已验证；形参未核实，不建议 AI 生成' },
  { name: 'TIMER_1_FB_M', inputs: [], outputs: [], paramsVerified: 'unverified', source: SRC_FB_LIST, note: '存在性已验证；形参未核实' },
  { name: 'TIMER_10_FB_M', inputs: [], outputs: [], paramsVerified: 'unverified', source: SRC_FB_LIST },
  { name: 'TIMER_100_FB_M', inputs: [], outputs: [], paramsVerified: 'unverified', source: SRC_FB_LIST },
  { name: 'TIMER_CONT_FB_M', inputs: [], outputs: [], paramsVerified: 'unverified', source: SRC_FB_LIST },
  { name: 'TIMER_CONTHS_FB_M', inputs: [], outputs: [], paramsVerified: 'unverified', source: SRC_FB_LIST },
] as const;

/* ------------------------------------------------------------------ */
/* 指令 / 通用功能 / 已知不存在名称                                    */
/* ------------------------------------------------------------------ */

export type InstructionCategory = 'instruction' | 'generalFunction' | 'standardFb';

export interface InstructionFact {
  name: string;
  category: InstructionCategory;
  verified: VerifiedStatus;
  source: string;
  note?: string;
}

const SRC_FUN = 'JY997D58901 指令/通用FUN/FB篇 通用功能章（text/08002、08005、08007 等）';

/** 通用功能（ST 中可作函数/表达式使用）。 */
export const FX5_GENERAL_FUNCTIONS: readonly InstructionFact[] = [
  { name: 'ADD', category: 'generalFunction', verified: 'verified', source: 'JY997D58901 text/08002（最多 28 输入）' },
  { name: 'SUB', category: 'generalFunction', verified: 'verified', source: SRC_FUN },
  { name: 'MUL', category: 'generalFunction', verified: 'verified', source: 'JY997D58901 text/08002（最多 28 输入）' },
  { name: 'DIV', category: 'generalFunction', verified: 'verified', source: SRC_FUN },
  { name: 'MOD', category: 'generalFunction', verified: 'verified', source: SRC_FUN },
  { name: 'EXPT', category: 'generalFunction', verified: 'verified', source: 'JY997D58901 text/0C0?? / 1E005（ST: d:=EXPT(s1,s2)）' },
  { name: 'ABS', category: 'generalFunction', verified: 'verified', source: SRC_FUN },
  { name: 'SQRT', category: 'generalFunction', verified: 'verified', source: 'JY997D58901 text/08001；text/0C073（SQRT 指令不支持 ST，须用通用功能）' },
  { name: 'LN', category: 'generalFunction', verified: 'verified', source: SRC_FUN },
  { name: 'LOG', category: 'generalFunction', verified: 'verified', source: SRC_FUN },
  { name: 'EXP', category: 'generalFunction', verified: 'verified', source: SRC_FUN },
  { name: 'SIN', category: 'generalFunction', verified: 'verified', source: SRC_FUN },
  { name: 'COS', category: 'generalFunction', verified: 'verified', source: SRC_FUN },
  { name: 'TAN', category: 'generalFunction', verified: 'verified', source: SRC_FUN },
  { name: 'ASIN', category: 'generalFunction', verified: 'verified', source: SRC_FUN },
  { name: 'ACOS', category: 'generalFunction', verified: 'verified', source: SRC_FUN },
  { name: 'ATAN', category: 'generalFunction', verified: 'verified', source: SRC_FUN },
  { name: 'MAX', category: 'generalFunction', verified: 'verified', source: 'JY997D58901 text/08005（最多 28 输入）' },
  { name: 'MIN', category: 'generalFunction', verified: 'verified', source: 'JY997D58901 text/08005（最多 28 输入）' },
  { name: 'SEL', category: 'generalFunction', verified: 'verified', source: 'JY997D58901 text/08005（3 参）' },
  { name: 'LIMIT', category: 'generalFunction', verified: 'verified', source: 'JY997D58901 text/08005/0C049（3 参通用功能）' },
  { name: 'MUX', category: 'generalFunction', verified: 'verified', source: 'JY997D58901 text/08005（n + 2~28 输入）' },
  { name: 'LEN', category: 'generalFunction', verified: 'verified', source: SRC_FUN },
  { name: 'CONCAT', category: 'generalFunction', verified: 'verified', source: 'JY997D58901 text/08007（2~28 输入）' },
  { name: 'MID', category: 'generalFunction', verified: 'verified', source: SRC_FUN },
  { name: 'LEFT', category: 'generalFunction', verified: 'verified', source: SRC_FUN },
  { name: 'RIGHT', category: 'generalFunction', verified: 'verified', source: SRC_FUN },
  { name: 'FIND', category: 'generalFunction', verified: 'verified', source: SRC_FUN },
  { name: 'REPLACE', category: 'generalFunction', verified: 'verified', source: SRC_FUN },
  { name: 'INSERT', category: 'generalFunction', verified: 'verified', source: SRC_FUN },
  { name: 'DELETE', category: 'generalFunction', verified: 'verified', source: SRC_FUN },
  { name: 'INT_TO_REAL', category: 'generalFunction', verified: 'verified', source: 'JY997D58901 text/1C015（ST: d:=INT_TO_REAL(s)）' },
  { name: 'REAL_TO_INT', category: 'generalFunction', verified: 'verified', source: 'JY997D58901 text/1C022' },
] as const;

/** 属于「指令」（ST 中一般需要 EN/ENO 形态，不能当普通函数用）。 */
export const FX5_INSTRUCTIONS: readonly InstructionFact[] = [
  { name: 'SMOV', category: 'instruction', verified: 'verified', source: 'JY997D58901 text/0B05B（ST: ENO:=SMOV(EN,s,n1,n2,n3,d)）' },
  { name: 'RAMPF', category: 'instruction', verified: 'verified', source: 'JY997D58901 text/0C056（ST: ENO:=RAMPF(EN,s1,s2,n,d)）' },
  { name: 'MOV', category: 'instruction', verified: 'unverified', source: 'JY997D58901 text/06007（指令存在；ST 形态未核实）' },
  { name: 'BLKMOV', category: 'instruction', verified: 'unverified', source: 'JY997D58901（指令存在；ST 形态未核实）' },
  { name: 'SET', category: 'instruction', verified: 'unverified', source: 'JY997D58901 text/04002（SET/RST 指令语义；ST 形态未核实）' },
  { name: 'RST', category: 'instruction', verified: 'unverified', source: 'JY997D58901 text/04002' },
  { name: 'PLS', category: 'instruction', verified: 'unverified', source: 'JY997D58901（PLS 指令存在；ST 形态未核实）' },
  { name: 'PLF', category: 'instruction', verified: 'unverified', source: 'JY997D58901' },
  { name: 'HIOEN', category: 'instruction', verified: 'verified', source: 'JY997D58901 text/0602A（指令存在；ST 形态未核实）' },
  { name: 'DHIOEN', category: 'instruction', verified: 'verified', source: 'JY997D58901 text/0602A' },
] as const;

/**
 * v0.1 中列出、但经本机 6 本手册全文检索不存在的名称。
 * 严禁进入提示词白名单，也不应被 analyzer 视为已知 FB。
 */
export const FX5_NONEXISTENT_NAMES: readonly string[] = [
  'OUT_M', 'OUT_H', 'OUT_L',
  'TIMER_T', 'COUNTER_FB',
  'RAMP', 'HIOTRK', 'DHIO_TRK',
  'MC_HOM', 'MC_MOVE_ABSOLUTE', 'MC_MOVE_RELATIVE', 'MC_MOVE_VELOCITY',
  'MC_STOP', 'MC_SET_POSITION', 'MC_GET_POSITION', 'MC_DUTY',
] as const;

/** FX5 不支持的、v0.1 曾放行的类型名（iQ-R only）。 */
export const FX5_UNSUPPORTED_TYPE_NAMES: readonly string[] = IQ_R_ONLY_TYPES;
