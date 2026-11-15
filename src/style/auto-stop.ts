/**
 * 由气缸清单生成默认停止序列（spec.stopSequence 为空时使用）。
 *
 * 安全策略（对应档案规则 hold-clamp-until-release / return-home-before-idle）：
 * 1. 双电控气缸逐个缩回（缩回输出 ON、伸出输出 OFF）；
 * 2. 缩回过程中单电控夹紧输出保持 ON；
 * 3. 全部夹紧输出在同一释放步松开；
 * 4. 最后一步全部输出 OFF，完成条件 TRUE（回待机）。
 */

import type { CylinderSpec, StepAction, StopStepSpec } from '../spec/schema.ts';
import type { StyleProfile } from './index.ts';

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

/** 从档案 codeStructure.stopSequence.order 取气缸回原点顺序。 */
function stopOrder(style?: StyleProfile): string[] {
  const stop = style?.codeStructure?.stopSequence;
  if (!stop || typeof stop !== 'object') return [];
  const order = (stop as Record<string, unknown>).order;
  return Array.isArray(order) ? order.map(String).map((s) => s.trim()).filter(Boolean) : [];
}

/** 生成默认停止序列；无法生成时返回空数组。 */
export function buildDefaultStopSequence(
  cylinders: CylinderSpec[],
  style?: StyleProfile,
): StopStepSpec[] {
  const doubles = cylinders.filter((c) => c.valve !== 'single' && c.retractY);
  const singles = cylinders.filter((c) => c.valve === 'single');
  if (doubles.length === 0 && singles.length === 0) return [];

  // 按档案顺序排列双电控气缸；未列出的保持原顺序排在后面
  const order = stopOrder(style);
  const rank = (name: string): number => {
    const i = order.indexOf(name);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const orderedDoubles = doubles
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c.name) - rank(b.c.name) || a.i - b.i)
    .map((x) => x.c);

  const clampHold: StepAction[] = singles.map((c) => ({ target: c.extendY.trim(), value: 'ON' as const }));
  const steps: StopStepSpec[] = [];
  let n = 1;

  for (const c of orderedDoubles) {
    const actions: StepAction[] = [
      { target: c.extendY.trim(), value: 'OFF' },
      { target: c.retractY!.trim(), value: 'ON' },
      ...clampHold,
    ];
    steps.push({
      id: `S${n}`,
      name: `${c.name}回原位`,
      actions,
      until: c.retractedX.trim(),
    });
    n++;
  }

  if (singles.length > 0) {
    steps.push({
      id: `S${n}`,
      name: `${singles.map((c) => c.name).join('、')}松开`,
      actions: singles.map((c) => ({ target: c.extendY.trim(), value: 'OFF' as const })),
      until: uniq(singles.map((c) => c.retractedX.trim()))
        .map((x) => `(${x})`)
        .join(' AND '),
    });
    n++;
  }

  const allOutputs = uniq(
    cylinders.flatMap((c) => [c.extendY.trim(), c.retractY?.trim()].filter((x): x is string => !!x)),
  );
  steps.push({
    id: `S${n}`,
    name: '全部输出关闭',
    actions: allOutputs.map((y) => ({ target: y, value: 'OFF' as const })),
    until: 'TRUE',
  });

  return steps;
}
