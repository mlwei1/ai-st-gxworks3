/**
 * Spec 层统一入口。
 *
 * 供 CLI `gen` 使用的最小代码：
 *   import { loadSpecFile, formatSpecDiagnostics } from './spec/index.ts';
 *   const { ok, spec, diagnostics } = await loadSpecFile(path);
 *   if (!ok) { console.error(formatSpecDiagnostics(diagnostics)); process.exitCode = 1; }
 *   else generateFromSpec(spec!);
 */

export type {
  CpuSeries,
  CpuSpec,
  IoBinding,
  IoType,
  RequirementItem,
  RequirementSpec,
  SafetySpec,
  SpecDiagnostic,
  SpecLoadResult,
  SpecMeta,
  SpecSeverity,
  TemplateSpec,
  VarBinding,
  VarScope,
  KnownTemplateName,
} from './schema.ts';

export {
  CPU_SERIES,
  IO_TYPES,
  KNOWN_TEMPLATES,
  SPEC_JSON_SCHEMA,
  VAR_SCOPES,
  isKnownTemplate,
} from './schema.ts';

export {
  formatSpecDiagnostics,
  loadSpecFile,
  loadSpecFileSync,
  loadSpecText,
  parseSpec,
  validateSpec,
} from './load.ts';
