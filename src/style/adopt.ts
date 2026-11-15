/**
 * 把 diff 候选规则合并进习惯档案。
 *
 * 设计原则：候选经过人工确认后，由 `style adopt` 一次性写入档案；
 * 只采纳高/中置信候选，低置信（正文行级修改）只提示、不自动采纳。
 */

import type { StyleCandidate } from './diff-candidates.ts';
import type { StyleProfile } from './index.ts';

export type Confidence = 'high' | 'medium' | 'low';

export interface AdoptOptions {
  /** 最低采纳置信度，默认 medium。 */
  minConfidence?: Confidence;
}

export interface AdoptResult {
  profile: StyleProfile;
  adopted: string[];
  skipped: string[];
}

const RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

function cloneProfile(p: StyleProfile): StyleProfile {
  return typeof structuredClone === 'function'
    ? structuredClone(p)
    : (JSON.parse(JSON.stringify(p)) as StyleProfile);
}

/** 采纳候选规则到档案（返回新档案，不修改入参）。 */
export function adoptCandidates(
  profile: StyleProfile,
  candidates: StyleCandidate[],
  options: AdoptOptions = {},
): AdoptResult {
  const min = RANK[options.minConfidence ?? 'medium'];
  const next = cloneProfile(profile);
  const adopted: string[] = [];
  const skipped: string[] = [];

  next.labels = next.labels ?? {};
  next.naming = next.naming ?? {};

  for (const c of candidates) {
    if (RANK[c.confidence] < min) {
      skipped.push(`[${c.confidence}] ${c.kind}: ${c.message}`);
      continue;
    }
    switch (c.kind) {
      case 'label-rename': {
        if (!c.device || !c.after) {
          skipped.push(`label-rename 缺少软元件/新名：${c.message}`);
          break;
        }
        next.labels.names = next.labels.names ?? {};
        next.labels.names[c.device] = c.after;
        adopted.push(`标签 ${c.device} → ${c.after}`);
        break;
      }
      case 'language': {
        if (c.after !== 'en' && c.after !== 'zh') {
          skipped.push(`language 值非法：${c.message}`);
          break;
        }
        next.labels.language = c.after;
        adopted.push(`标签语言 → ${c.after}`);
        break;
      }
      case 'naming-prefix': {
        if (!c.prefixes || Object.keys(c.prefixes).length === 0) {
          skipped.push(`naming-prefix 缺少类型映射：${c.message}`);
          break;
        }
        next.naming.prefixes = { ...(next.naming.prefixes ?? {}), ...c.prefixes };
        adopted.push(`命名前缀 ${JSON.stringify(c.prefixes)}`);
        break;
      }
      case 'local-rename':
      case 'param-rename': {
        if (!c.before || !c.after) {
          skipped.push(`${c.kind} 缺少改名前后值：${c.message}`);
          break;
        }
        next.naming.renames = next.naming.renames ?? {};
        next.naming.renames[c.before] = c.after;
        adopted.push(`改名 ${c.before} → ${c.after}`);
        break;
      }
      case 'label-added':
      case 'body-edit':
      default:
        skipped.push(`[${c.kind}] 需人工处理：${c.message}`);
        break;
    }
  }

  return { profile: next, adopted, skipped };
}
