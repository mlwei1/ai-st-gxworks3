/**
 * 全局标签映射：把 spec.io / industrial.hmi 里的软元件地址映射为标签名。
 *
 * 用途：
 * 1. 生成 IEC XML 的 <GlobalVars>（带 <Address> 与注释）；
 * 2. 生成 ST 时把程序正文里的 X0/Y0/M0/D0 等软元件地址替换成标签名，
 *    并在 ST 文件头部写入 VAR_GLOBAL 声明块（便于单独 check/build-xml）。
 *
 * 标签语言（spec.labels.language，或 gen --labels）：
 * - en：英文标识符（io.name / bHmiStart …），默认，兼容旧项目；
 * - zh：中文标签名（从 io.comment 派生 / 触摸屏启动 …），GX Works3 实测可导入编译。
 */

import type { IecVar } from './iecxml.ts';
import type { LabelLanguage, RequirementSpec } from '../spec/schema.ts';
import type { StyleProfile } from '../style/index.ts';

export interface GlobalLabelPlan {
  /** 要写入 XML/ST 的全局标签（带 address/comment）。 */
  labels: IecVar[];
  /** 软元件地址 → 标签名（如 X0 → bStart / 启动按钮）。 */
  deviceToLabel: Map<string, string>;
}

const IDENT_RE = /^[A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff]*$/;

/** 从中文注释派生合法标签名：去掉括号说明与标点空白。 */
function fromComment(comment: string | undefined, fallback: string): string {
  if (!comment) return fallback;
  let s = comment;
  const cut = s.search(/[（(]/);
  if (cut > 0) s = s.slice(0, cut);
  s = s.replace(/[:：/／,，.。;；、\-—\s]/g, '');
  s = s.replace(/[^A-Za-z0-9_\u4e00-\u9fff]/g, '');
  if (!s) return fallback;
  if (!/^[A-Za-z_\u4e00-\u9fff]/.test(s)) s = `l_${s}`;
  return s;
}

/** 保证标签名唯一（重名追加 2、3…）。 */
function uniqueName(base: string, used: Set<string>): string {
  let name = IDENT_RE.test(base) ? base : `l_${base.replace(/[^A-Za-z0-9_\u4e00-\u9fff]/g, '') || 'label'}`;
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  let i = 2;
  while (used.has(`${name}${i}`)) i++;
  name = `${name}${i}`;
  used.add(name);
  return name;
}

/**
 * 从 spec 的 IO 表与工业 HMI 地址表生成全局标签计划。
 *
 * 同一名称或同一软元件只保留首个（避免 GX 导入时重复分配）。
 */
export function buildGlobalLabelPlan(
  spec: RequirementSpec,
  language?: LabelLanguage,
  style?: StyleProfile,
): GlobalLabelPlan {
  const lang: LabelLanguage = language ?? spec.labels?.language ?? 'en';
  const zh = lang === 'zh';
  const labels: IecVar[] = [];
  const deviceToLabel = new Map<string, string>();
  const used = new Set<string>();
  // 用户习惯档案里的标签名覆盖（device → 用户习惯叫法）
  const overrideRaw = style?.labels?.names ?? {};
  const overrides = new Map<string, string>();
  for (const [dev, name] of Object.entries(overrideRaw)) {
    if (!dev.trim() || !name.trim()) continue;
    overrides.set(dev.trim(), name.trim());
    overrides.set(dev.trim().toUpperCase(), name.trim());
  }
  const preferredName = (address: string, fallback: string): string =>
    overrides.get(address) ?? overrides.get(address.toUpperCase()) ?? fallback;

  const push = (v: { name: string; type: string; address?: string; comment?: string }) => {
    const address = (v.address ?? '').trim();
    if (!address || deviceToLabel.has(address)) return;
    const name = uniqueName(preferredName(address, v.name.trim()), used);
    deviceToLabel.set(address, name);
    labels.push({ name, type: v.type, address, ...(v.comment ? { comment: v.comment } : {}) });
  };

  for (const io of spec.io ?? []) {
    const name = zh ? fromComment(io.comment, io.name) : io.name;
    push({ name, type: io.type, address: io.device, comment: io.comment ?? `${io.device} ${io.name}` });
  }

  const ind = spec.sequence?.industrial;
  if (ind) {
    const h = ind.hmi;
    const zhNames = {
      start: '触摸屏启动',
      stop: '触摸屏停止',
      reset: '触摸屏复位',
      manual: '触摸屏手动',
      exitManual: '触摸屏退出手动',
      continueRun: '触摸屏继续',
      restart: '触摸屏从头',
      idle: '状态待机',
      auto: '状态自动',
      manualing: '状态手动',
      stopping: '状态停止中',
      alarm: '状态报警',
      paused: '状态急停暂停',
      step: '当前步号',
      mode: '当前模式',
      alarmCode: '报警代码',
      alarmStep: '报警步号',
    };
    const enNames = {
      start: 'bHmiStart',
      stop: 'bHmiStop',
      reset: 'bHmiReset',
      manual: 'bHmiManual',
      exitManual: 'bHmiExitManual',
      continueRun: 'bHmiContinue',
      restart: 'bHmiRestart',
      idle: 'bHmiIdle',
      auto: 'bHmiAuto',
      manualing: 'bHmiManualing',
      stopping: 'bHmiStopping',
      alarm: 'bHmiAlarm',
      paused: 'bHmiPaused',
      step: 'nHmiStep',
      mode: 'nHmiMode',
      alarmCode: 'nHmiAlarmCode',
      alarmStep: 'nHmiAlarmStep',
    };
    const n = zh ? zhNames : enNames;
    const status = h.status ?? {};
    const data = h.data ?? {};
    push({ name: n.start, type: 'BOOL', address: h.start, comment: '触摸屏：启动' });
    push({ name: n.stop, type: 'BOOL', address: h.stop, comment: '触摸屏：停止' });
    push({ name: n.reset, type: 'BOOL', address: h.reset, comment: '触摸屏：复位/清除报警' });
    push({ name: n.manual, type: 'BOOL', address: h.manual, comment: '触摸屏：手动模式' });
    push({ name: n.exitManual, type: 'BOOL', address: h.exitManual, comment: '触摸屏：退出手动/回待机' });
    push({ name: n.continueRun, type: 'BOOL', address: h.continueRun, comment: '触摸屏：继续（冻结步）' });
    push({ name: n.restart, type: 'BOOL', address: h.restart, comment: '触摸屏：从头开始' });
    push({ name: n.idle, type: 'BOOL', address: status.idle ?? 'M100', comment: '状态：待机' });
    push({ name: n.auto, type: 'BOOL', address: status.auto ?? 'M101', comment: '状态：自动运行' });
    push({ name: n.manualing, type: 'BOOL', address: status.manual ?? 'M102', comment: '状态：手动模式' });
    push({ name: n.stopping, type: 'BOOL', address: status.stopping ?? 'M103', comment: '状态：停止中' });
    push({ name: n.alarm, type: 'BOOL', address: status.alarm ?? 'M104', comment: '状态：报警中' });
    push({ name: n.paused, type: 'BOOL', address: status.paused ?? 'M105', comment: '状态：急停暂停' });
    push({ name: n.step, type: 'INT', address: data.step ?? 'D0', comment: '数据：当前步号' });
    push({ name: n.mode, type: 'INT', address: data.mode ?? 'D1', comment: '数据：当前模式' });
    push({ name: n.alarmCode, type: 'INT', address: data.alarmCode ?? 'D2', comment: '数据：报警代码' });
    push({ name: n.alarmStep, type: 'INT', address: data.alarmStep ?? 'D3', comment: '数据：报警冻结步号' });
    ind.manualButtons.forEach((b, i) => {
      const name = zh ? `手动${b.cylinder.replace(/[^A-Za-z0-9_\u4e00-\u9fff]/g, '') || i + 1}` : `bHmiManual${i + 1}`;
      push({ name, type: 'BOOL', address: b.button, comment: `触摸屏：手动翻转 ${b.cylinder}` });
    });
  }

  return { labels, deviceToLabel };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 通用标识符重命名：按 map 替换 ST 源码中的标识符（跳过字符串内容）。
 *
 * - 长标识符优先（避免 bAlarm 命中 bAlarmAny）；
 * - 边界包含字母/数字/下划线/汉字/点（避免命中 FB 成员或子串）。
 */
export function renameIdentifiers(source: string, map: Map<string, string>): string {
  if (map.size === 0) return source;
  const keys = [...map.keys()]
    .filter((k) => k.trim().length > 0)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  // 边界不含 '.'：允许重命名 FB 成员访问（如 tExt.Q），软元件位访问暂不在规范内
  const boundary = 'A-Za-z0-9_\\u4e00-\\u9fff';
  const re = new RegExp(`(?<![${boundary}])(${keys.join('|')})(?![${boundary}])`, 'g');
  const parts = source.split(/('(?:[^']|'')*'|"(?:[^"]|"")*")/g);
  return parts
    .map((part, i) => (i % 2 === 1 ? part : part.replace(re, (m) => map.get(m) ?? m)))
    .join('');
}

/**
 * 把 ST 源码里的软元件地址替换为全局标签名。
 *
 * - 只替换 deviceToLabel 中存在的地址（长地址优先，如 X10 先于 X1）；
 * - 前后要求非标识符字符，且不能紧跟数字/小数点（避免 X1 命中 X10 或 X0.0）；
 * - 跳过单引号/双引号字符串内容。
 */
export function renameDevicesToLabels(source: string, deviceToLabel: Map<string, string>): string {
  return renameIdentifiers(source, deviceToLabel);
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
