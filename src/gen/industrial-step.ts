/**
 * 工业步进程序生成器（FB 版）：
 * - 双电控气缸：FB_Cylinder（输出 + 5s 超时 + 报警码）
 * - 单电控气缸：FB_CylinderSV（弹簧复位，无缩回输出）
 * - 主程序只保留：模式管理 / 自动步 / 停止序列 / 手动翻转 / HMI / 报警汇总
 *
 * 设计约定（用户确认）：
 * - 模式：0 待机、1 自动、2 手动、3 停止中（仍属运行中）、4 报警、5 急停暂停；
 * - 气缸动作超时（默认 5s）：命令输出后目标磁性开关未到位 → 报警，步号冻结、流程不跳转；
 *   报警/急停时 FB 停止驱动（输出保持），不强制全部 OFF，由人切手动处理；
 * - 手动：每个执行元件一个翻转按钮（按一下到位、再按一下原位），仅手动模式有效；
 * - 报警/急停后：切手动清故障 → 继续（冻结步）/ 停止（停序列）/ 从头；
 * - 停止：当前步安全完成后进入停止序列，不是直接清输出；
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
import { renameIdentifiers } from '../emit/label-map.ts';

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
  stepIndex: Map<string, number>;
  stopIndex: Map<string, number>;
  /** 气缸下标 → 手动按钮设备。 */
  manualButton: Map<number, string>;
  /** 软元件输出 → 气缸方向（用于校验与命令生成）。 */
  outMap: Map<string, { cyl: number; dir: 'ext' | 'ret' }>;
  /** 是否使用中文局部标签（含 FB 形参/实例名）。 */
  zh: boolean;
}

const MODE = {
  idle: 0,
  auto: 1,
  manual: 2,
  stopping: 3,
  alarm: 4,
  paused: 5,
} as const;

function isSingle(c: CylinderSpec): boolean {
  return c.valve === 'single';
}

function timeoutMs(c: CylinderSpec): number {
  const v = c.timeoutMs;
  if (typeof v === 'number' && Number.isFinite(v) && v >= 100) return Math.trunc(v);
  return 5000;
}

function codeOf(c: CylinderSpec, dir: 'ext' | 'ret', index: number): number {
  if (dir === 'ext') return c.alarmExtend?.code ?? 100 + (index + 1) * 2;
  return c.alarmRetract?.code ?? 101 + (index + 1) * 2;
}

function msgOf(c: CylinderSpec, dir: 'ext' | 'ret'): string {
  return dir === 'ext'
    ? c.alarmExtend?.message ?? `${c.name}动作超时`
    : c.alarmRetract?.message ?? `${c.name}复位超时`;
}

function transitionList(step: SequenceStep) {
  if (!step.next) return [];
  return Array.isArray(step.next) ? step.next : [step.next];
}

function cylVars(i: number) {
  const n = i + 1;
  return {
    cmdExt: `bC${n}Ext`,
    cmdRet: `bC${n}Ret`,
    cmdClamp: `bC${n}Clamp`,
    outExt: `bC${n}OutExt`,
    outRet: `bC${n}OutRet`,
    outClamp: `bC${n}OutClamp`,
    alarm: `bC${n}Alarm`,
    alarmCode: `nC${n}AlarmCode`,
    fb: `fbCyl${n}`,
  };
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

  // 输出映射：FB 版要求所有动作目标都是某气缸的伸出/缩回输出
  const outMap = new Map<string, { cyl: number; dir: 'ext' | 'ret' }>();
  ind.cylinders.forEach((c, i) => {
    outMap.set(c.extendY.trim(), { cyl: i, dir: 'ext' });
    if (!isSingle(c) && c.retractY) outMap.set(c.retractY.trim(), { cyl: i, dir: 'ret' });
  });
  ctx.outMap = outMap;
  const checkAction = (a: StepAction, where: string) => {
    const target = a.target.trim();
    if (!outMap.has(target)) {
      throw new Error(
        `${where} 的动作目标 '${target}' 不是任何气缸的输出；FB 版工业步进只支持气缸输出动作`,
      );
    }
  };
  steps.forEach((s) => (s.actions ?? []).forEach((a) => checkAction(a, `步 ${s.id}`)));
  ind.stopSequence.forEach((s) => (s.actions ?? []).forEach((a) => checkAction(a, `停止步 ${s.id}`)));

  const cylNames = new Set(ind.cylinders.map((c) => c.name));
  ind.manualButtons.forEach((b) => {
    if (!cylNames.has(b.cylinder)) throw new Error(`manualButtons 的 cylinder '${b.cylinder}' 不在 cylinders 中`);
    if (!b.button || !b.button.trim()) throw new Error('manualButtons[].button 不能为空');
  });
}

/** FB_Cylinder：双电控气缸（伸出/缩回输出 + 双向 5s 超时）。 */
function emitDoubleCylinderFB(): string[] {
  return [
    '// ============================================================',
    '// 气缸功能块（双电控）：输出 + 双向超时报警',
    '// ============================================================',
    'FUNCTION_BLOCK FB_Cylinder',
    'VAR_INPUT',
    '    bEnable : BOOL;                    // 允许动作/监视（自动/停止中/手动）',
    '    bCmdExtend : BOOL;                 // 命令伸出',
    '    bCmdRetract : BOOL;                // 命令缩回',
    '    xExtended : BOOL;                  // 伸出到位磁性开关',
    '    xRetracted : BOOL;                 // 原位磁性开关',
    '    tTimeout : TIME := T#5s;           // 动作超时',
    '    nAlarmExt : INT := 100;            // 伸出超时报警码',
    '    nAlarmRet : INT := 101;            // 缩回超时报警码',
    'END_VAR',
    'VAR_OUTPUT',
    '    bOutExtend : BOOL;                 // 伸出输出（驱动 Y）',
    '    bOutRetract : BOOL;                // 缩回输出（驱动 Y）',
    '    bAlarm : BOOL;                     // 超时报警',
    '    nAlarmCode : INT;                  // 报警码',
    'END_VAR',
    'VAR',
    '    tExt : TON;',
    '    tRet : TON;',
    'END_VAR',
    '    // 输出（bEnable=FALSE 时保持输出，配合报警/急停冻结）',
    '    IF bEnable THEN',
    '        bOutExtend := bCmdExtend;',
    '        bOutRetract := bCmdRetract;',
    '    END_IF;',
    '',
    '    // 超时监视',
    '    tExt(IN := bEnable AND bCmdExtend AND NOT xExtended, PT := tTimeout);',
    '    tRet(IN := bEnable AND bCmdRetract AND NOT xRetracted, PT := tTimeout);',
    '',
    '    bAlarm := FALSE;',
    '    IF tExt.Q THEN',
    '        bAlarm := TRUE;',
    '        nAlarmCode := nAlarmExt;',
    '    ELSIF tRet.Q THEN',
    '        bAlarm := TRUE;',
    '        nAlarmCode := nAlarmRet;',
    '    END_IF;',
    'END_FUNCTION_BLOCK',
    '',
  ];
}

/** FB_CylinderSV：单电控（弹簧复位）气缸（夹紧/松开 + 双向超时）。 */
function emitSingleCylinderFB(): string[] {
  return [
    '// ============================================================',
    '// 气缸功能块（单电控/弹簧复位）：夹紧输出 + 双向超时报警',
    '// ============================================================',
    'FUNCTION_BLOCK FB_CylinderSV',
    'VAR_INPUT',
    '    bEnable : BOOL;                    // 允许动作/监视（自动/停止中/手动）',
    '    bCmdClamp : BOOL;                  // 命令夹紧（FALSE=松开）',
    '    xClamped : BOOL;                   // 夹紧到位磁性开关',
    '    xReleased : BOOL;                  // 松开到位磁性开关',
    '    tTimeout : TIME := T#5s;           // 动作超时',
    '    nAlarmClamp : INT := 100;          // 夹紧超时报警码',
    '    nAlarmRelease : INT := 101;        // 松开超时报警码',
    'END_VAR',
    'VAR_OUTPUT',
    '    bOutClamp : BOOL;                  // 夹紧输出（驱动 Y）',
    '    bAlarm : BOOL;                     // 超时报警',
    '    nAlarmCode : INT;                  // 报警码',
    'END_VAR',
    'VAR',
    '    tClamp : TON;',
    '    tRelease : TON;',
    'END_VAR',
    '    // 输出（bEnable=FALSE 时保持输出）',
    '    IF bEnable THEN',
    '        bOutClamp := bCmdClamp;',
    '    END_IF;',
    '',
    '    // 超时监视',
    '    tClamp(IN := bEnable AND bCmdClamp AND NOT xClamped, PT := tTimeout);',
    '    tRelease(IN := bEnable AND NOT bCmdClamp AND NOT xReleased, PT := tTimeout);',
    '',
    '    bAlarm := FALSE;',
    '    IF tClamp.Q THEN',
    '        bAlarm := TRUE;',
    '        nAlarmCode := nAlarmClamp;',
    '    ELSIF tRelease.Q THEN',
    '        bAlarm := TRUE;',
    '        nAlarmCode := nAlarmRelease;',
    '    END_IF;',
    'END_FUNCTION_BLOCK',
    '',
  ];
}

function manualInitLines(ctx: Ctx): string[] {
  const lines: string[] = [];
  ctx.cyls.forEach((c, i) => {
    const v = cylVars(i);
    if (isSingle(c)) {
      lines.push(`            ${v.cmdClamp} := (${c.extendedX});  // 保持当前夹紧状态`);
    } else {
      lines.push(`            ${v.cmdExt} := FALSE;`);
      lines.push(`            ${v.cmdRet} := FALSE;`);
    }
  });
  return lines;
}

function cmdResetLines(ctx: Ctx): string[] {
  const lines: string[] = [];
  ctx.cyls.forEach((c, i) => {
    const v = cylVars(i);
    if (isSingle(c)) lines.push(`            ${v.cmdClamp} := FALSE;`);
    else {
      lines.push(`            ${v.cmdExt} := FALSE;`);
      lines.push(`            ${v.cmdRet} := FALSE;`);
    }
  });
  return lines;
}

/** 生成自动/停止序列的“输出命令” CASE（动作目标 → 气缸命令）。 */
function commandCaseLines(ctx: Ctx, mode: 'auto' | 'stop', indent: string): string[] {
  const lines: string[] = [];
  const setAction = (a: StepAction) => {
    const target = a.target.trim();
    const hit = ctx.outMap.get(target);
    if (!hit) return;
    const v = cylVars(hit.cyl);
    const c = ctx.cyls[hit.cyl];
    if (isSingle(c)) {
      const clamp = a.value !== 'OFF';
      lines.push(`${indent}${v.cmdClamp} := ${clamp ? 'TRUE' : 'FALSE'};`);
    } else if (hit.dir === 'ext') {
      lines.push(`${indent}${v.cmdExt} := TRUE;`);
    } else {
      lines.push(`${indent}${v.cmdRet} := TRUE;`);
    }
  };
  if (mode === 'auto') {
    ctx.steps.forEach((s) => {
      const idx = ctx.stepIndex.get(s.id)!;
      lines.push(`${indent}    // ${s.id}${s.name ? ` ${s.name}` : ''}`);
      lines.push(`${indent}    ${idx}:`);
      for (const a of s.actions ?? []) setAction(a);
    });
  } else {
    ctx.stopSteps.forEach((s) => {
      const idx = ctx.stopIndex.get(s.id)!;
      lines.push(`${indent}    // ${s.id}${s.name ? ` ${s.name}` : ''}`);
      lines.push(`${indent}    ${idx}:`);
      for (const a of s.actions ?? []) setAction(a);
    });
  }
  return lines;
}

function fbInstanceLines(ctx: Ctx, i: number): string[] {
  const c = ctx.cyls[i];
  const v = cylVars(i);
  const lines: string[] = [];
  lines.push(`    // ${c.name}（${isSingle(c) ? '单电控' : '双电控'}）`);
  if (isSingle(c)) {
    lines.push(`    ${v.fb}(bEnable := (nMode = 1) OR (nMode = 2) OR (nMode = 3),`);
    lines.push(`              bCmdClamp := ${v.cmdClamp},`);
    lines.push(`              xClamped := ${c.extendedX}, xReleased := ${c.retractedX},`);
    lines.push(`              tTimeout := T#${timeoutMs(c)}ms,`);
    lines.push(`              nAlarmClamp := ${codeOf(c, 'ext', i)}, nAlarmRelease := ${codeOf(c, 'ret', i)},`);
    lines.push(`              bOutClamp => ${v.outClamp}, bAlarm => ${v.alarm}, nAlarmCode => ${v.alarmCode});`);
  } else {
    lines.push(`    ${v.fb}(bEnable := (nMode = 1) OR (nMode = 2) OR (nMode = 3),`);
    lines.push(`              bCmdExtend := ${v.cmdExt}, bCmdRetract := ${v.cmdRet},`);
    lines.push(`              xExtended := ${c.extendedX}, xRetracted := ${c.retractedX},`);
    lines.push(`              tTimeout := T#${timeoutMs(c)}ms,`);
    lines.push(`              nAlarmExt := ${codeOf(c, 'ext', i)}, nAlarmRet := ${codeOf(c, 'ret', i)},`);
    lines.push(`              bOutExtend => ${v.outExt}, bOutRetract => ${v.outRet},`);
    lines.push(`              bAlarm => ${v.alarm}, nAlarmCode => ${v.alarmCode});`);
  }
  lines.push('');
  return lines;
}

function alarmAggregateLines(ctx: Ctx): string[] {
  const lines: string[] = [];
  const alarms = ctx.cyls.map((_, i) => cylVars(i).alarm);
  lines.push(`    bAlarmAny := ${alarms.join(' OR ')};`);
  lines.push('    IF bAlarmAny AND NOT bAlarm THEN');
  lines.push('        bAlarm := TRUE;');
  lines.push(`        nMode := ${MODE.alarm};`);
  lines.push('        nAlarmStep := nStep;');
  const branches = ctx.cyls
    .map((c, i) => {
      const v = cylVars(i);
      return `        ${i === 0 ? 'IF' : 'ELSIF'} ${v.alarm} THEN nAlarmCode := ${v.alarmCode};  // ${c.name}`;
    })
    .join('\n');
  lines.push(branches);
  lines.push('        END_IF;');
  // 取消手动动作命令，等待人工处理
  for (const l of cmdResetLines(ctx)) lines.push(`    ${l.trim()}`);
  lines.push('    END_IF;');
  return lines;
}

function autoTransitionLines(ctx: Ctx): string[] {
  const lines: string[] = [];
  const ind = '        ';
  lines.push(`${ind}IF nMode = ${MODE.auto} THEN`);
  lines.push(`${ind}    CASE nStep OF`);
  ctx.steps.forEach((s) => {
    const idx = ctx.stepIndex.get(s.id)!;
    lines.push(`${ind}        // ${s.id}${s.name ? ` ${s.name}` : ''}`);
    lines.push(`${ind}        ${idx}:`);
    const trans = transitionList(s);
    trans.forEach((t, k) => {
      const kw = k === 0 ? 'IF' : 'ELSIF';
      lines.push(`${ind}            ${kw} (${t.condition!.trim()}) THEN`);
      lines.push(`${ind}                IF bStopReq THEN`);
      lines.push(`${ind}                    nMode := ${MODE.stopping};`);
      lines.push(`${ind}                    nStopStep := 1;`);
      lines.push(`${ind}                    bStopActive := TRUE;`);
      lines.push(`${ind}                    bStopReq := FALSE;`);
      lines.push(`${ind}                ELSE`);
      if (t.to === 'END') {
        lines.push(`${ind}                    nStep := 0;`);
        lines.push(`${ind}                    nMode := ${MODE.idle};`);
      } else {
        lines.push(`${ind}                    nStep := ${ctx.stepIndex.get(t.to)};`);
      }
      lines.push(`${ind}                END_IF;`);
    });
    if (trans.length > 0) lines.push(`${ind}            END_IF;`);
  });
  lines.push(`${ind}    END_CASE;`);
  lines.push(`${ind}END_IF;`);
  return lines;
}

function stopSequenceLines(ctx: Ctx): string[] {
  const lines: string[] = [];
  const ind = '        ';
  lines.push(`${ind}IF nMode = ${MODE.stopping} THEN`);
  lines.push(`${ind}    CASE nStopStep OF`);
  ctx.stopSteps.forEach((s) => {
    const idx = ctx.stopIndex.get(s.id)!;
    lines.push(`${ind}        // ${s.id}${s.name ? ` ${s.name}` : ''}`);
    lines.push(`${ind}        ${idx}:`);
    lines.push(`${ind}            IF (${s.until.trim()}) THEN`);
    lines.push(`${ind}                nStopStep := ${idx + 1};`);
    lines.push(`${ind}            END_IF;`);
  });
  lines.push(`${ind}        ELSE`);
  lines.push(`${ind}            nMode := ${MODE.idle};`);
  lines.push(`${ind}            nStep := 0;`);
  lines.push(`${ind}            nStopStep := 0;`);
  lines.push(`${ind}            bStopActive := FALSE;`);
  lines.push(`${ind}            bStopReq := FALSE;`);
  lines.push(`${ind}    END_CASE;`);
  lines.push(`${ind}END_IF;`);
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
      lines.push(`${ind}            ${v.cmdClamp} := TRUE;`);
      lines.push(`${ind}        ELSIF ${c.extendedX} THEN`);
      lines.push(`${ind}            ${v.cmdClamp} := FALSE;`);
      lines.push(`${ind}        ELSE`);
      lines.push(`${ind}            // 位置未知（卡在中间）：默认松开回原位，便于人工恢复`);
      lines.push(`${ind}            ${v.cmdClamp} := FALSE;`);
      lines.push(`${ind}        END_IF;`);
    } else {
      lines.push(`${ind}        IF ${c.retractedX} THEN`);
      lines.push(`${ind}            ${v.cmdExt} := TRUE;`);
      lines.push(`${ind}            ${v.cmdRet} := FALSE;`);
      lines.push(`${ind}        ELSIF ${c.extendedX} THEN`);
      lines.push(`${ind}            ${v.cmdExt} := FALSE;`);
      lines.push(`${ind}            ${v.cmdRet} := TRUE;`);
      lines.push(`${ind}        ELSE`);
      lines.push(`${ind}            // 位置未知（卡在中间）：默认缩回原位，便于人工恢复`);
      lines.push(`${ind}            ${v.cmdExt} := FALSE;`);
      lines.push(`${ind}            ${v.cmdRet} := TRUE;`);
      lines.push(`${ind}        END_IF;`);
    }
    lines.push(`${ind}    END_IF;`);
    if (!isSingle(c)) {
      lines.push(`${ind}    IF ${v.cmdExt} AND ${c.extendedX} THEN`);
      lines.push(`${ind}        ${v.cmdExt} := FALSE;`);
      lines.push(`${ind}    END_IF;`);
      lines.push(`${ind}    IF ${v.cmdRet} AND ${c.retractedX} THEN`);
      lines.push(`${ind}        ${v.cmdRet} := FALSE;`);
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
  lines.push('    // ---- 输出汇总（Y 只在此处驱动；待机全关，其他模式取 FB 输出） ----');
  lines.push(`    IF nMode = ${MODE.idle} THEN`);
  ctx.cyls.forEach((c) => {
    lines.push(`        ${c.extendY} := FALSE;`);
    if (!isSingle(c) && c.retractY) lines.push(`        ${c.retractY} := FALSE;`);
  });
  lines.push('    ELSE');
  ctx.cyls.forEach((c, i) => {
    const v = cylVars(i);
    if (isSingle(c)) {
      lines.push(`        ${c.extendY} := ${v.outClamp};`);
    } else {
      lines.push(`        ${c.extendY} := ${v.outExt};`);
      if (c.retractY) lines.push(`        ${c.retractY} := ${v.outRet};`);
    }
  });
  lines.push('    END_IF;');
  return lines;
}

/** 中文局部标签重命名表（类型前缀 b/n/t/x + 中文语义，便于阅读）。 */
function buildZhRenameMap(ctx: Ctx): Map<string, string> {
  const m = new Map<string, string>();
  const add = (en: string, zh: string) => m.set(en, zh);

  // 模式/流程
  add('nMode', 'n模式');
  add('nStep', 'n步号');
  add('nStopStep', 'n停止步号');
  add('bStopReq', 'b停止请求');
  add('bStopActive', 'b停止序列启动');
  add('bAlarmAny', 'b存在报警');
  add('bAlarm', 'b报警');
  add('nAlarmCode', 'n报警码');
  add('nAlarmStep', 'n报警步号');
  add('bEStopPause', 'b急停暂停');
  add('bCylOK', 'b气缸位置正常');

  // HMI 边沿
  add('bStartLast', 'b启动上次');
  add('bStopLast', 'b停止上次');
  add('bResetLast', 'b复位上次');
  add('bManualLast', 'b手动上次');
  add('bExitLast', 'b退出手动上次');
  add('bContinueLast', 'b继续上次');
  add('bRestartLast', 'b从头上次');
  add('bStartEdge', 'b启动上升沿');
  add('bStopEdge', 'b停止上升沿');
  add('bResetEdge', 'b复位上升沿');
  add('bManualEdge', 'b手动上升沿');
  add('bExitEdge', 'b退出手动上升沿');
  add('bContinueEdge', 'b继续上升沿');
  add('bRestartEdge', 'b从头上升沿');

  // FB 形参/内部变量
  add('bEnable', 'b使能');
  add('bCmdExtend', 'b伸出命令');
  add('bCmdRetract', 'b缩回命令');
  add('xExtended', 'x伸出到位');
  add('xRetracted', 'x原位到位');
  add('tTimeout', 't超时');
  add('nAlarmExt', 'n伸出报警码');
  add('nAlarmRet', 'n缩回报警码');
  add('bOutExtend', 'b伸出输出');
  add('bOutRetract', 'b缩回输出');
  add('tExt', 't伸出超时');
  add('tRet', 't缩回超时');
  add('bCmdClamp', 'b夹紧命令');
  add('xClamped', 'x夹紧到位');
  add('xReleased', 'x松开到位');
  add('nAlarmClamp', 'n夹紧报警码');
  add('nAlarmRelease', 'n松开报警码');
  add('bOutClamp', 'b夹紧输出');
  add('tClamp', 't夹紧超时');
  add('tRelease', 't松开超时');

  // 每个气缸
  ctx.cyls.forEach((c, i) => {
    const n = i + 1;
    add(`bC${n}Ext`, `b${c.name}伸出命令`);
    add(`bC${n}Ret`, `b${c.name}缩回命令`);
    add(`bC${n}Clamp`, `b${c.name}夹紧命令`);
    add(`bC${n}OutExt`, `b${c.name}伸出输出`);
    add(`bC${n}OutRet`, `b${c.name}缩回输出`);
    add(`bC${n}OutClamp`, `b${c.name}夹紧输出`);
    add(`bC${n}Alarm`, `b${c.name}报警`);
    add(`nC${n}AlarmCode`, `n${c.name}报警码`);
    add(`fbCyl${n}`, `fb${c.name}`);
    add(`bBtn${n}Edge`, `b手动${c.name}上升沿`);
    add(`bBtn${n}Last`, `b手动${c.name}上次`);
  });
  return m;
}

/** 生成工业版 ST 步进程序（FB 版）。 */
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
    manualButton: new Map(),
    outMap: new Map(),
    zh: (spec.labels?.language ?? 'en') === 'zh',
  };
  validateAndIndex(ctx);
  ind.manualButtons.forEach((b) => {
    const i = ctx.cyls.findIndex((c) => c.name === b.cylinder);
    if (i >= 0) ctx.manualButton.set(i, b.button.trim());
  });

  const warnings: string[] = [];
  const lines: string[] = [];
  const h = ind.hmi;
  const initialIndex = ctx.stepIndex.get(seq.initialStep ?? ctx.steps[0].id) ?? 1;

  lines.push(...emitDoubleCylinderFB());
  lines.push(...emitSingleCylinderFB());

  lines.push('// ============================================================');
  lines.push('// 工业步进主程序（FB 版：模式/自动/手动/报警/停止序列/HMI）');
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
  lines.push('    bAlarmAny : BOOL := FALSE;              // 任一气缸超时');
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
  lines.push('    // ---- 气缸命令（自动/停止序列/手动共用） ----');
  ctx.cyls.forEach((c, i) => {
    const v = cylVars(i);
    if (isSingle(c)) {
      lines.push(`    ${v.cmdClamp} : BOOL := FALSE;            // ${c.name}：夹紧命令（FALSE=松开）`);
    } else {
      lines.push(`    ${v.cmdExt} : BOOL := FALSE;             // ${c.name}：伸出命令`);
      lines.push(`    ${v.cmdRet} : BOOL := FALSE;             // ${c.name}：缩回命令`);
    }
  });
  lines.push('');
  lines.push('    // ---- FB 输出/报警 ----');
  ctx.cyls.forEach((c, i) => {
    const v = cylVars(i);
    if (isSingle(c)) {
      lines.push(`    ${v.outClamp} : BOOL := FALSE;`);
    } else {
      lines.push(`    ${v.outExt} : BOOL := FALSE;`);
      lines.push(`    ${v.outRet} : BOOL := FALSE;`);
    }
    lines.push(`    ${v.alarm} : BOOL := FALSE;`);
    lines.push(`    ${v.alarmCode} : INT := 0;`);
  });
  lines.push('');
  lines.push('    // ---- FB 实例 ----');
  ctx.cyls.forEach((c, i) => {
    const v = cylVars(i);
    lines.push(`    ${v.fb} : ${isSingle(c) ? 'FB_CylinderSV' : 'FB_Cylinder'};  // ${c.name}`);
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
  ind.manualButtons.forEach((b) => {
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

  // 3) 模式与命令
  lines.push('    // ---- 3) 模式与 HMI 命令 ----');
  const cylOkExpr = ctx.cyls
    .map((c) => `((${c.extendedX}) OR (${c.retractedX}))`)
    .join(' AND ');
  lines.push(`    bCylOK := ${cylOkExpr};`);
  lines.push('');
  lines.push('    // 待机：启动/切手动');
  lines.push(`    IF nMode = ${MODE.idle} THEN`);
  lines.push('        IF bStartEdge THEN');
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
  lines.push('    // 自动：停止请求（当前步完成后进入停止序列）');
  lines.push(`    IF nMode = ${MODE.auto} THEN`);
  lines.push('        IF bStopEdge THEN');
  lines.push('            bStopReq := TRUE;');
  lines.push('        END_IF;');
  lines.push('    END_IF;');
  lines.push('');
  lines.push('    // 报警/急停暂停：切手动处理、停止、从头开始');
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
  lines.push(`            nMode := ${MODE.idle};`);
  lines.push('            nStep := 0;');
  lines.push('            nStopStep := 0;');
  lines.push('            bStopActive := FALSE;');
  lines.push('            bStopReq := FALSE;');
  lines.push('            bAlarm := FALSE;');
  lines.push('            bEStopPause := FALSE;');
  lines.push('            nAlarmCode := 0;');
  lines.push('            nAlarmStep := 0;');
  for (const l of cmdResetLines(ctx)) lines.push(l);
  lines.push('        END_IF;');
  lines.push('    END_IF;');
  lines.push('');
  lines.push('    // 手动：清故障、退出手动、继续/停止/从头');
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
  lines.push(`            nMode := ${MODE.idle};`);
  lines.push('            nStep := 0;');
  lines.push('            nStopStep := 0;');
  lines.push('            bStopActive := FALSE;');
  lines.push('            bStopReq := FALSE;');
  lines.push('            bAlarm := FALSE;');
  lines.push('            bEStopPause := FALSE;');
  lines.push('            nAlarmCode := 0;');
  lines.push('            nAlarmStep := 0;');
  for (const l of cmdResetLines(ctx)) lines.push(l);
  lines.push('        END_IF;');
  lines.push('    END_IF;');
  lines.push('');
  lines.push('    // 急停仍按住时禁止任何模式切换');
  lines.push(`    IF ${ind.estop.trim()} THEN`);
  lines.push(`        nMode := ${MODE.paused};`);
  lines.push('    END_IF;');
  lines.push('');

  // 4) 手动翻转（先处理，命令供本扫描 FB 使用）
  lines.push('    // ---- 4) 手动翻转（仅手动模式） ----');
  lines.push(...manualLines(ctx));
  lines.push('');

  // 5) 气缸命令
  lines.push('    // ---- 5) 气缸命令（按模式；双电控默认保持，单电控默认松开） ----');
  lines.push(`    IF nMode <> ${MODE.manual} THEN`);
  for (const l of cmdResetLines(ctx)) lines.push(`    ${l.trim()}`);
  lines.push('    END_IF;');
  lines.push('');
  lines.push(`    IF nMode = ${MODE.auto} THEN`);
  lines.push('        CASE nStep OF');
  lines.push(...commandCaseLines(ctx, 'auto', '        '));
  lines.push('        END_CASE;');
  lines.push(`    ELSIF nMode = ${MODE.stopping} THEN`);
  lines.push('        CASE nStopStep OF');
  lines.push(...commandCaseLines(ctx, 'stop', '        '));
  lines.push('        END_CASE;');
  lines.push('    END_IF;');
  lines.push('');

  // 6) FB 调用
  lines.push('    // ---- 6) 气缸 FB 调用（输出 + 5s 超时监视） ----');
  ctx.cyls.forEach((_, i) => lines.push(...fbInstanceLines(ctx, i)));
  lines.push('');

  // 7) 报警汇总
  lines.push('    // ---- 7) 报警汇总（任一气缸超时 → 冻结步号、等手动处理） ----');
  lines.push(...alarmAggregateLines(ctx));
  lines.push('');

  // 8) 自动步转移
  lines.push('    // ---- 8) 自动步转移（报警/急停时 nMode 不是自动，流程不跳转） ----');
  lines.push(...autoTransitionLines(ctx));
  lines.push('');

  // 9) 停止序列
  lines.push('    // ---- 9) 停止序列（按顺序回原点，不直接清输出） ----');
  lines.push(...stopSequenceLines(ctx));
  lines.push('');

  // 10) 输出汇总
  lines.push(...outputDriveLines(ctx));
  lines.push('');

  // 11) HMI 状态
  lines.push('    // ---- 11) HMI 状态/数据 ----');
  lines.push(...hmiStatusLines(ctx));
  lines.push('');
  lines.push('END_PROGRAM');
  lines.push('');

  let source = lines.join('\n');
  // 中文标签模式：主程序/ FB 的局部标签也改为中文（类型前缀 + 中文语义）
  if (ctx.zh) source = renameIdentifiers(source, buildZhRenameMap(ctx));

  return { source, warnings };
}
