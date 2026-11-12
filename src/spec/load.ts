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
  STEP_SEQUENCE_TEMPLATE,
  VAR_SCOPES,
  isAcceptedTemplateName,
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
  if (!isAcceptedTemplateName(raw.name)) {
    err(
      diagnostics,
      'SPEC_E_TEMPLATE_UNKNOWN',
      'template.name',
      `未知模板 '${raw.name}'；已知模板：${[...KNOWN_TEMPLATES, STEP_SEQUENCE_TEMPLATE].join(', ')}`,
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
 * 校验并解析 sequence 段（SFC/STL 风格的 ST 步进程序）。
 *
 * 结构：{ initialStep?, startCondition?, stopCondition?, faultCondition?, steps[] }
 * 每步：{ id, name?, actions[]?, next? }
 */
function parseSequence(
  raw: unknown,
  series: CpuSeries,
  diagnostics: SpecDiagnostic[],
): import('./schema.ts').SequenceSpec | null {
  if (raw === undefined) return null;
  if (!isPlainObject(raw)) {
    err(diagnostics, 'SPEC_E_SEQUENCE', 'sequence', 'sequence 必须是对象');
    return null;
  }
  const stepsRaw = raw.steps;
  if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) {
    err(diagnostics, 'SPEC_E_SEQUENCE_STEPS', 'sequence.steps', 'sequence.steps 必须是至少 1 个元素的数组');
    return null;
  }

  const parsedSteps: import('./schema.ts').SequenceStep[] = [];
  const ids = new Set<string>();
  const actionStrs: Array<{ stepId: string; actions: import('./schema.ts').StepAction[] }> = [];

  stepsRaw.forEach((stepRaw, i) => {
    const path = `sequence.steps[${i}]`;
    if (!isPlainObject(stepRaw)) {
      err(diagnostics, 'SPEC_E_SEQUENCE_STEP', path, 'step 必须是对象');
      return;
    }
    const id = stepRaw.id;
    if (!isNonEmptyString(id) || !IDENTIFIER.test(id.trim())) {
      err(diagnostics, 'SPEC_E_SEQUENCE_STEP_ID', `${path}.id`, `步 ID 必须是合法标识符（字母/数字/下划线），如 S1`);
      return;
    }
    if (ids.has(id.trim())) {
      err(diagnostics, 'SPEC_E_SEQUENCE_STEP_DUP', `${path}.id`, `步 ID 重复：${id}`);
      return;
    }
    ids.add(id.trim());

    const step: import('./schema.ts').SequenceStep = { id: id.trim() };
    if (stepRaw.name !== undefined) {
      if (typeof stepRaw.name !== 'string') {
        err(diagnostics, 'SPEC_E_SEQUENCE_STEP_NAME', `${path}.name`, 'name 必须是字符串');
      } else {
        step.name = stepRaw.name;
      }
    }

    const actions: import('./schema.ts').StepAction[] = [];
    if (stepRaw.actions !== undefined) {
      if (!Array.isArray(stepRaw.actions)) {
        err(diagnostics, 'SPEC_E_SEQUENCE_ACTIONS', `${path}.actions`, 'actions 必须是数组');
      } else {
        stepRaw.actions.forEach((aRaw, j) => {
          const aPath = `${path}.actions[${j}]`;
          if (!isPlainObject(aRaw)) {
            err(diagnostics, 'SPEC_E_SEQUENCE_ACTION', aPath, 'action 必须是对象');
            return;
          }
          if (!isNonEmptyString(aRaw.target)) {
            err(diagnostics, 'SPEC_E_SEQUENCE_ACTION_TARGET', `${aPath}.target`, 'action.target 必须是非空字符串');
            return;
          }
          const target = aRaw.target.trim();
          const val = aRaw.value;
          const expr = aRaw.expression;
          if (val !== undefined && val !== 'ON' && val !== 'OFF') {
            err(diagnostics, 'SPEC_E_SEQUENCE_ACTION_VALUE', `${aPath}.value`, "value 只能是 'ON' 或 'OFF'");
            return;
          }
          if (expr !== undefined && !isNonEmptyString(expr)) {
            err(diagnostics, 'SPEC_E_SEQUENCE_ACTION_EXPR', `${aPath}.expression`, 'expression 必须是非空字符串');
            return;
          }
          if (val === undefined && expr === undefined) {
            err(diagnostics, 'SPEC_E_SEQUENCE_ACTION_EMPTY', aPath, 'action 必须给 value(ON/OFF) 或 expression');
            return;
          }
          if (val !== undefined && expr !== undefined) {
            err(diagnostics, 'SPEC_E_SEQUENCE_ACTION_CONFLICT', aPath, 'value 与 expression 只能二选一');
            return;
          }
          const looksLikeDevice = /^[A-Za-z]{1,3}[0-9]+(\.[0-9]+)?$/.test(target);
          if (looksLikeDevice) {
            validateDevice(target, `${aPath}.target`, series, diagnostics);
          } else if (!IDENTIFIER.test(target)) {
            err(diagnostics, 'SPEC_E_SEQUENCE_ACTION_TARGET_ID', `${aPath}.target`, `action.target '${target}' 既不是软元件也不是合法变量名`);
            return;
          }
          actions.push({ target, ...(val ? { value: val } : {}), ...(expr ? { expression: String(expr) } : {}) });
        });
      }
    }
    if (actions.length > 0) step.actions = actions;

    // next：单条或数组
    if (stepRaw.next !== undefined) {
      const nextRaw = stepRaw.next;
      const arr = Array.isArray(nextRaw) ? nextRaw : [nextRaw];
      const transitions: import('./schema.ts').StepTransition[] = [];
      arr.forEach((tRaw, k) => {
        const tPath = `${path}.next${Array.isArray(nextRaw) ? `[${k}]` : ''}`;
        if (!isPlainObject(tRaw)) {
          err(diagnostics, 'SPEC_E_SEQUENCE_TRANSITION', tPath, 'transition 必须是对象');
          return;
        }
        if (!isNonEmptyString(tRaw.to)) {
          err(diagnostics, 'SPEC_E_SEQUENCE_TRANSITION_TO', `${tPath}.to`, 'to 必须是非空字符串（步 ID 或 END）');
          return;
        }
        const to = tRaw.to.trim();
        const condition = tRaw.condition;
        const delayMs = tRaw.delayMs;
        if (condition !== undefined && !isNonEmptyString(condition)) {
          err(diagnostics, 'SPEC_E_SEQUENCE_TRANSITION_COND', `${tPath}.condition`, 'condition 必须是非空字符串');
          return;
        }
        if (delayMs !== undefined) {
          if (typeof delayMs !== 'number' || !Number.isFinite(delayMs) || delayMs <= 0 || Math.trunc(delayMs) !== delayMs) {
            err(diagnostics, 'SPEC_E_SEQUENCE_TRANSITION_DELAY', `${tPath}.delayMs`, 'delayMs 必须是正整数（毫秒）');
            return;
          }
        }
        if (condition === undefined && delayMs === undefined) {
          err(diagnostics, 'SPEC_E_SEQUENCE_TRANSITION_EMPTY', tPath, 'transition 必须给 condition 或 delayMs');
          return;
        }
        transitions.push({
          to,
          ...(condition !== undefined ? { condition: String(condition) } : {}),
          ...(delayMs !== undefined ? { delayMs: Number(delayMs) } : {}),
        });
      });
      if (transitions.length > 0) step.next = Array.isArray(nextRaw) ? transitions : transitions[0];
    }

    actionStrs.push({ stepId: step.id, actions });
    parsedSteps.push(step);
  });

  const result: import('./schema.ts').SequenceSpec = { steps: parsedSteps };

  // 可选字段
  for (const field of ['initialStep', 'startCondition', 'stopCondition', 'faultCondition'] as const) {
    if (raw[field] !== undefined) {
      if (!isNonEmptyString(raw[field])) {
        err(diagnostics, 'SPEC_E_SEQUENCE_FIELD', `sequence.${field}`, `${field} 必须是非空字符串`);
      } else {
        result[field] = String(raw[field]);
      }
    }
  }

  // 工业版附加定义（模式/气缸监视/手动/停止序列/HMI）
  const industrial = parseIndustrial(raw.industrial, diagnostics);
  if (industrial) result.industrial = industrial;

  // 引用完整性：initialStep / 转移目标
  if (result.initialStep !== undefined && !ids.has(result.initialStep)) {
    err(diagnostics, 'SPEC_E_SEQUENCE_INITIAL', 'sequence.initialStep', `initialStep '${result.initialStep}' 不在 steps 中`);
  }
  parsedSteps.forEach((step, i) => {
    const list = step.next === undefined ? [] : Array.isArray(step.next) ? step.next : [step.next];
    list.forEach((t, k) => {
      if (t.to !== 'END' && !ids.has(t.to)) {
        err(
          diagnostics,
          'SPEC_E_SEQUENCE_TRANSITION_TARGET',
          `sequence.steps[${i}].next${Array.isArray(step.next) ? `[${k}]` : ''}.to`,
          `转移目标 '${t.to}' 不存在（可用：${[...ids].join(', ')} 或 END）`,
        );
      }
    });
  });

  return result;
}

/** 解析 sequence.industrial（工业版：模式/气缸监视/手动/停止序列/HMI）。 */
function parseIndustrial(
  raw: unknown,
  diagnostics: SpecDiagnostic[],
): import('./schema.ts').IndustrialSpec | undefined {
  if (raw === undefined) return undefined;
  const root = 'sequence.industrial';
  if (!isPlainObject(raw)) {
    err(diagnostics, 'SPEC_E_INDUSTRIAL', root, 'industrial 必须是对象');
    return undefined;
  }
  const ind: import('./schema.ts').IndustrialSpec = {
    estop: '',
    hmi: {
      start: '',
      stop: '',
      reset: '',
      manual: '',
      exitManual: '',
      continueRun: '',
      restart: '',
    },
    cylinders: [],
    manualButtons: [],
    stopSequence: [],
  };

  if (!isNonEmptyString(raw.estop)) err(diagnostics, 'SPEC_E_INDUSTRIAL_ESTOP', `${root}.estop`, 'estop 必须是非空字符串（如 X2）');
  else ind.estop = String(raw.estop).trim();

  if (isNonEmptyString(raw.alarmOutput)) ind.alarmOutput = String(raw.alarmOutput).trim();

  // HMI
  if (!isPlainObject(raw.hmi)) {
    err(diagnostics, 'SPEC_E_INDUSTRIAL_HMI', `${root}.hmi`, 'hmi 必须是对象');
  } else {
    for (const k of ['start', 'stop', 'reset', 'manual', 'exitManual', 'continueRun', 'restart'] as const) {
      const v = raw.hmi[k];
      if (!isNonEmptyString(v)) err(diagnostics, 'SPEC_E_INDUSTRIAL_HMI_FIELD', `${root}.hmi.${k}`, `hmi.${k} 必须是非空字符串（软元件地址，如 M0）`);
      else ind.hmi[k] = String(v).trim();
    }
    if (isPlainObject(raw.hmi.status)) {
      const status = raw.hmi.status;
      const st: NonNullable<import('./schema.ts').IndustrialHmiSpec['status']> = {};
      for (const k of ['idle', 'auto', 'manual', 'stopping', 'alarm', 'paused'] as const) {
        if (isNonEmptyString(status[k])) st[k] = String(status[k]).trim();
      }
      ind.hmi.status = st;
    }
    if (isPlainObject(raw.hmi.data)) {
      const data = raw.hmi.data;
      const d: NonNullable<import('./schema.ts').IndustrialHmiSpec['data']> = {};
      for (const k of ['step', 'mode', 'alarmCode', 'alarmStep'] as const) {
        if (isNonEmptyString(data[k])) d[k] = String(data[k]).trim();
      }
      ind.hmi.data = d;
    }
  }

  // 气缸
  if (!Array.isArray(raw.cylinders) || raw.cylinders.length === 0) {
    err(diagnostics, 'SPEC_E_INDUSTRIAL_CYLINDERS', `${root}.cylinders`, 'cylinders 必须是至少 1 个元素的数组');
  } else {
    raw.cylinders.forEach((cRaw, i) => {
      const p = `${root}.cylinders[${i}]`;
      if (!isPlainObject(cRaw)) {
        err(diagnostics, 'SPEC_E_INDUSTRIAL_CYLINDER', p, 'cylinder 必须是对象');
        return;
      }
      const c: import('./schema.ts').CylinderSpec = {
        name: String(cRaw.name ?? ''),
        extendY: String(cRaw.extendY ?? ''),
        extendedX: String(cRaw.extendedX ?? ''),
        retractedX: String(cRaw.retractedX ?? ''),
      };
      for (const k of ['name', 'extendY', 'extendedX', 'retractedX'] as const) {
        if (!isNonEmptyString(cRaw[k])) err(diagnostics, 'SPEC_E_INDUSTRIAL_CYLINDER_FIELD', `${p}.${k}`, `${k} 必须是非空字符串`);
      }
      if (isNonEmptyString(cRaw.retractY)) c.retractY = String(cRaw.retractY).trim();
      if (cRaw.valve !== undefined) {
        if (cRaw.valve !== 'double' && cRaw.valve !== 'single') {
          err(diagnostics, 'SPEC_E_INDUSTRIAL_CYLINDER_VALVE', `${p}.valve`, "valve 只能是 'double' 或 'single'");
        } else {
          c.valve = cRaw.valve;
        }
      }
      if (cRaw.timeoutMs !== undefined) {
        if (typeof cRaw.timeoutMs !== 'number' || !Number.isFinite(cRaw.timeoutMs) || cRaw.timeoutMs < 100) {
          err(diagnostics, 'SPEC_E_INDUSTRIAL_CYLINDER_TIMEOUT', `${p}.timeoutMs`, 'timeoutMs 必须是 >=100 的整数毫秒');
        } else {
          c.timeoutMs = Math.trunc(cRaw.timeoutMs);
        }
      }
      for (const alarmKey of ['alarmExtend', 'alarmRetract'] as const) {
        const aRaw = cRaw[alarmKey];
        if (aRaw !== undefined) {
          if (!isPlainObject(aRaw) || typeof aRaw.code !== 'number') {
            err(diagnostics, 'SPEC_E_INDUSTRIAL_ALARM', `${p}.${alarmKey}`, `${alarmKey} 必须是 { code:number, message?:string }`);
          } else {
            c[alarmKey] = {
              code: Math.trunc(aRaw.code),
              ...(isNonEmptyString(aRaw.message) ? { message: String(aRaw.message) } : {}),
            };
          }
        }
      }
      ind.cylinders.push(c);
    });
  }

  // 手动按钮
  if (!Array.isArray(raw.manualButtons) || raw.manualButtons.length === 0) {
    err(diagnostics, 'SPEC_E_INDUSTRIAL_MANUAL', `${root}.manualButtons`, 'manualButtons 必须是至少 1 个元素的数组');
  } else {
    raw.manualButtons.forEach((bRaw, i) => {
      const p = `${root}.manualButtons[${i}]`;
      if (!isPlainObject(bRaw) || !isNonEmptyString(bRaw.button) || !isNonEmptyString(bRaw.cylinder)) {
        err(diagnostics, 'SPEC_E_INDUSTRIAL_MANUAL_BUTTON', p, '必须是 { button:string, cylinder:string }');
        return;
      }
      ind.manualButtons.push({ button: String(bRaw.button).trim(), cylinder: String(bRaw.cylinder).trim() });
    });
  }

  // 停止序列
  if (!Array.isArray(raw.stopSequence) || raw.stopSequence.length === 0) {
    err(diagnostics, 'SPEC_E_INDUSTRIAL_STOP', `${root}.stopSequence`, 'stopSequence 必须是至少 1 个元素的数组');
  } else {
    raw.stopSequence.forEach((sRaw, i) => {
      const p = `${root}.stopSequence[${i}]`;
      if (!isPlainObject(sRaw) || !isNonEmptyString(sRaw.id) || !isNonEmptyString(sRaw.until)) {
        err(diagnostics, 'SPEC_E_INDUSTRIAL_STOP_STEP', p, 'stopSequence 每步必须是 { id, name?, actions, until }');
        return;
      }
      const actions: import('./schema.ts').StepAction[] = [];
      if (!Array.isArray(sRaw.actions)) {
        err(diagnostics, 'SPEC_E_INDUSTRIAL_STOP_ACTIONS', `${p}.actions`, 'actions 必须是数组');
      } else {
        sRaw.actions.forEach((aRaw, j) => {
          const ap = `${p}.actions[${j}]`;
          if (!isPlainObject(aRaw) || !isNonEmptyString(aRaw.target)) {
            err(diagnostics, 'SPEC_E_INDUSTRIAL_STOP_ACTION', ap, 'action 必须是 { target, value?/expression? }');
            return;
          }
          if (aRaw.value !== undefined && aRaw.value !== 'ON' && aRaw.value !== 'OFF') {
            err(diagnostics, 'SPEC_E_INDUSTRIAL_STOP_ACTION_VALUE', `${ap}.value`, "value 只能是 'ON' 或 'OFF'");
            return;
          }
          actions.push({
            target: String(aRaw.target).trim(),
            ...(aRaw.value !== undefined ? { value: aRaw.value as 'ON' | 'OFF' } : {}),
            ...(isNonEmptyString(aRaw.expression) ? { expression: String(aRaw.expression).trim() } : {}),
          });
        });
      }
      ind.stopSequence.push({
        id: String(sRaw.id).trim(),
        ...(isNonEmptyString(sRaw.name) ? { name: String(sRaw.name).trim() } : {}),
        actions,
        until: String(sRaw.until).trim(),
      });
    });
  }

  return ind;
}

/** 解析标签生成选项（英文/中文标签）。 */
function parseLabels(
  raw: unknown,
  diagnostics: SpecDiagnostic[],
): import('./schema.ts').LabelOptions | null {
  if (raw === undefined) return null;
  if (!isPlainObject(raw)) {
    err(diagnostics, 'SPEC_E_LABELS', 'labels', 'labels 必须是对象，如 { "language": "zh" }');
    return null;
  }
  const out: import('./schema.ts').LabelOptions = {};
  if (raw.language !== undefined) {
    if (raw.language !== 'en' && raw.language !== 'zh') {
      err(diagnostics, 'SPEC_E_LABELS_LANGUAGE', 'labels.language', "labels.language 只能是 'en' 或 'zh'");
    } else {
      out.language = raw.language;
    }
  }
  return out;
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
  const sequence = parseSequence(root.sequence, series, diagnostics);
  const labels = parseLabels(root.labels, diagnostics);

  // step_sequence 与 sequence 段必须成对出现
  if (sequence !== null && template !== null && template.name !== 'step_sequence') {
    err(
      diagnostics,
      'SPEC_E_SEQUENCE_TEMPLATE',
      'template.name',
      `包含 sequence 段时 template.name 必须为 'step_sequence'（当前 '${template.name}'）`,
    );
  }
  if (sequence === null && template !== null && template.name === 'step_sequence') {
    err(
      diagnostics,
      'SPEC_E_SEQUENCE_MISSING',
      'sequence',
      `template.name 为 'step_sequence' 时必须提供 sequence 段（steps/next/actions）`,
    );
  }

  if (root.tests !== undefined && !Array.isArray(root.tests)) {
    err(diagnostics, 'SPEC_E_TESTS', 'tests', 'tests 必须是数组（预留字段）');
  }
  const tests = Array.isArray(root.tests) ? [...root.tests] : undefined;

  const errors = severityOf(diagnostics, 'error');
  if (
    errors > 0 ||
    cpu === null ||
    template === null ||
    io === null ||
    requirements === null ||
    (root.sequence !== undefined && sequence === null)
  ) {
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
  if (sequence !== null) spec.sequence = sequence;
  if (labels !== null) spec.labels = labels;
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
