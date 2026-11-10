/**
 * GX Works3 编译诊断回灌（M1 收尾）。
 *
 * 目标：把「全部转换（Rebuild All）」产生的 Error 列表变成结构化诊断，
 * 作为修复循环的初始反馈喂给生成器（LLM 兜底或人工修正），形成半自动闭环：
 *
 *   gen → 导入 GX Works3 → 全部转换 → 导出/整理错误列表（JSON 或纯文本）
 *       → `gen --llm --compiler-errors errors.json` → 重新生成 → 再次导入验证
 *
 * 为什么是半自动：GX Works3 没有公开的编译错误读取接口，错误列表需要从
 * Output 窗口人工/工具导出；本模块只负责“读取 + 结构化 + 回灌”，不假装能直连编译器。
 */

import type { CompilerErrorEntry } from './compiler-feedback-types.ts';
import type { DiagnosticLike } from './repair.ts';

export type { CompilerErrorEntry };

export interface ParsedCompilerErrors {
  entries: CompilerErrorEntry[];
  /** 解析过程中的问题（如某行无法识别）；不阻断已有条目的使用。 */
  diagnostics: DiagnosticLike[];
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v);
  return undefined;
}

function normalizeEntry(raw: unknown): CompilerErrorEntry | null {
  if (typeof raw === 'string') {
    return raw.trim() ? { message: raw.trim() } : null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const message = asString(o.message) ?? asString(o.content) ?? asString(o.text) ?? asString(o.error);
  if (!message) return null;
  const entry: CompilerErrorEntry = { message };
  const code = asString(o.code) ?? asString(o.errorCode);
  if (code) entry.code = code;
  const line = asNumber(o.line) ?? asNumber(o.lineNumber);
  if (line !== undefined) entry.line = line;
  const column = asNumber(o.column);
  if (column !== undefined) entry.column = column;
  const pou = asString(o.pou) ?? asString(o.program) ?? asString(o.dataName);
  if (pou) entry.pou = pou;
  return entry;
}

/** 从一段纯文本中提取行号/错误码/消息（GX Works3 Output 常见格式）。 */
function parseTextLine(line: string): CompilerErrorEntry | null {
  const text = line.trim();
  if (!text) return null;
  // 跳过表头/分隔/无信息行
  if (/^(No\.?|Result|Data Name|Category|Content|Error Code)$/i.test(text)) return null;
  if (/^No\.?\s+Result\b/i.test(text)) return null;
  if (/^-+$/.test(text)) return null;

  const entry: CompilerErrorEntry = { message: text };

  // 错误码：0x11021040 / C1200 / E009 等
  const code = text.match(/\b(0x[0-9A-Fa-f]{6,8}|[A-Z]{1,2}\d{3,5})\b/);
  if (code) entry.code = code[1];

  // 行号：第 12 行 / line 12 / :12:5
  const lineZh = text.match(/第\s*(\d+)\s*行/);
  const lineEn = text.match(/\bline\s*(\d+)\b/i);
  const lineColon = text.match(/:(\d+):(\d+)\b/);
  if (lineZh) entry.line = Number(lineZh[1]);
  else if (lineEn) entry.line = Number(lineEn[1]);
  else if (lineColon) {
    entry.line = Number(lineColon[1]);
    entry.column = Number(lineColon[2]);
  }

  // POU：形如 [Main] / Program Main / POU: Main / 表格列 "Error   Main ..."
  const pou =
    text.match(/\[\s*([A-Za-z_][\w]*)\s*\]/) ??
    text.match(/\b(?:pou|program)\s*[:：]?\s*([A-Za-z_][\w]*)/i) ??
    text.match(/\bError\s{2,}([A-Za-z_][\w]*)/i);
  if (pou) entry.pou = pou[1];

  return entry;
}

/**
 * 解析编译错误输入：
 *  - JSON：数组，或 `{ errors: [...] }` / `{ compilerErrors: [...] }`
 *  - 纯文本：按行解析（GX Works3 Output 文本/人工整理）
 */
export function parseCompilerErrors(input: string | unknown): ParsedCompilerErrors {
  const entries: CompilerErrorEntry[] = [];
  const diagnostics: DiagnosticLike[] = [];

  let value: unknown = input;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return { entries, diagnostics };
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        value = JSON.parse(trimmed);
      } catch (e) {
        diagnostics.push({
          severity: 'warning',
          code: 'CFB_W_JSON',
          message: `输入看起来是 JSON 但解析失败，按纯文本处理：${e instanceof Error ? e.message : String(e)}`,
        });
        value = trimmed;
      }
    }
  }

  if (Array.isArray(value)) {
    for (const raw of value) {
      const entry = normalizeEntry(raw);
      if (entry) entries.push(entry);
      else diagnostics.push({ severity: 'warning', code: 'CFB_W_ENTRY', message: `无法识别的错误条目：${JSON.stringify(raw)}` });
    }
    return { entries, diagnostics };
  }

  if (value && typeof value === 'object') {
    const holder = value as Record<string, unknown>;
    const list = Array.isArray(holder.errors)
      ? holder.errors
      : Array.isArray(holder.compilerErrors)
        ? holder.compilerErrors
        : undefined;
    if (list) {
      for (const raw of list) {
        const entry = normalizeEntry(raw);
        if (entry) entries.push(entry);
        else diagnostics.push({ severity: 'warning', code: 'CFB_W_ENTRY', message: `无法识别的错误条目：${JSON.stringify(raw)}` });
      }
      return { entries, diagnostics };
    }
    diagnostics.push({
      severity: 'warning',
      code: 'CFB_W_SHAPE',
      message: 'JSON 对象未找到 errors/compilerErrors 数组，按纯文本处理',
    });
    value = JSON.stringify(value);
  }

  for (const line of String(value).split(/\r?\n/)) {
    const entry = parseTextLine(line);
    if (entry) entries.push(entry);
  }
  return { entries, diagnostics };
}

/** 把错误条目格式化为修复循环可用的反馈文本。 */
export function formatCompilerFeedback(entries: CompilerErrorEntry[]): string {
  if (entries.length === 0) return '';
  const lines = ['【GX Works3 全部转换错误】'];
  for (const e of entries) {
    const loc = e.line != null ? `:${e.line}${e.column != null ? `:${e.column}` : ''}` : '';
    const code = e.code ? ` ${e.code}` : '';
    const pou = e.pou ? ` [${e.pou}]` : '';
    lines.push(`- ERROR${code}${loc}${pou} ${e.message}`);
  }
  lines.push('请只修正与上述错误相关的代码，不要改变已经正确的逻辑。');
  return lines.join('\n');
}

/** 把编译错误条目转成统一诊断结构（用于 manifest/CLI 汇总）。 */
export function compilerErrorsToDiagnostics(entries: CompilerErrorEntry[]): DiagnosticLike[] {
  return entries.map((e) => {
    const d: DiagnosticLike = {
      severity: 'error',
      code: e.code ? `GXW3_${e.code}` : 'GXW3_E',
      message: e.message,
    };
    if (e.line != null) d.line = e.line;
    if (e.column != null) d.column = e.column;
    if (e.pou) d.pou = e.pou;
    return d;
  });
}
