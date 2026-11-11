/**
 * 事实库查询入口。
 *
 * 使用方式：
 *   import { getCpuProfile, getDeviceFact, isSupportedFx5Type } from '../profile/index.ts';
 *
 * 所有查询在未显式指定机型时默认 FX5U。
 */

import {
  FX5U_PROFILE,
  FX5UJ_PROFILE,
  FX5_STANDARD_FBS,
  FX5_NATIVE_FBS,
  FX5_GENERAL_FUNCTIONS,
  FX5_INSTRUCTIONS,
  FX5_NONEXISTENT_NAMES,
  FX5_TYPE_FACTS,
  FX5_TYPE_NAMES,
  IQ_R_ONLY_TYPES,
  type CpuModel,
  type CpuProfile,
  type DeviceBase,
  type DeviceFact,
  type FbFact,
  type InstructionFact,
  type TypeFact,
  type VerifiedStatus,
} from './fx5u.ts';

export {
  FX5U_PROFILE,
  FX5UJ_PROFILE,
  FX5_STANDARD_FBS,
  FX5_NATIVE_FBS,
  FX5_GENERAL_FUNCTIONS,
  FX5_INSTRUCTIONS,
  FX5_NONEXISTENT_NAMES,
  FX5_TYPE_FACTS,
  FX5_TYPE_NAMES,
  IQ_R_ONLY_TYPES,
};
export type {
  CpuModel,
  CpuProfile,
  DeviceBase,
  DeviceFact,
  FbFact,
  InstructionFact,
  TypeFact,
  VerifiedStatus,
};

export {
  FX5_POSITIONING_INSTRUCTIONS,
  getPositioningInstruction,
  isPositioningInstruction,
} from './positioning.ts';
export type {
  PositioningInstructionFact,
  PositioningOperand,
} from './positioning.ts';

/** 默认机型。 */
export const DEFAULT_CPU_MODEL: CpuModel = 'FX5U';

/** 取得指定机型的事实集合。 */
export function getCpuProfile(model: CpuModel = DEFAULT_CPU_MODEL): CpuProfile {
  return model === 'FX5UJ' ? FX5UJ_PROFILE : FX5U_PROFILE;
}

/** 取得某软元件事实；未知前缀返回 undefined。 */
export function getDeviceFact(
  symbol: string,
  model: CpuModel = DEFAULT_CPU_MODEL,
): DeviceFact | undefined {
  return getCpuProfile(model).devices[symbol.toUpperCase()];
}

/** 取得某软元件的十进制等价范围；`null` 表示存在但范围未核实。 */
export function getDeviceRange(
  symbol: string,
  model: CpuModel = DEFAULT_CPU_MODEL,
): [number, number] | null | undefined {
  const fact = getDeviceFact(symbol, model);
  if (!fact) return undefined;
  return fact.range;
}

/** 进制的人类可读名。 */
export function baseLabel(base: DeviceBase): string {
  return base === 8 ? '八进制' : base === 16 ? '十六进制' : '十进制';
}

/**
 * 校验设备编号是否合法。
 *  - `unknown-prefix`：前缀不在 FX5 软元件表；
 *  - `invalid-digits`：编号含该进制的非法数字（如 X198）；
 *  - `range-unverified`：软元件存在但范围未核实（SM/SD），不做范围检查；
 *  - `out-of-range` / `ok`。
 */
export type DeviceNumberCheck =
  | 'ok'
  | 'unknown-prefix'
  | 'invalid-digits'
  | 'range-unverified'
  | 'out-of-range';

export function checkDeviceNumber(
  symbol: string,
  number: number,
  model: CpuModel = DEFAULT_CPU_MODEL,
): DeviceNumberCheck {
  const fact = getDeviceFact(symbol, model);
  if (!fact) return 'unknown-prefix';
  if (!Number.isFinite(number)) return 'invalid-digits';
  if (fact.range === null) return 'range-unverified';
  if (number < fact.range[0] || number > fact.range[1]) return 'out-of-range';
  return 'ok';
}

/** FX5 是否支持该数据类型名（已去长度参数）。 */
export function isSupportedFx5Type(name: string): boolean {
  return FX5_TYPE_NAMES.has(name.trim().toUpperCase());
}

/** 是否为「仅 iQ-R 支持、FX5 不支持」的类型名。 */
export function isIqROnlyType(name: string): boolean {
  return IQ_R_ONLY_TYPES.includes(name.trim().toUpperCase());
}

/** 取得类型事实。 */
export function getTypeFact(name: string): TypeFact | undefined {
  const up = name.trim().toUpperCase();
  return FX5_TYPE_FACTS.find((t) => t.name === up);
}

/** 取得标准 FB 事实（TON/TOF/.../SR）。 */
export function getStandardFbFact(name: string): FbFact | undefined {
  const up = name.trim().toUpperCase();
  return FX5_STANDARD_FBS.find((f) => f.name === up);
}

/** 取得 FX5 专有通用 FB 事实（COUNTER_FB_M / TIMER_*_FB_M）。 */
export function getNativeFbFact(name: string): FbFact | undefined {
  const up = name.trim().toUpperCase();
  return FX5_NATIVE_FBS.find((f) => f.name === up);
}

/** 取得通用功能事实。 */
export function getGeneralFunctionFact(name: string): InstructionFact | undefined {
  const up = name.trim().toUpperCase();
  return FX5_GENERAL_FUNCTIONS.find((f) => f.name === up);
}

/** 取得指令事实。 */
export function getInstructionFact(name: string): InstructionFact | undefined {
  const up = name.trim().toUpperCase();
  return FX5_INSTRUCTIONS.find((f) => f.name === up);
}

/** 是否为“已知不存在”的名称（v0.1 白名单遗留）。 */
export function isKnownNonexistentName(name: string): boolean {
  return FX5_NONEXISTENT_NAMES.includes(name.trim().toUpperCase());
}
