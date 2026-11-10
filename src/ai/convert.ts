/**
 * AI 输出（JSON）→ ST 源码 / AST 的转换层。
 *
 * 职责：把模型返回的 JSON 结构还原成 GX Works3 能编译的 ST 代码，
 * 并把模型可能的字段遗漏 / 格式错误挡在这里。
 */

import { type AST, type GlobalVarDeclaration, type POU, type TypeDeclaration, type VarDeclaration } from '../dialect/ast.ts';
import { parseWithRecovery } from '../dialect/recovery.ts';
import { unparsePOU } from '../emit/unparser.ts';

/** AI 返回的 JSON 结构。 */
export interface AIGeneratedProject {
  pous?: AIPOU[];
  types?: AIType[];
  globalVars?: AIGlobalVar[];
}

export interface AIPOU {
  pouType?: string;
  name?: string;
  returnType?: string;
  comment?: string;
  vars?: AIVar[];
  body?: string;
}

export interface AIVar {
  name?: string;
  typeName?: string;
  section?: string;
  initialValue?: string;
  address?: string;
  comment?: string;
}

export interface AIType {
  name?: string;
  members?: { name?: string; typeName?: string; comment?: string }[];
}

export interface AIGlobalVar {
  name?: string;
  typeName?: string;
  address?: string;
  comment?: string;
}

export interface ConversionResult {
  /** 还原后的 ST 源码（每个 POU 独立）。 */
  stSources: { name: string; source: string }[];
  /** 合并后的 ST 源码，可直接保存为 .st 文件。 */
  combined: string;
  /** 解析后的 AST。 */
  ast: AST;
  /** 转换过程中的告警。 */
  warnings: string[];
}

const SECTION_MAP: Record<string, VarDeclaration['section']> = {
  VAR: 'VAR',
  VAR_INPUT: 'VAR_INPUT',
  VAR_OUTPUT: 'VAR_OUTPUT',
  VAR_IN_OUT: 'VAR_IN_OUT',
  VAR_TEMP: 'VAR_TEMP',
  VAR_GLOBAL: 'VAR_GLOBAL',
  VAR_EXTERNAL: 'VAR_EXTERNAL',
};

/**
 * 把 AI 生成的 JSON 转为 ST 源码与 AST。
 *
 * 关键设计：AI 只提供「变量声明 + body 文本」，POU 外壳由本函数统一拼装，
 * 这样模型无法破坏 POU 结构；body 文本则交由真实解析器校验。
 */
export function convertAIGenerated(project: AIGeneratedProject): ConversionResult {
  const warnings: string[] = [];
  const stSources: { name: string; source: string }[] = [];

  /* ---------- 类型声明 ---------- */
  const typeBlocks: string[] = [];
  for (const t of project.types ?? []) {
    if (!t.name) continue;
    const members = (t.members ?? [])
      .filter((m) => m.name && m.typeName)
      .map((m) => {
        const c = m.comment ? ` // ${m.comment}` : '';
        return `    ${m.name} : ${m.typeName};${c}`;
      });
    if (members.length === 0) {
      warnings.push(`结构体 '${t.name}' 没有有效成员，已跳过`);
      continue;
    }
    typeBlocks.push(
      [`TYPE ${t.name}:`, 'STRUCT', ...members, 'END_STRUCT', 'END_TYPE'].join('\n'),
    );
  }

  /* ---------- 全局变量 ---------- */
  const globalBlock: string[] = [];
  for (const g of project.globalVars ?? []) {
    if (!g.name || !g.typeName) continue;
    const addr = g.address ? ` AT ${g.address}` : '';
    // 先补分号，再追加注释 —— 注释必须在分号之后
    let line = `    ${g.name} : ${g.typeName}${addr};`;
    if (g.comment) line += ` // ${g.comment}`;
    globalBlock.push(line);
  }

  /* ---------- POU ---------- */

  for (const p of project.pous ?? []) {
    if (!p.name) {
      warnings.push('存在缺少 name 的 POU，已跳过');
      continue;
    }
    const pouType =
      p.pouType === 'functionBlock' || p.pouType === 'function' ? p.pouType : 'program';

    // 变量声明
    const varLines: string[] = [];
    const sections: { section: VarDeclaration['section']; lines: string[] }[] = [];
    for (const v of p.vars ?? []) {
      if (!v.name || !v.typeName) {
        warnings.push(`POU '${p.name}' 中存在缺少 name/typeName 的变量，已跳过`);
        continue;
      }
      const section = SECTION_MAP[(v.section ?? 'VAR').toUpperCase()] ?? 'VAR';
      let line = `    ${v.name} : ${v.typeName}`;
      if (v.address) line += ` AT ${v.address}`;
      if (v.initialValue) line += ` := ${v.initialValue}`;
      // 先补分号，再追加注释 —— 注释必须在分号之后，否则会破坏语法
      line += ';';
      if (v.comment) line += ` // ${v.comment}`;

      let bucket = sections.find((s) => s.section === section);
      if (!bucket) {
        bucket = { section, lines: [] };
        sections.push(bucket);
      }
      bucket.lines.push(line);
    }

    for (const sec of sections) {
      varLines.push(sec.section);
      varLines.push(...sec.lines);
      varLines.push('END_VAR');
    }

    const body = (p.body ?? '').trim();

    // 拼装完整 POU 源码
    const header =
      pouType === 'program'
        ? `PROGRAM ${p.name}`
        : pouType === 'functionBlock'
          ? `FUNCTION_BLOCK ${p.name}`
          : `FUNCTION ${p.name}${p.returnType ? ` : ${p.returnType}` : ''}`;
    const footer =
      pouType === 'program'
        ? 'END_PROGRAM'
        : pouType === 'functionBlock'
          ? 'END_FUNCTION_BLOCK'
          : 'END_FUNCTION';

    const source = [
      header,
      ...varLines,
      body,
      footer,
    ]
      .filter((l) => l !== '')
      .join('\n');

    stSources.push({ name: p.name, source });
  }

  // 合并后的完整源码
  const combined = [
    ...typeBlocks,
    ...(globalBlock.length > 0 ? ['VAR_GLOBAL', ...globalBlock, 'END_VAR'] : []),
    ...stSources.map((s) => s.source),
  ].join('\n\n');

  // 对**合并后的完整源码**统一解析。
  // 逐个 POU 单独解析会导致 VAR_GLOBAL 与 TYPE 不在作用域内，
  // 从而把合法的全局变量引用误报为「未定义」。
  const { ast: parsedAst, errors } = parseWithRecovery(combined);
  for (const e of errors) {
    warnings.push(`第 ${e.line} 行语法错误：${e.message}`);
  }

  // 回填 POU 注释
  for (const pou of parsedAst.pous) {
    const meta = project.pous?.find((p) => p.name === pou.name);
    if (meta?.comment) pou.comment = meta.comment;
  }

  return { stSources, combined, ast: parsedAst, warnings };
}

/**
 * 把 AI 生成的 JSON 转成可直接喂给解析器的完整 ST 文本。
 */
export function aiProjectToST(project: AIGeneratedProject): string {
  return convertAIGenerated(project).combined;
}
