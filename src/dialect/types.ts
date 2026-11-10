/**
 * GX Works3 / FX5U (iQ-F) ST 方言类型系统。
 *
 * v2（M0-1）：类型表来自 `src/profile/fx5u.ts`（FX5 手册 JY997D58901 text/03001）。
 * 与 v0.1 的差异：
 *  - FX5 **不支持** LINT / ULINT / UINT / UDINT / LREAL（iQ-R 才有）；
 *  - 新增 TIMER / RETENTIVETIMER / COUNTER / LCOUNTER / POINTER 定时器/计数器/指针型；
 *  - STRING 与 STRING[Unicode](WSTRING) 都按 1 字起算（实际按字节数换算，见手册），
 *    这里保留“基础宽度”仅供可赋值性判断，不能用于地址占用计算。
 */

import { FX5_TYPE_FACTS, FX5_TYPE_NAMES, IQ_R_ONLY_TYPES } from '../profile/index.ts';

/** FX5 可用基础数据类型（顺序与手册一致）。 */
export const PRIMITIVE_TYPES = FX5_TYPE_FACTS.map((t) => t.name) as readonly string[];

export type PrimitiveType = string;

/** 是否为合法的基础类型名（FX5 口径）。 */
export function isPrimitiveType(name: string): boolean {
  return FX5_TYPE_NAMES.has(name.trim().toUpperCase());
}

/** 是否为「仅 iQ-R 支持、FX5 不支持」的类型名（LI/UL/LREAL、UINT/UDINT）。 */
export function isIqROnlyPrimitiveType(name: string): boolean {
  return IQ_R_ONLY_TYPES.includes(name.trim().toUpperCase());
}

/**
 * 数据类型的基础宽度（以 16 位字为单位）。
 * 仅用于可赋值性/加宽判断；TIMER 等的实际占用以手册为准（未逐项核实）。
 */
export const TYPE_WORD_WIDTH: Record<string, number> = {
  BOOL: 1,
  WORD: 1,
  DWORD: 2,
  INT: 1,
  DINT: 2,
  REAL: 2,
  TIME: 2,
  STRING: 1,
  WSTRING: 1,
  TIMER: 2,
  RETENTIVETIMER: 2,
  COUNTER: 2,
  LCOUNTER: 2,
  POINTER: 1,
};

/** 有符号整型集合（FX5）。 */
export const SIGNED_INT_TYPES = new Set(['INT', 'DINT']);
/** 无符号整型集合（FX5）。 */
export const UNSIGNED_INT_TYPES = new Set(['WORD', 'DWORD']);
/** 浮点型集合（FX5 只有单精度 REAL）。 */
export const FLOAT_TYPES = new Set(['REAL']);
/** 整数型集合（signed + unsigned）。 */
export const INT_TYPES = new Set([...SIGNED_INT_TYPES, ...UNSIGNED_INT_TYPES]);
/** 数值型集合（整数 + 浮点 + 时间）。 */
export const NUMERIC_TYPES = new Set([...INT_TYPES, ...FLOAT_TYPES, 'TIME']);

/** 数据类型（内置基础类型或用户自定义类型名）。 */
export type DataType = string;

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

/**
 * 隐式数值转换（用于表达式中的字面量折叠与运算结果推断）。
 * FX5 只有单精度 REAL；整数加宽在 INT(1字) / DINT(2字) 之间。
 */
export function widenType(a: string, b: string): string {
  const ta = baseTypeName(a);
  const tb = baseTypeName(b);
  if (ta === tb) return ta;
  if (FLOAT_TYPES.has(ta) || FLOAT_TYPES.has(tb)) {
    return 'REAL';
  }
  const wa = TYPE_WORD_WIDTH[ta] ?? 1;
  const wb = TYPE_WORD_WIDTH[tb] ?? 1;
  const w = Math.max(wa, wb);
  const signed = SIGNED_INT_TYPES.has(ta) || SIGNED_INT_TYPES.has(tb);
  const map: Record<number, string> = signed
    ? { 1: 'INT', 2: 'DINT' }
    : { 1: 'WORD', 2: 'DWORD' };
  return map[w] ?? (signed ? 'DINT' : 'DWORD');
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
