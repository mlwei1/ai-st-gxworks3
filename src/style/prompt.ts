/**
 * 把编程习惯档案转成 LLM 提示词片段。
 *
 * 用于：
 * - `generate`（旧 AI 对话路径）的 system prompt；
 * - LLM 兜底生成的需求文本。
 *
 * 档案是“默认偏好”，本次对话的显式要求优先级更高，提示词里写明这一点。
 */

import type { StyleProfile } from './index.ts';

function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** 生成提示词片段；无有效内容时返回空串。 */
export function styleToPromptSection(style: StyleProfile): string {
  const lines: string[] = [];
  lines.push('【用户编程习惯档案（必须遵守；若与本次对话显式要求冲突，以本次对话为准）】');
  lines.push(`档案：${style.name}${style.title ? `（${style.title}）` : ''}`);

  const labels = style.labels;
  if (labels?.language || (labels?.names && Object.keys(labels.names).length > 0)) {
    lines.push('标签习惯：');
    if (labels?.language) lines.push(`- 标签语言：${labels.language === 'zh' ? '中文' : '英文'}`);
    if (labels?.names && Object.keys(labels.names).length > 0) {
      lines.push(`- 指定标签名（优先使用）：${pretty(labels.names)}`);
    }
  }

  const naming = style.naming;
  if (naming?.prefixes && Object.keys(naming.prefixes).length > 0) {
    lines.push('命名前缀（按数据类型）：');
    lines.push(`- ${pretty(naming.prefixes)}`);
  }
  if (naming?.renames && Object.keys(naming.renames).length > 0) {
    lines.push(`- 精确改名（旧名 → 新名）：${pretty(naming.renames)}`);
  }
  if (naming?.examples?.length) lines.push(`- 命名示例：${naming.examples.join('，')}`);

  if (style.defaults?.cylinderTimeoutMs !== undefined) {
    lines.push(`默认参数：气缸动作超时 ${style.defaults.cylinderTimeoutMs}ms`);
  }

  for (const [key, title] of [
    ['codeStructure', '程序结构习惯'],
    ['hmi', 'HMI 地址规划'],
    ['alarmCodes', '报警码分配'],
  ] as const) {
    const v = style[key];
    if (v && typeof v === 'object' && Object.keys(v as object).length > 0) {
      lines.push(`${title}：`);
      lines.push(pretty(v));
    }
  }

  if (style.reviewChecklist?.length) {
    lines.push('生成后自检清单：');
    for (const item of style.reviewChecklist) lines.push(`- [ ] ${item}`);
  }
  if (style.notes?.length) {
    lines.push('其他约定：');
    for (const n of style.notes) lines.push(`- ${n}`);
  }

  return lines.length > 2 ? lines.join('\n') : '';
}
