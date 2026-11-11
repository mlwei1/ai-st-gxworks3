/**
 * ST → IEC 61131-10 XML 构建（供 MCP / 后续 CLI 复用）。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

import { parseWithRecovery } from '../dialect/recovery.ts';
import { analyzeST, type Diagnostic } from '../dialect/analyzer.ts';
import { astToIecProject } from '../emit/iec-project.ts';
import { emitIecXml } from '../emit/iecxml.ts';
import { generateLabelCsvFiles } from '../emit/label-csv.ts';
import { extractPouBodies } from './pou-text.ts';

export interface BuildXmlOptions {
  /** XML 内程序内容名（默认 ST 文件名）。 */
  projectName?: string;
  /** 目标 CPU（FX5U / FX5UJ）。 */
  target?: 'FX5U' | 'FX5UJ';
  /** 输出目录（默认 ST 文件所在目录）。 */
  outDir?: string;
}

export interface BuildXmlResult {
  ok: boolean;
  stPath: string;
  xmlPath?: string;
  labelFiles: string[];
  diagnostics: Diagnostic[];
  warnings: string[];
}

/** 从 ST 文件构建 XML + 标签 CSV；不抛异常，失败以 diagnostics 返回。 */
export async function buildXmlFromStFile(
  stFilePath: string,
  options: BuildXmlOptions = {},
): Promise<BuildXmlResult> {
  const stPath = resolve(stFilePath);
  const outDir = options.outDir ? resolve(options.outDir) : resolve(stPath, '..');
  const projectName = options.projectName ?? basename(stPath).replace(/\.st$/i, '');
  const result: BuildXmlResult = { ok: false, stPath, labelFiles: [], diagnostics: [], warnings: [] };

  const source = await readFile(stPath, 'utf8');
  const { ast, errors } = parseWithRecovery(source);
  for (const e of errors) {
    result.diagnostics.push({
      severity: 'error',
      code: 'PARSE',
      message: e.message,
      line: e.line,
      column: e.column,
    } as Diagnostic);
  }
  if (errors.length === 0) {
    const target = options.target ?? 'FX5U';
    result.diagnostics.push(...analyzeST(ast, { target }));
  }
  if (result.diagnostics.some((d) => d.severity === 'error')) return result;

  const mapped = astToIecProject(ast, {
    contentName: projectName,
    createdAt: new Date().toISOString(),
    // 保留原始正文注释（AST 不携带语句级注释）
    bodyTexts: extractPouBodies(source),
  });
  result.warnings.push(...mapped.warnings);
  const xml = emitIecXml(mapped.project);

  await mkdir(outDir, { recursive: true });
  const xmlPath = resolve(outDir, `${projectName}.xml`);
  await writeFile(xmlPath, xml, 'utf8');
  result.xmlPath = xmlPath;

  try {
    const labels = generateLabelCsvFiles(ast, { projectName });
    for (const f of labels) {
      const p = resolve(outDir, f.name);
      await writeFile(p, f.content);
      result.labelFiles.push(p);
    }
  } catch (e) {
    result.warnings.push(`标签 CSV 生成失败（不影响 XML）：${e instanceof Error ? e.message : String(e)}`);
  }

  result.ok = true;
  return result;
}
