/**
 * ST 模板库公共工具：IO 选取、参数取值、字面量格式化、PROGRAM 渲染。
 *
 * 约束（见 docs/整体方案.md 的模板约定）：
 * - IO 只使用 spec.io 里给出的 X/Y/D 等设备；缺失时退回到安全默认地址（X0/Y0/D100…）。
 * - 内部变量统一 `bXxx` / `nXxx` / `tXxx` / `fXxx` 前缀，注释用中文行注释 `//`。
 * - 不使用块注释 `(* *)`：recovery 的顶层切分按 ASCII 括号计深度，注释里的括号会干扰切分。
 */

import type { TemplateContext } from './types.ts';

export interface IoItem {
  device: string;
  name: string;
  type: string;
  comment?: string;
}

const DEVICE_RE = /^([A-Za-z]+)([0-9]+)$/;

/** 取设备前缀（X/Y/D/M…），非法返回 ''。 */
export function devicePrefix(device: string): string {
  const m = DEVICE_RE.exec((device ?? '').trim());
  return m ? m[1]!.toUpperCase() : '';
}

/** 取设备编号，非法返回 -1。 */
export function deviceNumber(device: string): number {
  const m = DEVICE_RE.exec((device ?? '').trim());
  return m ? Number(m[2]) : -1;
}

/** spec.io 列表（容错为空数组）。 */
export function ioList(ctx: TemplateContext): IoItem[] {
  return ctx.spec?.io ?? [];
}

/**
 * 按前缀取第 index 个 IO 设备；不存在时用 fallback。
 * 例：pickDevice(ctx, 'X', 0, 'X0') → spec.io 中第一个 X 设备。
 */
export function pickDevice(ctx: TemplateContext, prefix: string, index: number, fallback: string): string {
  const want = prefix.toUpperCase();
  const list = ioList(ctx).filter(
    (i) => devicePrefix(i.device) === want && deviceNumber(i.device) >= 0,
  );
  return list[index]?.device ?? fallback;
}

/** 取第 index 个 IO 项（含 name/comment），用于生成注释。 */
export function pickIo(ctx: TemplateContext, prefix: string, index: number, fallback: string): IoItem {
  const want = prefix.toUpperCase();
  const list = ioList(ctx).filter(
    (i) => devicePrefix(i.device) === want && deviceNumber(i.device) >= 0,
  );
  return list[index] ?? { device: fallback, name: '', type: makeDefaultType(prefix) };
}

function makeDefaultType(prefix: string): string {
  return /^[XYM]$/i.test(prefix) ? 'BOOL' : 'INT';
}

/** IO 注释：优先用 spec.io 的 name/comment，缺省用给定角色说明。 */
export function ioComment(ctx: TemplateContext, prefix: string, index: number, fallback: string, role: string): string {
  const item = pickIo(ctx, prefix, index, fallback);
  const detail = [item.name, item.comment].filter((s) => s && s.trim()).join('，');
  return detail ? `${role}：${detail}` : role;
}

/* ------------------------------------------------------------------ */
/* 参数取值                                                           */
/* ------------------------------------------------------------------ */

export function numParam(ctx: TemplateContext, name: string, fallback: number): number {
  const v = ctx.params?.[name];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return fallback;
}

export function boolParam(ctx: TemplateContext, name: string, fallback: boolean): boolean {
  const v = ctx.params?.[name];
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(s)) return true;
    if (['false', '0', 'no', 'off'].includes(s)) return false;
  }
  if (typeof v === 'number') return v !== 0;
  return fallback;
}

export function strParam(ctx: TemplateContext, name: string, fallback: string): string {
  const v = ctx.params?.[name];
  if (v === undefined || v === null) return fallback;
  return String(v).trim() || fallback;
}

/* ------------------------------------------------------------------ */
/* 字面量格式化                                                       */
/* ------------------------------------------------------------------ */

/** 秒 → 三菱 TIME 字面量（统一用 ms，避免小数秒在 GX Works3 的兼容问题）。 */
export function timeLiteral(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `T#${ms}ms`;
}

/** 整数参数 → ST 十进制字面量。 */
export function intLiteral(n: number): string {
  return String(Math.trunc(Number.isFinite(n) ? n : 0));
}

/** 数值参数 → REAL 字面量（保证带小数点，避免被推断成 INT）。 */
export function realLiteral(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return Number.isInteger(v) ? `${v.toFixed(1)}` : String(v);
}

/** 把字符串按 4 空格整体缩进（用于拼接 body 片段）。 */
export function indent4(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : `    ${line}`))
    .join('\n');
}

/* ------------------------------------------------------------------ */
/* PROGRAM 渲染                                                       */
/* ------------------------------------------------------------------ */

export interface LocalDecl {
  /** 不带缩进/分号的声明文本，如 `bRun : BOOL := FALSE;` */
  line: string;
  comment?: string;
}

export interface ProgramRenderOptions {
  programName?: string;
  /** 头部注释块（每行一个字符串，不带 `//`） */
  header: string[];
  vars: LocalDecl[];
  /** 已带 4 空格缩进的正文；多行原样 */
  body: string;
}

/** 渲染一个自包含的 PROGRAM（含中文头部注释与本地 VAR 块）。 */
export function renderProgram(options: ProgramRenderOptions): string {
  const name = options.programName ?? 'Main';
  const lines: string[] = [];
  lines.push('// ============================================================');
  for (const h of options.header) lines.push(`// ${h}`);
  lines.push('// ============================================================');
  lines.push('');
  lines.push(`PROGRAM ${name}`);
  lines.push('VAR');
  for (const v of options.vars) {
    const decl = `    ${v.line}`;
    lines.push(v.comment ? `${decl.padEnd(44)}// ${v.comment}`.replace(/\s+$/, '') : decl);
  }
  lines.push('END_VAR');
  const body = options.body.replace(/\s+$/, '');
  if (body.length > 0) {
    lines.push(indent4(body));
  }
  lines.push('END_PROGRAM');
  return lines.join('\n') + '\n';
}

/** 模板通用头部第一行。 */
export function headerFor(templateName: string, templateDesc: string, ctx: TemplateContext, paramSummary: string[]): string[] {
  const lines = [
    `模板：${templateName}`,
    `说明：${templateDesc}`,
    `规格：${ctx.spec?.name ?? '(未命名)'}（CPU ${ctx.spec?.cpu?.series ?? 'FX5U'}）`,
  ];
  if (paramSummary.length > 0) lines.push(`参数：${paramSummary.join('，')}`);
  return lines;
}
