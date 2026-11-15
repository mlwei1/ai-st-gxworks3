#!/usr/bin/env node
/**
 * ai-st-gxworks3 —— AI 驱动的三菱 GX Works3 ST 代码生成与校验工具。
 *
 * 子命令：
 *   check     校验 ST 文件（语法 + 三菱方言静态检查）
 *   build-xml ST 文件 → IEC61131-10 XML（可直接导入 GX Works3）
 *   generate  自然语言需求 → ST 代码 + XML
 *   prompt    打印将要使用的系统提示词（调试用）
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import { analyzeST, type Diagnostic } from './dialect/analyzer.ts';
import { parseWithRecovery } from './dialect/recovery.ts';
import { generateLabelCsvFiles } from './emit/label-csv.ts';
import {
  renderLocalLabelTable,
  renderPOUAsText,
  renderPOUDeclarations,
  renderProjectAsText,
  renderVarSheetTable,
} from './emit/text.ts';
import { astToIecProject } from './emit/iec-project.ts';
import { emitIecXml } from './emit/iecxml.ts';
import { generateFromSpec } from './gen/generate.ts';
import { extractPouBodies } from './pipeline/pou-text.ts';
import { deliverFromSpec, formatDeliverySummary } from './deliver/index.ts';
import { runMcpServer } from './mcp/server.ts';
import { parseCompilerErrors } from './gen/compiler-feedback.ts';
import { listTemplates } from './templates/index.ts';
import { formatSpecDiagnostics } from './spec/index.ts';
import {
  formatSimDiagnostics,
  formatSimReport,
  runScenarioWithObservations,
  validateScenario,
} from './sim/index.ts';
import { convertAIGenerated, type AIGeneratedProject } from './ai/convert.ts';
import { generateST, loadLLMConfig } from './ai/client.ts';
import { buildSystemPrompt } from './ai/prompt.ts';
import { loadStyleFile, resolveStyleFiles } from './style/index.ts';
import { extractStyleCandidates, renderCandidateMarkdown, type StyleCandidate } from './style/diff-candidates.ts';
import { adoptCandidates } from './style/adopt.ts';
import { styleErrors, validateStyleProfile } from './style/validate.ts';

const SEVERITY_ICON: Record<Diagnostic['severity'], string> = {
  error: '✖',
  warning: '▲',
  info: '·',
};

/* ------------------------------------------------------------------ */
/* 参数解析                                                           */
/* ------------------------------------------------------------------ */

interface Args {
  _: string[];
  [key: string]: string | boolean | undefined;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { _: [] };
  // 短选项映射
  const shortMap: Record<string, string> = { o: 'out', n: 'name', t: 'target' };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        args[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        // 值为下一个 token 时，只要它本身不是选项（- 开头）就消费；
        // 避免 --llm -o out 把 -o 当成 --llm 的值。
        if (next && !next.startsWith('-')) {
          args[a.slice(2)] = next;
          i++;
        } else {
          args[a.slice(2)] = true;
        }
      }
    } else if (a.startsWith('-') && a.length > 1) {
      // 短选项：-o value / -o=value
      const key = a.slice(1);
      const eq = key.indexOf('=');
      if (eq !== -1) {
        args[shortMap[key.slice(0, eq)] ?? key.slice(0, eq)] = key.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        const mapped = shortMap[key] ?? key;
        if (next && !next.startsWith('-')) {
          args[mapped] = next;
          i++;
        } else {
          args[mapped] = true;
        }
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

/* ------------------------------------------------------------------ */
/* 输出辅助                                                           */
/* ------------------------------------------------------------------ */

function printDiagnostics(diags: Diagnostic[], sourceName: string): number {
  const errors = diags.filter((d) => d.severity === 'error').length;
  const warnings = diags.filter((d) => d.severity === 'warning').length;

  if (diags.length === 0) {
    console.log(`✓ ${sourceName} 校验通过，未发现问题。`);
    return 0;
  }

  console.log(`\n${sourceName} —— ${errors} 个错误, ${warnings} 个警告\n`);
  for (const d of diags) {
    const loc = `${sourceName}:${d.line}:${d.column}`;
    const pou = d.pou ? ` [${d.pou}]` : '';
    console.log(`${SEVERITY_ICON[d.severity]} ${loc}${pou} ${d.code}: ${d.message}`);
    if (d.hint) console.log(`    ↳ ${d.hint}`);
  }
  console.log('');
  return errors;
}

/* ------------------------------------------------------------------ */
/* 子命令                                                             */
/* ------------------------------------------------------------------ */

async function cmdCheck(args: Args): Promise<number> {
  const files = args._;
  if (files.length === 0) {
    console.error('用法: ai-st-gxworks3 check <file.st> [更多文件...]');
    return 2;
  }
  let totalErrors = 0;
  for (const f of files) {
    const src = await readFile(resolve(f), 'utf8');
    const { ast, errors } = parseWithRecovery(src);

    // 语法错误
    if (errors.length > 0) {
      console.log(`\n${basename(f)} —— ${errors.length} 个语法错误\n`);
      for (const e of errors) {
        console.log(`✖ ${basename(f)}:${e.line}:${e.column} 语法错误: ${e.message}`);
      }
      console.log('');
      totalErrors += errors.length;
    }

    // 语义与方言检查（能解析出的部分）
    const diags = analyzeST(ast, {
      target: (args.target as 'FX5U' | 'iQ-R') ?? 'FX5U',
      includeWarnings: args.noWarnings !== true,
    });
    if (diags.length > 0) {
      totalErrors += printDiagnostics(diags, basename(f));
    } else if (errors.length === 0) {
      console.log(`✓ ${basename(f)} 校验通过，未发现问题。`);
    }
  }
  return totalErrors > 0 ? 1 : 0;
}

/**
 * 生成 GX Works3 粘贴用文本 + 标签 CSV。
 *
 * 这是**推荐的主流程**：GX Works3 强制结构化工程模式，变量声明与 ST 本体分离，
 * 外部文本无法直接写进工程，只能：
 *   1) 标签 CSV → 导入到「全局标签」
 *   2) ST 文本 → 粘贴进「程序本体」/「标签设置」
 */
async function cmdBuildText(args: Args): Promise<number> {
  const input = args._[0];
  if (!input) {
    console.error('用法: ai-st-gxworks3 build-text <file.st> [-o outdir]');
    return 2;
  }
  const src = await readFile(resolve(input), 'utf8');

  const { ast, errors } = parseWithRecovery(src);
  if (errors.length > 0) {
    console.log(`\n${basename(input)} —— ${errors.length} 个语法错误\n`);
    for (const e of errors) {
      console.log(`✖ ${basename(input)}:${e.line}:${e.column} 语法错误: ${e.message}`);
    }
    console.log('');
    console.error('存在语法错误，未生成文本。修复后再试。');
    return 1;
  }

  const diags = analyzeST(ast, { target: (args.target as 'FX5U' | 'iQ-R') ?? 'FX5U' });
  const errorCount = diags.filter((d) => d.severity === 'error').length;
  if (errorCount > 0) {
    printDiagnostics(diags, basename(input));
    console.error('存在错误，未生成文本。修复后再试。');
    return 1;
  }
  printDiagnostics(diags, basename(input));

  const base = (args.out as string) ?? input.replace(/\.st$/i, '');
  const outDir = resolve(base);
  await mkdir(outDir, { recursive: true });

  // 1) 每个 POU 一个「程序本体」文本，直接粘贴进「程序本体」工作表
  for (const pou of ast.pous) {
    const text = renderPOUAsText(pou, { includeComments: args.declare !== false });
    await writeFile(resolve(outDir, `${pou.name}.st`), text, 'utf8');
    console.log(`✓ ${pou.name}.st  → 粘贴进 GX Works3「程序本体」工作表`);
  }

  // 2) 每个 POU 一个「标签设置」录入表
  for (const pou of ast.pous) {
    const table = renderLocalLabelTable(pou);
    if (table) {
      await writeFile(resolve(outDir, `${pou.name}_labels.txt`), table, 'utf8');
    }
  }
  console.log(`✓ *_labels.txt  → 「标签设置」工作表逐行录入用`);

  // 4) 标签 CSV（GX Works3 标签导入的唯一通道）
  {
    const labelFiles = generateLabelCsvFiles(ast, {
      projectName: (args.name as string) ?? undefined,
    });
    for (const f of labelFiles) {
      await writeFile(resolve(outDir, f.name), f.content);
    }
    console.log(`✓ 标签 CSV 已保存: ${outDir}\\*.csv（UTF-16，可直接导入 GX Works3）`);
  }

  // 5) 汇总速查表
  await writeFile(
    resolve(outDir, 'local_labels_table.txt'),
    renderVarSheetTable(ast),
    'utf8',
  );
  console.log(`✓ local_labels_table.txt  → 全部局部标签汇总`);

  console.log('');
  console.log('导入步骤：');
  console.log('  1) 程序/FB 右键 → 局部标签 → 导入文件 → 选 *_local_labels.csv');
  console.log('  2) 全局标签 右键 → 导入文件 → 选 Global.csv');
  console.log('  3) 「程序本体」工作表 → 全选 → 粘贴对应 .st 内容');
  console.log('  4) 转换 → 全部转换，检查编译错误');
  console.log('');
  console.log('  备选（无 CSV 导入时）：按 *_labels.txt 在「标签设置」工作表手工录入');

  return 0;
}

/**
 * 生成 GX Works3 可导入的 IEC 61131-10 XML。
 *
 * 这是「落地通道 A」的核心产物：一次导入即可带上
 * Program + 局部/全局标签 + 结构体 + ST 正文。
 *
 * 注意：本期只导出 Program；FB/Function 会在告警中说明并跳过。
 */
async function cmdBuildXml(args: Args): Promise<number> {
  const input = args._[0];
  if (!input) {
    console.error('用法: ai-st-gxworks3 build-xml <file.st> [-o outdir]');
    return 2;
  }
  const src = await readFile(resolve(input), 'utf8');
  const { ast, errors } = parseWithRecovery(src);
  if (errors.length > 0) {
    console.log(`\n${basename(input)} —— ${errors.length} 个语法错误\n`);
    for (const e of errors) {
      console.log(`✖ ${basename(input)}:${e.line}:${e.column} 语法错误: ${e.message}`);
    }
    console.log('');
    console.error('存在语法错误，未生成 XML。');
    return 1;
  }

  const target = (args.target as 'FX5U' | 'iQ-R') ?? 'FX5U';
  const diags = analyzeST(ast, { target });
  const errorCount = diags.filter((d) => d.severity === 'error').length;
  printDiagnostics(diags, basename(input));
  if (errorCount > 0) {
    console.error('存在错误，未生成 XML。修复后再试。');
    return 1;
  }
  if (target !== 'FX5U') {
    console.log(`▲ 注意：当前 profile 只实现 FX5U；--target ${target} 暂未生效。`);
  }

  const projectName =
    (args.name as string) ?? basename(input).replace(/\.st$/i, '');
  const outDir = resolve((args.out as string) ?? `${projectName}-iecxml`);
  await mkdir(outDir, { recursive: true });

  const mapped = astToIecProject(ast, {
    contentName: projectName,
    createdAt: new Date().toISOString(),
    // 保留原始正文注释（AST 不携带语句级注释）
    bodyTexts: extractPouBodies(src),
  });
  for (const w of mapped.warnings) console.log(`▲ ${w}`);

  const xml = emitIecXml(mapped.project);
  const xmlPath = resolve(outDir, `${projectName}.xml`);
  await writeFile(xmlPath, xml, 'utf8');
  console.log(`\n✓ ${projectName}.xml  → GX Works3：工程 → 导入 → IEC61131-10 XML格式`);

  // 标签 CSV 作为备份通道（IEC XML 导入失败时仍可走「标签 CSV + 粘贴 ST」）
  const labelFiles = generateLabelCsvFiles(ast, { projectName });
  for (const f of labelFiles) {
    await writeFile(resolve(outDir, f.name), f.content);
  }
  console.log(`✓ 标签 CSV 备份: ${outDir}\\*.csv`);

  const manifest = {
    tool: 'ai-st-gxworks3',
    format: 'IEC61131-10',
    target,
    source: basename(input),
    generatedAt: new Date().toISOString(),
    programs: mapped.project.programs.map((p) => p.name),
    structs: (mapped.project.types ?? []).map((t) => t.name),
    globalVars: (mapped.project.globalVars ?? []).map((g) => g.name),
    warnings: mapped.warnings,
  };
  await writeFile(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`✓ manifest.json（程序/结构体/全局变量/告警清单）`);

  console.log('');
  console.log('导入步骤：');
  console.log('  1) 打开已配置 FX5U CPU 参数/任务的 GX Works3 工程（建议用模板工程）');
  console.log('  2) 工程 → 导入 → IEC61131-10 XML格式 → 选本 XML');
  console.log('  3) 转换 → 全部转换，检查编译结果');
  console.log('  备选：标签 CSV 导入 + 程序本体粘贴 ST（见 build-text）');
  return 0;
}

/**
 * `sim <scenario.json> [--observed obs.json]`：仿真场景 DSL 校验 + 半自动断言。
 *
 * 不带 --observed 时输出执行清单（供在 GX Simulator3 中操作并采集观测值）。
 */
async function cmdSim(args: Args): Promise<number> {
  const scenarioPath = args._[0];
  if (!scenarioPath) {
    console.error('用法: ai-st-gxworks3 sim <scenario.json> [--observed obs.json] [--write-obs-template obs.json] [-o outdir]');
    return 2;
  }
  const scenarioFile = resolve(scenarioPath);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(scenarioFile, 'utf8'));
  } catch (e) {
    console.error(`读取场景失败：${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  const validated = validateScenario(raw);
  if (validated.diagnostics.length > 0) console.log(formatSimDiagnostics(validated.diagnostics));
  if (!validated.ok || !validated.scenario) {
    console.error('场景校验失败。');
    return 1;
  }
  const scenario = validated.scenario;
  const outDir = typeof args.out === 'string' ? resolve(args.out) : resolve('out', `${scenario.name}-sim`);

  const observedPath = typeof args.observed === 'string' ? args.observed : undefined;
  const tplPath = typeof args['write-obs-template'] === 'string' ? args['write-obs-template'] : undefined;
  if (tplPath) {
    const template = {
      scenario: scenario.name,
      observedAt: new Date().toISOString(),
      steps: scenario.steps.map((s, i) => ({
        step: i + 1,
        name: s.name,
        values: {},
      })),
    };
    await writeFile(resolve(tplPath), JSON.stringify(template, null, 2), 'utf8');
    console.log(`已写出观测文件模板：${resolve(tplPath)}（填入各步骤实际读到的设备值）`);
  }

  if (!observedPath) {
    console.log(`\n场景 ${scenario.name}（${scenario.steps.length} 步）执行清单：`);
    scenario.steps.forEach((s, i) => {
      const sets = s.set ? Object.entries(s.set).map(([k, v]) => `${k}=${String(v)}`).join(', ') : '';
      const exps = s.expect ? Object.entries(s.expect).map(([k, v]) => `${k}=${String(v)}`).join(', ') : '';
      console.log(`  ${i + 1}. ${s.name}${sets ? ` | 写: ${sets}` : ''}${exps ? ` | 期望: ${exps}` : ''}`);
    });
    console.log('\n操作：GX Works3 打开工程 → 调试 → 仿真 → 开始仿真 → 批监视写/读设备，');
    console.log('      把每步读到的值填入观测文件，再用 --observed <obs.json> 运行断言。');
    return 0;
  }

  let observationsRaw: unknown;
  try {
    observationsRaw = JSON.parse(await readFile(resolve(observedPath), 'utf8'));
  } catch (e) {
    console.error(`读取观测文件失败：${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  const result = runScenarioWithObservations(scenario, observationsRaw as never);
  if (result.diagnostics.length > 0) console.log(formatSimDiagnostics(result.diagnostics));
  console.log(formatSimReport(result));

  await mkdir(outDir, { recursive: true });
  const reportPath = resolve(outDir, 'report.json');
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        scenario: scenario.name,
        scenarioFile,
        observedFile: resolve(observedPath),
        ok: result.ok,
        mismatchCount: result.mismatchCount,
        steps: result.steps,
        diagnostics: result.diagnostics,
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`报告：${reportPath}`);
  return result.ok ? 0 : 1;
}

/**
 * `gen <spec.json>`：Spec → 模板实例化 → 解析/方言检查 → IEC XML 工程包。
 *
 * 当前为确定性模板路径；LLM 兜底与编译诊断修复循环在后续迭代接入。
 */
async function cmdGen(args: Args): Promise<number> {
  if (args['list-templates']) {
    const templates = listTemplates();
    console.log(`可用模板（${templates.length}）：\n`);
    for (const t of templates) {
      const params = t.params
        .map((p) => `${p.name}=${p.default ?? ''}`)
        .join(', ');
      console.log(`  ${t.name.padEnd(24)} ${t.description}`);
      if (params) console.log(`     参数: ${params}`);
    }
    console.log('');
    console.log(
      '  step_sequence            （特殊）SFC/STL 风格步进程序：不实例化模板库，由 spec.sequence 生成；见 docs/ST步进程序.md',
    );
    return 0;
  }

  const specPath = args._[0];
  if (!specPath) {
    console.error(
      '用法: ai-st-gxworks3 gen <spec.json> [-o outdir] [--llm] [--compiler-errors errors.json] [--style profile.json] [--labels en|zh] [--list-templates]',
    );
    return 2;
  }

  const outDir = typeof args.out === 'string' ? args.out : undefined;
  const useLlm = args.llm === true || (typeof args.llm === 'string' && args.llm !== 'false');

  // GX Works3 编译错误回灌（半自动）：--compiler-errors <file>（JSON 或纯文本）
  let compilerErrors;
  const compilerErrorsPath = typeof args['compiler-errors'] === 'string' ? args['compiler-errors'] : undefined;
  if (compilerErrorsPath) {
    if (!useLlm) {
      console.error('--compiler-errors 需要同时指定 --llm（回灌需要 LLM 重新生成）。');
      return 2;
    }
    try {
      const raw = await readFile(resolve(compilerErrorsPath), 'utf8');
      const parsed = parseCompilerErrors(raw);
      compilerErrors = parsed.entries;
      for (const w of parsed.diagnostics) console.warn(`▲ ${w.code}: ${w.message}`);
      if (compilerErrors.length === 0) {
        console.warn('▲ 编译错误文件中没有识别到有效条目，按普通 LLM 兜底流程继续。');
      } else {
        console.log(`已读取 ${compilerErrors.length} 条 GX Works3 编译错误，将作为修复反馈。`);
      }
    } catch (e) {
      console.error(`读取编译错误文件失败：${e instanceof Error ? e.message : String(e)}`);
      return 2;
    }
  }

  // 编程习惯档案（可选，支持多级合并：--style user.json,company.json,project.json）
  const stylePath = typeof args.style === 'string' ? args.style : undefined;
  let style;
  if (stylePath) {
    const paths = stylePath
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => resolve(s));
    const loadedStyle =
      paths.length > 1 ? await resolveStyleFiles(paths) : await loadStyleFile(paths[0]);
    if (!loadedStyle.ok || !loadedStyle.profile) {
      console.error(`✖ 编程习惯档案校验失败：${loadedStyle.diagnostics.map((d) => d.message).join('; ')}`);
      return 2;
    }
    style = loadedStyle.profile;
  }

  const result = await generateFromSpec(resolve(specPath), {
    outDir,
    useLlm,
    compilerErrors,
    labelLanguage:
      args.labels === 'en' || args.labels === 'zh' ? (args.labels as 'en' | 'zh') : undefined,
    style,
  });

  if (result.specDiagnostics.length > 0) {
    console.error(formatSpecDiagnostics(result.specDiagnostics));
  }
  const codeDiags = result.diagnostics;
  if (codeDiags.length > 0) {
    printDiagnostics(
      codeDiags.map((d) => ({
        severity: d.severity,
        code: d.code,
        message: d.message,
        line: d.line ?? 0,
        column: d.column ?? 0,
        pou: d.pou,
        hint: d.hint,
      })) as Diagnostic[],
      result.spec?.name ?? specPath,
    );
  }
  for (const w of result.warnings) console.log(`▲ ${w}`);

  if (!result.ok) {
    console.error(`\n✖ 生成失败（spec 校验或代码检查未通过），产物已写入: ${result.outDir}`);
    return 1;
  }

  console.log(
    `\n✓ 生成成功: ${result.spec?.name}（${
      result.generator === 'llm' ? 'LLM 兜底生成' : `模板 ${result.templateName}`
    }）`,
  );
  if (result.compilerDiagnostics?.length) {
    console.log(`  回灌编译错误: ${result.compilerDiagnostics.length} 条`);
  }
  if (result.attempts > 1) console.log(`  生成尝试: ${result.attempts} 轮`);
  if (result.stPath) console.log(`  ST       : ${result.stPath}`);
  if (result.xmlPath) console.log(`  IEC XML  : ${result.xmlPath}`);
  if (result.labelFiles?.length) console.log(`  标签 CSV : ${result.labelFiles.length} 个`);
  if (result.hmiCsvPath) console.log(`  HMI 表   : ${result.hmiCsvPath}`);
  if (result.alarmCsvPath) console.log(`  报警表   : ${result.alarmCsvPath}`);
  if (result.manifestPath) console.log(`  manifest : ${result.manifestPath}`);
  console.log('');
  console.log('导入步骤：');
  console.log('  1) 复制纯 ST 模板：copy templates\\FX5U_ST_Template.gx3 %TEMP%\\run.gx3');
  console.log('  2) GX Works3 打开副本 → 工程 → 导入 → IEC61131-10 XML格式 → 选上面的 XML');
  console.log('  3) 转换 → 全部转换，检查 Error/Warning');
  return 0;
}

/**
 * `deliver <spec.json> [-o outdir] [--sim report.json] [--native-evidence a.png,b.png]`
 * 生成交付工程包：ST/XML/标签 + report.md + trace.json + delivery.json(SHA256)。
 */
async function cmdDeliver(args: Args): Promise<number> {
  const specPath = args._[0];
  if (!specPath) {
    console.error(
      '用法: ai-st-gxworks3 deliver <spec.json> [-o outdir] [--sim report.json] [--native-evidence 证据1,证据2]',
    );
    return 2;
  }
  const nativeRaw = typeof args['native-evidence'] === 'string' ? args['native-evidence'] : undefined;
  const nativeEvidencePaths = nativeRaw
    ? nativeRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;
  const target = typeof args.target === 'string' ? (args.target as 'FX5U' | 'FX5UJ' | 'iQ-R') : undefined;

  const result = await deliverFromSpec({
    specPath,
    outDir: typeof args.out === 'string' ? args.out : undefined,
    target,
    simReportPath: typeof args.sim === 'string' ? args.sim : undefined,
    nativeEvidencePaths,
  });

  console.log(formatDeliverySummary(result));
  console.log(`文件数：${result.files.length}（SHA256 清单见 delivery.json）`);
  for (const row of result.trace) {
    console.log(`  ${row.id}: 本地=${row.localCheck} 仿真=${row.sim} 原生=${row.nativeCompile}`);
  }
  if (!result.ok) {
    console.error('\n✖ 交付状态 FAIL（详见 report.md 失败诊断）');
    return 1;
  }
  console.log('\n✓ 交付包已生成（人工审查点见 report.md 第 6 节）');
  return 0;
}

/** `mcp`：启动内置 MCP Server（stdio）。 */
async function cmdMcp(): Promise<number> {
  await runMcpServer();
  return 0;
}

/** `style` 子命令：档案列表/查看/校验/合并 + 从生成物 diff 提取候选规则。 */
async function cmdStyle(args: Args): Promise<number> {
  const action = args._[0];
  const rest = args._.slice(1);
  const dir = typeof args.dir === 'string' ? args.dir : 'profiles';

  const walk = async (p: string): Promise<string[]> => {
    const out: string[] = [];
    let entries;
    try {
      entries = await readdir(resolve(p), { withFileTypes: true });
    } catch {
      return out;
    }
    for (const e of entries) {
      const fp = join(p, e.name);
      if (e.isDirectory()) out.push(...(await walk(fp)));
      else if (e.name.endsWith('.json')) out.push(fp);
    }
    return out;
  };

  if (!action || action === 'help') {
    console.log(`用法: ai-st-gxworks3 style <list|show|check|merge|candidates> [参数]`);
    console.log(`  style list [--dir profiles]                    列出全部习惯档案`);
    console.log(`  style show <profile.json>                      查看档案内容`);
    console.log(`  style check [<profile.json>...] [--dir profiles] 校验档案`);
    console.log(`  style merge <a.json> <b.json> [-o merged.json] 多级合并（后者覆盖前者）`);
    console.log(`  style candidates --generated gen.st --actual user.st [-o outdir]`);
    console.log(`                                                 对比生成物与用户修改，提取候选规则`);
    console.log(`  style adopt --profile p.json --candidates candidates.json [-o out.json] [--min high|medium] [--force]`);
    console.log(`                                                 把候选规则采纳进档案（有冲突时默认拒绝写盘）`);
    return 0;
  }

  if (action === 'list') {
    const files = await walk(dir);
    if (files.length === 0) {
      console.log(`（${dir} 下没有 json 档案）`);
      return 0;
    }
    for (const f of files) {
      const r = await loadStyleFile(f);
      if (!r.ok || !r.profile) {
        console.log(`✖ ${f}：${r.diagnostics.map((d) => d.message).join('; ')}`);
        continue;
      }
      const p = r.profile;
      console.log(
        `- ${p.name}${p.title ? ` — ${p.title}` : ''}` +
          `（scope=${p.scope ?? '-'}，语言=${p.labels?.language ?? '-'}，超时=${p.defaults?.cylinderTimeoutMs ?? '-'}ms）`,
      );
      console.log(`    ${f}`);
    }
    return 0;
  }

  if (action === 'show') {
    const file = rest[0];
    if (!file) {
      console.error('用法: ai-st-gxworks3 style show <profile.json>');
      return 2;
    }
    const r = await loadStyleFile(resolve(file));
    if (!r.ok || !r.profile) {
      console.error(`✖ 档案校验失败：${r.diagnostics.map((d) => d.message).join('; ')}`);
      return 1;
    }
    console.log(JSON.stringify(r.profile, null, 2));
    return 0;
  }

  if (action === 'check') {
    const files = rest.length > 0 ? rest : await walk(dir);
    let errors = 0;
    for (const f of files) {
      const r = await loadStyleFile(resolve(f));
      if (!r.ok) {
        errors++;
        console.error(`✖ ${f}：${r.diagnostics.map((d) => d.message).join('; ')}`);
        continue;
      }
      const ruleDiags = validateStyleProfile(r.profile!);
      const errs = styleErrors(ruleDiags);
      errors += errs.length;
      if (ruleDiags.length === 0) {
        console.log(`✓ ${f}`);
      } else {
        console.log(`▲ ${f}`);
        for (const d of ruleDiags) {
          console.log(`  ${d.severity === 'error' ? '✖' : '▲'} ${d.code}: ${d.message}`);
        }
      }
    }
    return errors > 0 ? 1 : 0;
  }

  if (action === 'merge') {
    if (rest.length === 0) {
      console.error('用法: ai-st-gxworks3 style merge <a.json> <b.json> ... [-o merged.json]');
      return 2;
    }
    const r = await resolveStyleFiles(rest.map((f) => resolve(f)));
    if (!r.ok || !r.profile) {
      console.error(`✖ 合并失败：${r.diagnostics.map((d) => d.message).join('; ')}`);
      return 1;
    }
    const out = typeof args.out === 'string' ? args.out : undefined;
    const text = JSON.stringify(r.profile, null, 2) + '\n';
    if (out) {
      await writeFile(resolve(out), text, 'utf8');
      console.log(`✓ 已合并 ${rest.length} 个档案 → ${out}`);
    } else {
      console.log(text);
    }
    return 0;
  }

  if (action === 'adopt') {
    const profilePath = typeof args.profile === 'string' ? args.profile : rest[0];
    const candidatesPath = typeof args.candidates === 'string' ? args.candidates : rest[1];
    if (!profilePath || !candidatesPath) {
      console.error(
        '用法: ai-st-gxworks3 style adopt --profile p.json --candidates candidates.json [-o out.json] [--min high|medium|low]',
      );
      return 2;
    }
    const loadedProfile = await loadStyleFile(resolve(profilePath));
    if (!loadedProfile.ok || !loadedProfile.profile) {
      console.error(`✖ 档案校验失败：${loadedProfile.diagnostics.map((d) => d.message).join('; ')}`);
      return 1;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(resolve(candidatesPath), 'utf8'));
    } catch (e) {
      console.error(`✖ 读取候选文件失败：${e instanceof Error ? e.message : String(e)}`);
      return 1;
    }
    const list = Array.isArray(raw)
      ? (raw as StyleCandidate[])
      : ((raw as { candidates?: StyleCandidate[] }).candidates ?? null);
    if (!Array.isArray(list)) {
      console.error('✖ 候选文件应为数组，或 style_candidates.json（含 candidates 字段）');
      return 1;
    }
    const minConfidence =
      args.min === 'high' || args.min === 'medium' || args.min === 'low'
        ? (args.min as 'high' | 'medium' | 'low')
        : 'medium';
    const adopted = adoptCandidates(loadedProfile.profile, list, { minConfidence });
    console.log(`采纳 ${adopted.adopted.length} 条候选规则（最低置信度 ${minConfidence}）：`);
    for (const a of adopted.adopted) console.log(`  ✓ ${a}`);
    if (adopted.skipped.length > 0) {
      console.log(`跳过 ${adopted.skipped.length} 条：`);
      for (const s of adopted.skipped) console.log(`  - ${s}`);
    }
    if (adopted.diagnostics.length > 0) {
      console.log(`规则校验：${adopted.diagnostics.length} 条提示`);
      for (const d of adopted.diagnostics) {
        console.log(`  ${d.severity === 'error' ? '✖' : '▲'} ${d.code}: ${d.message}`);
      }
    }
    const ruleErrors = styleErrors(adopted.diagnostics);
    if (ruleErrors.length > 0 && args.force !== true) {
      console.error(
        `✖ 采纳后档案存在 ${ruleErrors.length} 个规则冲突，未写盘（确认无误可加 --force）`,
      );
      return 1;
    }
    const out = typeof args.out === 'string' ? args.out : undefined;
    const text = JSON.stringify(adopted.profile, null, 2) + '\n';
    if (out) {
      await writeFile(resolve(out), text, 'utf8');
      console.log(`✓ 已写入 ${out}`);
    } else {
      console.log(text);
    }
    return 0;
  }

  if (action === 'candidates') {
    const gen = typeof args.generated === 'string' ? args.generated : undefined;
    const act = typeof args.actual === 'string' ? args.actual : undefined;
    if (!gen || !act) {
      console.error(
        '用法: ai-st-gxworks3 style candidates --generated gen.st --actual user_modified.st [-o outdir]',
      );
      return 2;
    }
    const report = extractStyleCandidates(await readFile(resolve(gen), 'utf8'), await readFile(resolve(act), 'utf8'));
    const md = renderCandidateMarkdown(report);
    console.log(md);
    const out = typeof args.out === 'string' ? args.out : undefined;
    if (out) {
      await mkdir(resolve(out), { recursive: true });
      await writeFile(resolve(out, 'style_candidates.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
      await writeFile(resolve(out, 'style_candidates.md'), md, 'utf8');
      console.log(`✓ 候选报告已写入 ${out}/style_candidates.json 与 .md`);
    }
    return report.ok ? 0 : 1;
  }

  console.error(`未知 style 动作：${action}（可用 list/show/check/merge/candidates）`);
  return 2;
}

async function cmdGenerate(args: Args): Promise<number> {
  const requirement = args._.join(' ') || (args.req as string);
  if (!requirement) {
    console.error('用法: ai-st-gxworks3 generate "控制需求描述" [--io io.txt] [--out out.st]');
    console.error('  或: ai-st-gxworks3 generate --req "控制需求描述"');
    return 2;
  }

  let ioTable: string | undefined;
  if (args.io && typeof args.io === 'string') {
    ioTable = await readFile(resolve(args.io), 'utf8');
  }

  console.log('正在调用 AI 生成 GX Works3 ST 代码…');
  let generated;
  try {
    generated = await generateST(
      {
        requirement,
        ioTable,
        existingVariables: typeof args.vars === 'string' ? await readFile(resolve(args.vars), 'utf8') : undefined,
        target: (args.target as 'FX5U' | 'iQ-R') ?? 'FX5U',
      },
      loadLLMConfig(),
    );
  } catch (e) {
    console.error(`✖ ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  console.log(`✓ AI 生成完成（尝试 ${generated.attempts} 次）`);

  const project = generated.json as AIGeneratedProject;
  const converted = convertAIGenerated(project);

  if (converted.warnings.length > 0) {
    console.log('\n转换告警:');
    for (const w of converted.warnings) console.log(`  ▲ ${w}`);
  }

  // 静态检查
  const diags = analyzeST(converted.ast, {
    target: (args.target as 'FX5U' | 'iQ-R') ?? 'FX5U',
  });
  const errors = printDiagnostics(diags, 'AI 生成结果');
  if (errors > 0) {
    console.error('\nAI 生成的结果未通过静态检查，建议修正需求后重试。');
  }

  // 输出：ST 源码 + 粘贴用文本 + 标签 CSV
  const stPath = (args.out as string) ?? 'generated.st';
  await mkdir(resolve(stPath, '..'), { recursive: true });
  await writeFile(resolve(stPath), converted.combined, 'utf8');
  console.log(`\n✓ ST 源码已保存: ${stPath}`);

  const outDir = stPath.replace(/\.st$/i, '');
  await mkdir(resolve(outDir), { recursive: true });

  for (const pou of converted.ast.pous) {
    const text = renderPOUAsText(pou, { includeComments: args.declare !== false });
    await writeFile(resolve(outDir, `${pou.name}.st`), text, 'utf8');
    const table = renderLocalLabelTable(pou);
    if (table) await writeFile(resolve(outDir, `${pou.name}_labels.txt`), table, 'utf8');
  }
  console.log(`✓ 粘贴用文本已保存: ${outDir}\\*.st`);
  console.log(`✓ 标签录入表已保存: ${outDir}\\*_labels.txt`);

  await writeFile(
    resolve(outDir, 'local_labels_table.txt'),
    renderVarSheetTable(converted.ast),
    'utf8',
  );
  console.log(`✓ 局部标签速查表已保存: ${outDir}\\local_labels_table.txt`);

  {
    const labelFiles = generateLabelCsvFiles(converted.ast, {
      projectName: (args.name as string) ?? undefined,
    });
    for (const f of labelFiles) {
      await writeFile(resolve(outDir, f.name), f.content);
    }
    console.log(`✓ 标签 CSV 已保存: ${outDir}\\*.csv`);
  }

  console.log('');
  console.log('导入步骤：');
  console.log('  1) 程序/FB 右键 → 局部标签 → 导入文件 → *_local_labels.csv');
  console.log('  2) 全局标签 右键 → 导入文件 → Global.csv');
  console.log('  3) 「程序本体」工作表粘贴对应 .st 内容');
  console.log('  4) 转换 → 全部转换');

  return errors > 0 ? 1 : 0;
}

function cmdPrompt(args: Args): void {
  const target = (args.target as 'FX5U' | 'iQ-R') ?? 'FX5U';
  console.log(buildSystemPrompt(target));
}

/* ------------------------------------------------------------------ */
/* 主入口                                                             */
/* ------------------------------------------------------------------ */

function usage(): void {
  console.log(`ai-st-gxworks3 —— 三菱 GX Works3 ST 代码生成与校验工具

用法:
  ai-st-gxworks3 check <file.st> [...]        校验 ST（语法 + 三菱方言检查）
  ai-st-gxworks3 gen <spec.json>              ★ Spec → 模板生成 ST + IEC XML 工程包
  ai-st-gxworks3 sim <scenario.json>           ★ 仿真场景校验 + 半自动断言（观测文件）
  ai-st-gxworks3 deliver <spec.json>          ★ 交付工程包（报告 + 追溯矩阵 + SHA256）
  ai-st-gxworks3 mcp                          启动 MCP Server（stdio，供 AI Agent 调用）
  ai-st-gxworks3 build-xml <file.st>          生成 IEC 61131-10 XML（可直接导入 GX Works3）
  ai-st-gxworks3 build-text <file.st>          生成 ST 文本 + 标签 CSV（备选通道）
  ai-st-gxworks3 generate "<需求>"             AI 生成 ST（LLM，旧流程）
  ai-st-gxworks3 prompt                       打印系统提示词
  ai-st-gxworks3 style list|show|check|merge|candidates
                                              编程习惯档案管理 / 修改 diff 候选规则提取

通用选项:
  --target FX5U|iQ-R     目标 CPU 系列（默认 FX5U）
  --no-declare           不生成顶部声明速查注释
  --no-warnings          只显示错误
  -o, --out <path>       输出文件或目录
  --name <name>          工程名（写入 CSV 第 1 行）
  --io <file>            IO 分配表文件
  --vars <file>          已有变量清单文件

示例:
  ai-st-gxworks3 check program.st
  ai-st-gxworks3 build-text program.st -o ./out
  ai-st-gxworks3 generate "电机启停控制，按下启动按钮运行10秒后自动停止" --io io.txt

导入 GX Works3（标签只能导入 CSV，XML 仅支持导出）：
  1) 程序/FB 右键 → 局部标签 → 导入文件 → *_local_labels.csv
  2) 全局标签   右键 → 导入文件 → Global.csv
  3) 「程序本体」工作表 → 全选 → 粘贴对应 .st
  4) 转换 → 全部转换
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    usage();
    return;
  }

  // check/build-xml 需要把第一个参数从 _ 中移除
  const rest = args._.slice(1);
  const cmdArgs: Args = { ...args, _: rest };

  let code = 0;
  switch (cmd) {
    case 'check':
      code = await cmdCheck(cmdArgs);
      break;
    case 'build-text':
      code = await cmdBuildText(cmdArgs);
      break;
    case 'build-xml':
      code = await cmdBuildXml(cmdArgs);
      break;
    case 'gen':
      code = await cmdGen(cmdArgs);
      break;
    case 'sim':
      code = await cmdSim(cmdArgs);
      break;
    case 'deliver':
      code = await cmdDeliver(cmdArgs);
      break;
    case 'mcp':
      code = await cmdMcp();
      break;
    case 'generate':
      code = await cmdGenerate(cmdArgs);
      break;
    case 'prompt':
      cmdPrompt(cmdArgs);
      break;
    case 'style':
      code = await cmdStyle(cmdArgs);
      break;
    default:
      console.error(`未知子命令: ${cmd}\n`);
      usage();
      code = 2;
  }

  process.exitCode = code;
}

main().catch((e) => {
  console.error(`✖ ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
