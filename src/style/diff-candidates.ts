/**
 * 从「AI 生成 ST」与「用户修改后 ST」的差异中提取编程习惯候选规则。
 *
 * v0 能提取：
 * - 全局标签改名（按软元件地址配对）→ label-rename；
 * - 新增全局标签 → label-added；
 * - 局部变量/FB 形参改名（按 POU + 变量段 + 序号/类型配对）→ local-rename / param-rename；
 * - 标签语言推断（中文/英文）→ language；
 * - 命名前缀推断（b/n/t/x…）→ naming-prefix；
 * - 正文行级修改统计 → body-edit（低置信，供人工判断）。
 *
 * 输出只是“候选”，需要人工/后续流程确认后才写入 profiles/。
 */

import type { AST, POU, VarDeclaration } from '../dialect/ast.ts';
import { parseWithRecovery } from '../dialect/recovery.ts';

export type CandidateKind =
  | 'label-rename'
  | 'label-added'
  | 'local-rename'
  | 'param-rename'
  | 'language'
  | 'naming-prefix'
  | 'body-edit';

export type CandidateConfidence = 'high' | 'medium' | 'low';

export interface StyleCandidate {
  kind: CandidateKind;
  confidence: CandidateConfidence;
  message: string;
  before?: string;
  after?: string;
  /** 作用域：global / POU 名 / 段名。 */
  scope?: string;
}

export interface CandidateReport {
  ok: boolean;
  generated: { lines: number; globalVars: number; pous: number };
  actual: { lines: number; globalVars: number; pous: number };
  candidates: StyleCandidate[];
  parseErrors: string[];
}

const CJK_RE = /[\u4e00-\u9fff]/;
const PREFIX_RE = /^([a-z]{1,3})[\u4e00-\u9fff]/;

function countCjkName(names: string[]): number {
  return names.filter((n) => CJK_RE.test(n)).length;
}

function pouKey(p: POU): string {
  return `${p.pouType}:${p.name}`;
}

function varNameCandidates(
  gen: VarDeclaration[],
  act: VarDeclaration[],
  pou: POU,
): StyleCandidate[] {
  const out: StyleCandidate[] = [];
  const sections = new Set([...gen.map((v) => v.section), ...act.map((v) => v.section)]);
  for (const section of sections) {
    const g = gen.filter((v) => v.section === section);
    const a = act.filter((v) => v.section === section);
    const n = Math.min(g.length, a.length);
    for (let i = 0; i < n; i++) {
      const gv = g[i];
      const av = a[i];
      if (gv.name === av.name) continue;
      // 类型变化大时置信度降低
      const sameType = gv.typeName.toUpperCase() === av.typeName.toUpperCase();
      const isParam = section === 'VAR_INPUT' || section === 'VAR_OUTPUT' || section === 'VAR_IN_OUT';
      out.push({
        kind: isParam ? 'param-rename' : 'local-rename',
        confidence: sameType ? 'medium' : 'low',
        scope: `${pou.name}.${section}`,
        before: gv.name,
        after: av.name,
        message: `${isParam ? 'FB 形参' : '局部变量'} ${pou.name}.${section}[${i + 1}]：${gv.name} → ${av.name}`,
      });
    }
  }
  return out;
}

/** 提取习惯候选。 */
export function extractStyleCandidates(generatedSource: string, actualSource: string): CandidateReport {
  const g = parseWithRecovery(generatedSource);
  const a = parseWithRecovery(actualSource);
  const parseErrors = [
    ...g.errors.map((e) => `生成物：${e.message}（第 ${e.line} 行）`),
    ...a.errors.map((e) => `用户版本：${e.message}（第 ${e.line} 行）`),
  ];
  const gAst: AST = g.ast;
  const aAst: AST = a.ast;
  const gLines = generatedSource.split(/\r?\n/).filter((l) => l.trim()).length;
  const aLines = actualSource.split(/\r?\n/).filter((l) => l.trim()).length;

  const candidates: StyleCandidate[] = [];

  // ---- 全局标签：按地址配对 ----
  const gAddr = new Map<string, { name: string; type: string }>();
  for (const v of gAst.globalVars) {
    if (v.address) gAddr.set(v.address.trim().toUpperCase(), { name: v.name, type: v.typeName });
  }
  const aAddr = new Map<string, { name: string; type: string }>();
  for (const v of aAst.globalVars) {
    if (v.address) aAddr.set(v.address.trim().toUpperCase(), { name: v.name, type: v.typeName });
  }
  for (const [addr, gv] of gAddr) {
    const av = aAddr.get(addr);
    if (!av) continue;
    if (av.name !== gv.name) {
      candidates.push({
        kind: 'label-rename',
        confidence: 'high',
        scope: 'global',
        before: gv.name,
        after: av.name,
        message: `全局标签 ${addr}：${gv.name} → ${av.name}`,
      });
    }
  }
  for (const [addr, av] of aAddr) {
    if (!gAddr.has(addr)) {
      candidates.push({
        kind: 'label-added',
        confidence: 'medium',
        scope: 'global',
        after: av.name,
        message: `用户新增全局标签 ${av.name}（${addr}）`,
      });
    }
  }

  // ---- 局部变量 / FB 形参 ----
  const gPous = new Map(gAst.pous.map((p) => [pouKey(p), p]));
  for (const ap of aAst.pous) {
    const gp = gPous.get(pouKey(ap));
    if (!gp) continue;
    candidates.push(...varNameCandidates(gp.vars, ap.vars, ap));
  }

  // ---- 标签语言推断 ----
  const gNames = [
    ...gAst.globalVars.map((v) => v.name),
    ...gAst.pous.flatMap((p) => p.vars.map((v) => v.name)),
  ];
  const aNames = [
    ...aAst.globalVars.map((v) => v.name),
    ...aAst.pous.flatMap((p) => p.vars.map((v) => v.name)),
  ];
  const gCjk = countCjkName(gNames);
  const aCjk = countCjkName(aNames);
  if (aCjk > gCjk && gCjk / Math.max(1, gNames.length) < 0.2 && aCjk / Math.max(1, aNames.length) > 0.5) {
    candidates.push({
      kind: 'language',
      confidence: 'high',
      before: 'en',
      after: 'zh',
      message: `用户版本大量使用中文标识符（${aCjk} 个），建议档案 labels.language = "zh"`,
    });
  } else if (gCjk > aCjk && aCjk === 0) {
    candidates.push({
      kind: 'language',
      confidence: 'medium',
      before: 'zh',
      after: 'en',
      message: '用户版本全部改为英文标识符，建议档案 labels.language = "en"',
    });
  }

  // ---- 命名前缀推断 ----
  const prefixCount = (names: string[]) => {
    const m = new Map<string, number>();
    for (const n of names) {
      const hit = PREFIX_RE.exec(n);
      if (!hit) continue;
      m.set(hit[1], (m.get(hit[1]) ?? 0) + 1);
    }
    return [...m.entries()].sort((x, y) => y[1] - x[1]).map(([p]) => p);
  };
  const gPrefix = prefixCount(gNames);
  const aPrefix = prefixCount(aNames);
  if (aPrefix.length > 0 && aPrefix.join(',') !== gPrefix.join(',')) {
    candidates.push({
      kind: 'naming-prefix',
      confidence: 'medium',
      before: gPrefix.join(',') || '(无)',
      after: aPrefix.join(','),
      message: `用户命名前缀习惯：${aPrefix.join(' / ')}（生成物：${gPrefix.join(',') || '无'}）`,
    });
  }

  // ---- 正文行级修改（低置信） ----
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const gSet = new Set(generatedSource.split(/\r?\n/).map(norm).filter(Boolean));
  const aSet = new Set(actualSource.split(/\r?\n/).map(norm).filter(Boolean));
  const removed = [...gSet].filter((l) => !aSet.has(l));
  const added = [...aSet].filter((l) => !gSet.has(l));
  if (removed.length + added.length > 0) {
    const samples = [...removed.slice(0, 3).map((l) => `- ${l}`), ...added.slice(0, 3).map((l) => `+ ${l}`)];
    candidates.push({
      kind: 'body-edit',
      confidence: 'low',
      message: `正文有 ${removed.length} 行被删改、${added.length} 行新增；示例：${samples.join(' | ')}`,
    });
  }

  return {
    ok: parseErrors.length === 0,
    generated: { lines: gLines, globalVars: gAst.globalVars.length, pous: gAst.pous.length },
    actual: { lines: aLines, globalVars: aAst.globalVars.length, pous: aAst.pous.length },
    candidates,
    parseErrors,
  };
}

/** 渲染候选报告 Markdown（便于人工确认）。 */
export function renderCandidateMarkdown(report: CandidateReport, title = '编程习惯候选规则'): string {
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(
    `生成物：${report.generated.lines} 行 / ${report.generated.globalVars} 全局标签 / ${report.generated.pous} POU；` +
      `用户版本：${report.actual.lines} 行 / ${report.actual.globalVars} 全局标签 / ${report.actual.pous} POU`,
  );
  lines.push('');
  if (report.parseErrors.length > 0) {
    lines.push('## 解析问题');
    for (const e of report.parseErrors) lines.push(`- ${e}`);
    lines.push('');
  }
  lines.push('## 候选规则');
  lines.push('');
  lines.push('| 置信度 | 类型 | 说明 | 建议写入 |');
  lines.push('|---|---|---|---|');
  for (const c of report.candidates) {
    let field = '';
    if (c.kind === 'label-rename' || c.kind === 'label-added') field = 'labels / io';
    else if (c.kind === 'local-rename' || c.kind === 'param-rename') field = 'naming（或生成器规则）';
    else if (c.kind === 'language') field = 'labels.language';
    else if (c.kind === 'naming-prefix') field = 'naming.prefixes';
    else field = 'codeStructure / reviewChecklist';
    lines.push(`| ${c.confidence} | ${c.kind} | ${c.message.replace(/\|/g, '\\|')} | ${field} |`);
  }
  if (report.candidates.length === 0) lines.push('| - | - | 未发现可提取差异 | - |');
  lines.push('');
  lines.push('> 候选规则需要人工确认后才写入 `profiles/`；确认后跑 `test/style.test.ts` 并提交。');
  lines.push('');
  return lines.join('\n');
}
