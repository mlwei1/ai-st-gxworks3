/**
 * Spec → ST → IEC XML 生成管线（M1）。
 *
 * 主流程（模板优先）：
 *   1. 加载并校验 spec（src/spec）
 *   2. 选择模板并合并参数（src/templates）
 *   3. 模板实例化 → 完整 ST 源码
 *   4. 解析 + 三菱方言检查（src/dialect）
 *   5. AST → IEC 61131-10 XML（src/emit）
 *   6. 写出工程包：ST / XML / 标签 CSV / manifest / diagnostics
 *
 * 说明：当前是确定性模板路径（同一 spec 同一产物）；LLM 兜底与
 * 编译诊断修复循环（src/gen/repair.ts）在后续迭代接入。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

import {
  loadSpecFile,
  type RequirementSpec,
  type SpecDiagnostic,
} from '../spec/index.ts';
import { mergeParams, requireTemplate } from '../templates/index.ts';
import { parseWithRecovery } from '../dialect/recovery.ts';
import { analyzeST, type Diagnostic } from '../dialect/analyzer.ts';
import { astToIecProject } from '../emit/iec-project.ts';
import { emitIecXml, type IecVar } from '../emit/iecxml.ts';
import { generateLabelCsvFiles } from '../emit/label-csv.ts';
import { generateWithLlmFallback, type LlmSourceGenerator } from './llm.ts';
import { generateStepSequence } from './step-sequence.ts';
import { extractPouBodies } from '../pipeline/pou-text.ts';
import { compilerErrorsToDiagnostics, type CompilerErrorEntry } from './compiler-feedback.ts';
import type { DiagnosticLike } from './repair.ts';

/**
 * 从 spec 的 IO 表与工业 HMI 地址表生成全局标签（带软元件地址 + 注释）。
 *
 * 目的：IEC XML 导入 GX Works3 后，工程树「全局标签」里能看到 X/Y/M/D 的
 * 名称与用途注释，而不是只有空白标签表。程序仍可直接使用软元件地址。
 */
function buildGlobalLabels(spec: RequirementSpec): IecVar[] {
  const vars: IecVar[] = [];
  const names = new Set<string>();
  const addresses = new Set<string>();
  const push = (v: IecVar) => {
    const name = v.name.trim();
    const address = (v.address ?? '').trim();
    if (!name || names.has(name)) return;
    // 同一软元件只挂一个标签，避免导入时重复分配
    if (address && addresses.has(address)) return;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return;
    names.add(name);
    if (address) addresses.add(address);
    vars.push({ ...v, name, ...(address ? { address } : {}) });
  };

  for (const io of spec.io ?? []) {
    push({
      name: io.name,
      type: io.type,
      address: io.device,
      comment: io.comment ?? `${io.device} ${io.name}`,
    });
  }

  const ind = spec.sequence?.industrial;
  if (ind) {
    const h = ind.hmi;
    push({ name: 'bHmiStart', type: 'BOOL', address: h.start, comment: '触摸屏：启动' });
    push({ name: 'bHmiStop', type: 'BOOL', address: h.stop, comment: '触摸屏：停止' });
    push({ name: 'bHmiReset', type: 'BOOL', address: h.reset, comment: '触摸屏：复位/清除报警' });
    push({ name: 'bHmiManual', type: 'BOOL', address: h.manual, comment: '触摸屏：手动模式' });
    push({ name: 'bHmiExitManual', type: 'BOOL', address: h.exitManual, comment: '触摸屏：退出手动/回待机' });
    push({ name: 'bHmiContinue', type: 'BOOL', address: h.continueRun, comment: '触摸屏：继续（冻结步）' });
    push({ name: 'bHmiRestart', type: 'BOOL', address: h.restart, comment: '触摸屏：从头开始' });
    const st = h.status ?? {};
    push({ name: 'bHmiIdle', type: 'BOOL', address: st.idle ?? 'M100', comment: '状态：待机' });
    push({ name: 'bHmiAuto', type: 'BOOL', address: st.auto ?? 'M101', comment: '状态：自动运行' });
    push({ name: 'bHmiManualing', type: 'BOOL', address: st.manual ?? 'M102', comment: '状态：手动模式' });
    push({ name: 'bHmiStopping', type: 'BOOL', address: st.stopping ?? 'M103', comment: '状态：停止中' });
    push({ name: 'bHmiAlarm', type: 'BOOL', address: st.alarm ?? 'M104', comment: '状态：报警中' });
    push({ name: 'bHmiPaused', type: 'BOOL', address: st.paused ?? 'M105', comment: '状态：急停暂停' });
    const d = h.data ?? {};
    push({ name: 'nHmiStep', type: 'INT', address: d.step ?? 'D0', comment: '数据：当前步号' });
    push({ name: 'nHmiMode', type: 'INT', address: d.mode ?? 'D1', comment: '数据：当前模式' });
    push({ name: 'nHmiAlarmCode', type: 'INT', address: d.alarmCode ?? 'D2', comment: '数据：报警代码' });
    push({ name: 'nHmiAlarmStep', type: 'INT', address: d.alarmStep ?? 'D3', comment: '数据：报警冻结步号' });
    ind.manualButtons.forEach((b, i) => {
      push({
        name: `bHmiManual${i + 1}`,
        type: 'BOOL',
        address: b.button,
        comment: `触摸屏：手动翻转 ${b.cylinder}`,
      });
    });
  }
  return vars;
}

export interface GenerateOptions {
  /** 输出目录；默认 `<spec 所在目录>/../out/<spec.name>` 或 `out/<spec.name>`。 */
  outDir?: string;
  /** 目标 CPU 覆盖（默认取 spec.cpu.series）。 */
  target?: 'FX5U' | 'FX5UJ' | 'iQ-R';
  /** 模板失败时启用 LLM 兜底（需要 LLM 环境变量；测试可注入 llmGenerate）。 */
  useLlm?: boolean;
  /** 注入自定义 LLM 生成器（测试/替代模型）；提供时隐含启用兜底。 */
  llmGenerate?: LlmSourceGenerator;
  /** GX Works3 编译错误列表（半自动回灌），需同时启用 LLM。 */
  compilerErrors?: CompilerErrorEntry[];
}

export interface GenerateResult {
  ok: boolean;
  specPath: string;
  spec: RequirementSpec | null;
  /** spec 校验诊断（加载/字段/设备/模板名等）。 */
  specDiagnostics: SpecDiagnostic[];
  /** 解析/方言诊断。 */
  diagnostics: DiagnosticLike[];
  /** 模板/生成告警（非阻断）。 */
  warnings: string[];
  templateName?: string;
  /** 本次产物来自模板还是 LLM 兜底。 */
  generator?: 'template' | 'llm';
  /** 回灌的 GX Works3 编译诊断（manifest 用）。 */
  compilerDiagnostics?: DiagnosticLike[];
  outDir: string;
  stPath?: string;
  xmlPath?: string;
  labelFiles?: string[];
  manifestPath?: string;
  diagnosticsPath?: string;
  stSource: string;
  attempts: number;
}

function toDiagnosticLike(d: Diagnostic): DiagnosticLike {
  const out: DiagnosticLike = {
    severity: d.severity,
    code: d.code,
    message: d.message,
  };
  if (typeof d.line === 'number') out.line = d.line;
  if (typeof d.column === 'number') out.column = d.column;
  if (d.pou) out.pou = d.pou;
  if (d.hint) out.hint = d.hint;
  return out;
}

/** 默认输出目录：`<cwd>/out/<spec.name>`（相对路径由调用方决定 cwd）。 */
export function defaultOutDir(spec: RequirementSpec): string {
  return resolve('out', spec.name);
}

/**
 * 从 spec 文件生成工程包。
 *
 * 不抛异常：所有失败都以 `ok: false` + diagnostics 返回，便于 CLI/CI 处理。
 */
export async function generateFromSpec(
  specPath: string,
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  const loaded = await loadSpecFile(specPath);
  const result: GenerateResult = {
    ok: false,
    specPath,
    spec: loaded.spec,
    specDiagnostics: loaded.diagnostics,
    diagnostics: [],
    warnings: [],
    outDir: options.outDir ? resolve(options.outDir) : '',
    stSource: '',
    attempts: 0,
  };

  if (!loaded.ok || !loaded.spec) {
    result.outDir = options.outDir
      ? resolve(options.outDir)
      : resolve('out', basename(specPath).replace(/\.json$/i, ''));
    return result;
  }

  const spec = loaded.spec;
  result.templateName = spec.template.name;
  result.outDir = options.outDir ? resolve(options.outDir) : defaultOutDir(spec);
  await mkdir(result.outDir, { recursive: true });

  // ---- 1) 生成 ST：模板优先；失败/编译错误回灌时走 LLM 兜底 ----
  const llmEnabled = options.useLlm === true || typeof options.llmGenerate === 'function';
  const tryTemplate = (): { ok: true; source: string } | { ok: false; error: string } => {
    try {
      const template = requireTemplate(spec.template.name);
      const params = mergeParams(template, spec.template.params ?? {});
      const source = template.instantiate({
        spec: {
          name: spec.name,
          cpu: spec.cpu,
          io: spec.io,
          vars: spec.vars,
          requirements: spec.requirements,
        },
        params,
      });
      return { ok: true, source };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  };

  let stSource: string | undefined;
  let generator: 'template' | 'llm' = 'template';

  // 场景 A：有编译错误回灌 → 优先让 LLM 带着真实编译错误重新生成。
  if (options.compilerErrors && options.compilerErrors.length > 0) {
    result.compilerDiagnostics = compilerErrorsToDiagnostics(options.compilerErrors);
    if (!llmEnabled) {
      result.warnings.push('收到 GX Works3 编译错误，但未启用 --llm；已忽略错误列表，按模板生成。');
    } else {
      const fb = await generateWithLlmFallback(spec, {
        generate: options.llmGenerate,
        compilerErrors: options.compilerErrors,
      });
      result.attempts = Math.max(1, fb.attempts.length);
      if (fb.ok) {
        stSource = fb.stSource;
        generator = 'llm';
      } else {
        // LLM 不可用时不应阻断确定性模板路径：把失败记为告警，回退模板。
        result.warnings.push('LLM 带着编译错误重生成未通过本地检查，回退模板生成。');
        for (const d of fb.diagnostics) {
          result.warnings.push(`LLM ${d.code}: ${d.message}`);
        }
      }
    }
  }

  // 场景 B0：步进程序（spec.sequence）→ 由生成器输出 SFC/STL 风格 ST
  if (!stSource && spec.sequence) {
    try {
      const stepGen = generateStepSequence(spec);
      stSource = stepGen.source;
      generator = 'template';
      result.attempts = Math.max(result.attempts, 1);
      result.warnings.push(...stepGen.warnings);
    } catch (e) {
      result.diagnostics.push({
        severity: 'error',
        code: 'GEN_E_SEQUENCE',
        message: `步进程序生成失败：${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
  if (!stSource && spec.template.name === 'step_sequence' && !spec.sequence) {
    result.diagnostics.push({
      severity: 'error',
      code: 'GEN_E_SEQUENCE_MISSING',
      message: "template.name 为 'step_sequence' 时必须提供 sequence 段（steps/actions/next）",
    });
  }

  // 场景 B：常规路径（模板优先；模板失败且启用 LLM 时兜底）。
  if (!stSource) {
    const t = tryTemplate();
    if (t.ok) {
      stSource = t.source;
      generator = 'template';
      result.attempts = Math.max(result.attempts, 1);
    } else if (llmEnabled) {
      result.warnings.push(`模板实例化失败（${t.error}），改用 LLM 兜底生成。`);
      const fb = await generateWithLlmFallback(spec, { generate: options.llmGenerate });
      result.attempts = Math.max(1, fb.attempts.length);
      if (fb.ok) {
        stSource = fb.stSource;
        generator = 'llm';
      } else {
        result.diagnostics.push({ severity: 'error', code: 'GEN_E_TEMPLATE', message: t.error });
        result.diagnostics.push(...fb.diagnostics);
      }
    } else {
      result.diagnostics.push({ severity: 'error', code: 'GEN_E_TEMPLATE', message: t.error });
    }
  }

  if (!stSource) {
    await writeArtifacts(result, null);
    return result;
  }
  result.stSource = stSource;
  result.generator = generator;

  // ---- 2) 解析 + 方言检查 ----
  const { ast, errors } = parseWithRecovery(stSource);
  for (const e of errors) {
    result.diagnostics.push({
      severity: 'error',
      code: 'PARSE',
      message: e.message,
      line: e.line,
      column: e.column,
    });
  }

  let target = options.target ?? spec.cpu.series;
  if (target === 'iQ-R') {
    result.warnings.push('当前 profile 只实现 FX5U/FX5UJ；iQ-R 目标未验证，按 FX5U 检查。');
    target = 'FX5U';
  }
  const dialectTarget = target as 'FX5U' | 'FX5UJ';
  const dialectDiags = analyzeST(ast, { target: dialectTarget });
  for (const d of dialectDiags) result.diagnostics.push(toDiagnosticLike(d));

  // ---- 3) 通过则生成 XML / 标签 CSV ----
  const hasError = result.diagnostics.some((d) => d.severity === 'error');
  let xml: string | null = null;
  if (!hasError) {
    try {
      const mapped = astToIecProject(ast, {
        contentName: spec.name,
        createdAt: new Date().toISOString(),
        // 保留原始正文注释（AST 不携带语句级注释）
        bodyTexts: extractPouBodies(stSource),
      });
      result.warnings.push(...mapped.warnings);
      // 全局标签：IO 表 + 工业 HMI 地址（带软元件地址与注释，导入后在「全局标签」可见）
      const globalLabels = buildGlobalLabels(spec);
      if (globalLabels.length > 0) {
        mapped.project.globalVars = [...(mapped.project.globalVars ?? []), ...globalLabels];
      }
      xml = emitIecXml(mapped.project);
      result.ok = true;
    } catch (e) {
      result.diagnostics.push({
        severity: 'error',
        code: 'GEN_E_EMIT',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // ---- 4) 写工程包 ----
  await writeArtifacts(result, xml, ast);

  return result;
}

/** 写出 ST / XML / 标签 CSV / manifest / diagnostics。 */
async function writeArtifacts(
  result: GenerateResult,
  xml: string | null,
  ast?: ReturnType<typeof parseWithRecovery>['ast'],
): Promise<void> {
  const spec = result.spec;
  const baseName = spec ? spec.name : basename(result.specPath).replace(/\.json$/i, '');
  await mkdir(result.outDir, { recursive: true });

  if (result.stSource) {
    const stPath = resolve(result.outDir, `${baseName}.st`);
    await writeFile(stPath, result.stSource, 'utf8');
    result.stPath = stPath;
  }

  if (xml) {
    const xmlPath = resolve(result.outDir, `${baseName}.xml`);
    await writeFile(xmlPath, xml, 'utf8');
    result.xmlPath = xmlPath;

    if (ast) {
      try {
        const labels = generateLabelCsvFiles(ast, { projectName: baseName });
        const files: string[] = [];
        for (const f of labels) {
          const p = resolve(result.outDir, f.name);
          await writeFile(p, f.content);
          files.push(p);
        }
        result.labelFiles = files;
      } catch (e) {
        result.warnings.push(
          `标签 CSV 生成失败（不影响 XML）：${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  const manifest = {
    tool: 'ai-st-gxworks3',
    format: 'IEC61131-10',
    spec: spec
      ? {
          name: spec.name,
          cpu: spec.cpu,
          template: spec.template,
          io: spec.io,
          requirements: spec.requirements,
          sequence: spec.sequence ?? null,
        }
      : { source: result.specPath },
    templateName: result.templateName ?? null,
    generator: result.generator ?? null,
    generatedAt: new Date().toISOString(),
    ok: result.ok,
    attempts: result.attempts,
    diagnostics: result.diagnostics,
    compilerDiagnostics: result.compilerDiagnostics ?? [],
    warnings: result.warnings,
    specDiagnostics: result.specDiagnostics,
  };
  const manifestPath = resolve(result.outDir, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  result.manifestPath = manifestPath;

  const diagnosticsPath = resolve(result.outDir, 'diagnostics.json');
  await writeFile(
    diagnosticsPath,
    JSON.stringify(
      {
        spec: result.specDiagnostics,
        code: result.diagnostics,
        compiler: result.compilerDiagnostics ?? [],
        warnings: result.warnings,
      },
      null,
      2,
    ),
    'utf8',
  );
  result.diagnosticsPath = diagnosticsPath;

}
