/**
 * HMI 地址表 / 报警表导出。
 *
 * 数据来源：
 * - HMI 命令/状态/数据、手动按钮：spec.sequence.industrial.hmi / manualButtons；
 * - 报警码：spec.cylinders[].alarmExtend/alarmRetract，缺省时按 style.alarmCodes.mapping 按缸名补齐；
 * - 标签名：复用 buildGlobalLabelPlan，保证与 ST/XML 中的全局标签一致。
 */

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { RequirementSpec } from '../spec/schema.ts';
import type { StyleProfile } from '../style/index.ts';
import { buildGlobalLabelPlan } from './label-map.ts';

export interface HmiRow {
  address: string;
  name: string;
  type: string;
  category: string;
  description: string;
}

export interface AlarmRow {
  code: number;
  name: string;
  trigger: string;
  handling: string;
}

export interface HmiCsvExport {
  hmiPath: string;
  alarmPath: string;
  hmiRows: HmiRow[];
  alarmRows: AlarmRow[];
}

const DEFAULT_STATUS = {
  idle: 'M100',
  auto: 'M101',
  manual: 'M102',
  stopping: 'M103',
  alarm: 'M104',
  paused: 'M105',
};

const DEFAULT_DATA = {
  step: 'D0',
  mode: 'D1',
  alarmCode: 'D2',
  alarmStep: 'D3',
};

/** 生成 HMI 地址行（与 ST 标签同源）。 */
export function buildHmiRows(spec: RequirementSpec, style?: StyleProfile): HmiRow[] {
  const ind = spec.sequence?.industrial;
  if (!ind) return [];
  const plan = buildGlobalLabelPlan(spec, spec.labels?.language, style);
  const labelOf = (addr: string | undefined, fallback: string): string => {
    if (!addr) return fallback;
    return plan.deviceToLabel.get(addr) ?? addr;
  };
  const rows: HmiRow[] = [];
  const seen = new Set<string>();
  const add = (address: string | undefined, name: string, type: string, category: string, description: string) => {
    if (!address || seen.has(address)) return;
    seen.add(address);
    rows.push({ address, name, type, category, description });
  };

  const h = ind.hmi;
  add(h.start, labelOf(h.start, 'hmi_start'), 'BOOL', '命令', '启动（上升沿）');
  add(h.stop, labelOf(h.stop, 'hmi_stop'), 'BOOL', '命令', '停止（完成后走停止序列）');
  add(h.reset, labelOf(h.reset, 'hmi_reset'), 'BOOL', '命令', '复位/清除报警');
  add(h.manual, labelOf(h.manual, 'hmi_manual'), 'BOOL', '命令', '进入手动模式');
  add(h.exitManual, labelOf(h.exitManual, 'hmi_exit_manual'), 'BOOL', '命令', '退出手动/回待机');
  add(h.continueRun, labelOf(h.continueRun, 'hmi_continue'), 'BOOL', '命令', '继续（从冻结步）');
  add(h.restart, labelOf(h.restart, 'hmi_restart'), 'BOOL', '命令', '从头开始');

  const status = { ...DEFAULT_STATUS, ...(h.status ?? {}) };
  add(status.idle, labelOf(status.idle, 'hmi_idle'), 'BOOL', '状态', '待机');
  add(status.auto, labelOf(status.auto, 'hmi_auto'), 'BOOL', '状态', '自动运行');
  add(status.manual, labelOf(status.manual, 'hmi_manualing'), 'BOOL', '状态', '手动模式');
  add(status.stopping, labelOf(status.stopping, 'hmi_stopping'), 'BOOL', '状态', '停止中');
  add(status.alarm, labelOf(status.alarm, 'hmi_alarm'), 'BOOL', '状态', '报警');
  add(status.paused, labelOf(status.paused, 'hmi_paused'), 'BOOL', '状态', '急停暂停');

  const data = { ...DEFAULT_DATA, ...(h.data ?? {}) };
  add(data.step, labelOf(data.step, 'hmi_step'), 'INT', '数据', '当前步号');
  add(data.mode, labelOf(data.mode, 'hmi_mode'), 'INT', '数据', '当前模式');
  add(data.alarmCode, labelOf(data.alarmCode, 'hmi_alarm_code'), 'INT', '数据', '报警代码');
  add(data.alarmStep, labelOf(data.alarmStep, 'hmi_alarm_step'), 'INT', '数据', '报警冻结步号');

  for (const b of ind.manualButtons) {
    add(b.button, labelOf(b.button, b.button), 'BOOL', '手动', `手动翻转 ${b.cylinder}`);
  }
  if (ind.alarmOutput) {
    add(ind.alarmOutput, labelOf(ind.alarmOutput, ind.alarmOutput), 'BOOL', '报警', '报警汇总');
  }
  return rows;
}

function styleAlarmMapping(style?: StyleProfile): Record<string, Record<string, number>> {
  const mapping = style?.alarmCodes?.mapping;
  if (!mapping || typeof mapping !== 'object') return {};
  const out: Record<string, Record<string, number>> = {};
  for (const [cyl, v] of Object.entries(mapping as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const row: Record<string, number> = {};
    for (const [dir, code] of Object.entries(v as Record<string, unknown>)) {
      if (typeof code === 'number' && Number.isFinite(code)) row[dir] = code;
    }
    out[cyl] = row;
  }
  return out;
}

/** 生成报警表行（超时报警）。 */
export function buildAlarmRows(spec: RequirementSpec, style?: StyleProfile): AlarmRow[] {
  const ind = spec.sequence?.industrial;
  if (!ind) return [];
  const mapping = styleAlarmMapping(style);
  const rows: AlarmRow[] = [];
  const timeoutText = (ms?: number) => (ms ? `${ms / 1000}s` : '5s');

  for (const c of ind.cylinders) {
    const single = c.valve === 'single';
    const m = mapping[c.name] ?? {};
    const ext = c.alarmExtend?.code ?? m.extend ?? m.clamp;
    const ret = c.alarmRetract?.code ?? m.retract ?? m.release;
    const common = `检查气路/电磁阀与磁性开关（${c.extendedX}/${c.retractedX}）`;
    if (ext !== undefined) {
      rows.push({
        code: ext,
        name: `${c.name}${single ? '夹紧' : '伸出'}超时`,
        trigger: `${c.extendY} 输出 ${timeoutText(c.timeoutMs)} 后 ${c.extendedX} 未到位`,
        handling: `${common}；手动恢复后清除报警再继续`,
      });
    }
    if (ret !== undefined) {
      rows.push({
        code: ret,
        name: `${c.name}${single ? '松开' : '缩回'}超时`,
        trigger: `${(single ? '输出复位' : c.retractY ?? '(缩回输出)')} ${timeoutText(c.timeoutMs)} 后 ${c.retractedX} 未到位`,
        handling: `${common}；手动恢复后清除报警再继续`,
      });
    }
  }
  return rows.sort((a, b) => a.code - b.code);
}

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers: string[], rows: Array<Array<string | number>>): string {
  const lines = [headers.join(','), ...rows.map((r) => r.map(csvEscape).join(','))];
  // UTF-8 BOM + CRLF，Excel 直接打开不乱码
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

export function renderHmiCsv(rows: HmiRow[]): string {
  return toCsv(
    ['地址', '标签名', '类型', '分类', '用途'],
    rows.map((r) => [r.address, r.name, r.type, r.category, r.description]),
  );
}

export function renderAlarmCsv(rows: AlarmRow[]): string {
  return toCsv(
    ['报警代码', '报警名称', '触发条件', '处理建议'],
    rows.map((r) => [r.code, r.name, r.trigger, r.handling]),
  );
}

/** 导出 hmi_map.csv / alarm_map.csv 到输出目录。 */
export async function exportHmiCsvFiles(
  spec: RequirementSpec,
  style: StyleProfile | undefined,
  outDir: string,
): Promise<HmiCsvExport | null> {
  if (!spec.sequence?.industrial) return null;
  const hmiRows = buildHmiRows(spec, style);
  const alarmRows = buildAlarmRows(spec, style);
  const hmiPath = resolve(outDir, 'hmi_map.csv');
  const alarmPath = resolve(outDir, 'alarm_map.csv');
  await writeFile(hmiPath, renderHmiCsv(hmiRows), 'utf8');
  await writeFile(alarmPath, renderAlarmCsv(alarmRows), 'utf8');
  return { hmiPath, alarmPath, hmiRows, alarmRows };
}
