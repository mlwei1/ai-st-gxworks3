/**
 * GX Works3 ST 文本导出格式生成器。
 *
 * 背景（实测 + 官方文档确认）：
 *   GX Works3 强制使用「结构化工程」模式，**变量声明与 ST 本体是分离的**。
 *   - 局部标签在「标签设置」工作表
 *   - ST 代码在「程序本体」工作表
 *   - 官方不提供把 VAR 段写进 ST 本体的语法（不同于 CODESYS）
 *
 *   GX Works3 提供了「导出至文件 → 在外围添加声明/注解」选项，
 *   用于把声明包在 ST 外面。其文本形态为：
 *
 *       //!DECLARE
 *       VAR
 *           nCount : INT := 0;   // 注释
 *       END_VAR
 *       //!END_DECLARE
 *       nCount := nCount + 1;
 *
 *   本模块按此格式生成可直接粘贴进「程序本体」编辑器的 ST 文本。
 *
 * 变量声明部分同时以**注释形式**保留在正文顶部，
 * 便于人工核对（AI 生成的代码必须可审查）。
 */

import {
  type AST,
  type POU,
  type Statement,
  type VarDeclaration,
} from '../dialect/ast.ts';
import { unparse } from '../emit/unparser.ts';

const INDENT = '    ';

/** 声明块起始标记。 */
export const DECLARE_START = '//!DECLARE';
/** 声明块结束标记。 */
export const DECLARE_END = '//!END_DECLARE';

/** 变量声明的文本形态（VAR 段）。 */
export interface VarBlock {
  /** VAR 段名，如 VAR / VAR_INPUT / VAR_OUTPUT / VAR_IN_OUT */
  section: string;
  /** 该段内的变量 */
  vars: VarDeclaration[];
}

/**
 * 变量声明行。
 *
 * ST 语法要求声明以分号结尾（`bEnable : BOOL;`），
 * 漏掉分号会导致整段解析失败。
 */
function renderDecl(v: VarDeclaration): string {
  let line = `${v.name} : ${v.typeName}`;
  if (v.arrayRange) {
    line += ` ARRAY[${v.arrayRange.from}..${v.arrayRange.to}]`;
  }
  if (v.address) line += ` AT ${v.address}`;
  if (v.retain) line += ' RETAIN';
  if (v.constant) line += ' CONSTANT';
  if (v.initialValue) {
    line += ` := ${unparseExpr(v.initialValue)}`;
  }
  line += ';';
  if (v.comment) line += ` // ${v.comment}`;
  return line;
}

/** 表达式转文本（用于初始值）。 */
function unparseExpr(expr: unknown): string {
  const stmts: Statement[] = [
    { kind: 'assignStmt', target: expr as never, value: expr as never, loc: { line: 0, column: 0, start: 0, end: 0 } },
  ];
  const text = unparse(stmts);
  return text.replace(/^.*:=\s*/, '').replace(/;\s*$/, '').trim();
}

/**
 * 生成单个 POU 的「程序本体」文本 —— 直接粘贴进 GX Works3 的「程序本体」工作表。
 *
 * **注意**：这里不含 VAR 声明段。
 * GX Works3 强制结构化工程模式，变量声明必须建在「标签设置」工作表，
 * 不能像 CODESYS 那样写在文本里。声明内容请对照 local_labels_table.txt 手工建立。
 *
 * @param pou  POU 定义
 * @param options.includeComments 是否在顶部附上声明速查注释（便于人工核对）
 */
export function renderPOUAsText(
  pou: POU,
  options: { includeComments?: boolean } = {},
): string {
  const out: string[] = [];

  // 顶部注释：列出本 POU 需要在「标签设置」中建立的局部标签
  if (options.includeComments !== false) {
    const vars = pou.vars.filter((v) => v.section !== 'VAR_GLOBAL');
    if (vars.length > 0) {
      out.push('(* ---------- 本 POU 需在「标签设置」工作表建立的局部标签 ----------');
      for (const v of vars) {
        const scope =
          v.section === 'VAR_INPUT'
            ? '输入'
            : v.section === 'VAR_OUTPUT'
              ? '输出'
              : v.section === 'VAR_IN_OUT'
                ? '输入输出'
                : '局部';
        const init = v.initialValue ? ` := ${unparseExpr(v.initialValue)}` : '';
        const c = v.comment ? `  // ${v.comment}` : '';
        out.push(`   ${scope.padEnd(4)} ${v.name} : ${v.typeName}${init}${c}`);
      }
      out.push('(* ----------------------------------------------------------- *)');
      out.push('');
    }
  }

  // 本体
  const body = unparse(pou.body);
  if (body.trim().length > 0) {
    out.push(body);
  }

  return out.join('\n');
}

/**
 * 生成单个 POU 的「声明块」文本 —— 用于对照「标签设置」工作表手工录入，
 * 或作为工具自身的解析输入（//!DECLARE … //!END_DECLARE 包裹）。
 */
export function renderPOUDeclarations(pou: POU): string {
  const out: string[] = [];
  const order = ['VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT', 'VAR', 'VAR_TEMP'];
  const blocks: VarBlock[] = [];
  for (const section of order) {
    const vars = pou.vars.filter((v) => v.section === section);
    if (vars.length > 0) blocks.push({ section, vars });
  }
  if (blocks.length === 0) return '';

  out.push(DECLARE_START);
  for (const b of blocks) {
    out.push(b.section);
    for (const v of b.vars) {
      out.push(`${INDENT}${renderDecl(v)}`);
    }
    out.push('END_VAR');
  }
  out.push(DECLARE_END);
  return out.join('\n');
}

/**
 * 生成整个工程的 ST 文本（每个 POU 一段，用分隔线隔开）。
 *
 * 分隔线用 GX Works3 注释语法，便于工程师逐段粘贴。
 */
export function renderProjectAsText(ast: AST, options: { includeDeclareBlock?: boolean } = {}): string {
  const out: string[] = [];
  for (const pou of ast.pous) {
    const kind =
      pou.pouType === 'program'
        ? '程序'
        : pou.pouType === 'functionBlock'
          ? '功能块'
          : '函数';
    out.push('(* ============================================================');
    out.push(`   ${kind}：${pou.name}`);
    if (pou.comment) out.push(`   ${pou.comment}`);
    out.push('   ============================================================ *)');
    out.push('');
    out.push(renderPOUAsText(pou, options));
    out.push('');
  }
  return out.join('\n');
}

/**
 * 生成「变量声明速查表」——供人工核对用。
 *
 * GX Works3 的标签表在「标签设置」工作表单独维护，
 * 粘贴 ST 前需要先在那边建好对应标签，因此这张表不能省。
 */
export function renderVarSheetTable(ast: AST): string {
  const out: string[] = [];
  const rows: string[] = [];

  for (const pou of ast.pous) {
    for (const v of pou.vars) {
      const scope = v.section === 'VAR_INPUT' ? '输入' : v.section === 'VAR_OUTPUT' ? '输出' : '局部';
      const init = v.initialValue ? unparseExpr(v.initialValue) : '';
      rows.push(
        [pou.name, v.name, v.typeName, scope, v.address ?? '', init, v.comment ?? '']
          .map((x) => String(x))
          .join('\t'),
      );
    }
  }

  out.push('(* 需要在「标签设置」工作表中创建/确认的局部标签：');
  out.push('   POU名\t标签名\t类型\t方向\t软元件\t初始值\t注释');
  for (const r of rows) out.push(`   ${r}`);
  out.push('*)');
  return out.join('\n');
}

/**
 * 生成全局标签导入用 CSV。
 *
 * GX Works3 支持通过 CSV 批量导入全局标签，列格式为：
 *   名称,数据类型,软元件号,注释
 * 编码用 UTF-8（带 BOM 可确保 Excel 正确识别中文）。
 */
export function renderGlobalLabelCSV(
  globals: { name: string; typeName: string; address?: string; comment?: string }[],
): string {
  const rows: string[] = ['名称,数据类型,软元件号,注释'];
  for (const g of globals) {
    rows.push(
      [
        g.name,
        g.typeName,
        g.address ?? '',
        (g.comment ?? '').replace(/,/g, '，'),
      ].join(','),
    );
  }
  // 加 BOM，保证 Excel 打开中文不乱码
  return '﻿' + rows.join('\r\n') + '\r\n';
}

/**
 * 生成「局部标签录入表」。
 *
 * GX Works3 的局部标签在「标签设置」工作表单独维护，
 * 无法通过粘贴 ST 文本自动创建。这份表供工程师逐行录入。
 */
export function renderLocalLabelTable(pou: POU): string {
  const vars = pou.vars.filter((v) => v.section !== 'VAR_GLOBAL');
  if (vars.length === 0) return '';
  const out: string[] = [];
  out.push(`(* ${pou.name} —— 在「标签设置」工作表按此表逐行录入`);
  out.push('   方向    标签名              数据类型   初始值   软元件     注释');
  for (const v of vars) {
    const scope =
      v.section === 'VAR_INPUT'
        ? '输入'
        : v.section === 'VAR_OUTPUT'
          ? '输出'
          : v.section === 'VAR_IN_OUT'
            ? '输入输出'
            : '局部';
    const init = v.initialValue ? unparseExpr(v.initialValue) : '';
    out.push(
      `   ${scope.padEnd(6)} ${v.name.padEnd(20)} ${v.typeName.padEnd(10)} ${init.padEnd(8)} ${(v.address ?? '').padEnd(10)} ${v.comment ?? ''}`,
    );
  }
  out.push('*)');
  return out.join('\n');
}
