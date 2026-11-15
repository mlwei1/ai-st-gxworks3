/**
 * style 档案 schemaVersion 迁移。
 *
 * 当前支持 schemaVersion=1；历史上没有版本号（或 0）的档案可迁移到 1。
 */

import { parseStyle, type StyleLoadResult } from './index.ts';

export interface MigrateResult {
  ok: boolean;
  /** 迁移后的档案（parseStyle 校验通过时存在）。 */
  profile: StyleLoadResult['profile'];
  changed: boolean;
  diagnostics: Array<{ code: string; message: string }>;
}

export function migrateStyleRaw(raw: unknown): MigrateResult {
  const diagnostics: Array<{ code: string; message: string }> = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {
      ok: false,
      profile: null,
      changed: false,
      diagnostics: [{ code: 'STYLE_E_ROOT', message: 'style 根节点必须是 JSON 对象' }],
    };
  }
  const obj = { ...(raw as Record<string, unknown>) };
  const version = obj.schemaVersion;
  let changed = false;

  if (version === undefined || version === null || version === 0) {
    obj.schemaVersion = 1;
    changed = true;
    diagnostics.push({
      code: 'STYLE_M_VERSION',
      message: '档案缺少 schemaVersion（或为 0），已迁移为 1',
    });
  } else if (version !== 1) {
    return {
      ok: false,
      profile: null,
      changed: false,
      diagnostics: [
        {
          code: 'STYLE_E_SCHEMA_UNSUPPORTED',
          message: `不支持的 schemaVersion=${String(version)}（当前只支持 1）`,
        },
      ],
    };
  }

  const parsed = parseStyle(obj);
  if (!parsed.ok || !parsed.profile) {
    return {
      ok: false,
      profile: null,
      changed,
      diagnostics: [...diagnostics, ...parsed.diagnostics.map((d) => ({ code: d.code, message: d.message }))],
    };
  }
  return { ok: true, profile: parsed.profile, changed, diagnostics };
}
