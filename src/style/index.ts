/**
 * 编程习惯档案（Style Profile）。
 *
 * 目的：把用户/AI 对话中反复出现的编程习惯（命名、标签语言、默认超时、
 * 模式划分、报警策略等）沉淀成可版本化的 JSON，生成时作为默认值应用。
 *
 * 优先级：显式 CLI/对话要求 > spec 显式字段 > style 档案 > 内置默认。
 * 因此 merge 只填充 spec 中“未显式设置”的字段，不覆盖项目已明确的选择。
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { LabelLanguage, RequirementSpec } from '../spec/schema.ts';

export interface StylePrefixes {
  /** BOOL 变量前缀（默认 b）。 */
  BOOL?: string;
  /** INT 变量前缀（默认 n）。 */
  INT?: string;
  /** TIME/TON 变量前缀（默认 t）。 */
  TIME?: string;
  /** 输入信号 BOOL 前缀（默认 x）。 */
  INPUT_BOOL?: string;
  /** FB 实例前缀（默认 fb）。 */
  FB_INSTANCE?: string;
}

export interface StyleProfile {
  schemaVersion: 1;
  /** 档案名（如 robot_transfer_industrial）。 */
  name: string;
  /** 人类可读标题。 */
  title?: string;
  /** 作用域：user=个人习惯，company=公司规范，project=项目覆盖。 */
  scope?: 'user' | 'company' | 'project';
  description?: string;
  /** 标签语言与按软元件覆盖的标签名（device → 用户习惯叫法，如 X0 → 开始按钮）。 */
  labels?: { language?: LabelLanguage; names?: Record<string, string> };
  /** 命名习惯。 */
  naming?: {
    prefixes?: StylePrefixes;
    /** 精确标识符改名（before → after），由 diff 候选采纳生成。 */
    renames?: Record<string, string>;
    examples?: string[];
    notes?: string[];
  };
  /** 默认参数。 */
  defaults?: {
    /** 气缸动作超时默认值（ms）。 */
    cylinderTimeoutMs?: number;
  };
  /** 程序结构习惯（自由文本/字段，供 AI 阅读与后续规则化）。 */
  codeStructure?: Record<string, unknown>;
  /** HMI 地址规划习惯。 */
  hmi?: Record<string, unknown>;
  /** 报警码分配习惯。 */
  alarmCodes?: Record<string, unknown>;
  /** 生成后自检清单。 */
  reviewChecklist?: string[];
  /** 其他备注/待规则化条目。 */
  notes?: string[];
}

export interface StyleDiagnostic {
  code: string;
  message: string;
}

export interface StyleLoadResult {
  ok: boolean;
  profile: StyleProfile | null;
  diagnostics: StyleDiagnostic[];
}

const LABEL_LANGUAGES = new Set(['en', 'zh']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 解析并校验 style JSON（不读文件）。 */
export function parseStyle(raw: unknown): StyleLoadResult {
  const diagnostics: StyleDiagnostic[] = [];
  const err = (code: string, message: string) => diagnostics.push({ code, message });

  if (!isPlainObject(raw)) {
    err('STYLE_E_ROOT', 'style 根节点必须是 JSON 对象');
    return { ok: false, profile: null, diagnostics };
  }
  if (raw.schemaVersion !== 1) {
    err('STYLE_E_SCHEMA_VERSION', 'schemaVersion 必须为 1');
  }
  if (typeof raw.name !== 'string' || !raw.name.trim()) {
    err('STYLE_E_NAME', 'name 必须是非空字符串');
  }
  if (raw.labels !== undefined) {
    if (!isPlainObject(raw.labels)) {
      err('STYLE_E_LABELS', 'labels 必须是对象');
    } else {
      if (raw.labels.language !== undefined && !LABEL_LANGUAGES.has(String(raw.labels.language))) {
        err('STYLE_E_LABELS_LANGUAGE', "labels.language 只能是 'en' 或 'zh'");
      }
      if (raw.labels.names !== undefined) {
        if (!isPlainObject(raw.labels.names)) err('STYLE_E_LABELS_NAMES', 'labels.names 必须是 { 软元件: 标签名 } 对象');
        else {
          for (const [k, v] of Object.entries(raw.labels.names)) {
            if (typeof v !== 'string' || !v.trim()) err('STYLE_E_LABELS_NAMES_VALUE', `labels.names.${k} 必须是非空字符串`);
          }
        }
      }
    }
  }
  if (raw.naming !== undefined) {
    if (!isPlainObject(raw.naming)) err('STYLE_E_NAMING', 'naming 必须是对象');
    else if (raw.naming.renames !== undefined) {
      if (!isPlainObject(raw.naming.renames)) err('STYLE_E_RENAMES', 'naming.renames 必须是 { 旧名: 新名 } 对象');
      else {
        for (const [k, v] of Object.entries(raw.naming.renames)) {
          if (typeof v !== 'string' || !v.trim()) err('STYLE_E_RENAMES_VALUE', `naming.renames.${k} 必须是非空字符串`);
        }
      }
    }
  }
  if (raw.defaults !== undefined && !isPlainObject(raw.defaults)) {
    err('STYLE_E_DEFAULTS', 'defaults 必须是对象');
  }
  if (diagnostics.length > 0) {
    return { ok: false, profile: null, diagnostics };
  }
  return { ok: true, profile: raw as unknown as StyleProfile, diagnostics };
}

/** 读取 style 文件。 */
export async function loadStyleFile(path: string): Promise<StyleLoadResult> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (e) {
    return {
      ok: false,
      profile: null,
      diagnostics: [
        { code: 'STYLE_E_READ', message: `读取 style 文件失败：${e instanceof Error ? e.message : String(e)}` },
      ],
    };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      profile: null,
      diagnostics: [
        { code: 'STYLE_E_JSON', message: `style 不是合法 JSON：${e instanceof Error ? e.message : String(e)}` },
      ],
    };
  }
  return parseStyle(raw);
}

/**
 * 深合并两个 style 档案（后者覆盖前者）。
 *
 * - 对象：递归合并；
 * - 数组：拼接并去重（保留顺序）；
 * - 标量：后者覆盖。
 */
function mergeProfileValue(base: unknown, over: unknown): unknown {
  if (Array.isArray(base) && Array.isArray(over)) {
    const out: unknown[] = [];
    const seen = new Set<string>();
    for (const v of [...base, ...over]) {
      const key = JSON.stringify(v);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(v);
    }
    return out;
  }
  if (isPlainObject(base) && isPlainObject(over)) {
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(over)) {
      out[k] = k in out ? mergeProfileValue(out[k], v) : v;
    }
    return out;
  }
  return over;
}

/**
 * 合并多级档案：按数组顺序，后面的覆盖前面的。
 *
 * 典型顺序：个人(user) → 公司(company) → 项目(project)。
 */
export function mergeStyleProfiles(profiles: StyleProfile[]): StyleProfile {
  if (profiles.length === 0) throw new Error('mergeStyleProfiles 至少需要 1 个档案');
  let merged: StyleProfile = {
    schemaVersion: 1,
    name: profiles[0].name,
  };
  for (const p of profiles) {
    merged = mergeProfileValue(merged, p) as StyleProfile;
  }
  if (profiles.length > 1 && !profiles[profiles.length - 1].name.includes('+')) {
    merged.name = profiles.map((p) => p.name).join('+');
  }
  merged.schemaVersion = 1;
  return merged;
}

/** 读取并合并多个 style 文件（后文件优先）。 */
export async function resolveStyleFiles(paths: string[]): Promise<{
  ok: boolean;
  profile: StyleProfile | null;
  sources: string[];
  diagnostics: StyleDiagnostic[];
}> {
  const diagnostics: StyleDiagnostic[] = [];
  const profiles: StyleProfile[] = [];
  for (const path of paths) {
    const r = await loadStyleFile(path);
    if (!r.ok || !r.profile) {
      diagnostics.push(...r.diagnostics);
      continue;
    }
    profiles.push(r.profile);
  }
  if (diagnostics.length > 0 || profiles.length === 0) {
    return { ok: false, profile: null, sources: paths, diagnostics };
  }
  return { ok: true, profile: mergeStyleProfiles(profiles), sources: paths, diagnostics };
}

/** 读取目录下全部 *.json 档案，按 scope（user < company < project）排序后合并。 */
export async function resolveStyleDirectory(dir: string): Promise<{
  ok: boolean;
  profile: StyleProfile | null;
  sources: string[];
  diagnostics: StyleDiagnostic[];
}> {
  const diagnostics: StyleDiagnostic[] = [];
  let files: string[];
  try {
    const collect = async (p: string): Promise<string[]> => {
      const out: string[] = [];
      const entries = await readdir(p, { withFileTypes: true });
      for (const e of entries) {
        const fp = join(p, e.name);
        if (e.isDirectory()) out.push(...(await collect(fp)));
        else if (e.isFile() && e.name.toLowerCase().endsWith('.json')) out.push(fp);
      }
      return out;
    };
    files = await collect(dir);
  } catch (e) {
    return {
      ok: false,
      profile: null,
      sources: [],
      diagnostics: [
        { code: 'STYLE_E_DIR', message: `读取档案目录失败：${e instanceof Error ? e.message : String(e)}` },
      ],
    };
  }
  const rank = (scope: StyleProfile['scope']): number =>
    scope === 'user' ? 1 : scope === 'company' ? 2 : scope === 'project' ? 3 : 2;
  const loaded: Array<{ profile: StyleProfile; file: string }> = [];
  for (const file of files.sort()) {
    const r = await loadStyleFile(file);
    if (!r.ok || !r.profile) {
      diagnostics.push(...r.diagnostics);
      continue;
    }
    loaded.push({ profile: r.profile, file });
  }
  if (diagnostics.length > 0 || loaded.length === 0) {
    if (loaded.length === 0 && diagnostics.length === 0) {
      diagnostics.push({ code: 'STYLE_E_DIR_EMPTY', message: `目录中没有可用的 *.json 档案：${dir}` });
    }
    return { ok: false, profile: null, sources: files, diagnostics };
  }
  loaded.sort((a, b) => rank(a.profile.scope) - rank(b.profile.scope) || a.file.localeCompare(b.file));
  return {
    ok: true,
    profile: mergeStyleProfiles(loaded.map((x) => x.profile)),
    sources: loaded.map((x) => x.file),
    diagnostics,
  };
}

/**
 * 把 style 档案合并进 spec（只填充未显式设置的字段）。
 *
 * 当前自动应用：
 * - labels.language（spec 未设置时）；
 * - industrial.cylinders[].timeoutMs（spec 未设置且档案给了默认值）。
 * 其他字段（命名前缀、模式、报警策略、HMI 规划等）由生成器/AI 读取档案后逐步规则化。
 */
export function mergeStyleIntoSpec(
  spec: RequirementSpec,
  profile: StyleProfile,
): { applied: string[] } {
  const applied: string[] = [];

  if (!spec.labels?.language && profile.labels?.language) {
    spec.labels = { ...(spec.labels ?? {}), language: profile.labels.language };
    applied.push(`标签语言=${profile.labels.language}`);
  }

  const timeout = profile.defaults?.cylinderTimeoutMs;
  const cylinders = spec.sequence?.industrial?.cylinders;
  if (typeof timeout === 'number' && Number.isFinite(timeout) && timeout >= 100 && cylinders) {
    let n = 0;
    for (const c of cylinders) {
      if (c.timeoutMs === undefined) {
        c.timeoutMs = Math.trunc(timeout);
        n++;
      }
    }
    if (n > 0) applied.push(`${n} 个气缸超时默认=${Math.trunc(timeout)}ms`);
  }

  // 报警码：spec 未设置时按档案 alarmCodes.mapping（缸名 → 方向码）补齐
  const mapping = profile.alarmCodes?.mapping;
  if (mapping && typeof mapping === 'object' && cylinders) {
    const num = (v: unknown): number | undefined =>
      typeof v === 'number' && Number.isFinite(v) ? v : undefined;
    let n = 0;
    for (const c of cylinders) {
      const m = (mapping as Record<string, unknown>)[c.name];
      if (!m || typeof m !== 'object') continue;
      const row = m as Record<string, unknown>;
      const single = c.valve === 'single';
      const ext = num(row.extend) ?? num(row.clamp);
      const ret = num(row.retract) ?? num(row.release);
      if (!c.alarmExtend && ext !== undefined) {
        c.alarmExtend = { code: ext, message: `${c.name}${single ? '夹紧' : '伸出'}超时` };
        n++;
      }
      if (!c.alarmRetract && ret !== undefined) {
        c.alarmRetract = { code: ret, message: `${c.name}${single ? '松开' : '缩回'}超时` };
        n++;
      }
    }
    if (n > 0) applied.push(`${n} 条报警码按档案补齐`);
  }

  return { applied };
}

/** 新建档案时的空白模板（`style init` 使用）。 */
export function createStyleTemplate(
  name: string,
  scope: StyleProfile['scope'] = 'user',
  title?: string,
): StyleProfile {
  return {
    schemaVersion: 1,
    name,
    title: title ?? `${name} 的编程习惯`,
    scope,
    description: '由 style init 生成；请按实际习惯修改，问题清单见 profiles/questions.md。',
    labels: { language: 'zh' },
    naming: {
      prefixes: { BOOL: 'b', INT: 'n', TIME: 't', INPUT_BOOL: 'x', FB_INSTANCE: 'fb' },
      examples: ['n模式', 'b启动上升沿', 't超时', 'x伸出到位', 'fb竖直缸'],
    },
    defaults: { cylinderTimeoutMs: 5000 },
    codeStructure: {
      modes: ['待机', '自动', '手动', '停止中', '报警', '急停暂停'],
    },
    reviewChecklist: [
      '模式互斥与报警冻结是否符合习惯',
      '停止序列是否安全（夹紧保持到松开步）',
      '标签语言/命名前缀是否一致',
      '生成物 XML 导入 GX 全部转换 Error:0',
    ],
    notes: ['模板：请补充 HMI 地址规划、报警码分配、停止序列等习惯。'],
  };
}
