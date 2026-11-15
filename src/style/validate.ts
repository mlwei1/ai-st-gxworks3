/**
 * style 档案规则级校验：命名合法性、标签冲突、前缀合法性、改名冲突/循环。
 *
 * `style check` 与 `style adopt` 都会调用；有 error 时 adopt 默认拒绝写盘（可用 --force）。
 */

import type { StyleProfile } from './index.ts';

export type StyleSeverity = 'error' | 'warning';

export interface StyleRuleDiagnostic {
  code: string;
  severity: StyleSeverity;
  message: string;
}

const IDENT_RE = /^[A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff]*$/;
const DEVICE_RE = /^(X|Y|M|D|T|C|ST|S|SM|SD|B|W)\d+([.]\d+)?$/i;
const PREFIX_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function validIdent(s: string): boolean {
  return IDENT_RE.test(s.trim());
}

/** 校验档案中的规则冲突。 */
export function validateStyleProfile(profile: StyleProfile): StyleRuleDiagnostic[] {
  const d: StyleRuleDiagnostic[] = [];
  const err = (code: string, message: string) => d.push({ code, severity: 'error', message });
  const warn = (code: string, message: string) => d.push({ code, severity: 'warning', message });

  // ---- labels.names ----
  const names = profile.labels?.names ?? {};
  const usedNames = new Map<string, string>(); // lower(name) → device
  for (const [device, name] of Object.entries(names)) {
    if (!DEVICE_RE.test(device.trim())) err('STYLE_C_DEVICE', `labels.names 的软元件地址非法：${device}`);
    if (!validIdent(name)) err('STYLE_C_LABEL_NAME', `labels.names.${device} 的标签名不是合法标识符：${name}`);
    const key = name.trim().toLowerCase();
    const prev = usedNames.get(key);
    if (prev) {
      err('STYLE_C_LABEL_DUP', `labels.names 标签名重复：${prev} 与 ${device} 都叫「${name}」`);
    } else {
      usedNames.set(key, device);
    }
  }

  // ---- naming.prefixes ----
  const prefixes = profile.naming?.prefixes ?? {};
  const prefixValues = new Map<string, string>();
  for (const [group, prefix] of Object.entries(prefixes)) {
    if (typeof prefix !== 'string' || !PREFIX_RE.test(prefix.trim())) {
      err('STYLE_C_PREFIX', `naming.prefixes.${group} 不是合法前缀（字母/下划线开头）：${String(prefix)}`);
      continue;
    }
    const key = prefix.trim().toLowerCase();
    const prev = prefixValues.get(key);
    if (prev) warn('STYLE_C_PREFIX_DUP', `命名前缀重复：${prev} 与 ${group} 都使用「${prefix}」`);
    else prefixValues.set(key, group);
  }

  // ---- naming.renames ----
  const renames = profile.naming?.renames ?? {};
  const sources = new Set(Object.keys(renames));
  for (const [from, to] of Object.entries(renames)) {
    if (!validIdent(from)) err('STYLE_C_RENAME_FROM', `naming.renames 旧名非法：${from}`);
    if (!validIdent(to)) err('STYLE_C_RENAME_TO', `naming.renames 新名非法：${to}`);
    if (from === to) warn('STYLE_C_RENAME_SELF', `naming.renames 自改名（无效果）：${from}`);
    if (sources.has(to)) {
      warn('STYLE_C_RENAME_CHAIN', `naming.renames 存在链式改名：${from} → ${to}（${to} 又是旧名，生成时不会递归替换）`);
    }
  }
  // 环检测：a→b→a
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (node: string, path: string[]): void => {
    const st = state.get(node);
    if (st === 'done') return;
    if (st === 'visiting') {
      err('STYLE_C_RENAME_CYCLE', `naming.renames 存在循环改名：${[...path, node].join(' → ')}`);
      return;
    }
    state.set(node, 'visiting');
    const next = renames[node];
    if (next !== undefined) visit(next, [...path, node]);
    state.set(node, 'done');
  };
  for (const from of sources) visit(from, []);

  return d;
}

/** 只返回 error 级别。 */
export function styleErrors(diagnostics: StyleRuleDiagnostic[]): StyleRuleDiagnostic[] {
  return diagnostics.filter((x) => x.severity === 'error');
}
