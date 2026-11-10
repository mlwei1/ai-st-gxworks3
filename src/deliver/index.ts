/**
 * M3 交付工程包（deliver）。
 *
 * 在 `gen` 生成的工程包基础上，增加面向人工审查/归档的交付物：
 *   - report.md       人读的交付报告（规格摘要、IO 表、需求追溯矩阵、验证状态、导入步骤）
 *   - trace.json      机读的需求追溯矩阵（需求 → 模板/设备/产物/验证状态）
 *   - delivery.json   交付清单（文件 + SHA256 + 生成信息）
 *   - evidence/       可选：仿真报告、GX 编译证据截图等副本
 *
 * 设计原则：不隐藏失败——生成/校验失败时仍然产出报告，明确标出 FAIL 与诊断。
 */

import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';

import { generateFromSpec, type GenerateResult } from '../gen/generate.ts';
import type { RequirementSpec } from '../spec/index.ts';

export interface DeliveryOptions {
  /** spec 文件路径。 */
  specPath: string;
  /** 交付包输出目录；默认 `out/deliver_<spec.name>`。 */
  outDir?: string;
  /** 目标 CPU 覆盖，透传给 gen。 */
  target?: 'FX5U' | 'FX5UJ' | 'iQ-R';
  /** 仿真报告（`sim --observed` 生成的 report.json）路径，可选。 */
  simReportPath?: string;
  /** GX Works3 编译/导入证据文件路径（截图等），可选；会被复制进 evidence/。 */
  nativeEvidencePaths?: string[];
  /** 固定生成时间（测试用）。 */
  generatedAt?: string;
}

export type RequirementVerification = 'pass' | 'fail' | 'not-run';

export interface TraceRow {
  id: string;
  text: string;
  /** 命中需求文本的软元件（如 X0 / Y0）。 */
  devices: string[];
  /** 对应的 IO 名称（`device:name`）。 */
  io: string[];
  /** 该需求所属模板。 */
  template: string;
  /** 相关产物（相对交付包根目录）。 */
  artifacts: string[];
  localCheck: RequirementVerification;
  sim: RequirementVerification;
  nativeCompile: RequirementVerification;
  note: string;
}

export interface DeliverySummary {
  name: string;
  title?: string;
  cpu: string;
  template: string;
  generator: string;
  generatedAt: string;
  ok: boolean;
  requirementCount: number;
  passCount: number;
  failCount: number;
  simReport?: { path: string; ok: boolean; mismatchCount: number } | null;
  diagnostics: { errors: number; warnings: number };
}

export interface DeliveryResult {
  ok: boolean;
  outDir: string;
  specPath: string;
  files: Array<{ path: string; sha256: string; bytes: number }>;
  reportPath?: string;
  tracePath?: string;
  deliveryPath?: string;
  trace: TraceRow[];
  summary: DeliverySummary;
  generation: GenerateResult;
}

const DEVICE_RE = /\b(?:X|Y|M|S|T|C|D|R|L|B|W)[0-9]+(?:\.[0-9]+)?\b/g;

function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

function relTo(root: string, p: string): string {
  return relative(root, p).replace(/\\/g, '/');
}

function countDiagnostics(g: GenerateResult): { errors: number; warnings: number } {
  const all = [...g.specDiagnostics, ...g.diagnostics];
  const errors = all.filter((d) => d.severity === 'error').length;
  const warnings = all.filter((d) => d.severity === 'warning').length + g.warnings.length;
  return { errors, warnings };
}

/** 从需求文本中抽取软元件，并映射到 spec.io 的名称。 */
function devicesForRequirement(text: string, spec: RequirementSpec): { devices: string[]; io: string[] } {
  const devices = Array.from(new Set(text.match(DEVICE_RE) ?? []));
  const byDevice = new Map(spec.io.map((b) => [b.device.toUpperCase(), b]));
  const io: string[] = [];
  for (const d of devices) {
    const hit = byDevice.get(d.toUpperCase());
    if (hit) io.push(`${hit.device}:${hit.name}`);
  }
  return { devices, io };
}

function readSimReport(raw: unknown): { ok: boolean; mismatchCount: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.ok !== 'boolean') return null;
  return { ok: r.ok, mismatchCount: Number(r.mismatchCount ?? 0) };
}

/** 交付包默认输出目录。 */
export function defaultDeliveryDir(specName: string): string {
  return resolve('out', `deliver_${specName}`);
}

/**
 * 生成交付工程包。不抛异常：失败时同样写出 report/trace，并返回 ok=false。
 */
export async function deliverFromSpec(options: DeliveryOptions): Promise<DeliveryResult> {
  const specPath = resolve(options.specPath);
  const outDir = options.outDir ? resolve(options.outDir) : defaultDeliveryDir(basename(specPath, '.json'));
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  await mkdir(outDir, { recursive: true });

  const artifactsDir = resolve(outDir, 'artifacts');
  const generation = await generateFromSpec(specPath, {
    outDir: artifactsDir,
    target: options.target,
  });

  // 可选证据归档
  const evidenceFiles: string[] = [];
  const evidenceDir = resolve(outDir, 'evidence');
  if (options.simReportPath) {
    await mkdir(evidenceDir, { recursive: true });
    const simAbs = resolve(options.simReportPath);
    const dst = resolve(evidenceDir, 'sim-report.json');
    await copyFile(simAbs, dst);
    evidenceFiles.push(relTo(outDir, dst));
  }
  for (const ev of options.nativeEvidencePaths ?? []) {
    const evAbs = resolve(ev);
    await mkdir(evidenceDir, { recursive: true });
    const dst = resolve(evidenceDir, basename(evAbs));
    await copyFile(evAbs, dst);
    evidenceFiles.push(relTo(outDir, dst));
  }

  let sim: { ok: boolean; mismatchCount: number } | null = null;
  if (options.simReportPath) {
    try {
      sim = readSimReport(JSON.parse(await readFile(resolve(options.simReportPath), 'utf8')));
    } catch {
      sim = null;
    }
  }

  const spec = generation.spec;
  const template = spec?.template.name ?? generation.templateName ?? '(unknown)';
  const localCheck: RequirementVerification = generation.ok ? 'pass' : 'fail';
  const simStatus: RequirementVerification = sim ? (sim.ok ? 'pass' : 'fail') : 'not-run';
  const native: RequirementVerification =
    options.nativeEvidencePaths && options.nativeEvidencePaths.length > 0 ? 'pass' : 'not-run';

  const artifactNames = [generation.stPath, generation.xmlPath]
    .filter((p): p is string => typeof p === 'string')
    .map((p) => relTo(outDir, resolve(p)));

  const trace: TraceRow[] = (spec?.requirements ?? []).map((req) => {
    const { devices, io } = devicesForRequirement(req.text, spec as RequirementSpec);
    const note = generation.ok
      ? simStatus === 'pass'
        ? '本地检查通过，仿真场景通过'
        : simStatus === 'fail'
          ? '本地检查通过，仿真场景失败（见 evidence/sim-report.json）'
          : '本地检查通过；仿真/原生编译未接入'
      : '本地检查失败，详见 artifacts/diagnostics.json';
    return {
      id: req.id,
      text: req.text,
      devices,
      io,
      template,
      artifacts: artifactNames,
      localCheck,
      sim: simStatus,
      nativeCompile: native,
      note,
    };
  });

  const passCount = trace.filter((r) => r.localCheck === 'pass' && r.sim !== 'fail').length;
  const failCount = trace.length - passCount;
  const summary: DeliverySummary = {
    name: spec?.name ?? basename(specPath, '.json'),
    title: spec?.title,
    cpu: spec ? `${spec.cpu.series}${spec.cpu.model ? ` / ${spec.cpu.model}` : ''}` : 'unknown',
    template,
    generator: generation.generator ?? (generation.ok ? 'template' : 'failed'),
    generatedAt,
    ok: generation.ok && simStatus !== 'fail',
    requirementCount: trace.length,
    passCount,
    failCount,
    simReport: options.simReportPath ? { path: 'evidence/sim-report.json', ok: sim?.ok ?? false, mismatchCount: sim?.mismatchCount ?? -1 } : null,
    diagnostics: countDiagnostics(generation),
  };

  const reportPath = resolve(outDir, 'report.md');
  const tracePath = resolve(outDir, 'trace.json');
  const deliveryPath = resolve(outDir, 'delivery.json');

  await writeFile(reportPath, renderReport(summary, generation, trace, evidenceFiles), 'utf8');
  await writeFile(tracePath, JSON.stringify({ generatedAt, spec: specPath, trace }, null, 2), 'utf8');

  // 收集文件清单 + SHA256（delivery.json 自身不列入，避免自引用哈希）
  const files: DeliveryResult['files'] = [];
  const collect = async (dir: string): Promise<void> => {
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        await collect(abs);
      } else if (relTo(outDir, abs) !== 'delivery.json') {
        const buf = await readFile(abs);
        files.push({ path: relTo(outDir, abs), sha256: sha256(buf), bytes: buf.length });
      }
    }
  };
  await collect(outDir);
  files.sort((a, b) => a.path.localeCompare(b.path));
  await writeFile(
    deliveryPath,
    JSON.stringify({ generatedAt, spec: specPath, summary, evidenceFiles, files }, null, 2),
    'utf8',
  );

  return {
    ok: summary.ok,
    outDir,
    specPath,
    files,
    reportPath,
    tracePath,
    deliveryPath,
    trace,
    summary,
    generation,
  };
}

/** 人读交付报告（Markdown）。 */
function renderReport(
  summary: DeliverySummary,
  g: GenerateResult,
  trace: TraceRow[],
  evidenceFiles: string[],
): string {
  const lines: string[] = [];
  lines.push(`# 交付报告：${summary.title ?? summary.name}`);
  lines.push('');
  lines.push(`- 工程名：\`${summary.name}\``);
  lines.push(`- CPU：${summary.cpu}`);
  lines.push(`- 模板：\`${summary.template}\`（生成方式：${summary.generator}）`);
  lines.push(`- 生成时间：${summary.generatedAt}`);
  lines.push(`- 交付状态：**${summary.ok ? 'PASS' : 'FAIL'}**（需求 ${summary.passCount}/${summary.requirementCount} 通过）`);
  if (summary.simReport) {
    lines.push(
      `- 仿真报告：${summary.simReport.ok ? 'PASS' : 'FAIL'}（不一致 ${summary.simReport.mismatchCount} 处，见 \`evidence/sim-report.json\`）`,
    );
  }
  lines.push('');

  lines.push('## 1. 交付文件');
  lines.push('');
  lines.push('| 文件 | 说明 |');
  lines.push('|---|---|');
  lines.push('| `artifacts/*.st` | ST 源码（人工审查主文件） |');
  lines.push('| `artifacts/*.xml` | IEC 61131-10 工程包（GX Works3 导入） |');
  lines.push('| `artifacts/*.csv` | 标签表（备选导入通道） |');
  lines.push('| `artifacts/manifest.json` | 生成记录（spec/模板/诊断） |');
  lines.push('| `trace.json` | 需求追溯矩阵（机读） |');
  lines.push('| `delivery.json` | 交付清单 + SHA256 |');
  if (evidenceFiles.length > 0) lines.push('| `evidence/*` | 仿真报告 / GX 编译证据副本 |');
  lines.push('');

  lines.push('## 2. 需求追溯矩阵');
  lines.push('');
  lines.push('| 需求 | 内容 | 软元件 | 本地检查 | 仿真 | 原生编译 |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of trace) {
    const devices = r.io.length > 0 ? r.io.join('<br>') : r.devices.join(', ') || '—';
    lines.push(
      `| ${r.id} | ${r.text.replace(/\|/g, '\\|')} | ${devices} | ${r.localCheck} | ${r.sim} | ${r.nativeCompile} |`,
    );
  }
  lines.push('');

  lines.push('## 3. 验证状态');
  lines.push('');
  lines.push(`- 本地检查：${summary.diagnostics.errors === 0 ? '✓ 通过（0 error）' : `✖ ${summary.diagnostics.errors} error`}`);
  lines.push(`- 警告：${summary.diagnostics.warnings} 条`);
  lines.push(`- 编译/导入证据：${evidenceFiles.some((e) => e.includes('evidence/')) ? '见 evidence/' : '未提供'}`);
  lines.push('');

  lines.push('## 4. 诊断摘要');
  lines.push('');
  lines.push(`- error：${summary.diagnostics.errors} 条`);
  lines.push(`- warning：${summary.diagnostics.warnings} 条`);
  if (!g.ok) {
    lines.push('');
    const errs = [...g.specDiagnostics, ...g.diagnostics].filter((d) => d.severity === 'error');
    for (const e of errs) {
      const loc = 'path' in e ? e.path : (e as { line?: number }).line;
      lines.push(`- ${e.code}${loc !== undefined ? ` @${loc}` : ''}: ${e.message}`);
    }
    if (errs.length === 0) lines.push('- （无 error 诊断，但生成未完成，请检查 artifacts/diagnostics.json）');
  } else if (summary.diagnostics.warnings > 0) {
    lines.push('');
    lines.push('> 存在警告，建议人工确认（详见 `artifacts/diagnostics.json`）。');
  }
  lines.push('');

  lines.push('## 5. 导入 GX Works3');
  lines.push('');
  lines.push('1. 打开已配置 FX5U CPU 参数/任务的 GX Works3 工程（推荐模板工程）；');
  lines.push('2. 工程 → 导入 → IEC61131-10 XML 格式 → 选择 `artifacts/*.xml`；');
  lines.push('3. 转换 → 全部转换，确认 Error 0；');
  lines.push('4. 需要时钟/扫描设置时按工程模板核对（生成的程序执行类型为 scan）。');
  lines.push('');

  lines.push('## 6. 人工审查点');
  lines.push('');
  lines.push('- [ ] IO 表与现场接线一致（设备地址、常开/常闭）；');
  lines.push('- [ ] 需求条款与 ST 逻辑逐条对照（见 trace.json）；');
  lines.push('- [ ] 安全/联锁回路由人工复核（本工具不做安全 PLC 逻辑）；');
  lines.push('- [ ] 现场联调前先在 GX Simulator3 跑仿真场景。');
  lines.push('');
  return lines.join('\n');
}

/** 供 CLI 打印：简短摘要行。 */
export function formatDeliverySummary(result: DeliveryResult): string {
  const s = result.summary;
  return [
    `交付包：${result.outDir}`,
    `状态：${s.ok ? 'PASS' : 'FAIL'}（需求 ${s.passCount}/${s.requirementCount}）`,
    `报告：${result.reportPath ?? '—'}`,
    `追溯：${result.tracePath ?? '—'}`,
    `清单：${result.deliveryPath ?? '—'}`,
  ].join('\n');
}

/** 相对路径检查辅助（供测试/CLI 使用）。 */
export function isInsidePackage(outDir: string, file: string): boolean {
  const rel = relative(resolve(outDir), resolve(file));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/** 供测试：读取交付清单。 */
export async function readDeliveryManifest(outDir: string): Promise<{ files: DeliveryResult['files']; summary: DeliverySummary }> {
  const raw = JSON.parse(await readFile(resolve(outDir, 'delivery.json'), 'utf8')) as {
    files?: unknown;
    summary?: DeliverySummary;
  };
  const files = Array.isArray(raw.files) ? (raw.files as DeliveryResult['files']) : [];
  const summary = raw.summary as DeliverySummary;
  return { files, summary };
}

/** 目录是否存在（小工具）。 */
export async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
