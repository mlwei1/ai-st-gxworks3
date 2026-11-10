/**
 * RequirementSpec 加载与校验。
 *
 * 纯函数入口：`parseSpec(input)`（对象或 JSON 字符串）。
 * 文件入口：`loadSpecFile(path)`（异步）/ `loadSpecFileSync(path)`（同步）。
 *
 * 校验与 `src/profile` 联动：IO/vars 的设备地址按 FX5U/FX5UJ 的进制与范围校验
 * （X/Y 八进制、B/W/SB/SW 十六进制，范围来自 profile）。
 *
 * 返回结构（供 CLI `gen` 使用）：
 *   { ok: boolean, spec: RequirementSpec | null, diagnostics: SpecDiagnostic[] }
 *  - ok=true 时 spec 一定非空（warning 不影响 ok）；
 *  - ok=false 时 spec=null，diagnostics 至少含一条 error。
 */

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import {
  CPU_SERIES,
  IO_TYPES,
  KNOWN_TEMPLATES,
  VAR_SCOPES,
  isKnownTemplate,
} from './schema.ts';
import type {
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
} from './schema.ts';
import { checkDeviceNumber, getDeviceFact } from '../profile/index.ts';
import { parseDeviceAddress } from '../dialect/instructions.ts';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function err(diagnostics: SpecDiagnostic[], code: string, path: string, message: string): void {
  diagnostics.push({ severity: 'error', code, path, message });
}

function warn(diagnostics: SpecDiagnostic[], code: string, path: string, message: string): void {
  diagnostics.push({ severity: 'warning', code, path, message });
}

function severityOf(diagnostics: SpecDiagnostic[], severity: SpecSeverity): number {
  return diagnostics.filter((d) => d.severity === severity).length;
}

function cpuModelOf(series: CpuSeries): 'FX5U' | 'FX5UJ' {
  return series === 'FX5UJ' ? 'FX5UJ' : 'FX5U';
}

/**
 * 校验并规范化一个设备地址。
 * @returns 规范化后的地址（去空白、大写）；无效时返回 null（已写诊断）。
 */
function validateDevice(
  raw: unknown,
  path: string,
  series: CpuSeries,
  diagnostics: SpecDiagnostic[],
): string | null {
  if (!isNonEmptyString(raw)) {
    err(diagnostics, 'SPEC_E_IO_DEVICE_FORMAT', path, '设备地址必须是非空字符串（如 X0 / Y0 / D100）');
    return null;
  }
  const device = raw.trim();
  const parsed = parseDeviceAddress(device);
  if (!parsed) {
    err(
      diagnostics,
      'SPEC_E_IO_DEVICE_FORMAT',
      path,
      `设备地址 '${device}' 格式无效，应形如 X0 / Y0 / D100 / M1000`,
    );
    return null;
  }
  const model = cpuModelOf(series);
  const check = checkDeviceNumber(parsed.prefix, parsed.number, model);
  if (check === 'unknown-prefix') {
    err(
      diagnostics,
      'SPEC_E_IO_DEVICE_PREFIX',
      path,
      `设备前缀 '${parsed.prefix}' 不是 ${model} 软元件（常见：X/Y/M/L/B/S/T/C/D/W/R/Z/SM/SD）`,
    );
    return null;
  }
  if (!parsed.validDigits) {
    const base = parsed.base === 8 ? '八进制' : parsed.base === 16 ? '十六进制' : '十进制';
    err(
      diagnostics,
      'SPEC_E_IO_DEVICE_BASE',
      path,
      `设备地址 '${device}' 含非法${base}数字（${parsed.prefix} 的编号为${base}，如 X/Y 只能用 0~7）`,
    );
    return null;
  }
  if (check === 'out-of-range') {
    err(
      diagnostics,
      'SPEC_E_IO_DEVICE_RANGE',
      path,
      `设备地址 '${device}' 超出 ${model} ${parsed.prefix} 的有效范围（请参考 src/profile）`,
    );
    return null;
  }
  if (check === 'range-unverified') {
    warn(
      diagnostics,
      'SPEC_W_IO_DEVICE_RANGE_UNVERIFIED',
      path,
      `设备 '${device}' 所属软元件范围尚未核实（系统软元件），仅校验了进制`,
    );
  }
  return device.toUpperCase();
}

/** 校验 cpu 段。 */
function parseCpu(raw: unknown, diagnostics: SpecDiagnostic[]): CpuSpec | null {
  if (!isPlainObject(raw)) {
    err(diagnostics, 'SPEC_E_CPU', 'cpu', 'cpu 必须是对象，如 { "series": "FX5U" }');
    return null;
  }
  const series = raw.series;
  if (typeof series !== 'string' || !(CPU_SERIES as readonly string[]).includes(series)) {
    err(
      diagnostics,
      'SPEC_E_CPU_SERIES',
      'cpu.series',
      `cpu.series 必须是 ${CPU_SERIES.join(' / ')} 之一，实际 ${JSON.stringify(series)}`,
    );
    return null;
  }
  if (raw.model !== undefined && typeof raw.model !== 'string') {
    err(diagnostics, 'SPEC_E_CPU_MODEL', 'cpu.model', 'cpu.model 必须是字符串');
    return null;
  }
  const cpu: CpuSpec = { series: series as CpuSeries };
  if (typeof raw.model === 'string') cpu.model = raw.model;
  return cpu;
}

/** 校验 template 段。 */
function parseTemplate(raw: unknown, diagnostics: SpecDiagnostic[]): TemplateSpec | null {
  if (!isPlainObject(raw)) {
    err(diagnostics, 'SPEC_E_TEMPLATE', 'template', 'template 必须是对象，如 { "name": "timer_sequence" }');
    return null;
  }
  if (!isNonEmptyString(raw.name)) {
    err(diagnostics, 'SPEC_E_TEMPLATE_NAME', 'template.name', 'template.name 必须是非空字符串');
    return null;
  }
  if (!isKnownTemplate(raw.name)) {
    err(
      diagnostics,
      'SPEC_E_TEMPLATE_UNKNOWN',
      'template.name',
      `未知模板 '${raw.name}'；已知模板：${KNOWN_TEMPLATES.join(', ')}`,
    );
    return null;
  }
  const template: TemplateSpec = { name: raw.name };
  if (raw.params !== undefined) {
    if (!isPlainObject(raw.params)) {
      err(diagnostics, 'SPEC_E_TEMPLATE_PARAMS', 'template.params', 'template.params 必须是对象');
      return null;
    }
    const params: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(raw.params)) {
      if (!key.trim()) {
        err(diagnostics, 'SPEC_E_TEMPLATE_PARAM_NAME', 'template.params', 'template.params 的参数名不能为空');
        continue;
      }
      if (typeof value === 'number' && !Number.isFinite(value)) {
        err(
          diagnostics,
          'SPEC_E_TEMPLATE_PARAM_VALUE',
          `template.params.${key}`,
          `模板参数 '${key}' 必须是有限的 string/number/boolean`,
        );
        continue;
      }
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        err(
          diagnostics,
          'SPEC_E_TEMPLATE_PARAM_VALUE',
          `template.params.${key}`,
          `模板参数 '${key}' 必须是 string/number/boolean 标量`,
        );
        continue;
      }
      params[key] = value;
    }
    template.params = params;
  }
  return template;
}

/** 校验 io 段（含重复 name/device）。 */
function parseIo(
  raw: unknown,
  series: CpuSeries,
  diagnostics: SpecDiagnostic[],
): IoBinding[] | null {
  if (!Array.isArray(raw)) {
    err(diagnostics, 'SPEC_E_IO', 'io', 'io 必须是数组（可为空数组）');
    return null;
  }
  const items: IoBinding[] = [];
  const seenNames = new Set<string>();
  const seenDevices = new Set<string>();
  raw.forEach((entry, i) => {
    const path = `io[${i}]`;
    if (!isPlainObject(entry)) {
      err(diagnostics, 'SPEC_E_IO_ITEM', path, 'io 的每一项必须是对象');
      return;
    }
    let valid = true;
    const name = entry.name;
    if (!isNonEmptyString(name)) {
      err(diagnostics, 'SPEC_E_IO_NAME', `${path}.name`, 'io[].name 必须是非空字符串');
      valid = false;
    } else if (!IDENTIFIER.test(name)) {
      err(
        diagnostics,
        'SPEC_E_IO_NAME_INVALID',
        `${path}.name`,
        `IO 名称 '${name}' 不是合法标识符（只允许字母/数字/下划线且不以数字开头）`,
      );
      valid = false;
    } else if (seenNames.has(name)) {
      err(diagnostics, 'SPEC_E_IO_DUPLICATE_NAME', `${path}.name`, `IO 名称 '${name}' 重复`);
      valid = false;
    } else {
      seenNames.add(name);
    }

    const type = entry.type;
    if (typeof type !== 'string' || !(IO_TYPES as readonly string[]).includes(type)) {
      err(
        diagnostics,
        'SPEC_E_IO_TYPE',
        `${path}.type`,
        `io[].type 必须是 ${IO_TYPES.join(' / ')} 之一，实际 ${JSON.stringify(type)}`,
      );
      valid = false;
    } else if (entry.comment !== undefined && typeof entry.comment !== 'string') {
      err(diagnostics, 'SPEC_E_IO_COMMENT', `${path}.comment`, 'io[].comment 必须是字符串');
      valid = false;
    }

    const device = validateDevice(entry.device, `${path}.device`, series, diagnostics);
    if (device === null) {
      valid = false;
    } else if (seenDevices.has(device)) {
      err(diagnostics, 'SPEC_E_IO_DUPLICATE_DEVICE', `${path}.device`, `设备 '${device}' 重复绑定`);
      valid = false;
    } else {
      seenDevices.add(device);
    }

    if (valid && name !== undefined && type !== undefined && device !== null) {
      const binding: IoBinding = { device, name: name as string, type: type as IoType };
      if (typeof entry.comment === 'string') binding.comment = entry.comment;
      items.push(binding);
    }
  });
  return items;
}

/** 校验 vars 段（可选）。 */
function parseVars(
  raw: unknown,
  series: CpuSeries,
  diagnostics: SpecDiagnostic[],
): VarBinding[] | null {
  if (raw === undefined) return null;
  if (!Array.isArray(raw)) {
    err(diagnostics, 'SPEC_E_VARS', 'vars', 'vars 必须是数组');
    return null;
  }
  const items: VarBinding[] = [];
  const seen = new Set<string>();
  raw.forEach((entry, i) => {
    const path = `vars[${i}]`;
    if (!isPlainObject(entry)) {
      err(diagnostics, 'SPEC_E_VAR_ITEM', path, 'vars 的每一项必须是对象');
      return;
    }
    let valid = true;
    const name = entry.name;
    if (!isNonEmptyString(name)) {
      err(diagnostics, 'SPEC_E_VAR_NAME', `${path}.name`, 'vars[].name 必须是非空字符串');
      valid = false;
    } else if (!IDENTIFIER.test(name)) {
      err(diagnostics, 'SPEC_E_VAR_NAME_INVALID', `${path}.name`, `变量名 '${name}' 不是合法标识符`);
      valid = false;
    } else if (seen.has(name)) {
      err(diagnostics, 'SPEC_E_VAR_DUPLICATE_NAME', `${path}.name`, `变量名 '${name}' 重复`);
      valid = false;
    } else {
      seen.add(name);
    }

    const type = entry.type;
    if (!isNonEmptyString(type)) {
      err(diagnostics, 'SPEC_E_VAR_TYPE', `${path}.type`, 'vars[].type 必须是非空字符串');
      valid = false;
    }
    const scope = entry.scope;
    if (typeof scope !== 'string' || !(VAR_SCOPES as readonly string[]).includes(scope)) {
      err(
        diagnostics,
        'SPEC_E_VAR_SCOPE',
        `${path}.scope`,
        `vars[].scope 必须是 ${VAR_SCOPES.join(' / ')} 之一`,
      );
      valid = false;
    }
    for (const field of ['initial', 'comment'] as const) {
      if (entry[field] !== undefined && typeof entry[field] !== 'string') {
        err(diagnostics, 'SPEC_E_VAR_FIELD', `${path}.${field}`, `vars[].${field} 必须是字符串`);
        valid = false;
      }
    }
    let device: string | undefined;
    if (entry.device !== undefined) {
      const checked = validateDevice(entry.device, `${path}.device`, series, diagnostics);
      if (checked === null) valid = false;
      else device = checked;
    }
    if (valid && name !== undefined && type !== undefined && scope !== undefined) {
      const binding: VarBinding = { name: name as string, type: type as string, scope: scope as VarScope };
      if (typeof entry.initial === 'string') binding.initial = entry.initial;
      if (device) binding.device = device;
      if (typeof entry.comment === 'string') binding.comment = entry.comment;
      items.push(binding);
    }
  });
  return items;
}

/** 校验 requirements 段（非空、id 唯一）。 */
function parseRequirements(
  raw: unknown,
  diagnostics: SpecDiagnostic[],
): RequirementItem[] | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    err(diagnostics, 'SPEC_E_REQUIREMENTS', 'requirements', 'requirements 必须是非空数组');
    return null;
  }
  const items: RequirementItem[] = [];
  const seenIds = new Set<string>();
  raw.forEach((entry, i) => {
    const path = `requirements[${i}]`;
    if (!isPlainObject(entry)) {
      err(diagnostics, 'SPEC_E_REQ_ITEM', path, 'requirements 的每一项必须是对象');
      return;
    }
    let valid = true;
    if (!isNonEmptyString(entry.id)) {
      err(diagnostics, 'SPEC_E_REQ_ID', `${path}.id`, 'requirements[].id 必须是非空字符串');
      valid = false;
    } else if (seenIds.has(entry.id)) {
      err(diagnostics, 'SPEC_E_REQ_DUPLICATE_ID', `${path}.id`, `需求 id '${entry.id}' 重复`);
      valid = false;
    } else {
      seenIds.add(entry.id);
    }
    if (!isNonEmptyString(entry.text)) {
      err(diagnostics, 'SPEC_E_REQ_TEXT', `${path}.text`, 'requirements[].text 必须是非空字符串');
      valid = false;
    }
    if (valid && entry.id !== undefined && entry.text !== undefined) {
      items.push({ id: entry.id as string, text: entry.text as string });
    }
  });
  return items;
}

/** 校验 safety 段（可选）。 */
function parseSafety(
  raw: unknown,
  series: CpuSeries,
  diagnostics: SpecDiagnostic[],
): SafetySpec | null {
  if (raw === undefined) return null;
  if (!isPlainObject(raw)) {
    err(diagnostics, 'SPEC_E_SAFETY', 'safety', 'safety 必须是对象');
    return null;
  }
  const safety: SafetySpec = {};
  if (raw.estop !== undefined) {
    if (!isNonEmptyString(raw.estop)) {
      err(diagnostics, 'SPEC_E_SAFETY_ESTOP', 'safety.estop', 'safety.estop 必须是非空字符串');
    } else {
      const parsed = parseDeviceAddress(raw.estop.trim());
      const isDeviceLike = parsed !== null && getDeviceFact(parsed.prefix) !== undefined;
      if (isDeviceLike) {
        // 看起来是软元件地址 → 按设备规则校验；否则视为变量名/描述，接受
        const checked = validateDevice(raw.estop, 'safety.estop', series, diagnostics);
        if (checked !== null) safety.estop = checked;
      } else {
        safety.estop = raw.estop;
      }
    }
  }
  if (raw.interlocks !== undefined) {
    if (!Array.isArray(raw.interlocks)) {
      err(diagnostics, 'SPEC_E_SAFETY_INTERLOCKS', 'safety.interlocks', 'safety.interlocks 必须是字符串数组');
    } else {
      const interlocks: string[] = [];
      raw.interlocks.forEach((item, i) => {
        if (!isNonEmptyString(item)) {
          err(
            diagnostics,
            'SPEC_E_SAFETY_INTERLOCK_ITEM',
            `safety.interlocks[${i}]`,
            '互锁条件必须是非空字符串',
          );
        } else {
          interlocks.push(item);
        }
      });
      safety.interlocks = interlocks;
    }
  }
  return safety;
}

/** 校验 meta 段（可选）。 */
function parseMeta(raw: unknown, diagnostics: SpecDiagnostic[]): SpecMeta | null {
  if (raw === undefined) return null;
  if (!isPlainObject(raw)) {
    err(diagnostics, 'SPEC_E_META', 'meta', 'meta 必须是对象');
    return null;
  }
  const meta: SpecMeta = {};
  for (const field of ['version', 'createdAt'] as const) {
    if (raw[field] !== undefined) {
      if (typeof raw[field] !== 'string') {
        err(diagnostics, 'SPEC_E_META_FIELD', `meta.${field}`, `meta.${field} 必须是字符串`);
      } else {
        meta[field] = raw[field] as string;
      }
    }
  }
  return meta;
}

/**
 * 校验并规范化一个 spec 对象。
 * 注意：内部使用；外部请用 `parseSpec` / `loadSpecFile`。
 */
export function validateSpec(root: unknown): SpecLoadResult {
  const diagnostics: SpecDiagnostic[] = [];
  if (!isPlainObject(root)) {
    err(diagnostics, 'SPEC_E_ROOT', '$', 'spec 根节点必须是 JSON 对象');
    return { ok: false, spec: null, diagnostics };
  }

  // name
  let name = '';
  if (!isNonEmptyString(root.name)) {
    err(diagnostics, 'SPEC_E_NAME', 'name', 'name 必须是非空字符串（合法标识符）');
  } else if (!IDENTIFIER.test(root.name)) {
    err(
      diagnostics,
      'SPEC_E_NAME_INVALID',
      'name',
      `name '${root.name}' 不是合法标识符（只允许字母/数字/下划线且不以数字开头）`,
    );
  } else {
    name = root.name;
  }

  // title
  let title: string | undefined;
  if (root.title !== undefined) {
    if (typeof root.title !== 'string') {
      err(diagnostics, 'SPEC_E_TITLE', 'title', 'title 必须是字符串');
    } else {
      title = root.title;
    }
  }

  const cpu = parseCpu(root.cpu, diagnostics);
  const template = parseTemplate(root.template, diagnostics);
  const series: CpuSeries = cpu?.series ?? 'FX5U';

  const io = parseIo(root.io, series, diagnostics);
  const vars = parseVars(root.vars, series, diagnostics);
  const requirements = parseRequirements(root.requirements, diagnostics);
  const safety = parseSafety(root.safety, series, diagnostics);
  const meta = parseMeta(root.meta, diagnostics);

  if (root.tests !== undefined && !Array.isArray(root.tests)) {
    err(diagnostics, 'SPEC_E_TESTS', 'tests', 'tests 必须是数组（预留字段）');
  }
  const tests = Array.isArray(root.tests) ? [...root.tests] : undefined;

  const errors = severityOf(diagnostics, 'error');
  if (errors > 0 || cpu === null || template === null || io === null || requirements === null) {
    return { ok: false, spec: null, diagnostics };
  }

  const spec: RequirementSpec = {
    name,
    cpu,
    template,
    io,
    requirements,
  };
  if (title !== undefined) spec.title = title;
  if (vars !== null) spec.vars = vars;
  if (safety !== null) spec.safety = safety;
  if (tests !== undefined) spec.tests = tests;
  if (meta !== null) spec.meta = meta;

  return { ok: true, spec, diagnostics };
}

/**
 * 解析 spec（对象或 JSON 字符串）。
 *
 * @param input JSON 对象，或 JSON 文本
 * @example
 *   const r = parseSpec({ name: 'demo', cpu: { series: 'FX5U' }, ... });
 *   if (!r.ok) console.error(r.diagnostics);
 */
export function parseSpec(input: unknown): SpecLoadResult {
  if (typeof input === 'string') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        spec: null,
        diagnostics: [
          {
            severity: 'error',
            code: 'SPEC_E_JSON',
            path: '$',
            message: `JSON 解析失败：${message}`,
          },
        ],
      };
    }
    return validateSpec(parsed);
  }
  return validateSpec(input);
}

/** 解析 JSON 文本（等价于 parseSpec(string)）。 */
export function loadSpecText(text: string): SpecLoadResult {
  return parseSpec(text);
}

/** 读取并校验 spec 文件（同步）。文件读取失败会返回 SPEC_E_READ 诊断。 */
export function loadSpecFileSync(filePath: string): SpecLoadResult {
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      spec: null,
      diagnostics: [
        { severity: 'error', code: 'SPEC_E_READ', path: '$', message: `无法读取 spec 文件 '${filePath}'：${message}` },
      ],
    };
  }
  const result = parseSpec(text);
  if (!result.ok) {
    for (const d of result.diagnostics) {
      if (d.path === '$' && d.severity === 'error') d.message = `${d.message}（文件：${filePath}）`;
    }
  }
  return result;
}

/** 读取并校验 spec 文件（异步，供 CLI 使用）。 */
export async function loadSpecFile(filePath: string): Promise<SpecLoadResult> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      spec: null,
      diagnostics: [
        { severity: 'error', code: 'SPEC_E_READ', path: '$', message: `无法读取 spec 文件 '${filePath}'：${message}` },
      ],
    };
  }
  return parseSpec(text);
}

/** 把诊断渲染成多行文本（CLI 输出用）。 */
export function formatSpecDiagnostics(diagnostics: SpecDiagnostic[]): string {
  return diagnostics
    .map((d) => `${d.severity === 'error' ? '✖' : '▲'} ${d.path} ${d.code}: ${d.message}`)
    .join('\n');
}
