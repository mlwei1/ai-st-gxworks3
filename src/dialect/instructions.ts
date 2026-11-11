/**
 * FX5U / iQ-F (GX Works3) ST 指令白名单与方言规则。
 *
 * 这是「三菱方言检查」的核心知识库：AI 生成 ST 时最常见的错误就是
 * 混入西门子(S7)、CODESYS/Twincat 或 IEC 通用但三菱不支持的写法。
 * 校验器依据此表拦截这些代码。
 *
 * v2（M0-1）：三菱事实统一来自 `src/profile/`（带 source/verified），
 * 本文件只保留兼容导出；不要再往本文件里硬编码新事实。
 */

import {
  FX5_STANDARD_FBS,
  FX5_NATIVE_FBS,
  FX5_POSITIONING_INSTRUCTIONS,
  FX5_COMMUNICATION_INSTRUCTIONS,
  FX5U_PROFILE,
  getDeviceFact,
  type DeviceBase,
} from '../profile/index.ts';

/** 三菱 FX5U 支持的标准功能块（IEC 61131-3 通用部分，语法一致）。 */
export const STANDARD_FUNCTION_BLOCKS: Record<string, string> = Object.fromEntries(
  FX5_STANDARD_FBS.map((f) => [f.name, f.name]),
);

/**
 * 定位指令（ST 中以函数形式调用，返回 ENO）。
 * 形参个数来自 profile 的手册核实结果；EN/ENO 也计入操作数。
 */
export const POSITIONING_FUNCTIONS: Record<string, { min: number; max: number; ret: string | null }> =
  Object.fromEntries(
    FX5_POSITIONING_INSTRUCTIONS.map((f) => [
      f.name,
      { min: f.operands.length, max: f.operands.length, ret: 'BOOL' },
    ]),
  );

/**
 * 通信指令（ST 中以函数形式调用，返回 ENO）。
 * 形参个数来自 profile 的手册核实结果；`U0`/`U` 是模块号字符串操作数。
 * ADPRW 的 ST 顺序待原生验证，但参数个数按操作数表记录为 7。
 */
export const COMMUNICATION_FUNCTIONS: Record<string, { min: number; max: number; ret: string | null }> =
  Object.fromEntries(
    FX5_COMMUNICATION_INSTRUCTIONS.map((f) => [
      f.name,
      { min: f.operands.length, max: f.operands.length, ret: 'BOOL' },
    ]),
  );

/**
 * 三菱专用功能块（标准 IEC 中没有对应物）。
 *
 * v0.1 曾在此列出 OUT_M/OUT_H/OUT_L/TIMER_T/COUNTER_FB/RAMP/HIOTRK/
 * DHIO_TRK/MC_*，经本机 6 本手册全文检索**均不存在**（见 02 审计）。
 * 现仅保留已确认存在的 FX5 通用 FB。
 */
export const MITSUBISHI_FUNCTION_BLOCKS: Record<string, string> = Object.fromEntries(
  FX5_NATIVE_FBS.map((f) => [f.name, f.name]),
);

/**
 * 三菱 ST 支持的标准函数（按参数个数分类）。
 * `null` 表示该参数为任意类型。
 */
export const STANDARD_FUNCTIONS: Record<string, { min: number; max: number; ret: string | null; eno?: boolean }> = {
  // 数值运算
  ADD: { min: 2, max: 2, ret: null },
  SUB: { min: 2, max: 2, ret: null },
  MUL: { min: 2, max: 2, ret: null },
  DIV: { min: 2, max: 2, ret: null },
  MOD: { min: 2, max: 2, ret: null },
  EXPT: { min: 2, max: 2, ret: null },
  // 单参函数
  ABS: { min: 1, max: 1, ret: null },
  SQRT: { min: 1, max: 1, ret: null },
  LN: { min: 1, max: 1, ret: null },
  LOG: { min: 1, max: 1, ret: null },
  EXP: { min: 1, max: 1, ret: null },
  SIN: { min: 1, max: 1, ret: null },
  COS: { min: 1, max: 1, ret: null },
  TAN: { min: 1, max: 1, ret: null },
  ASIN: { min: 1, max: 1, ret: null },
  ACOS: { min: 1, max: 1, ret: null },
  ATAN: { min: 1, max: 1, ret: null },
  // 多参函数
  MAX: { min: 2, max: 255, ret: null },
  MIN: { min: 2, max: 255, ret: null },
  // ST 中使用「通用功能 LIMIT」：d := LIMIT(s1下限, s2输入值, s3上限)；
  // 梯形图指令 LIMIT(P) 不支持 ST 语言（JY997D58901 p712 注），不要按 4 操作数指令写法调用。
  LIMIT: { min: 3, max: 3, ret: null },
  // 斜坡信号指令（应用指令）：ENO := RAMPF(EN, s1初始值, s2目标值, n扫描次数, d数组)；
  // JY997D58901 8.17 p747。返回 ENO。
  RAMPF: { min: 5, max: 5, ret: 'BOOL' },
  SEL: { min: 3, max: 3, ret: null },
  MUX: { min: 2, max: 255, ret: null },
  // 位操作
  AND: { min: 2, max: 255, ret: null },
  OR: { min: 2, max: 255, ret: null },
  XOR: { min: 2, max: 255, ret: null },
  NOT: { min: 1, max: 1, ret: 'BOOL' },
  // 数据搬移
  MOV: { min: 2, max: 2, ret: null },
  SMOV: { min: 4, max: 4, ret: null },
  BLKMOV: { min: 4, max: 4, ret: null },
  // 转换（v2：FX5 无 LREAL，DINT_TO_LREAL/LREAL_TO_DINT 已移除；见 profile）
  INT_TO_REAL: { min: 1, max: 1, ret: 'REAL' },
  REAL_TO_INT: { min: 1, max: 1, ret: 'INT' },
  BOOL_TO_INT: { min: 1, max: 1, ret: 'INT' },
  INT_TO_BOOL: { min: 1, max: 1, ret: 'BOOL' },
  // 字符串
  LEN: { min: 1, max: 1, ret: 'INT' },
  CONCAT: { min: 2, max: 255, ret: 'STRING' },
  MID: { min: 3, max: 3, ret: 'STRING' },
  LEFT: { min: 2, max: 2, ret: 'STRING' },
  RIGHT: { min: 2, max: 2, ret: 'STRING' },
  FIND: { min: 2, max: 2, ret: 'INT' },
  REPLACE: { min: 4, max: 4, ret: 'STRING' },
  INSERT: { min: 4, max: 4, ret: 'STRING' },
  DELETE: { min: 3, max: 3, ret: 'STRING' },
};

/**
 * 三菱特有函数（标准 IEC 无对应物）。
 * `argTypes` 中 `?` 表示任意类型。
 */
export const MITSUBISHI_FUNCTIONS: Record<string, { argTypes: string[]; ret: string | null }> = {
  SET: { argTypes: ['BOOL', 'BOOL'], ret: null },
  RST: { argTypes: ['BOOL', 'BOOL'], ret: null },
  PLS: { argTypes: ['BOOL', 'BOOL'], ret: null },
  PLF: { argTypes: ['BOOL', 'BOOL'], ret: null },
  ZR: { argTypes: ['BOOL', 'BOOL'], ret: null },
};

/**
 * 三菱 ST 中「看起来像 IEC 但参数顺序/语义不同」的陷阱函数。
 * key 为函数名，value 为说明，校验器命中即报错。
 */
export const KNOWN_TRAPS: Record<string, string> = {
  RAMP_REAL:
    '三菱无 RAMP_REAL 函数。斜坡控制用 RAMPF 指令（ST 形式：ENO := RAMPF(EN, s1, s2, n, d);，JY997D58901 p747）；REAL 斜坡请自定义 FB。',
  BLKMOV: 'BLKMOV 为批量搬移，请确认参数个数与数据长度一致。',
  TONR: '三菱 FX5U 的 ST 中使用标准 TON，不使用 IEC 的 TONR。',
};

/**
 * 明确禁止出现的「其他品牌函数」——AI 最容易误用的部分。
 */
export const FOREIGN_BRANDS_FUNCTIONS: Record<string, string> = {
  // 西门子 S7 / TIA Portal
  IREF: '西门子 IREF（间接寻址），三菱 GX Works3 ST 不支持。',
  'POKE': '西门子 POKE，三菱 GX Works3 ST 不支持。',
  'PEEK': '西门子 PEEK，三菱 GX Works3 ST 不支持。',
  SCALE: '西门子 SCALE，三菱请用自建 FB 或 RAMPF。',
  'NORM_X': '西门子 NORM_X，三菱 GX Works3 ST 不支持。',
  // CODESYS / TwinCAT
  '__CALL': 'CODESYS 内部调用语法，三菱不支持。',
  'CU_ADD': 'CODESYS 计数器扩展指令，三菱不支持。',
  'RSR': 'CODESYS RSR，三菱请用 SET/RST。',
  'ROL': 'CODESYS ROL/ROR，三菱请用自写位操作。',
  // 通用 IEC 但三菱未实现
  'CTU_DINT': '三菱使用单一 CTU/CTD/CTUD，靠数据类型区分宽度。',
};

/**
 * 标准功能块的形参表（来自 profile）。
 *
 * 用于校验功能块实例调用的参数名是否正确。
 * required 为必填输入参数；形参是否已核实见 profile 的 `paramsVerified`。
 */
export const STANDARD_FB_SIGNATURES: Record<
  string,
  { inputs: string[]; outputs: string[]; required: string[] }
> = Object.fromEntries(
  FX5_STANDARD_FBS.map((f) => [
    f.name,
    {
      inputs: [...f.inputs],
      outputs: [...f.outputs],
      // 必填输入：优先用 profile 核实的 required（如 TON 的 IN/PT）
      required: [...(f.required ?? f.inputs)],
    },
  ]),
);

/** 保留字：不能作为变量名。 */
export const RESERVED_WORDS = new Set([
  // 程序组织单元
  'PROGRAM', 'END_PROGRAM', 'FUNCTION', 'END_FUNCTION', 'FUNCTION_BLOCK', 'END_FUNCTION_BLOCK',
  'TYPE', 'END_TYPE', 'STRUCT', 'END_STRUCT', 'VAR', 'END_VAR',
  'VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT', 'VAR_TEMP', 'VAR_GLOBAL', 'VAR_EXTERNAL',
  'VAR_ACCESS', 'VAR_CONFIG', 'VAR_INST',
  // 控制结构
  'IF', 'THEN', 'ELSE', 'ELSIF', 'END_IF',
  'CASE', 'OF', 'END_CASE',
  'FOR', 'TO', 'BY', 'DO', 'END_FOR',
  'WHILE', 'END_WHILE', 'REPEAT', 'UNTIL', 'END_REPEAT', 'EXIT', 'RETURN',
  'CONTINUE',
  // 运算符/逻辑
  'AND', 'OR', 'XOR', 'NOT', 'MOD',
  'TRUE', 'FALSE', 'NULL',
  // 其他
  'THIS', 'CONSTANT', 'RETAIN', 'NON_RETAIN', 'PERSISTENT', 'AT', 'REF_TO', 'REF',
]);

/**
 * 设备地址（软元件）前缀（来自 FX5U profile）。
 * `base` 为软元件编号进制：X/Y 八进制、B/W/SB/SW 十六进制、其余十进制。
 */
export const DEVICE_PREFIXES: Record<
  string,
  { width: number; kind: 'bit' | 'word'; description: string; base: DeviceBase }
> = Object.fromEntries(
  Object.values(FX5U_PROFILE.devices).map((d) => [
    d.symbol,
    { width: 1, kind: d.kind, description: d.label, base: d.base },
  ]),
);

/**
 * 设备号范围的合法区间（FX5U，十进制等价数值）。
 *
 * 由 `src/profile/fx5u.ts` 派生；带进制的解析请用 `parseDeviceAddress`，
 * 范围校验请用 `checkDeviceNumber`（会区分 X/Y 的八进制与 B/W 的十六进制）。
 * SM/SD 范围未核实，故不出现在本表。
 */
export const DEVICE_RANGES: Record<string, { min: number; max: number }> = Object.fromEntries(
  Object.values(FX5U_PROFILE.devices)
    .filter((d) => d.range !== null)
    .map((d) => [d.symbol, { min: d.range![0], max: d.range![1] }]),
);

/** 各软元件编号的进制（来自 profile）。 */
export const DEVICE_BASES: Record<string, DeviceBase> = Object.fromEntries(
  Object.values(FX5U_PROFILE.devices).map((d) => [d.symbol, d.base]),
);

/**
 * @deprecated 无手册依据（见 02 审计 §3.10）。GX Works3 中未分配软元件的标签
 * 进入“标签存储器/锁存标签区域”，而不是自动分配设备地址；显式分配只需避免
 * 与其他标签重复软元件。仅保留导出以免破坏旧代码，**新检查不要再使用**。
 */
export const AUTO_ALLOCATE_GUARD = {
  bitBelow: 8000,
  wordBelow: 512,
};

/**
 * 常用系统位（FX5U），用于校验时识别特殊继电器。
 * 已按 JY997D58701 text/15002、text/2C003 修正（v0.1 的 SM400/SM410 等描述是错的）。
 */
export const SYSTEM_BITS: Record<string, string> = {
  SM400: '始终 ON',
  SM401: '始终 OFF',
  SM402: 'RUN 后仅 1 个扫描 ON',
  SM403: 'RUN 后仅 1 个扫描 OFF',
  SM409: '0.01 秒时钟',
  SM410: '0.1 秒时钟',
  SM411: '0.2 秒时钟',
  SM412: '1 秒时钟',
  SM413: '2 秒时钟',
  SM414: '2n 秒时钟',
  SM415: '2nms 时钟',
  SM420: '用户定时时钟 No.0',
  SM421: '用户定时时钟 No.1',
  SM422: '用户定时时钟 No.2',
  SM423: '用户定时时钟 No.3',
  SM424: '用户定时时钟 No.4',
};

/** 判断标识符是否合法（GX Works3 区分大小写，不允许全角字符）。 */
export function isValidIdentifier(name: string): boolean {
  if (!name) return false;
  if (RESERVED_WORDS.has(name.toUpperCase())) return false;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return false;
  // 全角字符检测
  for (const ch of name) {
    const c = ch.codePointAt(0)!;
    if (c > 0x7f && c < 0xff) return false;
  }
  return true;
}

/** 解析后的设备地址（含进制信息）。 */
export interface ParsedDeviceAddress {
  prefix: string;
  /** 按 base 解析出的数值；编号含非法数字时为 NaN。 */
  number: number;
  base: DeviceBase;
  /** 编号部分原文。 */
  digits: string;
  /** 编号是否只由该进制的合法数字组成（如 X198 对八进制非法）。 */
  validDigits: boolean;
}

/**
 * 解析设备地址，返回 `{ prefix, number, base, digits, validDigits }` 或 null。
 *
 * v2：支持进制——X/Y 八进制，B/W/SB/SW 十六进制，其余十进制（来自 profile）。
 * 范围校验请用 profile 的 `checkDeviceNumber`，不要直接比较数值。
 */
export function parseDeviceAddress(text: string): ParsedDeviceAddress | null {
  const m = /^([A-Za-z]+)([0-9A-Za-z]+)$/.exec(text.trim());
  if (!m) return null;
  const prefix = m[1].toUpperCase();
  const digits = m[2];
  const fact = getDeviceFact(prefix);
  const base: DeviceBase = fact?.base ?? 10;
  const validDigits =
    base === 8
      ? /^[0-7]+$/.test(digits)
      : base === 16
        ? /^[0-9A-Fa-f]+$/.test(digits)
        : /^[0-9]+$/.test(digits);
  const number = validDigits ? Number.parseInt(digits, base) : Number.NaN;
  return { prefix, number, base, digits, validDigits };
}
