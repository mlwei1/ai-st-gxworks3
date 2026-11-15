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
import {
  buildGlobalLabelPlan,
  prependGlobalVarBlock,
  renameDevicesToLabels,
  renameIdentifiers,
} from '../emit/label-map.ts';
import { generateLabelCsvFiles } from '../emit/label-csv.ts';
import { exportHmiCsvFiles } from '../emit/hmi-csv.ts';
import { generateWithLlmFallback, type LlmSourceGenerator } from './llm.ts';
import { generateStepSequence } from './step-sequence.ts';
import { extractPouBodies } from '../pipeline/pou-text.ts';
import { compilerErrorsToDiagnostics, type CompilerErrorEntry } from './compiler-feedback.ts';
import type { DiagnosticLike } from './repair.ts';
import { mergeStyleIntoSpec, type StyleProfile } from '../style/index.ts';
import { checkSpecAgainstStyle } from '../style/check-spec.ts';
import { applyStyleHmiAddresses } from '../style/apply-hmi.ts';
import { buildDefaultStopSequence } from '../style/auto-stop.ts';

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
  /** 标签语言覆盖：en=英文标签（默认），zh=中文标签。 */
  labelLanguage?: 'en' | 'zh';
  /** 编程习惯档案（命名/标签语言/默认超时等）；只填充 spec 未显式设置的项。 */
  style?: StyleProfile;
  /** 用档案 HMI 地址规划覆盖 spec（显式 opt-in，默认关闭）。 */
  applyHmiFromStyle?: boolean;
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
  /** 工业程序的触摸屏地址表（CSV）。 */
  hmiCsvPath?: string;
  /** 工业程序的报警表（CSV）。 */
  alarmCsvPath?: string;
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
  // 停止序列为空：按气缸清单自动生成默认安全停止序列（缩回→松夹→全关）
  const indAuto = spec.sequence?.industrial;
  if (indAuto && indAuto.stopSequence.length === 0) {
    indAuto.stopSequence = buildDefaultStopSequence(indAuto.cylinders, options.style);
    if (indAuto.stopSequence.length > 0) {
      result.warnings.push(
        `stopSequence 为空，已按气缸清单自动生成 ${indAuto.stopSequence.length} 步停止序列`,
      );
    }
  }
  // 编程习惯档案：只填充 spec 未显式设置项（优先级：CLI/对话 > spec > style）
  if (options.style) {
    const applied = mergeStyleIntoSpec(spec, options.style);
    if (applied.applied.length > 0) {
      result.warnings.push(`已应用编程习惯档案 ${options.style.name}：${applied.applied.join('、')}`);
    }
    // HMI 地址显式覆盖（opt-in）
    if (options.applyHmiFromStyle) {
      const hmiApplied = applyStyleHmiAddresses(spec, options.style);
      if (hmiApplied.applied.length > 0) {
        result.warnings.push(`HMI 地址已按习惯档案覆盖：${hmiApplied.applied.join('；')}`);
      }
    }
    // 习惯一致性校验：只提示 spec 与档案的偏差，不阻断生成
    for (const d of checkSpecAgainstStyle(spec, options.style)) {
      result.warnings.push(`习惯校验：${d.message}`);
    }
  }
  // CLI --labels 覆盖：全局标签与局部标签/ FB 形参语言保持一致
  if (options.labelLanguage) {
    spec.labels = { ...(spec.labels ?? {}), language: options.labelLanguage };
  }
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
        style: options.style,
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
      const stepGen = generateStepSequence(spec, { style: options.style });
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
      const fb = await generateWithLlmFallback(spec, {
        generate: options.llmGenerate,
        style: options.style,
      });
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
    await writeArtifacts(result, null, undefined, options.style);
    return result;
  }

  // 习惯档案里的精确标识符改名（来自 style candidates 采纳）
  const styleRenames = options.style?.naming?.renames;
  if (styleRenames && Object.keys(styleRenames).length > 0) {
    const map = new Map<string, string>();
    for (const [from, to] of Object.entries(styleRenames)) {
      // 防止误改软元件地址
      if (!from.trim() || !to.trim()) continue;
      if (/^(X|Y|M|D|T|C|SM|SD|B|W)\d/i.test(from)) continue;
      map.set(from, to);
    }
    if (map.size > 0) {
      stSource = renameIdentifiers(stSource, map);
      result.warnings.push(`已按习惯档案改名 ${map.size} 个标识符`);
    }
  }

  // 全局标签：把程序正文里的软元件地址替换成标签名（可读性），
  // 并在 ST 文件头插入 VAR_GLOBAL 块（便于单独 check/build-xml）。
  const labelPlan = buildGlobalLabelPlan(spec, options.labelLanguage, options.style);
  if (labelPlan.labels.length > 0 && !/\bVAR_GLOBAL\b/.test(stSource)) {
    stSource = renameDevicesToLabels(stSource, labelPlan.deviceToLabel);
    stSource = prependGlobalVarBlock(stSource, labelPlan.labels);
  }

  // 全局标签审计：只在标签表/声明里出现、从未在程序正文使用的标签，提示接线缺失
  if (labelPlan.labels.length > 0) {
    const bodyOnly = stSource.replace(/VAR_GLOBAL[\s\S]*?END_VAR/, '');
    const unused = labelPlan.labels.filter((l) => !bodyOnly.includes(l.name));
    if (unused.length > 0) {
      result.warnings.push(
        `未被程序引用的全局标签：${unused.map((l) => `${l.name}(${l.address})`).join('、')}` +
          `；检查 spec.io 是否只定义了标签而未接线`,
      );
    }
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
  await writeArtifacts(result, xml, ast, options.style);

  return result;
}

/** 写出 ST / XML / 标签 CSV / manifest / diagnostics。 */
async function writeArtifacts(
  result: GenerateResult,
  xml: string | null,
  ast?: ReturnType<typeof parseWithRecovery>['ast'],
  style?: StyleProfile,
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

  // 工业程序：HMI 地址表 + 报警表（与 ST/XML 标签同源）
  if (spec?.sequence?.industrial) {
    try {
      const exported = await exportHmiCsvFiles(spec, style, result.outDir);
      if (exported) {
        result.hmiCsvPath = exported.hmiPath;
        result.alarmCsvPath = exported.alarmPath;
      }
    } catch (e) {
      result.warnings.push(`HMI/报警表生成失败：${e instanceof Error ? e.message : String(e)}`);
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
