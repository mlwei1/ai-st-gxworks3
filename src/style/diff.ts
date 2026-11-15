/**
 * 两个 style 档案的差异比较（多级档案审阅 / 采纳前后对比）。
 */

import type { StyleProfile } from './index.ts';

export interface StyleDiffEntry {
  path: string;
  kind: 'added' | 'removed' | 'changed';
  before?: unknown;
  after?: unknown;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function flatten(value: unknown, prefix = '', out = new Map<string, unknown>()): Map<string, unknown> {
  if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
  } else if (prefix) {
    out.set(prefix, value);
  }
  return out;
}

/** 比较两个档案：返回新增/删除/变更的叶子字段。 */
export function diffStyleProfiles(a: StyleProfile, b: StyleProfile): StyleDiffEntry[] {
  const fa = flatten(a);
  const fb = flatten(b);
  const paths = new Set([...fa.keys(), ...fb.keys()]);
  const out: StyleDiffEntry[] = [];
  for (const path of [...paths].sort()) {
    const inA = fa.has(path);
    const inB = fb.has(path);
    if (!inA && inB) out.push({ path, kind: 'added', after: fb.get(path) });
    else if (inA && !inB) out.push({ path, kind: 'removed', before: fa.get(path) });
    else if (JSON.stringify(fa.get(path)) !== JSON.stringify(fb.get(path))) {
      out.push({ path, kind: 'changed', before: fa.get(path), after: fb.get(path) });
    }
  }
  return out;
}

function fmt(v: unknown): string {
  if (v === undefined) return '—';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

/** 渲染 Markdown 差异表。 */
export function renderStyleDiff(entries: StyleDiffEntry[], nameA: string, nameB: string): string {
  if (entries.length === 0) return `两个档案无差异：${nameA} ↔ ${nameB}\n`;
  const lines: string[] = [];
  lines.push(`# 习惯档案差异：${nameA} → ${nameB}`);
  lines.push('');
  lines.push('| 字段 | 变化 | 旧值 | 新值 |');
  lines.push('|---|---|---|---|');
  for (const e of entries) {
    const icon = e.kind === 'added' ? '新增' : e.kind === 'removed' ? '删除' : '修改';
    lines.push(`| ${e.path} | ${icon} | ${fmt(e.before)} | ${fmt(e.after)} |`);
  }
  lines.push('');
  return lines.join('\n');
}
