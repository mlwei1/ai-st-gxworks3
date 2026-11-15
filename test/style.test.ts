/**
 * 编程习惯档案（Style Profile）测试。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { loadStyleFile, mergeStyleIntoSpec, parseStyle } from '../src/style/index.ts';
import { loadSpecFile } from '../src/spec/load.ts';
import { generateFromSpec } from '../src/gen/generate.ts';
import type { RequirementSpec } from '../src/spec/schema.ts';

const profilePath = resolve('profiles/industrial/robot_transfer_habits.json');

test('style：首个档案可加载且字段完整', async () => {
  const r = await loadStyleFile(profilePath);
  assert.equal(r.ok, true, r.diagnostics.map((d) => d.message).join('; '));
  const p = r.profile!;
  assert.equal(p.labels?.language, 'zh');
  assert.equal(p.defaults?.cylinderTimeoutMs, 5000);
  assert.equal(p.naming?.prefixes?.INPUT_BOOL, 'x');
  assert.ok((p.reviewChecklist ?? []).length >= 5);
  assert.ok((p.codeStructure as Record<string, unknown>).alarmBehavior);
});

test('style：非法档案给出明确诊断', () => {
  const bad = parseStyle({ schemaVersion: 2, name: '', labels: { language: 'fr' } });
  assert.equal(bad.ok, false);
  const codes = bad.diagnostics.map((d) => d.code);
  assert.ok(codes.includes('STYLE_E_SCHEMA_VERSION'));
  assert.ok(codes.includes('STYLE_E_NAME'));
  assert.ok(codes.includes('STYLE_E_LABELS_LANGUAGE'));
});

test('style：只填充 spec 未显式设置的项', async () => {
  const loaded = await loadSpecFile(resolve('specs/robot_transfer_steps_v2.json'));
  assert.equal(loaded.ok, true);
  const style = (await loadStyleFile(profilePath)).profile!;

  // spec 已显式 zh + 已给 timeout：不应被改变
  const spec1 = loaded.spec!;
  const before = spec1.labels?.language;
  const timeoutBefore = spec1.sequence!.industrial!.cylinders[0].timeoutMs;
  mergeStyleIntoSpec(spec1, style);
  assert.equal(spec1.labels?.language, before);
  assert.equal(spec1.sequence!.industrial!.cylinders[0].timeoutMs, timeoutBefore);

  // 空 spec：应填入 zh 与 5000ms
  const spec2 = {
    name: 'style_fill',
    cpu: { series: 'FX5U' },
    template: { name: 'step_sequence' },
    io: [],
    requirements: [{ id: 'R1', text: 'x' }],
    sequence: { steps: [], industrial: { cylinders: [{ name: '缸', extendY: 'Y0', extendedX: 'X0', retractedX: 'X1' }] } },
  } as unknown as RequirementSpec;
  const applied = mergeStyleIntoSpec(spec2, style);
  assert.equal(spec2.labels?.language, 'zh');
  assert.equal(spec2.sequence!.industrial!.cylinders[0].timeoutMs, 5000);
  assert.ok(applied.applied.length >= 2);
});

test('style：gen 使用档案后生成中文全局标签', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-style-'));
  try {
    const style = (await loadStyleFile(profilePath)).profile!;
    // robot_transfer_steps.json 未配置 labels，档案应补成中文
    const r = await generateFromSpec(resolve('specs/robot_transfer_steps.json'), {
      outDir: dir,
      style,
    });
    assert.equal(r.ok, true, r.diagnostics.map((d) => d.message).join('; '));
    assert.ok(r.warnings.some((w) => w.includes('已应用编程习惯档案')), r.warnings.join('; '));
    const st = await readFile(r.stPath!, 'utf8');
    assert.match(st, /VAR_GLOBAL/);
    assert.match(st, /启动按钮 : BOOL AT X0;/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
