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

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

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
import { convertAIGenerated, type AIGeneratedProject } from './ai/convert.ts';
import { generateST, loadLLMConfig } from './ai/client.ts';
import { buildSystemPrompt } from './ai/prompt.ts';

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
        if (next && !next.startsWith('--')) {
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
  ai-st-gxworks3 build-xml <file.st>           ★ 生成 IEC 61131-10 XML（可直接导入 GX Works3）
  ai-st-gxworks3 build-text <file.st>          生成 ST 文本 + 标签 CSV（备选通道）
  ai-st-gxworks3 generate "<需求>"             AI 生成 ST + 文本 + 标签 CSV
  ai-st-gxworks3 prompt                       打印系统提示词

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
    case 'generate':
      code = await cmdGenerate(cmdArgs);
      break;
    case 'prompt':
      cmdPrompt(cmdArgs);
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
