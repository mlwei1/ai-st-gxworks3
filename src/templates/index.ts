/**
 * ST 模板库入口（M1-2）。
 *
 * 8 个标准回路模板：每个模板根据 spec（IO/参数）实例化为**完整 ST 源码**，
 * 由 `gen` 命令 → parser → analyzer → build-xml 落地 GX Works3。
 */

import { alarmFirstOutTemplate } from './alarm_first_out.ts';
import { analogScaleTemplate } from './analog_scale.ts';
import { counterBatchTemplate } from './counter_batch.ts';
import { motorAutoStopTemplate } from './motor_auto_stop.ts';
import { motorReverseInterlockTemplate } from './motor_reverse_interlock.ts';
import { modbusReadTemplate } from './modbus_read.ts';
import { motorStartStopTemplate } from './motor_start_stop.ts';
import { positioningDrvaTemplate } from './positioning_drva.ts';
import { stateMachineTemplate } from './state_machine.ts';
import { temperatureTwoPositionTemplate } from './temperature_two_position.ts';
import { timerSequenceTemplate } from './timer_sequence.ts';
import type { StTemplate } from './types.ts';

export type {
  StTemplate,
  TemplateContext,
  TemplateParamDef,
} from './types.ts';

/** 11 个模板的固定名称（`spec.template.name` 的取值集合）。 */
export const TEMPLATE_NAMES = [
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
] as const;

export type TemplateName = (typeof TEMPLATE_NAMES)[number];

const TEMPLATES: readonly StTemplate[] = [
  motorStartStopTemplate,
  motorAutoStopTemplate,
  motorReverseInterlockTemplate,
  timerSequenceTemplate,
  counterBatchTemplate,
  stateMachineTemplate,
  analogScaleTemplate,
  alarmFirstOutTemplate,
  positioningDrvaTemplate,
  temperatureTwoPositionTemplate,
  modbusReadTemplate,
];

/** 全部模板（顺序与 TEMPLATE_NAMES 一致）。 */
export function listTemplates(): StTemplate[] {
  return [...TEMPLATES];
}

/** 按名称取模板；不存在返回 undefined（调用方负责报错）。 */
export function getTemplate(name: string): StTemplate | undefined {
  return TEMPLATES.find((t) => t.name === name);
}

/** 取模板，不存在时抛错（gen 命令用）。 */
export function requireTemplate(name: string): StTemplate {
  const t = getTemplate(name);
  if (!t) {
    throw new Error(`未知模板 '${name}'；可用模板：${TEMPLATE_NAMES.join(', ')}`);
  }
  return t;
}

/**
 * 合并参数默认值：spec/CLI 传入的 params 覆盖模板默认值。
 * @param params 外部参数（可能缺省/部分）
 */
export function mergeParams(
  template: StTemplate,
  params: Record<string, string | number | boolean | undefined> = {},
): Record<string, string | number | boolean | undefined> {
  const merged: Record<string, string | number | boolean | undefined> = {};
  for (const p of template.params) merged[p.name] = p.default;
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) merged[k] = v;
  }
  return merged;
}
