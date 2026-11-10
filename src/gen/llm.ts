/**
 * LLM 兜底生成 + 修复循环（M1 骨架）。
 *
 * 定位：模板库覆盖不了的非标逻辑，用 LLM 生成 ST；本地解析/方言诊断
 * 作为反馈回灌，最多重试 N 轮。模型调用通过 `LlmSourceGenerator` 注入，
 * 默认实现走现有 `src/ai/client.ts`（需要 LLM 环境变量）；测试可注入假实现。
 *
 * 注意：本模块只负责“生成 + 本地检查”；真机编译诊断回灌是后续迭代。
 */

import { generateST } from '../ai/client.ts';
import { aiProjectToST, type AIGeneratedProject } from '../ai/convert.ts';
import { analyzeST } from '../dialect/analyzer.ts';
import { parseWithRecovery } from '../dialect/recovery.ts';
import type { RequirementSpec } from '../spec/index.ts';
import type { AST } from '../dialect/ast.ts';
import {
  runRepairLoop,
  type DiagnosticLike,
  type RepairAttempt,
} from './repair.ts';
import {
  compilerErrorsToDiagnostics,
  formatCompilerFeedback,
  type CompilerErrorEntry,
} from './compiler-feedback.ts';

export interface LlmSourceContext {
  spec: RequirementSpec;
  /** 上一轮诊断反馈（首轮为空串）。 */
  feedback: string;
  /** 第几轮（1 起）。 */
  attempt: number;
}

/** 注入点：给定上下文返回完整 ST 源码（抛错表示本轮生成失败）。 */
export type LlmSourceGenerator = (ctx: LlmSourceContext) => Promise<string>;

export interface LlmFallbackOptions {
  /** 自定义生成器（测试/其他模型时注入）；默认走内置 LLM 客户端。 */
  generate?: LlmSourceGenerator;
  /** 最大轮数（含首轮），默认 3。 */
  maxAttempts?: number;
  /**
   * GX Works3 编译错误（半自动回灌）：作为首轮反馈喂给生成器。
   * 错误列表需要先从 GX Works3 Output 人工整理/导出为 JSON 或文本。
   */
  compilerErrors?: CompilerErrorEntry[];
}

export interface LlmFallbackResult {
  ok: boolean;
  /** 最终 ST 源码（可能为空，若生成器首轮就抛错）。 */
  stSource: string;
  /** 最终 AST（解析成功时存在）。 */
  ast?: AST;
  diagnostics: DiagnosticLike[];
  attempts: RepairAttempt<string>[];
  /** 回灌的编译诊断（manifest/日志用）。 */
  compilerDiagnostics?: DiagnosticLike[];
  /** 模板名不适用时，调用方的提示。 */
  note?: string;
}

/** 把 spec 转成给 LLM 的需求文本（含验收条款与 IO 表）。 */
export function specToRequirement(spec: RequirementSpec): string {
  const lines: string[] = [];
  lines.push(`目标 PLC：${spec.cpu.series}${spec.cpu.model ? `（${spec.cpu.model}）` : ''}`);
  if (spec.title) lines.push(`任务：${spec.title}`);
  lines.push('', '控制需求：');
  for (const r of spec.requirements) lines.push(`- [${r.id}] ${r.text}`);
  if (spec.io.length > 0) {
    lines.push('', 'IO 分配（请使用这些软元件地址）：');
    for (const io of spec.io) {
      lines.push(`- ${io.device} → ${io.name} : ${io.type}${io.comment ? ` // ${io.comment}` : ''}`);
    }
  }
  if (spec.safety?.interlocks?.length) {
    lines.push('', '安全/互锁约束：');
    for (const it of spec.safety.interlocks) lines.push(`- ${it}`);
  }
  return lines.join('\n');
}

/** 默认生成器：调用项目内置 LLM 客户端，输出 AST JSON → ST 源码。 */
export function createDefaultLlmGenerator(options: { target?: 'FX5U' | 'iQ-R' } = {}): LlmSourceGenerator {
  return async ({ spec, feedback }) => {
    const base = specToRequirement(spec);
    const requirement = feedback
      ? `${base}\n\n上一次生成的 ST 未通过本地检查，请根据以下诊断修正后重新生成：\n${feedback}`
      : base;
    const { json } = await generateST({
      requirement,
      target: options.target ?? 'FX5U',
      maxAttempts: 1,
    });
    const project = json as AIGeneratedProject;
    const st = aiProjectToST(project);
    if (!st.trim()) throw new Error('LLM 返回的工程为空（无 POU）');
    return st;
  };
}

function parseDiagnostics(source: string): { ast?: AST; diagnostics: DiagnosticLike[] } {
  const { ast, errors } = parseWithRecovery(source);
  const diagnostics: DiagnosticLike[] = errors.map((e) => ({
    severity: 'error' as const,
    code: 'PARSE',
    message: e.message,
    line: e.line,
    column: e.column,
  }));
  if (diagnostics.length === 0) {
    for (const d of analyzeST(ast, { target: 'FX5U' })) {
      const item: DiagnosticLike = {
        severity: d.severity,
        code: d.code,
        message: d.message,
      };
      if (typeof d.line === 'number') item.line = d.line;
      if (typeof d.column === 'number') item.column = d.column;
      if (d.pou) item.pou = d.pou;
      if (d.hint) item.hint = d.hint;
      diagnostics.push(item);
    }
  }
  return { ast, diagnostics };
}

/**
 * LLM 兜底生成：生成 → 本地检查 → 带诊断反馈重试。
 *
 * 成功条件：解析 0 语法错误且 analyzer 0 error（warning 不阻断）。
 */
export async function generateWithLlmFallback(
  spec: RequirementSpec,
  options: LlmFallbackOptions = {},
): Promise<LlmFallbackResult> {
  const generate = options.generate ?? createDefaultLlmGenerator();
  let lastSource = '';
  let lastAst: AST | undefined;

  const compilerDiagnostics = options.compilerErrors
    ? compilerErrorsToDiagnostics(options.compilerErrors)
    : undefined;
  const initialFeedback = options.compilerErrors
    ? formatCompilerFeedback(options.compilerErrors)
    : undefined;

  const loop = await runRepairLoop<string>({
    maxAttempts: options.maxAttempts ?? 3,
    initialFeedback,
    generate: async (attempt, feedback) => {
      let source: string;
      try {
        source = await generate({ spec, feedback, attempt });
      } catch (e) {
        return {
          output: '',
          diagnostics: [
            { severity: 'error', code: 'LLM_E_CALL', message: e instanceof Error ? e.message : String(e) },
          ],
        };
      }
      lastSource = source;
      const { ast, diagnostics } = parseDiagnostics(source);
      if (ast) lastAst = ast;
      return { output: source, diagnostics };
    },
  });

  const result: LlmFallbackResult = {
    ok: loop.ok,
    stSource: lastSource,
    diagnostics: loop.diagnostics,
    attempts: loop.attempts,
  };
  if (lastAst) result.ast = lastAst;
  if (compilerDiagnostics) result.compilerDiagnostics = compilerDiagnostics;
  if (!loop.ok) {
    result.note = 'LLM 兜底未通过本地检查；建议改模板或人工介入';
  }
  return result;
}

/**
 * 半自动编译诊断回灌：把 GX Works3 全部转换的错误列表作为首轮反馈，
 * 让生成器带着真实编译错误重新生成。
 */
export async function generateWithCompilerFeedback(
  spec: RequirementSpec,
  compilerErrors: CompilerErrorEntry[],
  options: Omit<LlmFallbackOptions, 'compilerErrors'> = {},
): Promise<LlmFallbackResult> {
  return generateWithLlmFallback(spec, { ...options, compilerErrors });
}
