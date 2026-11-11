/**
 * 工业步进程序生成器（single PROGRAM：模式/自动/手动/报警/停止序列/HMI）。
 *
 * 由 spec.sequence.industrial 触发；没有 industrial 时使用旧的简单步进生成器。
 *
 * 设计约定（用户确认）：
 * - 模式：0 待机、1 自动、2 手动、3 停止中（仍属运行中）、4 报警、5 急停暂停；
 * - 气缸动作超时（默认 5s）：输出动作后目标磁性开关未到位 → 报警，步号冻结、流程不跳转；
 *   报警/急停时不强制全部输出 OFF（保持当前输出，防止掉件/失压动作），由人切手动处理；
 * - 手动：每个执行元件一个 HMI 翻转按钮（按一下到位、再按一下原位），仅手动模式有效；
 * - 报警/急停后：切手动清故障 → 继续（冻结步继续）/ 停止（停序列）/ 从头；
 * - 停止：当前步执行到安全完成点后进入停止序列，不是直接清输出；
 * - 急停：任何模式立即暂停，冻结步号，与报警同样允许手动处理。
 */

import type {
  CylinderSpec,
  IndustrialSpec,
  RequirementSpec,
  SequenceSpec,
  SequenceStep,
  StepAction,
} from '../spec/schema.ts';

export interface IndustrialStepResult {
  source: string;
  warnings: string[];
}

interface Ctx {
  spec: RequirementSpec;
  seq: SequenceSpec;
  ind: IndustrialSpec;
  cyls: CylinderSpec[];
  steps: SequenceStep[];
  stopSteps: IndustrialSpec['stopSequence'];
  /** 步 ID → CASE 标号（1 起）。 */
  stepIndex: Map<string, number>;
  /** 停止步 ID → 标号。 */
  stopIndex: Map<string, number>;
  /** 输出目标名 → 映像变量（bOutN）。 */
  outVar: Map<string, string>;
  outputs: string[];
  /** 手动按钮：气缸下标 → 按钮设备。 */
  manualButton: Map<number, string>;
}

const MODE = {
  idle: 0,
  auto: 1,
  manual: 2,
  stopping: 3,
  alarm: 4,
  paused: 5,
} as const;

function isDirectTarget(t: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(t.trim());
}

function actionShadowName(ctx: Ctx, target: string): string {
  const t = target.trim();
  let v = ctx.outVar.get(t);
  if (!v) {
    v = `bOut${ctx.outVar.size}`;
    ctx.outVar.set(t, v);
    ctx.outputs.push(t);
  }
  return v;
}

function collectOutputs(ctx: Ctx): void {
  const at = (a: StepAction) => {
    if (a.target && a.target.trim()) actionShadowName(ctx, a.target);
  };
  ctx.steps.forEach((s) => (s.actions ?? []).forEach(at));
  ctx.stopSteps.forEach((s) => (s.actions ?? []).forEach(at));
}

function cylVars(i: number) {
  const n = i + 1;
  return {
    extCmd: `bC${n}ExtCmd`,
    retCmd: `bC${n}RetCmd`,
    extMove: `bC${n}ExtMove`,
    retMove: `bC${n}RetMove`,
    relMove: `bC${n}RelMove`,
    clamp: `bC${n}Clamp`,
    clampMove: `bC${n}ClampMove`,
    tExt: `tC${n}Ext`,
    tRet: `tC${n}Ret`,
  };
}

function isSingle(c: CylinderSpec): boolean {
  return c.valve === 'single';
}

function timeoutMs(c: CylinderSpec): number {
  const v = c.timeoutMs;
  if (typeof v === 'number' && Number.isFinite(v) && v >= 100) return Math.trunc(v);
  return 5000;
}

function codeOf(c: CylinderSpec, dir: 'ext' | 'ret'): number {
  if (dir === 'ext') return c.alarmExtend?.code ?? (100 + 2);
  return c.alarmRetract?.code ?? (101 + 2);
}

function msgOf(c: CylinderSpec, dir: 'ext' | 'ret'): string {
  return dir === 'ext'
    ? c.alarmExtend?.message ?? `${c.name}伸出超时`
    : c.alarmRetract?.message ?? `${c.name}缩回超时`;
}

function transitionList(step: SequenceStep) {
  if (!step.next) return [];
  return Array.isArray(step.next) ? step.next : [step.next];
}

function validateAndIndex(ctx: Ctx): void {
  const { seq, ind, steps } = ctx;
  if (steps.length === 0) throw new Error('sequence.steps 不能为空');
  if (!ind.estop || !ind.estop.trim()) throw new Error('industrial.estop 不能为空');
  if (!ind.cylinders || ind.cylinders.length === 0) throw new Error('industrial.cylinders 不能为空');
  if (!ind.manualButtons || ind.manualButtons.length === 0) {
    throw new Error('industrial.manualButtons 不能为空（每个气缸一个翻转按钮）');
  }
  if (!ind.stopSequence || ind.stopSequence.length === 0) {
    throw new Error('industrial.stopSequence 不能为空（停止流程）');
  }
  const hmi = ind.hmi;
  for (const k of ['start', 'stop', 'reset', 'manual', 'exitManual', 'continueRun', 'restart'] as const) {
    if (!hmi[k] || !String(hmi[k]).trim()) throw new Error(`industrial.hmi.${k} 不能为空`);
  }
  steps.forEach((s, i) => {
    if (!s.id || !s.id.trim()) throw new Error(`sequence.steps[${i}].id 不能为空`);
    if (ctx.stepIndex.has(s.id)) throw new Error(`步 ID 重复：${s.id}`);
    ctx.stepIndex.set(s.id, i + 1);
    for (const t of transitionList(s)) {
      if (typeof t.delayMs === 'number') {
        throw new Error(`工业步进暂不支持 delayMs（步 ${s.id}），请改用传感器条件`);
      }
      if (!t.condition || !t.condition.trim()) throw new Error(`步 ${s.id} 的转移缺少 condition`);
      if (t.to !== 'END' && !steps.some((x) => x.id === t.to)) {
        throw new Error(`步 ${s.id} 的转移目标 '${t.to}' 不存在（可用 END）`);
      }
    }
  });
  ind.stopSequence.forEach((s, i) => {
    if (!s.id || !s.id.trim()) throw new Error(`industrial.stopSequence[${i}].id 不能为空`);
    if (!s.until || !s.until.trim()) throw new Error(`停止步 ${s.id} 缺少 until 条件`);
    ctx.stopIndex.set(s.id, i + 1);
  });
  const cylNames = new Set(ind.cylinders.map((c) => c.name));
  ind.manualButtons.forEach((b) => {
    if (!cylNames.has(b.cylinder)) {
      throw new Error(`manualButtons 的 cylinder '${b.cylinder}' 不在 cylinders 中`);
    }
    if (!b.button || !b.button.trim()) throw new Error('manualButtons[].button 不能为空');
  });
}

function manualInitLines(ctx: Ctx): string[] {
  const lines: string[] = [];
  ctx.cyls.forEach((c, i) => {
    const v = cylVars(i);
    if (isSingle(c)) {
      // 单电控：保持当前夹紧/松开状态，防止切换模式时掉件
      lines.push(`            ${v.clamp} := (${c.extendedX});`);
      lines.push(`            ${v.clampMove} := FALSE;`);
      lines.push(`            ${v.relMove} := FALSE;`);
    } else {
      lines.push(`            ${v.extCmd} := FALSE;`);
      lines.push(`            ${v.retCmd} := FALSE;`);
    }
  });
  return lines;
}

function outputsOffLines(ctx: Ctx): string[] {
  return ctx.outputs.map((o) => `            ${o} := FALSE;`);
}

function manualCmdResetLines(ctx: Ctx): string[] {
  const lines: string[] = [];
  ctx.cyls.forEach((c, i) => {
    const v = cylVars(i);
    if (isSingle(c)) {
      lines.push(`            ${v.clampMove} := FALSE;`);
      lines.push(`            ${v.relMove} := FALSE;`);
    } else {
      lines.push(`            ${v.extCmd} := FALSE;`);
      lines.push(`            ${v.retCmd} := FALSE;`);
    }
  });
  return lines;
}

/** 生成输出映像 + 气缸方向标志（自动或停止序列；reset 只在自动映像段执行一次）。 */
function imageLines(ctx: Ctx, mode: 'auto' | 'stop', reset: boolean): string[] {
  const lines: string[] = [];
  const I = '    ';
  const assignAction = (base: string, a: StepAction) => {
    const v = actionShadowName(ctx, a.target);
    if (typeof a.expression === 'string' && a.expression.trim()) {
      lines.push(`${base}${v} := ${a.expression.trim()};`);
      return;
    }
    const on = a.value === 'ON';
    lines.push(`${base}${v} := ${on ? 'TRUE' : 'FALSE'};`);
    // 气缸方向标志
    ctx.cyls.forEach((c, i) => {
      const cv = cylVars(i);
      const target = a.target.trim();
      if (target === c.extendY.trim()) {
        if (isSingle(c)) {
          if (on) lines.push(`${base}${cv.extMove} := TRUE;`);
          else lines.push(`${base}${cv.relMove} := TRUE;`);
        } else if (on) {
          lines.push(`${base}${cv.extMove} := TRUE;`);
        }
      } else if (!isSingle(c) && c.retractY && target === c.retractY.trim() && on) {
        lines.push(`${base}${cv.retMove} := TRUE;`);
      }
    });
  };

  if (reset) {
    for (const [, v] of ctx.outVar) lines.push(`${I}${v} := FALSE;`);
    ctx.cyls.forEach((c, i) => {
      const v = cylVars(i);
      lines.push(`${I}${v.extMove} := FALSE;`);
      lines.push(`${I}${v.retMove} := FALSE;`);
      if (isSingle(c)) lines.push(`${I}${v.relMove} := FALSE;`);
    });
    lines.push('');
  }

  if (mode === 'auto') {
    lines.push(`${I}IF nMode = ${MODE.auto} THEN`);
    lines.push(`${I}    CASE nStep OF`);
    ctx.steps.forEach((s) => {
      const idx = ctx.stepIndex.get(s.id)!;
      lines.push(`${I}        // ${s.id}${s.name ? ` ${s.name}` : ''}`);
      lines.push(`${I}        ${idx}:`);
      for (const a of s.actions ?? []) assignAction(`${I}            `, a);
    });
    lines.push(`${I}    END_CASE;`);
    lines.push(`${I}END_IF;`);
  } else {
    lines.push(`${I}IF nMode = ${MODE.stopping} THEN`);
    lines.push(`${I}    CASE nStopStep OF`);
    ctx.stopSteps.forEach((s) => {
      const idx = ctx.stopIndex.get(s.id)!;
      lines.push(`${I}        // ${s.id}${s.name ? ` ${s.name}` : ''}`);
      lines.push(`${I}        ${idx}:`);
      for (const a of s.actions ?? []) assignAction(`${I}            `, a);
    });
    lines.push(`${I}    END_CASE;`);
    lines.push(`${I}END_IF;`);
  }
  return lines;
}

function alarmLines(ctx: Ctx, index: number, dir: 'ext' | 'ret', code: number, msg: string): string[] {
  const v = cylVars(index);
  const lines = [
    `nMode := ${MODE.alarm};`,
    'bAlarm := TRUE;',
    `nAlarmCode := ${code};`,
    'nAlarmStep := nStep;',
  ];
  lines.push(...manualCmdResetLines(ctx).map((l) => l.trim()));
  if (isSingle(ctx.cyls[index])) {
    // 报警时保留夹爪状态（不强制松开）
    lines.push(`${v.relMove} := FALSE;`);
  }
  lines.push(`// ${msg}`);
  return lines;
}

function timerLines(ctx: Ctx): string[] {
  const lines: string[] = [];
  ctx.cyls.forEach((c, i) => {
    const v = cylVars(i);
    const pt = `T#${timeoutMs(c)}ms`;
    const auto = `((nMode = ${MODE.auto}) OR (nMode = ${MODE.stopping}))`;
    const manual = `(nMode = ${MODE.manual})`;
    if (isSingle(c)) {
      lines.push(`    // ${c.name}：夹紧/到位检测`);
      lines.push(
        `    ${v.tExt}(IN := (${auto} AND ${v.extMove} AND NOT ${c.extendedX}) OR (${manual} AND ${v.clampMove} AND NOT ${c.extendedX}), PT := ${pt});`,
      );
      lines.push(`    IF ${v.tExt}.Q THEN`);
      for (const l of alarmLines(ctx, i, 'ext', codeOf(c, 'ext', i), msgOf(c, 'ext'))) lines.push(`        ${l}`);
      lines.push('    END_IF;');
      lines.push('');
      lines.push(`    // ${c.name}：松开/回原位检测`);
      lines.push(
        `    ${v.tRet}(IN := ${v.relMove} AND NOT ${c.retractedX} AND ((nMode = ${MODE.auto}) OR (nMode = ${MODE.stopping}) OR (nMode = ${MODE.manual})), PT := ${pt});`,
      );
      lines.push(`    IF ${v.tRet}.Q THEN`);
      for (const l of alarmLines(ctx, i, 'ret', codeOf(c, 'ret', i), msgOf(c, 'ret'))) lines.push(`        ${l}`);
      lines.push('    END_IF;');
    } else {
      lines.push(`    // ${c.name}：伸出/到位检测`);
      lines.push(
        `    ${v.tExt}(IN := (${auto} AND ${v.extMove} AND NOT ${c.extendedX}) OR (${manual} AND ${v.extCmd} AND NOT ${c.extendedX}), PT := ${pt});`,
      );
      lines.push(`    IF ${v.tExt}.Q THEN`);
      for (const l of alarmLines(ctx, i, 'ext', codeOf(c, 'ext', i), msgOf(c, 'ext'))) lines.push(`        ${l}`);
      lines.push('    END_IF;');
      lines.push('');
      lines.push(`    // ${c.name}：缩回/原位检测`);
      lines.push(
        `    ${v.tRet}(IN := (${auto} AND ${v.retMove} AND NOT ${c.retractedX}) OR (${manual} AND ${v.retCmd} AND NOT ${c.retractedX}), PT := ${pt});`,
      );
      lines.push(`    IF ${v.tRet}.Q THEN`);
      for (const l of alarmLines(ctx, i, 'ret', codeOf(c, 'ret', i), msgOf(c, 'ret'))) lines.push(`        ${l}`);
      lines.push('    END_IF;');
    }
    lines.push('');
  });
  return lines;
}

function autoTransitionLines(ctx: Ctx): string[] {
  const lines: string[] = [];
  const indent = '        ';
  lines.push(`${indent}IF nMode = ${MODE.auto} THEN`);
  lines.push(`${indent}    CASE nStep OF`);
  ctx.steps.forEach((s) => {
    const idx = ctx.stepIndex.get(s.id)!;
    lines.push(`${indent}        // ${s.id}${s.name ? ` ${s.name}` : ''}`);
    lines.push(`${indent}        ${idx}:`);
    const trans = transitionList(s);
    trans.forEach((t, k) => {
      const kw = k === 0 ? 'IF' : 'ELSIF';
      lines.push(`${indent}            ${kw} (${t.condition!.trim()}) THEN`);
      lines.push(`${indent}                IF bStopReq THEN`);
      lines.push(`${indent}                    nMode := ${MODE.stopping};`);
      lines.push(`${indent}                    nStopStep := 1;`);
      lines.push(`${indent}                    bStopActive := TRUE;`);
      lines.push(`${indent}                    bStopReq := FALSE;`);
      lines.push(`${indent}                ELSE`);
      if (t.to === 'END') {
        for (const l of outputsOffLines(ctx)) lines.push(`${indent}                    ${l.trim()}`);
        lines.push(`${indent}                    nStep := 0;`);
        lines.push(`${indent}                    nMode := ${MODE.idle};`);
      } else {
        lines.push(`${indent}                    nStep := ${ctx.stepIndex.get(t.to)};`);
      }
      lines.push(`${indent}                END_IF;`);
    });
    if (trans.length > 0) lines.push(`${indent}            END_IF;`);
  });
  lines.push(`${indent}    END_CASE;`);
  lines.push(`${indent}END_IF;`);
  return lines;
}

function stopSequenceLines(ctx: Ctx): string[] {
  const lines: string[] = [];
  const indent = '        ';
  lines.push(`${indent}IF nMode = ${MODE.stopping} THEN`);
  lines.push(`${indent}    CASE nStopStep OF`);
  ctx.stopSteps.forEach((s) => {
    const idx = ctx.stopIndex.get(s.id)!;
    lines.push(`${indent}        // ${s.id}${s.name ? ` ${s.name}` : ''}`);
    lines.push(`${indent}        ${idx}:`);
    lines.push(`${indent}            IF (${s.until.trim()}) THEN`);
    lines.push(`${indent}                nStopStep := ${idx + 1};`);
    lines.push(`${indent}            END_IF;`);
  });
  lines.push(`${indent}        ELSE`);
  for (const l of outputsOffLines(ctx)) lines.push(`${indent}            ${l.trim()}`);
  lines.push(`${indent}            nMode := ${MODE.idle};`);
  lines.push(`${indent}            nStep := 0;`);
  lines.push(`${indent}            nStopStep := 0;`);
  lines.push(`${indent}            bStopActive := FALSE;`);
  lines.push(`${indent}            bStopReq := FALSE;`);
  lines.push(`${indent}    END_CASE;`);
  lines.push(`${indent}END_IF;`);
  return lines;
}

function manualLines(ctx: Ctx): string[] {
  const lines: string[] = [];
  const ind = '        ';
  lines.push(`${ind}IF nMode = ${MODE.manual} THEN`);
  ctx.cyls.forEach((c, i) => {
    const v = cylVars(i);
    const btn = ctx.manualButton.get(i);
    if (!btn) return;
    lines.push(`${ind}    // 手动翻转：${c.name}（${btn}）`);
    lines.push(`${ind}    IF bBtn${i + 1}Edge THEN`);
    if (isSingle(c)) {
      lines.push(`${ind}        IF ${c.retractedX} THEN`);
      lines.push(`${ind}            ${v.clamp} := TRUE;`);
      lines.push(`${ind}            ${v.clampMove} := TRUE;`);
      lines.push(`${ind}        ELSIF ${c.extendedX} THEN`);
      lines.push(`${ind}            ${v.clamp} := FALSE;`);
      lines.push(`${ind}            ${v.relMove} := TRUE;`);
      lines.push(`${ind}        ELSE`);
      lines.push(`${ind}            // 位置未知（卡在中间）：默认松开回原位，便于人工恢复`);
      lines.push(`${ind}            ${v.clamp} := FALSE;`);
      lines.push(`${ind}            ${v.relMove} := TRUE;`);
      lines.push(`${ind}        END_IF;`);
    } else {
      lines.push(`${ind}        IF ${c.retractedX} THEN`);
      lines.push(`${ind}            ${v.extCmd} := TRUE;`);
      lines.push(`${ind}            ${v.retCmd} := FALSE;`);
      lines.push(`${ind}        ELSIF ${c.extendedX} THEN`);
      lines.push(`${ind}            ${v.extCmd} := FALSE;`);
      lines.push(`${ind}            ${v.retCmd} := TRUE;`);
      lines.push(`${ind}        ELSE`);
      lines.push(`${ind}            // 位置未知（卡在中间）：默认缩回原位，便于人工恢复`);
      lines.push(`${ind}            ${v.extCmd} := FALSE;`);
      lines.push(`${ind}            ${v.retCmd} := TRUE;`);
      lines.push(`${ind}        END_IF;`);
    }
    lines.push(`${ind}    END_IF;`);
    if (isSingle(c)) {
      lines.push(`${ind}    IF ${v.clampMove} AND ${c.extendedX} THEN`);
      lines.push(`${ind}        ${v.clampMove} := FALSE;`);
      lines.push(`${ind}    END_IF;`);
      lines.push(`${ind}    IF ${v.relMove} AND ${c.retractedX} THEN`);
      lines.push(`${ind}        ${v.relMove} := FALSE;`);
      lines.push(`${ind}    END_IF;`);
    } else {
      lines.push(`${ind}    IF ${v.extCmd} AND ${c.extendedX} THEN`);
      lines.push(`${ind}        ${v.extCmd} := FALSE;`);
      lines.push(`${ind}    END_IF;`);
      lines.push(`${ind}    IF ${v.retCmd} AND ${c.retractedX} THEN`);
      lines.push(`${ind}        ${v.retCmd} := FALSE;`);
      lines.push(`${ind}    END_IF;`);
    }
    lines.push('');
  });
  lines.push(`${ind}END_IF;`);
  return lines;
}

function hmiStatusLines(ctx: Ctx): string[] {
  const h = ctx.ind.hmi;
  const st = h.status ?? {};
  const data = h.data ?? {};
  const idle = st.idle ?? 'M100';
  const auto = st.auto ?? 'M101';
  const manual = st.manual ?? 'M102';
  const stopping = st.stopping ?? 'M103';
  const alarm = st.alarm ?? 'M104';
  const paused = st.paused ?? 'M105';
  const dStep = data.step ?? 'D0';
  const dMode = data.mode ?? 'D1';
  const dAlarm = data.alarmCode ?? 'D2';
  const dAlarmStep = data.alarmStep ?? 'D3';
  const lines = [
    `    ${idle} := (nMode = ${MODE.idle});`,
    `    ${auto} := (nMode = ${MODE.auto});`,
    `    ${manual} := (nMode = ${MODE.manual});`,
    `    ${stopping} := (nMode = ${MODE.stopping});`,
    `    ${alarm} := bAlarm;`,
    `    ${paused} := bEStopPause;`,
    `    ${dStep} := nStep;`,
    `    ${dMode} := nMode;`,
    `    ${dAlarm} := nAlarmCode;`,
    `    ${dAlarmStep} := nAlarmStep;`,
  ];
  if (ctx.ind.alarmOutput && ctx.ind.alarmOutput !== alarm) {
    lines.push(`    ${ctx.ind.alarmOutput} := bAlarm;`);
  }
  return lines;
}

function outputDriveLines(ctx: Ctx): string[] {
  const lines: string[] = [];
  const ind = '    ';
  lines.push(`${ind}// ---- 输出汇总（同一输出只在此处驱动；报警/急停/待机保持输出不变） ----`);
  lines.push(`${ind}IF (nMode = ${MODE.auto}) OR (nMode = ${MODE.stopping}) THEN`);
  ctx.outputs.forEach((o) => {
    const v = ctx.outVar.get(o)!;
    lines.push(`${ind}    ${o} := ${v};`);
  });
  lines.push(`${ind}ELSIF nMode = ${MODE.manual} THEN`);
  ctx.cyls.forEach((c, i) => {
    const v = cylVars(i);
    if (isSingle(c)) {
      lines.push(`${ind}    ${c.extendY} := ${v.clamp};`);
    } else {
      lines.push(`${ind}    ${c.extendY} := ${v.extCmd};`);
      if (c.retractY) lines.push(`${ind}    ${c.retractY} := ${v.retCmd};`);
    }
  });
  lines.push(`${ind}END_IF;`);
  return lines;
}

/** 生成工业版 ST 步进程序。 */
export function generateIndustrialStepSequence(spec: RequirementSpec): IndustrialStepResult {
  const seq = spec.sequence;
  if (!seq) throw new Error('spec.sequence 为空');
  const ind = seq.industrial;
  if (!ind) throw new Error('spec.sequence.industrial 为空');
  const ctx: Ctx = {
    spec,
    seq,
    ind,
    cyls: ind.cylinders,
    steps: seq.steps,
    stopSteps: ind.stopSequence,
    stepIndex: new Map(),
    stopIndex: new Map(),
    outVar: new Map(),
    outputs: [],
    manualButton: new Map(),
  };
  validateAndIndex(ctx);
  collectOutputs(ctx);
  ind.manualButtons.forEach((b) => {
    const i = ctx.cyls.findIndex((c) => c.name === b.cylinder);
    if (i >= 0) ctx.manualButton.set(i, b.button.trim());
  });

  const warnings: string[] = [];
  const lines: string[] = [];
  const h = ind.hmi;
  const initialIndex = ctx.stepIndex.get(seq.initialStep ?? ctx.steps[0].id) ?? 1;

  lines.push('// ============================================================');
  lines.push('// 工业步进程序（自动生成：模式/自动/手动/报警/停止序列/HMI）');
  lines.push(`// 规格：${spec.name}`);
  lines.push(`// 急停：${ind.estop}；模式：0待机 1自动 2手动 3停止中 4报警 5急停暂停`);
  lines.push('// ============================================================');
  lines.push('');
  lines.push('PROGRAM Main');
  lines.push('VAR');
  lines.push('    // ---- 模式/流程 ----');
  lines.push(`    nMode : INT := ${MODE.idle};                   // 0待机 1自动 2手动 3停止中 4报警 5急停暂停`);
  lines.push('    nStep : INT := 0;                       // 自动步号（0=待机）');
  lines.push('    nStopStep : INT := 0;                   // 停止序列步号');
  lines.push('    bStopReq : BOOL := FALSE;               // 停止请求（当前步完成后进入停止序列）');
  lines.push('    bStopActive : BOOL := FALSE;            // 停止序列已启动');
  lines.push('    bAlarm : BOOL := FALSE;                 // 报警锁存');
  lines.push('    nAlarmCode : INT := 0;                  // 报警代码');
  lines.push('    nAlarmStep : INT := 0;                  // 报警时冻结的步号');
  lines.push('    bEStopPause : BOOL := FALSE;            // 急停暂停标志');
  lines.push('    bCylOK : BOOL := FALSE;                 // 所有气缸位置已知（复位/继续条件）');
  lines.push('');
  lines.push('    // ---- HMI 命令上升沿 ----');
  lines.push('    bStartLast : BOOL := FALSE;');
  lines.push('    bStopLast : BOOL := FALSE;');
  lines.push('    bResetLast : BOOL := FALSE;');
  lines.push('    bManualLast : BOOL := FALSE;');
  lines.push('    bExitLast : BOOL := FALSE;');
  lines.push('    bContinueLast : BOOL := FALSE;');
  lines.push('    bRestartLast : BOOL := FALSE;');
  ctx.cyls.forEach((_, i) => lines.push(`    bBtn${i + 1}Last : BOOL := FALSE;`));
  lines.push('');
  lines.push('    // ---- HMI 命令上升沿标志 ----');
  lines.push('    bStartEdge : BOOL := FALSE;');
  lines.push('    bStopEdge : BOOL := FALSE;');
  lines.push('    bResetEdge : BOOL := FALSE;');
  lines.push('    bManualEdge : BOOL := FALSE;');
  lines.push('    bExitEdge : BOOL := FALSE;');
  lines.push('    bContinueEdge : BOOL := FALSE;');
  lines.push('    bRestartEdge : BOOL := FALSE;');
  ctx.cyls.forEach((_, i) => lines.push(`    bBtn${i + 1}Edge : BOOL := FALSE;`));
  lines.push('');
  lines.push('    // ---- 输出映像（自动/停止序列） ----');
  for (const [target, v] of ctx.outVar) {
    lines.push(`    ${v} : BOOL := FALSE;                   // ${target}`);
  }
  lines.push('');
  lines.push('    // ---- 气缸动作标志/手动命令 ----');
  ctx.cyls.forEach((c, i) => {
    const v = cylVars(i);
    lines.push(`    ${v.extMove} : BOOL := FALSE;           // ${c.name}伸出动作中`);
    lines.push(`    ${v.retMove} : BOOL := FALSE;           // ${c.name}缩回动作中`);
    if (isSingle(c)) {
      lines.push(`    ${v.relMove} : BOOL := FALSE;           // ${c.name}松开动作中`);
      lines.push(`    ${v.clamp} : BOOL := FALSE;             // ${c.name}手动夹紧命令`);
      lines.push(`    ${v.clampMove} : BOOL := FALSE;         // ${c.name}手动夹紧动作中`);
    } else {
      lines.push(`    ${v.extCmd} : BOOL := FALSE;            // ${c.name}手动伸出命令`);
      lines.push(`    ${v.retCmd} : BOOL := FALSE;            // ${c.name}手动缩回命令`);
    }
  });
  lines.push('');
  lines.push('    // ---- 气缸超时定时器 ----');
  ctx.cyls.forEach((c, i) => {
    const v = cylVars(i);
    lines.push(`    ${v.tExt} : TON;                          // ${c.name}伸出/夹紧超时`);
    lines.push(`    ${v.tRet} : TON;                          // ${c.name}缩回/松开超时`);
  });
  lines.push('END_VAR');
  lines.push('');

  // 1) HMI 边沿
  lines.push('    // ---- 1) HMI 命令上升沿 ----');
  const edge = (name: string, dev: string, last: string) => {
    lines.push(`    ${name} := ${dev} AND NOT ${last};`);
    lines.push(`    ${last} := ${dev};`);
  };
  edge('bStartEdge', h.start, 'bStartLast');
  edge('bStopEdge', h.stop, 'bStopLast');
  edge('bResetEdge', h.reset, 'bResetLast');
  edge('bManualEdge', h.manual, 'bManualLast');
  edge('bExitEdge', h.exitManual, 'bExitLast');
  edge('bContinueEdge', h.continueRun, 'bContinueLast');
  edge('bRestartEdge', h.restart, 'bRestartLast');
  ind.manualButtons.forEach((b, k) => {
    const i = ctx.cyls.findIndex((c) => c.name === b.cylinder);
    if (i >= 0) {
      lines.push(`    bBtn${i + 1}Edge := ${b.button.trim()} AND NOT bBtn${i + 1}Last;`);
      lines.push(`    bBtn${i + 1}Last := ${b.button.trim()};`);
    }
  });
  lines.push('');

  // 2) 急停
  lines.push('    // ---- 2) 急停：任何模式立即暂停，冻结步号 ----');
  lines.push(`    IF ${ind.estop.trim()} THEN`);
  lines.push(`        IF nMode <> ${MODE.paused} THEN`);
  lines.push(`            nMode := ${MODE.paused};`);
  lines.push('            bEStopPause := TRUE;');
  lines.push('        END_IF;');
  lines.push('    END_IF;');
  lines.push('');

  // 3) 输出映像
  lines.push('    // ---- 3a) 自动输出映像与气缸方向标志 ----');
  lines.push(...imageLines(ctx, 'auto', true));
  lines.push('');
  lines.push('    // ---- 3b) 停止序列输出映像 ----');
  lines.push(...imageLines(ctx, 'stop', false));
  lines.push('');

  // 4) 气缸超时检测
  lines.push('    // ---- 4) 气缸动作超时检测（目标磁性开关 5s 未到位 → 报警） ----');
  lines.push(...timerLines(ctx));
  lines.push('');

  // 5) 模式与命令
  lines.push('    // ---- 5) 模式与 HMI 命令 ----');
  const cylOkExpr = ctx.cyls
    .map((c) => `((${c.extendedX}) OR (${c.retractedX}))`)
    .join(' AND ');
  lines.push(`    bCylOK := ${cylOkExpr};`);
  lines.push('');
  lines.push(`    // 待机：启动/切手动`);
  lines.push(`    IF nMode = ${MODE.idle} THEN`);
  lines.push(`        IF bStartEdge THEN`);
  lines.push(`            nStep := ${initialIndex};`);
  lines.push(`            nMode := ${MODE.auto};`);
  lines.push('            bStopReq := FALSE;');
  lines.push('            bStopActive := FALSE;');
  lines.push('            bAlarm := FALSE;');
  lines.push('            bEStopPause := FALSE;');
  lines.push('            nAlarmCode := 0;');
  lines.push('            nAlarmStep := 0;');
  lines.push('        END_IF;');
  lines.push(`        IF bManualEdge AND NOT ${ind.estop.trim()} THEN`);
  lines.push(`            nMode := ${MODE.manual};`);
  for (const l of manualInitLines(ctx)) lines.push(l);
  lines.push('        END_IF;');
  lines.push('    END_IF;');
  lines.push('');
  lines.push(`    // 自动：停止请求（当前步完成后进入停止序列）`);
  lines.push(`    IF nMode = ${MODE.auto} THEN`);
  lines.push('        IF bStopEdge THEN');
  lines.push('            bStopReq := TRUE;');
  lines.push('        END_IF;');
  lines.push('    END_IF;');
  lines.push('');
  lines.push(`    // 报警/急停暂停：切手动处理、停止、从头开始`);
  lines.push(`    IF (nMode = ${MODE.alarm}) OR (nMode = ${MODE.paused}) THEN`);
  lines.push(`        IF bManualEdge AND NOT ${ind.estop.trim()} THEN`);
  lines.push(`            nMode := ${MODE.manual};`);
  for (const l of manualInitLines(ctx)) lines.push(l);
  lines.push('        END_IF;');
  lines.push('        IF bStopEdge THEN');
  lines.push(`            nMode := ${MODE.stopping};`);
  lines.push('            IF NOT bStopActive THEN');
  lines.push('                nStopStep := 1;');
  lines.push('                bStopActive := TRUE;');
  lines.push('            END_IF;');
  lines.push('        END_IF;');
  lines.push('        IF bRestartEdge THEN');
  for (const l of outputsOffLines(ctx)) lines.push(l);
  for (const l of manualCmdResetLines(ctx)) lines.push(l);
  lines.push(`            nMode := ${MODE.idle};`);
  lines.push('            nStep := 0;');
  lines.push('            nStopStep := 0;');
  lines.push('            bStopActive := FALSE;');
  lines.push('            bStopReq := FALSE;');
  lines.push('            bAlarm := FALSE;');
  lines.push('            bEStopPause := FALSE;');
  lines.push('            nAlarmCode := 0;');
  lines.push('            nAlarmStep := 0;');
  lines.push('        END_IF;');
  lines.push('    END_IF;');
  lines.push('');
  lines.push(`    // 手动：清故障、退出手动、继续/停止/从头`);
  lines.push(`    IF nMode = ${MODE.manual} THEN`);
  lines.push(`        IF bResetEdge AND bCylOK AND NOT ${ind.estop.trim()} THEN`);
  lines.push('            bAlarm := FALSE;');
  lines.push('            bEStopPause := FALSE;');
  lines.push('            nAlarmCode := 0;');
  lines.push('            nAlarmStep := 0;');
  lines.push('        END_IF;');
  lines.push(
    `        IF bExitEdge AND bCylOK AND NOT bAlarm AND NOT bEStopPause AND NOT ${ind.estop.trim()} THEN`,
  );
  for (const l of outputsOffLines(ctx)) lines.push(l);
  lines.push(`            nMode := ${MODE.idle};`);
  lines.push('            nStep := 0;');
  lines.push('            bStopActive := FALSE;');
  lines.push('        END_IF;');
  lines.push(
    `        IF bContinueEdge AND bCylOK AND NOT bAlarm AND NOT bEStopPause AND NOT ${ind.estop.trim()} THEN`,
  );
  lines.push('            IF bStopActive THEN');
  lines.push(`                nMode := ${MODE.stopping};`);
  lines.push('            ELSE');
  lines.push(`                nMode := ${MODE.auto};`);
  lines.push('            END_IF;');
  lines.push('            bStopReq := FALSE;');
  lines.push('        END_IF;');
  lines.push('        IF bStopEdge THEN');
  lines.push(`            nMode := ${MODE.stopping};`);
  lines.push('            IF NOT bStopActive THEN');
  lines.push('                nStopStep := 1;');
  lines.push('                bStopActive := TRUE;');
  lines.push('            END_IF;');
  lines.push('        END_IF;');
  lines.push('        IF bRestartEdge THEN');
  for (const l of outputsOffLines(ctx)) lines.push(l);
  for (const l of manualCmdResetLines(ctx)) lines.push(l);
  lines.push(`            nMode := ${MODE.idle};`);
  lines.push('            nStep := 0;');
  lines.push('            nStopStep := 0;');
  lines.push('            bStopActive := FALSE;');
  lines.push('            bStopReq := FALSE;');
  lines.push('            bAlarm := FALSE;');
  lines.push('            bEStopPause := FALSE;');
  lines.push('            nAlarmCode := 0;');
  lines.push('            nAlarmStep := 0;');
  lines.push('        END_IF;');
  lines.push('    END_IF;');
  lines.push('');
  lines.push(`    // 急停仍按住时禁止任何模式切换`);
  lines.push(`    IF ${ind.estop.trim()} THEN`);
  lines.push(`        nMode := ${MODE.paused};`);
  lines.push('    END_IF;');
  lines.push('');

  // 6) 自动步转移
  lines.push('    // ---- 6) 自动步转移（报警/急停时 nMode 不是自动，流程不跳转） ----');
  lines.push(...autoTransitionLines(ctx));
  lines.push('');

  // 7) 停止序列
  lines.push('    // ---- 7) 停止序列（按顺序回原点，不直接清输出） ----');
  lines.push(...stopSequenceLines(ctx));
  lines.push('');

  // 8) 手动
  lines.push('    // ---- 8) 手动翻转（仅手动模式） ----');
  lines.push(...manualLines(ctx));
  lines.push('');

  // 9) 输出
  lines.push(...outputDriveLines(ctx));
  lines.push('');

  // 10) HMI 状态
  lines.push('    // ---- 10) HMI 状态/数据 ----');
  lines.push(...hmiStatusLines(ctx));
  lines.push('');
  lines.push('END_PROGRAM');
  lines.push('');

  return { source: lines.join('\n'), warnings };
}
