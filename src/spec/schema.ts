/**
 * RequirementSpec：可校验的控制需求规格（JSON）。
 *
 * 定位：自然语言需求 → 结构化 spec → 模板库/生成器 → ST/XML。
 * 本文件只定义类型、常量与 JSON Schema；校验逻辑在 `load.ts`。
 *
 * 约定：spec 只描述“要什么”，不描述“怎么写”：
 *  - `template` 选择已注册模板；
 *  - `io` 绑定物理软元件与变量名；
 *  - `requirements` 是可追踪的验收条款（id 唯一）。
 */

/** CPU 系列（M1 只支持 FX5 系列）。 */
export type CpuSeries = 'FX5U' | 'FX5UJ';

/** IO 可用数据类型（与 FX5 profile 对齐的常用子集）。 */
export type IoType = 'BOOL' | 'INT' | 'DINT' | 'REAL' | 'WORD' | 'TIME';

/** 变量作用域。 */
export type VarScope = 'local' | 'global';

/** CPU 与机型。 */
export interface CpuSpec {
  series: CpuSeries;
  /** 具体机型，如 FX5U-32MT/ES；可选。 */
  model?: string;
}

/** 模板选择与参数。 */
export interface TemplateSpec {
  /** 必须是 KNOWN_TEMPLATES 之一。 */
  name: string;
  /** 模板参数（标量值）；参数名由各模板自行解释。 */
  params?: Record<string, string | number | boolean>;
}

/** IO 绑定。 */
export interface IoBinding {
  /** 软元件地址，如 X0 / Y0 / M100 / D100；按 FX5U profile 校验进制与范围。 */
  device: string;
  /** 生成的标签/变量名（合法标识符，IO 内唯一）。 */
  name: string;
  type: IoType;
  comment?: string;
}

/** 附加变量（模板未覆盖时使用）。 */
export interface VarBinding {
  name: string;
  /** 类型名（内置类型或用户自定义 STRUCT/FB 名）。 */
  type: string;
  scope: VarScope;
  initial?: string;
  device?: string;
  comment?: string;
}

/** 验收条款。 */
export interface RequirementItem {
  id: string;
  text: string;
}

/** 安全相关约束。 */
export interface SafetySpec {
  /** 急停/停止信号（软元件地址或变量名，可选）。 */
  estop?: string;
  /** 互锁条件说明（人类可读）。 */
  interlocks?: string[];
}

/** 元信息。 */
export interface SpecMeta {
  version?: string;
  createdAt?: string;
}

/** 需求规格根对象。 */
export interface RequirementSpec {
  /** 唯一标识，合法标识符，如 "motor_start_stop"。 */
  name: string;
  title?: string;
  cpu: CpuSpec;
  template: TemplateSpec;
  io: IoBinding[];
  vars?: VarBinding[];
  requirements: RequirementItem[];
  safety?: SafetySpec;
  /** 预留：仿真/验收测试用例。 */
  tests?: unknown[];
  meta?: SpecMeta;
}

/** 诊断严重度。 */
export type SpecSeverity = 'error' | 'warning';

/** 一条 spec 诊断。 */
export interface SpecDiagnostic {
  severity: SpecSeverity;
  /** 机器可读错误码，如 SPEC_E_IO_DEVICE_BASE。 */
  code: string;
  /** 出错位置，如 io[2].device / cpu.series / name。 */
  path: string;
  message: string;
}

/** 加载/校验结果。 */
export interface SpecLoadResult {
  ok: boolean;
  /** 仅在 ok=true 时非空（warning 不影响 ok）。 */
  spec: RequirementSpec | null;
  diagnostics: SpecDiagnostic[];
}

/** 已知模板名（与模板库约定，M1 固定这 8 个）。 */
export const KNOWN_TEMPLATES = [
  'motor_start_stop',
  'motor_auto_stop',
  'motor_reverse_interlock',
  'timer_sequence',
  'counter_batch',
  'state_machine',
  'analog_scale',
  'alarm_first_out',
] as const;

/** 已知模板名联合类型。 */
export type KnownTemplateName = (typeof KNOWN_TEMPLATES)[number];

/** 是否为已知模板名。 */
export function isKnownTemplate(name: string): name is KnownTemplateName {
  return (KNOWN_TEMPLATES as readonly string[]).includes(name);
}

/** IO 可用类型（顺序稳定，供 CLI 提示）。 */
export const IO_TYPES: readonly IoType[] = ['BOOL', 'INT', 'DINT', 'REAL', 'WORD', 'TIME'];

/** 变量作用域取值。 */
export const VAR_SCOPES: readonly VarScope[] = ['local', 'global'];

/** CPU 系列取值。 */
export const CPU_SERIES: readonly CpuSeries[] = ['FX5U', 'FX5UJ'];

/**
 * JSON Schema（Draft-07 子集），供外部工具/编辑器补全使用。
 * 实际校验以 `load.ts` 的手写校验为准（两者保持一致）。
 */
export const SPEC_JSON_SCHEMA: Record<string, unknown> = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'RequirementSpec',
  type: 'object',
  additionalProperties: true,
  required: ['name', 'cpu', 'template', 'io', 'requirements'],
  properties: {
    name: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
    title: { type: 'string' },
    cpu: {
      type: 'object',
      additionalProperties: true,
      required: ['series'],
      properties: {
        series: { type: 'string', enum: [...CPU_SERIES] },
        model: { type: 'string' },
      },
    },
    template: {
      type: 'object',
      additionalProperties: true,
      required: ['name'],
      properties: {
        name: { type: 'string', enum: [...KNOWN_TEMPLATES] },
        params: {
          type: 'object',
          additionalProperties: { type: ['string', 'number', 'boolean'] },
        },
      },
    },
    io: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        required: ['device', 'name', 'type'],
        properties: {
          device: { type: 'string' },
          name: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
          type: { type: 'string', enum: [...IO_TYPES] },
          comment: { type: 'string' },
        },
      },
    },
    vars: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        required: ['name', 'type', 'scope'],
        properties: {
          name: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
          type: { type: 'string', minLength: 1 },
          scope: { type: 'string', enum: [...VAR_SCOPES] },
          initial: { type: 'string' },
          device: { type: 'string' },
          comment: { type: 'string' },
        },
      },
    },
    requirements: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: true,
        required: ['id', 'text'],
        properties: {
          id: { type: 'string', minLength: 1 },
          text: { type: 'string', minLength: 1 },
        },
      },
    },
    safety: {
      type: 'object',
      additionalProperties: true,
      properties: {
        estop: { type: 'string' },
        interlocks: { type: 'array', items: { type: 'string', minLength: 1 } },
      },
    },
    tests: { type: 'array' },
    meta: {
      type: 'object',
      additionalProperties: true,
      properties: {
        version: { type: 'string' },
        createdAt: { type: 'string' },
      },
    },
  },
};
