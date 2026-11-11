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

/* ------------------------------------------------------------------ */
/* 步进程序（SFC/STL 的 ST 实现）                                      */
/* ------------------------------------------------------------------ */

/** 步内动作：对 BOOL 目标置 ON/OFF，或做一次赋值。 */
export interface StepAction {
  /** 目标：软元件（Y0/X0/M100）或变量名（bRun/nCount）。 */
  target: string;
  /** BOOL 动作：'ON' / 'OFF'（与 expression 二选一）。 */
  value?: 'ON' | 'OFF';
  /** 赋值表达式：如 "nCount + 1"（生成 target := 表达式;）。 */
  expression?: string;
}

/** 步转移：条件表达式或延时；to 为目标步 ID 或 'END'。 */
export interface StepTransition {
  /** ST 布尔表达式，如 "X10 AND NOT X11"；与 delayMs 同时给出表示“条件 + 延时”。 */
  condition?: string;
  /** 延时推进（毫秒）；单独使用时到时间即转移。 */
  delayMs?: number;
  /** 目标步 ID；'END' 表示结束本序列（回待机）。 */
  to: string;
}

/** 一个步（SFC 的 step + transition + action）。 */
export interface SequenceStep {
  /** 步 ID（唯一），如 S1 / S10。 */
  id: string;
  /** 步名称（仅注释/报告用）。 */
  name?: string;
  /** 进入该步后持续执行的动作。 */
  actions?: StepAction[];
  /** 转移：单条或选择分支（多条时按顺序先真先走）。 */
  next?: StepTransition | StepTransition[];
}

/** 气缸故障报警定义（自动/手动动作超时用）。 */
export interface CylinderAlarmSpec {
  /** 报警代码（写入报警代码区）。 */
  code: number;
  /** HMI 显示文字（注释用）。 */
  message?: string;
}

/** 气缸定义（工业步进程序的执行元件 + 磁性开关 + 超时报警）。 */
export interface CylinderSpec {
  /** 名称（中文，仅注释/报警文字用）。 */
  name: string;
  /** 伸出/前进输出（如 Y0）。 */
  extendY: string;
  /** 缩回/后退输出（双电控）；单电控省略。 */
  retractY?: string;
  /** 伸出到位磁性开关（如 X10）。 */
  extendedX: string;
  /** 原位/缩回到位磁性开关（如 X12）。 */
  retractedX: string;
  /** 阀类型：double=双电控（默认），single=单电控弹簧复位。 */
  valve?: 'double' | 'single';
  /** 动作超时（ms），默认 5000。 */
  timeoutMs?: number;
  /** 伸出方向超时报警。 */
  alarmExtend?: CylinderAlarmSpec;
  /** 缩回/复位方向超时报警（单电控即“松开”）。 */
  alarmRetract?: CylinderAlarmSpec;
}

/** 手动翻转按钮（每个执行元件一个：按一下到位、再按一下原位）。 */
export interface ManualButtonSpec {
  /** HMI 按钮地址（如 M10）。 */
  button: string;
  /** 对应的气缸 name。 */
  cylinder: string;
}

/** 工业步进程序的 HMI 软元件表。 */
export interface IndustrialHmiSpec {
  start: string;
  stop: string;
  reset: string;
  manual: string;
  /** 退出手动/回待机。 */
  exitManual: string;
  /** 报警/急停处理后“继续”。 */
  continueRun: string;
  /** 从头开始。 */
  restart: string;
  /** 状态指示（可选，默认 M100~M105）。 */
  status?: {
    idle?: string;
    auto?: string;
    manual?: string;
    stopping?: string;
    alarm?: string;
    paused?: string;
  };
  /** 数据区（可选，默认 D0 步号/D1 模式/D2 报警码/D3 报警步号）。 */
  data?: {
    step?: string;
    mode?: string;
    alarmCode?: string;
    alarmStep?: string;
  };
}

/** 停止序列的一步（按顺序回原点/安全位置）。 */
export interface StopStepSpec {
  id: string;
  name?: string;
  /** 本步输出动作（与 SequenceStep.actions 相同语义）。 */
  actions: StepAction[];
  /** 完成条件（传感器表达式）。 */
  until: string;
}

/** 工业步进程序附加定义（spec.sequence.industrial）。 */
export interface IndustrialSpec {
  /** 急停信号（任何模式立即冻结；如 X2）。 */
  estop: string;
  hmi: IndustrialHmiSpec;
  /** 气缸列表（含磁性开关与超时报警）。 */
  cylinders: CylinderSpec[];
  /** 手动翻转按钮（每缸一个）。 */
  manualButtons: ManualButtonSpec[];
  /** 停止序列（停止时按顺序执行；完成后回待机）。 */
  stopSequence: StopStepSpec[];
  /** 报警汇总输出（可选，如 M104）。 */
  alarmOutput?: string;
}

/** 步进程序定义（spec.sequence）。 */
export interface SequenceSpec {
  /** 初始步 ID（缺省为 steps 的第一个）。 */
  initialStep?: string;
  /** 启动条件表达式（缺省 X0，取上升沿）。 */
  startCondition?: string;
  /** 停止条件表达式（缺省 X1）。 */
  stopCondition?: string;
  /** 故障/急停条件表达式（缺省 X2）。 */
  faultCondition?: string;
  /** 步列表（至少 1 步）。 */
  steps: SequenceStep[];
  /** 工业版附加定义（模式/气缸监视/手动/停止序列/HMI）；存在时生成工业骨架。 */
  industrial?: IndustrialSpec;
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
  /** 步进程序（SFC/STL 的 ST 实现）；存在时 template.name 应为 step_sequence。 */
  sequence?: SequenceSpec;
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

/** 已知模板名（12 个标准回路/工业模板）。 */
export const KNOWN_TEMPLATES = [
  'motor_start_stop',
  'motor_auto_stop',
  'motor_reverse_interlock',
  'timer_sequence',
  'counter_batch',
  'state_machine',
  'analog_scale',
  'alarm_first_out',
  'positioning_drva',
  'temperature_two_position',
  'modbus_read',
  'serial_send_recv',
] as const;

/** 步进程序模板名（特殊：不实例化模板库，而由 spec.sequence 生成 SFC/STL 风格 ST）。 */
export const STEP_SEQUENCE_TEMPLATE = 'step_sequence' as const;

/** 是否接受为 spec.template.name 的名称（8 个模板 + step_sequence）。 */
export function isAcceptedTemplateName(name: string): boolean {
  return isKnownTemplate(name) || name === STEP_SEQUENCE_TEMPLATE;
}

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
        name: { type: 'string', enum: [...KNOWN_TEMPLATES, STEP_SEQUENCE_TEMPLATE] },
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
    sequence: {
      type: 'object',
      additionalProperties: true,
      required: ['steps'],
      properties: {
        initialStep: { type: 'string', minLength: 1 },
        startCondition: { type: 'string', minLength: 1 },
        stopCondition: { type: 'string', minLength: 1 },
        faultCondition: { type: 'string', minLength: 1 },
        steps: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: true,
            required: ['id'],
            properties: {
              id: { type: 'string', minLength: 1 },
              name: { type: 'string' },
              actions: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: true,
                  required: ['target'],
                  properties: {
                    target: { type: 'string', minLength: 1 },
                    value: { type: 'string', enum: ['ON', 'OFF'] },
                    expression: { type: 'string', minLength: 1 },
                  },
                },
              },
              next: {
                oneOf: [
                  { $ref: '#/definitions/stepTransition' },
                  { type: 'array', minItems: 1, items: { $ref: '#/definitions/stepTransition' } },
                ],
              },
            },
          },
        },
        industrial: {
          type: 'object',
          additionalProperties: true,
          required: ['estop', 'hmi', 'cylinders', 'manualButtons', 'stopSequence'],
          properties: {
            estop: { type: 'string', minLength: 1 },
            alarmOutput: { type: 'string' },
            hmi: {
              type: 'object',
              additionalProperties: true,
              required: ['start', 'stop', 'reset', 'manual', 'exitManual', 'continueRun', 'restart'],
              properties: {
                start: { type: 'string', minLength: 1 },
                stop: { type: 'string', minLength: 1 },
                reset: { type: 'string', minLength: 1 },
                manual: { type: 'string', minLength: 1 },
                exitManual: { type: 'string', minLength: 1 },
                continueRun: { type: 'string', minLength: 1 },
                restart: { type: 'string', minLength: 1 },
                status: {
                  type: 'object',
                  additionalProperties: true,
                  properties: {
                    idle: { type: 'string' },
                    auto: { type: 'string' },
                    manual: { type: 'string' },
                    stopping: { type: 'string' },
                    alarm: { type: 'string' },
                    paused: { type: 'string' },
                  },
                },
                data: {
                  type: 'object',
                  additionalProperties: true,
                  properties: {
                    step: { type: 'string' },
                    mode: { type: 'string' },
                    alarmCode: { type: 'string' },
                    alarmStep: { type: 'string' },
                  },
                },
              },
            },
            cylinders: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                additionalProperties: true,
                required: ['name', 'extendY', 'extendedX', 'retractedX'],
                properties: {
                  name: { type: 'string', minLength: 1 },
                  extendY: { type: 'string', minLength: 1 },
                  retractY: { type: 'string' },
                  extendedX: { type: 'string', minLength: 1 },
                  retractedX: { type: 'string', minLength: 1 },
                  valve: { type: 'string', enum: ['double', 'single'] },
                  timeoutMs: { type: 'integer', minimum: 100 },
                  alarmExtend: {
                    type: 'object',
                    additionalProperties: true,
                    required: ['code'],
                    properties: {
                      code: { type: 'integer' },
                      message: { type: 'string' },
                    },
                  },
                  alarmRetract: {
                    type: 'object',
                    additionalProperties: true,
                    required: ['code'],
                    properties: {
                      code: { type: 'integer' },
                      message: { type: 'string' },
                    },
                  },
                },
              },
            },
            manualButtons: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                additionalProperties: true,
                required: ['button', 'cylinder'],
                properties: {
                  button: { type: 'string', minLength: 1 },
                  cylinder: { type: 'string', minLength: 1 },
                },
              },
            },
            stopSequence: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                additionalProperties: true,
                required: ['id', 'actions', 'until'],
                properties: {
                  id: { type: 'string', minLength: 1 },
                  name: { type: 'string' },
                  actions: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: true,
                      required: ['target'],
                      properties: {
                        target: { type: 'string', minLength: 1 },
                        value: { type: 'string', enum: ['ON', 'OFF'] },
                        expression: { type: 'string', minLength: 1 },
                      },
                    },
                  },
                  until: { type: 'string', minLength: 1 },
                },
              },
            },
          },
        },
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
  definitions: {
    stepTransition: {
      type: 'object',
      additionalProperties: true,
      required: ['to'],
      properties: {
        condition: { type: 'string', minLength: 1 },
        delayMs: { type: 'integer', minimum: 1 },
        to: { type: 'string', minLength: 1 },
      },
    },
  },
};
