/**
 * 带错误恢复的解析入口。
 *
 * 纯语法解析在遇到第一个错误就抛异常，这对「检查器」工具不友好：
 * 一个笔误会导致后面所有问题都看不到。
 *
 * 本模块做两级恢复：
 *  1. POU 级 —— 某个 POU 语法错误不影响其他 POU 被检查
 *  2. 语句级 —— POU 内部出错时，跳过错误语句继续解析该 POU 的剩余部分
 *
 * 这样一次运行就能看到文件里的全部问题。
 */

import { type AST } from './ast.ts';
import { ParseError, Parser } from './parser.ts';

export interface RecoveryResult {
  ast: AST;
  /** 语法错误列表。 */
  errors: { message: string; line: number; column: number }[];
}

/**
 * 逐段解析源码，收集全部语法错误。
 *
 * @param src ST 源码
 */
export function parseWithRecovery(src: string): RecoveryResult {
  const errors: RecoveryResult['errors'] = [];
  const ast: AST = { pous: [], globalVars: [], types: [] };
  const seen = new Set<string>();

  const record = (message: string, line: number, column: number) => {
    // 同一位置重复报错只保留一条，避免恢复过程刷屏
    const key = `${line}:${column}:${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    errors.push({ message, line, column });
  };

  for (const seg of splitTopLevel(src)) {
    const parser = new Parser(seg.text);
    let guard = 0;

    for (;;) {
      if (guard++ > 1000) break; // 防止无限循环
      if (parser.atEnd()) break;

      const before = parser.tokenIndex();
      try {
        parser.parseOneTopLevel();
        const part = parser.takeParsed();
        ast.pous.push(...part.pous);
        ast.globalVars.push(...part.globalVars);
        ast.types.push(...part.types);
        // 语句级恢复的错误（POU 内部某语句出错，不影响 POU 其余部分）
        for (const e of parser.takeRecoveryErrors()) {
          record(e.message, e.line, e.column);
        }
        if (parser.tokenIndex() === before) break; // 无进展，避免死循环
      } catch (e) {
        if (e instanceof ParseError) {
          record(e.message, e.line, e.column);
        } else {
          record(e instanceof Error ? e.message : String(e), 0, 0);
        }
        for (const e2 of parser.takeRecoveryErrors()) {
          record(e2.message, e2.line, e2.column);
        }
        // 跳到下一个语句边界后继续
        if (!parser.skipToRecoveryPoint()) break;
      }
    }
  }

  return { ast, errors };
}

/**
 * 按顶层声明切分源码。
 *
 * 切分点：PROGRAM / FUNCTION_BLOCK / FUNCTION / TYPE / VAR_GLOBAL 关键字开头，
 * 且处于顶层（括号深度为 0）。
 */
function splitTopLevel(src: string): { text: string; startLine: number }[] {
  const lines = src.split('\n');
  const segments: { text: string; startLine: number }[] = [];
  let current: string[] = [];
  let currentStart = 1;
  let depth = 0;

  const topLevelKeywords = /^\s*(PROGRAM|FUNCTION_BLOCK|FUNCTION|TYPE|VAR_GLOBAL)\b/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isTopLevelStart = depth === 0 && topLevelKeywords.test(line);

    if (isTopLevelStart && current.length > 0) {
      segments.push({ text: current.join('\n'), startLine: currentStart });
      current = [];
    }
    if (current.length === 0) currentStart = i + 1;

    current.push(line);

    for (const ch of line) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    if (depth < 0) depth = 0;
  }

  if (current.length > 0) {
    segments.push({ text: current.join('\n'), startLine: currentStart });
  }

  return segments;
}
