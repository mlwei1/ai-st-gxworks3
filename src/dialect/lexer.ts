/**
 * GX Works3 ST 语言的词法分析器。
 *
 * 方言要点：
 *  - 注释两种：`//` 行注释 与 `(* ... *)` 块注释（IEC 风格）
 *  - 数值字面量前缀：K(十进制) H(十六进制) B(二进制) D(十进制字) 8#/16#
 *  - 字符串用单引号 `'...'`（STRING），双引号 `"..."`（WSTRING）
 *  - 时间字面量 `T#1s500ms`
 *  - 标识符区分大小写，允许下划线
 */

export type TokenType =
  | 'identifier'
  | 'keyword'
  | 'number'
  | 'string'
  | 'time'
  | 'wstring'
  | 'operator'
  | 'eof';

export interface Token {
  type: TokenType;
  value: string;
  /** 在源文本中的起始偏移 */
  start: number;
  /** 在源文本中的结束偏移（不含） */
  end: number;
  /** 行列信息，1 基 */
  line: number;
  column: number;
}

export class LexError extends Error {
  readonly line: number;
  readonly column: number;

  constructor(message: string, line: number, column: number) {
    super(`${message} (第 ${line} 行, 第 ${column} 列)`);
    this.name = 'LexError';
    this.line = line;
    this.column = column;
  }
}

/**
 * 运算符表，按长度降序匹配（保证 `>=` 优先于 `>`，`=>` 优先于 `=`）。
 *
 * `=>` 用于功能块调用的输出参数：fbTimer(IN := TRUE, PT := T#1s, Q => bDone);
 */
const OPERATORS = [
  ':=', '=>',
  '<=', '>=', '<>', '**', '..',
  '+', '-', '*', '/', '=', '<', '>',
  '(', ')', '[', ']', ',', ';', ':', '.', '^', '#', '$', '?', '&',
];

/** ST 关键字（全部按小写匹配，GX Works3 关键字不区分大小写但标识符区分）。 */
const KEYWORDS = new Set([
  'program', 'end_program', 'function', 'end_function', 'function_block', 'end_function_block',
  'type', 'end_type', 'struct', 'end_struct',
  'var', 'end_var', 'var_input', 'var_output', 'var_in_out', 'var_temp',
  'var_global', 'var_external', 'var_access', 'var_config', 'var_inst',
  'if', 'then', 'else', 'elsif', 'end_if',
  'case', 'of', 'end_case',
  'for', 'to', 'by', 'do', 'end_for',
  'while', 'end_while', 'repeat', 'until', 'end_repeat',
  'exit', 'return', 'continue',
  'and', 'or', 'xor', 'not', 'mod',
  'true', 'false', 'null',
  'this', 'constant', 'retain', 'non_retain', 'persistent', 'at', 'ref_to', 'ref',
]);

/**
 * 判断标识符起始处是否为「时间字面量」T#。
 * 需后跟数字，否则 T 是普通标识符。
 */
function isTimeLiteralStart(src: string, i: number): boolean {
  if (src[i] !== 'T' && src[i] !== 't') return false;
  if (src[i + 1] !== '#') return false;
  return i + 2 < src.length && /[0-9]/.test(src[i + 2]);
}

export function tokenize(src: string): Token[] {
  // 容忍 Windows 编辑器常见的 UTF-8 BOM（否则首字符被报“无法识别”）
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const n = src.length;

  const col = (pos: number) => pos - lineStart + 1;
  const push = (type: TokenType, value: string, start: number) => {
    tokens.push({ type, value, start, end: i, line, column: col(start) });
  };

  while (i < n) {
    const ch = src[i];

    // 空白
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\n') {
      i++;
      line++;
      lineStart = i;
      continue;
    }

    // 注释
    if (ch === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '(' && src[i + 1] === '*') {
      const start = i;
      const startLine = line;
      const startCol = col(start);
      i += 2;
      let depth = 1;
      while (i < n && depth > 0) {
        if (src[i] === '(' && src[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (src[i] === '*' && src[i + 1] === ')') {
          depth--;
          i += 2;
        } else {
          if (src[i] === '\n') {
            line++;
            lineStart = i + 1;
          }
          i++;
        }
      }
      if (depth > 0) {
        throw new LexError('块注释未闭合（缺少 */）', startLine, startCol);
      }
      continue;
    }
    // C 风格块注释 /* ... */：GX Works3 手册明确支持 "/**/" 与 "//" 两种注释
    // （MELSEC iQ-R/MELSEC iQ-F 结构化文本(ST)编程指南 SH-081465CHN，p13/注释约定）。
    if (ch === '/' && src[i + 1] === '*') {
      const startLine = line;
      const startCol = col(i);
      i += 2;
      let closed = false;
      while (i < n) {
        if (src[i] === '*' && src[i + 1] === '/') {
          i += 2;
          closed = true;
          break;
        }
        if (src[i] === '\n') {
          line++;
          lineStart = i + 1;
        }
        i++;
      }
      if (!closed) {
        throw new LexError('块注释未闭合（缺少 */）', startLine, startCol);
      }
      continue;
    }

    // 字符串
    if (ch === "'") {
      const start = i;
      const startLine = line;
      const startCol = col(start);
      i++;
      let value = '';
      let closed = false;
      while (i < n) {
        if (src[i] === "'") {
          if (src[i + 1] === "'") {
            value += "'";
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        if (src[i] === '\n') {
          line++;
          lineStart = i + 1;
        }
        value += src[i];
        i++;
      }
      if (!closed) throw new LexError('字符串未闭合', startLine, startCol);
      push('string', value, start);
      continue;
    }
    if (ch === '"') {
      const start = i;
      const startLine = line;
      const startCol = col(start);
      i++;
      let value = '';
      let closed = false;
      while (i < n) {
        if (src[i] === '"') {
          i++;
          closed = true;
          break;
        }
        if (src[i] === '\n') {
          line++;
          lineStart = i + 1;
        }
        value += src[i];
        i++;
      }
      if (!closed) throw new LexError('宽字符串未闭合', startLine, startCol);
      push('wstring', value, start);
      continue;
    }

    // 时间字面量 T#1s500ms
    if (isTimeLiteralStart(src, i)) {
      const start = i;
      const startLine = line;
      const startCol = col(start);
      i += 2;
      while (i < n && /[0-9a-zA-Z_]/.test(src[i])) i++;
      push('time', src.slice(start, i), start);
      continue;
    }

    // 数字（含前缀形式）
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const start = i;
      const startLine = line;
      const startCol = col(start);
      // 进制前缀：16# 8# 2# 以及 K/H/D
      const prefixed = /^(16#|8#|2#|0x|0X)/.exec(src.slice(i));
      if (prefixed) {
        i += prefixed[0].length;
        while (i < n && /[0-9a-fA-F_]/.test(src[i])) i++;
        push('number', src.slice(start, i), start);
        continue;
      }
      // 浮点
      let isFloat = false;
      while (i < n && /[0-9_]/.test(src[i])) i++;
      if (src[i] === '.' && /[0-9]/.test(src[i + 1] ?? '')) {
        isFloat = true;
        i++;
        while (i < n && /[0-9_]/.test(src[i])) i++;
      }
      if ((src[i] === 'e' || src[i] === 'E') && /[0-9+-]/.test(src[i + 1] ?? '')) {
        isFloat = true;
        i++;
        if (src[i] === '+' || src[i] === '-') i++;
        while (i < n && /[0-9_]/.test(src[i])) i++;
      }
      let text = src.slice(start, i);
      // 带前缀的整数字面量 K/H/B/D
      if (!isFloat && /^[KHBDBD]/i.test(text)) {
        // 前缀已在数字循环中消耗，这里不成立（K 属于标识符分支）
      }
      push('number', text, start);
      continue;
    }

    // 标识符 / 关键字
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;

      // K/H 前缀的数值字面量（K=十进制, H=十六进制）。
      // 注意 B/D 不是字面量前缀：它们是三菱的链接继电器 / 数据寄存器软元件前缀，
      // 必须留给 parser 按设备地址解析，否则 D100 会被误判为字面量。
      const upperFirst = ch.toUpperCase();
      if (upperFirst === 'K' && /[0-9]/.test(src[i + 1] ?? '')) {
        i++;
        while (i < n && /[0-9_]/.test(src[i])) i++;
        push('number', src.slice(start, i), start);
        continue;
      }
      if (upperFirst === 'H' && /[0-9a-fA-F]/.test(src[i + 1] ?? '')) {
        i++;
        while (i < n && /[0-9a-fA-F_]/.test(src[i])) i++;
        push('number', src.slice(start, i), start);
        continue;
      }

      while (i < n && /[A-Za-z0-9_]/.test(src[i])) i++;
      const text = src.slice(start, i);
      push(KEYWORDS.has(text.toLowerCase()) ? 'keyword' : 'identifier', text, start);
      continue;
    }

    // 运算符
    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (op) {
      const start = i;
      i += op.length;
      push('operator', op, start);
      continue;
    }

    throw new LexError(`无法识别的字符 '${ch}'`, line, col(i));
  }

  tokens.push({ type: 'eof', value: '', start: i, end: i, line, column: col(i) });
  return tokens;
}
