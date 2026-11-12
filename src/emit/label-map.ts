/**
 * 全局标签映射：把 spec.io / industrial.hmi 里的软元件地址映射为标签名。
 *
 * 用途：
 * 1. 生成 IEC XML 的 <GlobalVars>（带 <Address> 与注释）；
 * 2. 生成 ST 时把程序正文里的 X0/Y0/M0/D0 等软元件地址替换成标签名，
 *    并在 ST 文件头部写入 VAR_GLOBAL 声明块（便于单独 check/build-xml）。
 */

import type { IecVar } from './iecxml.ts';
import type { RequirementSpec } from '../spec/schema.ts';

export interface GlobalLabelPlan {
  /** 要写入 XML/ST 的全局标签（带 address/comment）。 */
  labels: IecVar[];
  /** 软元件地址 → 标签名（如 X0 → bStart）。 */
  deviceToLabel: Map<string, string>;
}

/**
 * 从 spec 的 IO 表与工业 HMI 地址表生成全局标签计划。
 *
 * 同一名称或同一软元件只保留首个（避免 GX 导入时重复分配）。
 */
export function buildGlobalLabelPlan(spec: RequirementSpec): GlobalLabelPlan {
  const labels: IecVar[] = [];
  const deviceToLabel = new Map<string, string>();
  const names = new Set<string>();

  const push = (v: IecVar) => {
    const name = v.name.trim();
    const address = (v.address ?? '').trim();
    if (!name || names.has(name)) return;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return;
    if (address && deviceToLabel.has(address)) return;
    names.add(name);
    if (address) deviceToLabel.set(address, name);
    labels.push({ ...v, name, ...(address ? { address } : {}) });
  };

  for (const io of spec.io ?? []) {
    push({
      name: io.name,
      type: io.type,
      address: io.device,
      comment: io.comment ?? `${io.device} ${io.name}`,
    });
  }

  const ind = spec.sequence?.industrial;
  if (ind) {
    const h = ind.hmi;
    push({ name: 'bHmiStart', type: 'BOOL', address: h.start, comment: '触摸屏：启动' });
    push({ name: 'bHmiStop', type: 'BOOL', address: h.stop, comment: '触摸屏：停止' });
    push({ name: 'bHmiReset', type: 'BOOL', address: h.reset, comment: '触摸屏：复位/清除报警' });
    push({ name: 'bHmiManual', type: 'BOOL', address: h.manual, comment: '触摸屏：手动模式' });
    push({ name: 'bHmiExitManual', type: 'BOOL', address: h.exitManual, comment: '触摸屏：退出手动/回待机' });
    push({ name: 'bHmiContinue', type: 'BOOL', address: h.continueRun, comment: '触摸屏：继续（冻结步）' });
    push({ name: 'bHmiRestart', type: 'BOOL', address: h.restart, comment: '触摸屏：从头开始' });
    const st = h.status ?? {};
    push({ name: 'bHmiIdle', type: 'BOOL', address: st.idle ?? 'M100', comment: '状态：待机' });
    push({ name: 'bHmiAuto', type: 'BOOL', address: st.auto ?? 'M101', comment: '状态：自动运行' });
    push({ name: 'bHmiManualing', type: 'BOOL', address: st.manual ?? 'M102', comment: '状态：手动模式' });
    push({ name: 'bHmiStopping', type: 'BOOL', address: st.stopping ?? 'M103', comment: '状态：停止中' });
    push({ name: 'bHmiAlarm', type: 'BOOL', address: st.alarm ?? 'M104', comment: '状态：报警中' });
    push({ name: 'bHmiPaused', type: 'BOOL', address: st.paused ?? 'M105', comment: '状态：急停暂停' });
    const d = h.data ?? {};
    push({ name: 'nHmiStep', type: 'INT', address: d.step ?? 'D0', comment: '数据：当前步号' });
    push({ name: 'nHmiMode', type: 'INT', address: d.mode ?? 'D1', comment: '数据：当前模式' });
    push({ name: 'nHmiAlarmCode', type: 'INT', address: d.alarmCode ?? 'D2', comment: '数据：报警代码' });
    push({ name: 'nHmiAlarmStep', type: 'INT', address: d.alarmStep ?? 'D3', comment: '数据：报警冻结步号' });
    ind.manualButtons.forEach((b, i) => {
      push({
        name: `bHmiManual${i + 1}`,
        type: 'BOOL',
        address: b.button,
        comment: `触摸屏：手动翻转 ${b.cylinder}`,
      });
    });
  }

  return { labels, deviceToLabel };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 把 ST 源码里的软元件地址替换为全局标签名。
 *
 * - 只替换 deviceToLabel 中存在的地址（长地址优先，如 X10 先于 X1）；
 * - 前后要求非标识符字符，且不能紧跟数字/小数点（避免 X1 命中 X10 或 X0.0）；
 * - 跳过单引号/双引号字符串内容。
 */
export function renameDevicesToLabels(source: string, deviceToLabel: Map<string, string>): string {
  if (deviceToLabel.size === 0) return source;
  const keys = [...deviceToLabel.keys()]
    .filter((k) => k.trim().length > 0)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  const re = new RegExp(`(?<![A-Za-z0-9_.])(${keys.join('|')})(?![0-9A-Za-z_.])`, 'g');

  const parts = source.split(/('(?:[^']|'')*'|"(?:[^"]|"")*")/g);
  return parts
    .map((part, i) => (i % 2 === 1 ? part : part.replace(re, (m) => deviceToLabel.get(m) ?? m)))
    .join('');
}

/**
 * 在 ST 源码前插入 VAR_GLOBAL 声明块（标签 : 类型 AT 软元件; '注释'）。
 *
 * 该块让 ST 文件可以独立被 check / build-xml 解析；导入 GX Works3 时
 * 使用的是 XML 里的 <GlobalVars>，程序正文不包含该块。
 */
export function prependGlobalVarBlock(source: string, labels: IecVar[]): string {
  const usable = labels.filter((l) => l.address && l.name && l.type);
  if (usable.length === 0) return source;
  const lines: string[] = [];
  lines.push('// ============================================================');
  lines.push('// 全局标签（IEC XML <GlobalVars>；此块供本工具 check/build-xml 使用，');
  lines.push('// 导入 GX Works3 用 XML，程序正文引用下列标签名）');
  lines.push('// ============================================================');
  lines.push('VAR_GLOBAL');
  for (const l of usable) {
    const cmt = l.comment ? ` '${String(l.comment).replace(/'/g, "''")}'` : '';
    lines.push(`    ${l.name} : ${l.type} AT ${l.address};${cmt}`);
  }
  lines.push('END_VAR');
  lines.push('');
  return lines.join('\n') + source;
}
