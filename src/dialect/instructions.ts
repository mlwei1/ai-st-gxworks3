/**
 * FX5U / iQ-F (GX Works3) ST 指令白名单与方言规则。
 *
 * 这是「三菱方言检查」的核心知识库：AI 生成 ST 时最常见的错误就是
 * 混入西门子(S7)、CODESYS/Twincat 或 IEC 通用但三菱不支持的写法。
 * 校验器依据此表拦截这些代码。
 */

/** 三菱 FX5U 支持的标准功能块（IEC 61131-3 通用部分，语法一致）。 */
export const STANDARD_FUNCTION_BLOCKS: Record<string, string> = {
  TON: 'TON',
  TOF: 'TOF',
  TP: 'TP',
  CTU: 'CTU',
  CTD: 'CTD',
  CTUD: 'CTUD',
  R_TRIG: 'R_TRIG',
  F_TRIG: 'F_TRIG',
  RS: 'RS',
  SR: 'SR',
};

/** 三菱专用功能块（标准 IEC 中没有对应物）。 */
export const MITSUBISHI_FUNCTION_BLOCKS: Record<string, string> = {
  // 边沿输出型
  OUT_M: 'OUT_M 上升沿触发输出',
  OUT_H: 'OUT_H 高电平输出',
  OUT_L: 'OUT_L 低电平输出',
  // 定时/计数
  TIMER_T: 'TIMER_T 定时器',
  COUNTER_FB: 'COUNTER_FB 计数器',
  // 运算类
  RAMPF: 'RAMPF 整数型斜坡',
  RAMP: 'RAMP 浮点型斜坡',
  // 通信/模块
  MC_HOM: 'MC_HOM 原点回归',
  MC_MOVE_ABSOLUTE: 'MC_MOVE_ABSOLUTE 绝对定位',
  MC_MOVE_RELATIVE: 'MC_MOVE_RELATIVE 相对定位',
  MC_MOVE_VELOCITY: 'MC_MOVE_VELOCITY 速度定位',
  MC_STOP: 'MC_STOP 停止',
  MC_SET_POSITION: 'MC_SET_POSITION 坐标设定',
  MC_GET_POSITION: 'MC_GET_POSITION 坐标读取',
  MC_DUTY: 'MC_DUTY 扭矩',
  // 高速计数/脉冲
  HIOEN: 'HIOEN 高速计数使能',
  HIOTRK: 'HIOTRK 高速计数跟踪',
  DHIOEN: 'DHIOEN 高速计数使能(双字)',
  DHIO_TRK: 'DHIO_TRK 高速计数跟踪(双字)',
};

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
  LIMIT: { min: 3, max: 3, ret: null },
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
  // 转换
  INT_TO_REAL: { min: 1, max: 1, ret: 'REAL' },
  REAL_TO_INT: { min: 1, max: 1, ret: 'INT' },
  DINT_TO_LREAL: { min: 1, max: 1, ret: 'LREAL' },
  LREAL_TO_DINT: { min: 1, max: 1, ret: 'DINT' },
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
  LIMIT:
    '三菱 GX Works3 的 LIMIT 参数顺序为 LIMIT(EN, 下限, 上限, 输入, 输出)，与部分 IEC 实现不同；本工具使用 3 参形式 LIMIT(下限, 上限, 输入)。',
  RAMP_REAL:
    '三菱无 RAMP_REAL 函数。整数用 RAMPF，REAL 浮点用 RAMP；如需 REAL 斜坡请自定义 FB。',
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
 * 标准功能块的形参表（IEC 61131-3 / GX Works3 一致）。
 *
 * 用于校验功能块实例调用的参数名是否正确。
 * required 为必填输入参数。
 */
export const STANDARD_FB_SIGNATURES: Record<
  string,
  { inputs: string[]; outputs: string[]; required: string[] }
> = {
  TON: { inputs: ['IN', 'PT'], outputs: ['Q', 'ET'], required: ['IN', 'PT'] },
  TOF: { inputs: ['IN', 'PT'], outputs: ['Q', 'ET'], required: ['IN', 'PT'] },
  TP: { inputs: ['IN', 'PT'], outputs: ['Q', 'ET'], required: ['IN', 'PT'] },
  CTU: { inputs: ['CU', 'R', 'PV'], outputs: ['Q', 'CV'], required: ['CU', 'PV'] },
  CTD: { inputs: ['CD', 'LD', 'PV'], outputs: ['Q', 'CV'], required: ['CD', 'PV'] },
  CTUD: {
    inputs: ['CU', 'CD', 'R', 'LD', 'PV'],
    outputs: ['QU', 'QD', 'CV'],
    required: ['CU', 'CD', 'PV'],
  },
  R_TRIG: { inputs: ['CLK'], outputs: ['Q'], required: ['CLK'] },
  F_TRIG: { inputs: ['CLK'], outputs: ['Q'], required: ['CLK'] },
  RS: { inputs: ['S', 'R1'], outputs: ['Q1'], required: ['S', 'R1'] },
  SR: { inputs: ['S1', 'R'], outputs: ['Q1'], required: ['S1', 'R'] },
};

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
 * 设备地址（软元件）前缀。
 * 值表示该前缀是否支持直接寻址。
 */
export const DEVICE_PREFIXES: Record<string, { width: number; kind: 'bit' | 'word'; description: string }> = {
  X: { width: 1, kind: 'bit', description: '输入继电器' },
  Y: { width: 1, kind: 'bit', description: '输出继电器' },
  M: { width: 1, kind: 'bit', description: '辅助继电器' },
  L: { width: 1, kind: 'bit', description: '锁存继电器' },
  B: { width: 1, kind: 'bit', description: '链接继电器' },
  S: { width: 1, kind: 'bit', description: '状态继电器' },
  T: { width: 1, kind: 'bit', description: '定时器触点' },
  C: { width: 1, kind: 'bit', description: '计数器触点' },
  D: { width: 1, kind: 'word', description: '数据寄存器' },
  W: { width: 1, kind: 'word', description: '链接寄存器' },
  R: { width: 1, kind: 'word', description: '文件寄存器' },
  Z: { width: 1, kind: 'word', description: '变址寄存器' },
  SM: { width: 1, kind: 'bit', description: '特殊辅助继电器' },
  SD: { width: 1, kind: 'word', description: '特殊数据寄存器' },
};

/**
 * 设备号范围的合法区间（FX5U）。
 * 用于拦截越界地址，例如 X2048 在 FX5U 上不存在。
 */
export const DEVICE_RANGES: Record<string, { min: number; max: number }> = {
  X: { min: 0, max: 511 },
  Y: { min: 0, max: 511 },
  M: { min: 0, max: 767 },
  L: { min: 0, max: 767 },
  B: { min: 0, max: 63 },
  S: { min: 0, max: 127 },
  T: { min: 0, max: 511 },
  C: { min: 0, max: 255 },
  D: { min: 0, max: 7999 },
  W: { min: 0, max: 511 },
  R: { min: 0, max: 32767 },
  Z: { min: 0, max: 19 },
};

/**
 * 编译期自动分配区间的下界。显式地址落在这些区间内会与自动分配冲突。
 * FX5U 常见约定：M8000 以下、D512 以下为用户显式分配区。
 */
export const AUTO_ALLOCATE_GUARD = {
  bitBelow: 8000,
  wordBelow: 512,
};

/** 常用系统位（FX5U），用于校验时识别特殊继电器。 */
export const SYSTEM_BITS: Record<string, string> = {
  SM400: 'RUN 状态(ON)',
  SM401: 'STOP 状态(ON)',
  SM402: 'RUN 初始脉冲(1扫)',
  SM403: 'STOP 初始脉冲(1扫)',
  SM404: '保持(HOLD)',
  SM410: '1秒时钟',
  SM411: '2秒时钟',
  SM412: '1秒时钟(可用作闪烁)',
  SM420: '用户闪烁(1s)',
  SM421: '用户闪烁(2s)',
  SM424: '用户闪烁(0.5s)',
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

/** 解析设备地址，返回 { prefix, number } 或 null。 */
export function parseDeviceAddress(text: string): { prefix: string; number: number } | null {
  const m = /^([A-Za-z]+)([0-9]+)$/.exec(text.trim());
  if (!m) return null;
  return { prefix: m[1].toUpperCase(), number: Number(m[2]) };
}
