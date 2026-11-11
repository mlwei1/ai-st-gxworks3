/**
 * ST 步进程序生成器（SFC/STL 的 ST 实现）。
 *
 * 工业设备通常按工位/动作分步执行：SFC 用「步 + 转移条件 + 步动作」描述，
 * 梯形图里常用 STL（步进梯形图）实现。本项目只做 ST，因此用等价的
 * 「步号状态机」生成：
 *   - nStep（INT）保存当前步号（0=待机，1..N=步）；
 *   - 每步转移动作为 IF/ELSIF 条件判断（选择分支按顺序先真先走）；
 *   - 每步动作输出：先复位本程序用到的 BOOL 目标，再按当前步置位；
 *   - 支持延时转移（共享 TON + 每步设定值 + 步切换复位）；
 *   - 启动沿、停止/故障复位、结束回待机由生成代码统一处理。
 *
 * 不支持（后续扩展）：并行分支（SFC parallel）、步内子序列、动作限定符
 * （N/S/R/L/D 等，当前动作是「持续输出 + 每扫描赋值」语义）。
 */

import type { SequenceSpec, SequenceStep, StepAction, StepTransition } from '../spec/schema.ts';
import type { RequirementSpec } from '../spec/schema.ts';
import { generateIndustrialStepSequence } from './industrial-step.ts';

export interface StepSequenceResult {
  source: string;
  warnings: string[];
}

function normalizeTransitions(step: SequenceStep): StepTransition[] {
  if (!step.next) return [];
  return Array.isArray(step.next) ? step.next : [step.next];
}

/** 收集所有步动作里出现的 BOOL 输出目标（用于每扫描复位）。 */
function collectBoolOutputs(seq: SequenceSpec): string[] {
  const outs = new Set<string>();
  for (const step of seq.steps) {
    for (const action of step.actions ?? []) {
      if (action.value === 'ON' || action.value === 'OFF') outs.add(action.target.trim());
    }
  }
  return [...outs].sort();
}

function hasAnyDelay(seq: SequenceSpec): boolean {
  return seq.steps.some((s) => normalizeTransitions(s).some((t) => typeof t.delayMs === 'number'));
}

/** 初始化阶段发现的结构性错误（生成前校验，避免输出半成品）。 */
function validateSequence(seq: SequenceSpec): void {
  if (seq.steps.length === 0) throw new Error('sequence.steps 不能为空');
  const ids = new Set<string>();
  for (const s of seq.steps) {
    if (!s.id || !s.id.trim()) throw new Error('sequence.steps[].id 不能为空');
    if (ids.has(s.id)) throw new Error(`步 ID 重复：${s.id}`);
    ids.add(s.id);
  }
  const initial = seq.initialStep ?? seq.steps[0].id;
  if (!ids.has(initial)) throw new Error(`initialStep '${initial}' 不在 steps 中`);
  for (const s of seq.steps) {
    const transitions = normalizeTransitions(s);
    for (const t of transitions) {
      if (!t.to || !t.to.trim()) throw new Error(`步 ${s.id} 的转移缺少目标 to`);
      if (t.to !== 'END' && !ids.has(t.to)) {
        throw new Error(`步 ${s.id} 的转移目标 '${t.to}' 不存在（可用：${[...ids].join(', ')} 或 END）`);
      }
      if (!t.condition && typeof t.delayMs !== 'number') {
        throw new Error(`步 ${s.id} 的转移必须给 condition 或 delayMs 至少一项`);
      }
      if (typeof t.delayMs === 'number' && (!Number.isFinite(t.delayMs) || t.delayMs <= 0)) {
        throw new Error(`步 ${s.id} 的 delayMs 必须是正整数毫秒`);
      }
    }
  }
}

/** 生成延时步的 CASE 设定（只对带 delayMs 的步赋值）。 */
function delaySetupLines(seq: SequenceSpec): string[] {
  const lines: string[] = [];
  for (let i = 0; i < seq.steps.length; i++) {
    const step = seq.steps[i];
    const delays = normalizeTransitions(step)
      .map((t) => t.delayMs)
      .filter((v): v is number => typeof v === 'number' && v > 0);
    if (delays.length === 0) continue;
    const name = step.name ? ` ${step.name}` : '';
    lines.push(`            ${i + 1}: tStepTime := T#${delays[0]}ms;  // ${step.id}${name}`);
  }
  return lines;
}

/** 生成转移判断（支持多分支；delayMs 与 condition 同时给出表示“条件 AND 延时”）。 */
function transitionLines(seq: SequenceSpec, step: SequenceStep, useTimer: boolean): string[] {
  const transitions = normalizeTransitions(step);
  const idToIndex = new Map(seq.steps.map((s, i) => [s.id, i + 1]));
  const lines: string[] = [];
  transitions.forEach((t, idx) => {
    const keyword = idx === 0 ? 'IF' : 'ELSIF';
    const condParts: string[] = [];
    if (t.condition && t.condition.trim()) condParts.push(`(${t.condition.trim()})`);
    if (typeof t.delayMs === 'number') condParts.push('bTimerDone');
    const cond = condParts.length > 0 ? condParts.join(' AND ') : 'TRUE';
    const target = t.to.trim();
    const assign =
      target === 'END' ? 'nStep := 0; bRun := FALSE;' : `nStep := ${idToIndex.get(target) ?? '??'};`;
    lines.push(`                ${keyword} ${cond} THEN`);
    lines.push(`                    ${assign}`);
    if (useTimer) {
      lines.push('                    bTimerDone := FALSE;');
      lines.push('                    bTimerReset := TRUE;');
    }
  });
  if (lines.length > 0) lines.push('                END_IF;');
  return lines;
}

/** 生成步进 ST 源码。 */
export function generateStepSequence(spec: RequirementSpec): StepSequenceResult {
  const seq = spec.sequence;
  if (!seq) throw new Error('spec.sequence 为空，无法生成步进程序');
  // 工业版：带模式/气缸监视/手动/停止序列/HMI 时走工业骨架生成器
  if (seq.industrial) return generateIndustrialStepSequence(spec);
  validateSequence(seq);

  const warnings: string[] = [];
  const steps = seq.steps;
  const initial = seq.initialStep ?? steps[0].id;
  const initialIndex = steps.findIndex((s) => s.id === initial) + 1;
  const startCond = seq.startCondition?.trim() || 'X0';
  const stopCond = seq.stopCondition?.trim() || 'X1';
  const faultCond = seq.faultCondition?.trim() || 'X2';
  const boolOutputs = collectBoolOutputs(seq);
  const delay = hasAnyDelay(seq);
  if (delay && boolOutputs.length === 0) {
    warnings.push('延时转移存在但没有任何输出动作；请确认逻辑是否符合预期。');
  }

  const lines: string[] = [];
  lines.push('// ============================================================');
  lines.push('// 自动生成：ST 步进程序（SFC/STL 的 ST 实现）');
  lines.push('// 说明：nStep=0 待机；nStep=1..N 对应 steps 顺序');
  lines.push('// 启动/停止/故障条件、步动作、转移条件均来自 spec.sequence');
  lines.push('// ============================================================');
  lines.push('');
  lines.push('PROGRAM Main');
  lines.push('VAR');
  lines.push('    nStep : INT := 0;                       // 0=待机；1..N=步号');
  lines.push('    bRun : BOOL := FALSE;                   // 运行中');
  lines.push('    bStartLast : BOOL := FALSE;             // 启动条件上一扫描');
  if (delay) {
    lines.push('    bTimerDone : BOOL := FALSE;            // 当前步延时完成');
    lines.push('    bTimerReset : BOOL := FALSE;           // 步切换时复位定时器（一个扫描）');
    lines.push('    tStep : TON;                            // 步延时定时器');
    lines.push('    tStepTime : TIME := T#0ms;              // 当前步延时设定');
  }
  lines.push('END_VAR');
  lines.push('');
  lines.push('    // ---- 步号对照（便于审查） ----');
  lines.push('    // 0 = 待机（idle）');
  steps.forEach((s, i) => {
    lines.push(`    // ${i + 1} = ${s.id}${s.name ? ` ${s.name}` : ''}`);
  });
  lines.push('');

  lines.push('    // 1) 停止 / 故障：直接回待机');
  lines.push(`    IF (${stopCond}) OR (${faultCond}) THEN`);
  lines.push('        bRun := FALSE;');
  lines.push('        nStep := 0;');
  if (delay) {
    lines.push('        bTimerDone := FALSE;');
    lines.push('        bTimerReset := TRUE;');
  }
  lines.push('    END_IF;');
  lines.push('');
  lines.push('    // 2) 启动：启动条件上升沿（且无停止/故障）');
  lines.push(
    `    IF (${startCond}) AND NOT bStartLast AND NOT bRun AND NOT (${stopCond}) AND NOT (${faultCond}) THEN`,
  );
  lines.push('        bRun := TRUE;');
  lines.push(`        nStep := ${initialIndex};`);
  if (delay) {
    lines.push('        bTimerDone := FALSE;');
    lines.push('        bTimerReset := TRUE;');
  }
  lines.push('    END_IF;');
  lines.push(`    bStartLast := (${startCond});`);
  lines.push('');

  if (delay) {
    lines.push('    // 3) 步延时：仅带 delayMs 的步参与计时；步切换时复位一个扫描');
    lines.push('    CASE nStep OF');
    lines.push(...delaySetupLines(seq));
    lines.push('        ELSE');
    lines.push('            tStepTime := T#0ms;');
    lines.push('    END_CASE;');
    lines.push('    tStep(IN := bRun AND NOT bTimerDone AND NOT bTimerReset, PT := tStepTime);');
    lines.push('    IF tStep.Q THEN');
    lines.push('        bTimerDone := TRUE;');
    lines.push('        bTimerReset := FALSE;');
    lines.push('    END_IF;');
    lines.push('    IF NOT tStep.Q THEN');
    lines.push('        bTimerDone := FALSE;');
    lines.push('        bTimerReset := FALSE;');
    lines.push('    END_IF;');
    lines.push('');
  }

  const transLabel = delay ? 4 : 3;
  lines.push(`    // ${transLabel}) 步转移（选择分支按顺序先真先走）`);
  lines.push('    IF bRun THEN');
  lines.push('        CASE nStep OF');
  steps.forEach((s, i) => {
    lines.push(`            // ${s.id}${s.name ? ` ${s.name}` : ''}`);
    lines.push(`            ${i + 1}:`);
    const trans = transitionLines(seq, s, delay);
    if (trans.length === 0) {
      lines.push('                // 无转移条件：保持本步');
    } else {
      lines.push(...trans);
    }
  });
  lines.push('        END_CASE;');
  lines.push('    END_IF;');
  lines.push('');

  const outLabel = delay ? 5 : 4;
  lines.push(`    // ${outLabel}) 输出驱动：先复位本程序用到的输出，再按当前步置位`);
  for (const out of boolOutputs) {
    lines.push(`    ${out} := FALSE;`);
  }
  lines.push('    IF bRun THEN');
  lines.push('        CASE nStep OF');
  steps.forEach((s, i) => {
    const boolOn = (s.actions ?? [])
      .filter((a: StepAction) => a.value === 'ON')
      .map((a) => `${a.target.trim()} := TRUE;`);
    const boolOff = (s.actions ?? [])
      .filter((a: StepAction) => a.value === 'OFF')
      .map((a) => `${a.target.trim()} := FALSE;`);
    const assigns = (s.actions ?? [])
      .filter((a: StepAction) => typeof a.expression === 'string' && a.expression.trim())
      .map((a) => `${a.target.trim()} := ${a.expression!.trim()};`);
    const parts = [...boolOn, ...boolOff, ...assigns];
    if (parts.length === 0) return;
    lines.push(`            // ${s.id}`);
    lines.push(`            ${i + 1}:`);
    for (const p of parts) lines.push(`                ${p}`);
  });
  lines.push('        END_CASE;');
  lines.push('    END_IF;');
  lines.push('');
  lines.push('END_PROGRAM');
  lines.push('');
  lines.push('// 生成说明：');
  lines.push('// - 每个扫描周期先复位所有布尔输出，再由当前步置位 ON；');
  lines.push('// - 停止/故障条件成立时立即回待机（输出全部 OFF）；');
  lines.push('// - 转移条件为 ST 布尔表达式（传感器/定时器/计数器等任意组合）；');
  lines.push('// - 延时转移使用共享 TON，按步设定 tStepTime，步切换时复位；');
  lines.push('// - 并行分支（SFC parallel）尚未支持，可用两个步进程序 + 互锁实现。');

  return { source: lines.join('\n'), warnings };
}
