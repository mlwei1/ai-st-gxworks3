/**
 * GX Works3 / FX5U (iQ-F) ST 方言类型系统。
 *
 * 与标准 IEC 61131-3 的差异集中在：
 *  - 基础类型命名（INT/WORD 并存，ANY 泛型不开放给用户代码）
 *  - 字符串为 STRING[32] 形式，长度是类型的一部分
 *  - 双精度 REAL/LREAL 存在，但 LREAL 占用 4 个字寄存器
 */

/** FX5U 可用基础数据类型。 */
export const PRIMITIVE_TYPES = [
  'BOOL',
  'BYTE',
  'WORD',
  'DWORD',
  'INT',
  'UINT',
  'DINT',
  'UDINT',
  'LINT',
  'ULINT',
  'REAL',
  'LREAL',
  'TIME',
  'STRING',
  'WSTRING',
] as const;

export type PrimitiveType = (typeof PRIMITIVE_TYPES)[number];

/**
 * 数据类型在软元件上的字节宽度（以 16 位字为单位）。
 * GX Works3 的 D 寄存器是 16 位，多字类型占用连续的多个 D。
 */
export const TYPE_WORD_WIDTH: Record<string, number> = {
  BOOL: 1,
  BYTE: 1,
  WORD: 1,
  DWORD: 2,
  INT: 1,
  UINT: 1,
  DINT: 2,
  UDINT: 2,
  LINT: 4,
  ULINT: 4,
  REAL: 2,
  LREAL: 4,
  TIME: 2,
  STRING: 1,
  WSTRING: 1,
};

/** 有符号整型集合。 */
export const SIGNED_INT_TYPES = new Set(['INT', 'DINT', 'LINT']);
/** 无符号整型集合。 */
export const UNSIGNED_INT_TYPES = new Set(['BYTE', 'WORD', 'DWORD', 'UINT', 'UDINT', 'ULINT']);
/** 浮点型集合。 */
export const FLOAT_TYPES = new Set(['REAL', 'LREAL']);
/** 整数型集合（signed + unsigned）。 */
export const INT_TYPES = new Set([...SIGNED_INT_TYPES, ...UNSIGNED_INT_TYPES]);
/** 数值型集合（整数 + 浮点）。 */
export const NUMERIC_TYPES = new Set([...INT_TYPES, ...FLOAT_TYPES]);

export type DataType = PrimitiveType | string;

/** 是否为合法的基础类型名。 */
export function isPrimitiveType(name: string): name is PrimitiveType {
  return (PRIMITIVE_TYPES as readonly string[]).includes(name);
}

/**
 * 规范化类型名。GX Works3 允许 STRING[32] / STRING[64] 等带长度声明，
 * 这里保留长度信息用于比较，避免把 STRING 与 STRING[32] 混为一谈。
 */
export function normalizeTypeName(name: string): string {
  const t = name.trim().toUpperCase();
  const m = /^([A-Z]+)(?:\[(\d+)\])?$/.exec(t);
  if (!m) return t;
  if (m[1] === 'STRING' && m[2]) return `STRING[${m[2]}]`;
  if (m[1] === 'WSTRING' && m[2]) return `WSTRING[${m[2]}]`;
  return m[1];
}

/**
 * 取类型的基础名（去掉长度参数），保留原始大小写。
 *
 * 注意：GX Works3 的标签/类型名区分大小写，用户自定义类型（STRUCT）
 * 必须按原样匹配，因此这里不做大写化。内置基础类型请用 builtinTypeName。
 */
export function baseTypeName(name: string): string {
  const t = name.trim();
  const i = t.indexOf('[');
  const base = i === -1 ? t : t.slice(0, i);
  // 内置类型统一大写（STRING[32] -> STRING）
  const up = base.toUpperCase();
  if (up === 'STRING' || up === 'WSTRING') return up;
  return base;
}

/** 内置基础类型名（大写 + 去长度参数），用于查内置类型表。 */
export function builtinTypeName(name: string): string {
  const up = name.trim().toUpperCase();
  const i = up.indexOf('[');
  return i === -1 ? up : up.slice(0, i);
}

/** 该类型是否占用多个字寄存器。 */
export function isMultiWord(name: string): boolean {
  return (TYPE_WORD_WIDTH[baseTypeName(name)] ?? 1) > 1;
}

/**
 * 类型兼容判定：判断 `source` 类型的值能否直接赋给 `target`。
 *
 * 规则：
 *  - 完全相同 → 兼容
 *  - 同宽同符号类整数 → 兼容（INT -> DINT 需显式转换）
 *  - 整数 -> 浮点 → 需要显式转换（GX Works3 默认不允许隐式混算赋值）
 *  - ANY_INT / ANY_REAL 不对用户代码开放，这里不做通配
 */
export function isAssignable(target: string, source: string): boolean {
  const t = baseTypeName(target);
  const s = baseTypeName(source);
  if (t === s) return true;
  // BOOL 只能与 BOOL 互转。
  if (t === 'BOOL' || s === 'BOOL') return false;
  // 浮点与整数之间不做隐式转换。
  if (FLOAT_TYPES.has(t) !== FLOAT_TYPES.has(s)) return false;
  // 整型之间：目标宽度必须不小于来源宽度，且符号性一致或可安全扩展。
  if (INT_TYPES.has(t) && INT_TYPES.has(s)) {
    const tw = TYPE_WORD_WIDTH[t] ?? 1;
    const sw = TYPE_WORD_WIDTH[s] ?? 1;
    if (tw < sw) return false;
    const tSigned = SIGNED_INT_TYPES.has(t);
    const sSigned = SIGNED_INT_TYPES.has(s);
    if (tSigned !== sSigned) {
      // 无符号 -> 有符号：仅当目标宽度严格更大时才安全。
      if (!(tSigned && !sSigned && tw > sw)) return false;
    }
    return true;
  }
  return false;
}

/** 隐式数值转换（用于表达式中的字面量折叠与运算结果推断）。 */
export function widenType(a: string, b: string): string {
  const ta = baseTypeName(a);
  const tb = baseTypeName(b);
  if (ta === tb) return ta;
  if (FLOAT_TYPES.has(ta) || FLOAT_TYPES.has(tb)) {
    if (ta === 'LREAL' || tb === 'LREAL') return 'LREAL';
    return 'REAL';
  }
  const wa = TYPE_WORD_WIDTH[ta] ?? 1;
  const wb = TYPE_WORD_WIDTH[tb] ?? 1;
  const w = Math.max(wa, wb);
  const signed = SIGNED_INT_TYPES.has(ta) || SIGNED_INT_TYPES.has(tb);
  const map: Record<number, string> = signed
    ? { 1: 'INT', 2: 'DINT', 4: 'LINT' }
    : { 1: 'UINT', 2: 'UDINT', 4: 'ULINT' };
  return map[w] ?? (signed ? 'LINT' : 'ULINT');
}

/**
 * 字面量类型推断。GX Works3 支持 K(十进制) / H(十六进制) / B(二进制) 前缀，
 * 以及 T# 时间字面量、'字符串'。
 */
export function inferLiteralType(raw: string): string | null {
  const t = raw.trim();
  if (/^'(?:[^']|'')*'$/.test(t)) return 'STRING';
  if (/^"[^"]*"$/.test(t)) return 'WSTRING';
  if (/^T#[0-9a-zA-Z_]+$/.test(t)) return 'TIME';
  if (/^[0-9][0-9_]*$/.test(t)) return 'INT';
  if (/^0[0-7_]+$/.test(t)) return 'INT';
  if (/^16#[0-9a-fA-F_]+$/.test(t)) return 'INT';
  if (/^2#[01_]+$/.test(t)) return 'INT';
  if (/^8#[0-7_]+$/.test(t)) return 'INT';
  if (/^K[0-9_]+$/.test(t)) return 'INT';
  if (/^H[0-9a-fA-F_]+$/.test(t)) return 'INT';
  if (/^D[0-9]+$/i.test(t)) return 'INT';
  if (/^\d+\.\d+$/.test(t)) return 'REAL';
  if (/^\d+[eE][+-]?\d+$/.test(t)) return 'REAL';
  return null;
}

/** 数值字面量的整数值（仅处理整数形式），用于范围检查。 */
export function literalIntValue(raw: string): number | null {
  const t = raw.trim().toUpperCase();
  const clean = (s: string) => Number(s.replace(/_/g, ''));
  if (/^[0-9][0-9_]*$/.test(t)) return clean(t);
  if (/^K[0-9_]+$/.test(t)) return clean(t.slice(1));
  if (/^H[0-9a-fA-F_]+$/.test(t)) return parseInt(t.slice(1).replace(/_/g, ''), 16);
  if (/^2#[01_]+$/.test(t)) return parseInt(t.slice(2).replace(/_/g, ''), 2);
  if (/^8#[0-7_]+$/.test(t)) return parseInt(t.slice(2).replace(/_/g, ''), 8);
  if (/^16#[0-9a-fA-F_]+$/.test(t)) return parseInt(t.slice(3).replace(/_/g, ''), 16);
  return null;
}
