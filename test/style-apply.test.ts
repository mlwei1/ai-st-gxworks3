/**
 * 档案应用测试：报警码兜底、模式名驱动、目录自动合并。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { loadSpecFile } from '../src/spec/load.ts';
import {
  createStyleTemplate,
  loadStyleFile,
  mergeStyleIntoSpec,
  resolveStyleDirectory,
} from '../src/style/index.ts';
import type { StyleProfile } from '../src/style/index.ts';
import { checkSpecAgainstStyle, profileHmiAddresses } from '../src/style/check-spec.ts';
import { applyStyleHmiAddresses } from '../src/style/apply-hmi.ts';
import { buildDefaultStopSequence } from '../src/style/auto-stop.ts';
import { migrateStyleRaw } from '../src/style/migrate.ts';
import { generateFromSpec } from '../src/gen/generate.ts';

const specPath = resolve('specs/robot_transfer_steps_v2.json');
const profilePath = resolve('profiles/industrial/robot_transfer_habits.json');

test('应用：spec 未设置报警码时按档案 alarmCodes 补齐', async () => {
  const loaded = await loadSpecFile(specPath);
  assert.equal(loaded.ok, true);
  const style = (await loadStyleFile(profilePath)).profile!;
  const spec = loaded.spec!;
  for (const c of spec.sequence!.industrial!.cylinders) {
    delete c.alarmExtend;
    delete c.alarmRetract;
  }
  const r = mergeStyleIntoSpec(spec, style);
  const cyls = spec.sequence!.industrial!.cylinders;
  const byName = new Map(cyls.map((c) => [c.name, c]));
  assert.equal(byName.get('竖直缸')?.alarmExtend?.code, 10);
  assert.equal(byName.get('竖直缸')?.alarmRetract?.code, 11);
  assert.equal(byName.get('夹爪')?.alarmExtend?.code, 30);
  assert.ok(r.applied.some((a) => a.includes('报警码')), r.applied.join('；'));
});

test('应用：档案 modes 驱动模式名，非法时回退并告警', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-style-modes-'));
  try {
    const style: StyleProfile = {
      schemaVersion: 1,
      name: 'modes_demo',
      labels: { language: 'zh' },
      codeStructure: { modes: ['空闲', '运行', '手动', '停止', '故障', '暂停'] },
    };
    const r = await generateFromSpec(specPath, { outDir: dir, style });
    assert.equal(r.ok, true, r.diagnostics.map((d) => d.message).join('; '));
    const st = await readFile(r.stPath!, 'utf8');
    assert.match(st, /0空闲 1运行 2手动 3停止 4故障 5暂停/);
    assert.ok(!st.includes('0待机 1自动'), '应使用档案模式名');

    const bad: StyleProfile = {
      schemaVersion: 1,
      name: 'modes_bad',
      codeStructure: { modes: ['只有两个', '模式'] },
    };
    const r2 = await generateFromSpec(specPath, { outDir: join(dir, 'bad'), style: bad });
    assert.equal(r2.ok, true);
    assert.ok(r2.warnings.some((w) => w.includes('模式')), r2.warnings.join('; '));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('应用：--style 目录按 scope 排序合并（user < company < project）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-style-dir-'));
  try {
    const profileDir = join(dir, 'profiles');
    await mkdir(profileDir);
    await writeFile(
      join(profileDir, 'c_project.json'),
      JSON.stringify({ schemaVersion: 1, name: 'proj', scope: 'project', labels: { language: 'en' } }),
      'utf8',
    );
    await writeFile(
      join(profileDir, 'a_user.json'),
      JSON.stringify({
        schemaVersion: 1,
        name: 'user',
        scope: 'user',
        labels: { language: 'zh', names: { X0: '启动' } },
        naming: { prefixes: { BOOL: 'b' } },
      }),
      'utf8',
    );
    await writeFile(
      join(profileDir, 'b_company.json'),
      JSON.stringify({
        schemaVersion: 1,
        name: 'company',
        scope: 'company',
        labels: { names: { X1: '停止' } },
        naming: { prefixes: { INT: 'n' } },
      }),
      'utf8',
    );
    const r = await resolveStyleDirectory(profileDir);
    assert.equal(r.ok, true, r.diagnostics.map((d) => d.message).join('; '));
    // 语言：user(zh) 被 project(en) 覆盖
    assert.equal(r.profile?.labels?.language, 'en');
    // labels.names：三级深合并
    assert.deepEqual(r.profile?.labels?.names, { X0: '启动', X1: '停止' });
    // prefixes：company 补 INT，user 的 BOOL 保留
    assert.equal(r.profile?.naming?.prefixes?.BOOL, 'b');
    assert.equal(r.profile?.naming?.prefixes?.INT, 'n');
    assert.equal(r.profile?.name, 'user+company+proj');
    // 来源按 scope 排序
    assert.deepEqual(
      r.sources.map((s) => s.split(/[\\/]/).pop()),
      ['a_user.json', 'b_company.json', 'c_project.json'],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('check-spec：robot 示例与档案一致（无偏差）', async () => {
  const loaded = await loadSpecFile(specPath);
  const style = (await loadStyleFile(profilePath)).profile!;
  const diags = checkSpecAgainstStyle(loaded.spec!, style);
  assert.equal(diags.length, 0, diags.map((d) => d.message).join('; '));
  const hmi = profileHmiAddresses(style);
  assert.equal(hmi.start?.address, 'M0');
  assert.equal(hmi.idle?.address, 'M100');
  assert.equal(hmi.step?.address, 'D0');
});

test('check-spec：HMI/超时/手动按钮/报警码偏差会报告', async () => {
  const loaded = await loadSpecFile(specPath);
  const style = (await loadStyleFile(profilePath)).profile!;
  const spec = loaded.spec!;
  const ind = spec.sequence!.industrial!;
  ind.hmi.start = 'M50';
  ind.cylinders[0].timeoutMs = 3000;
  ind.manualButtons = ind.manualButtons.filter((b) => b.cylinder !== '水平缸');
  ind.cylinders[0].alarmExtend = { code: 99 };
  const diags = checkSpecAgainstStyle(spec, style);
  const codes = diags.map((d) => d.code);
  assert.ok(codes.includes('STYLE_SPEC_HMI'), codes.join(','));
  assert.ok(codes.includes('STYLE_SPEC_TIMEOUT'), codes.join(','));
  assert.ok(codes.includes('STYLE_SPEC_MANUAL'), codes.join(','));
  assert.ok(codes.includes('STYLE_SPEC_ALARM'), codes.join(','));
});

test('style init 模板：字段齐全且可加载/校验', async () => {
  const p = createStyleTemplate('alice', 'user');
  assert.equal(p.labels?.language, 'zh');
  assert.equal((p.codeStructure?.modes as string[]).length, 6);
  assert.ok((p.reviewChecklist ?? []).length >= 3);
  const dir = await mkdtemp(join(tmpdir(), 'dsh-style-init-'));
  try {
    const file = join(dir, 'alice.json');
    await writeFile(file, JSON.stringify(p), 'utf8');
    const loaded = await loadStyleFile(file);
    assert.equal(loaded.ok, true, loaded.diagnostics.map((d) => d.message).join('; '));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('停止序列规则：未保持夹紧 / 最后一步未回 TRUE 会告警', async () => {
  const loaded = await loadSpecFile(specPath);
  const style = (await loadStyleFile(profilePath)).profile!;
  const spec = loaded.spec!;
  const ind = spec.sequence!.industrial!;
  // 去掉 T1 的夹紧保持（松开步仍在 T3）
  ind.stopSequence[0].actions = ind.stopSequence[0].actions.filter((a) => a.target !== 'Y2');
  let diags = checkSpecAgainstStyle(spec, style);
  assert.ok(diags.some((d) => d.code === 'STYLE_SPEC_STOP_CLAMP'), diags.map((d) => d.code).join(','));

  // 恢复后修改最后一步完成条件
  ind.stopSequence[0].actions.push({ target: 'Y2', value: 'ON' });
  ind.stopSequence[ind.stopSequence.length - 1].until = 'X15';
  diags = checkSpecAgainstStyle(spec, style);
  assert.ok(diags.some((d) => d.code === 'STYLE_SPEC_STOP'), diags.map((d) => d.code).join(','));
});

test('HMI 地址覆盖：applyStyleHmiAddresses 按档案规划改 spec', async () => {
  const loaded = await loadSpecFile(specPath);
  const style = (await loadStyleFile(profilePath)).profile!;
  // 默认档案与 spec 一致：无覆盖
  const clean = applyStyleHmiAddresses(loaded.spec!, style);
  assert.equal(clean.applied.length, 0);

  // 修改档案规划后应覆盖 M0→M50、M11→M19
  const custom = structuredClone(style);
  (custom.hmi as Record<string, unknown>).commands = { ...(custom.hmi!.commands as object), M50: '启动' };
  delete (custom.hmi!.commands as Record<string, unknown>).M0;
  (custom.hmi as Record<string, unknown>).manualButtons = {
    ...(custom.hmi!.manualButtons as object),
    M19: '手动翻转 水平缸',
  };
  delete (custom.hmi!.manualButtons as Record<string, unknown>).M11;
  const spec2 = (await loadSpecFile(specPath)).spec!;
  const r = applyStyleHmiAddresses(spec2, custom);
  assert.equal(spec2.sequence!.industrial!.hmi.start, 'M50');
  const hBtn = spec2.sequence!.industrial!.manualButtons.find((b) => b.cylinder === '水平缸');
  assert.equal(hBtn?.button, 'M19');
  assert.ok(r.applied.length >= 2, r.applied.join('；'));
});

test('自动停止序列：缩回→松夹→全关，满足夹紧保持规则', async () => {
  const loaded = await loadSpecFile(specPath);
  const cyls = loaded.spec!.sequence!.industrial!.cylinders;
  const steps = buildDefaultStopSequence(cyls);
  assert.equal(steps.length, 4); // 2 个双电控 + 1 个松开步 + 1 个全关步
  assert.ok(steps[0].actions.some((a) => a.target === 'Y2' && a.value === 'ON'));
  assert.ok(steps[1].actions.some((a) => a.target === 'Y2' && a.value === 'ON'));
  const release = steps.find((s) => (s.name ?? '').includes('松开'));
  assert.ok(release?.actions.some((a) => a.target === 'Y2' && a.value === 'OFF'));
  assert.equal(steps[steps.length - 1].until, 'TRUE');

  // spec 空 stopSequence：loader 接受，生成时自动补齐并通过停止规则校验
  const dir = await mkdtemp(join(tmpdir(), 'dsh-auto-stop-'));
  try {
    const raw = JSON.parse(await readFile(specPath, 'utf8'));
    raw.sequence.industrial.stopSequence = [];
    const emptyStopSpec = join(dir, 'empty_stop.json');
    await writeFile(emptyStopSpec, JSON.stringify(raw), 'utf8');
    const style = (await loadStyleFile(profilePath)).profile!;
    const r = await generateFromSpec(emptyStopSpec, { outDir: join(dir, 'out'), style });
    assert.equal(r.ok, true, r.diagnostics.map((d) => d.message).join('; '));
    assert.ok(r.warnings.some((w) => w.includes('自动生成')), r.warnings.join('; '));
    assert.ok(!r.warnings.some((w) => w.startsWith('习惯校验：停止序列')), r.warnings.join('; '));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('schemaVersion 迁移：缺少版本号补 1，未知版本报错', () => {
  const legacy = { name: 'old', labels: { language: 'zh' } };
  const m = migrateStyleRaw(legacy);
  assert.equal(m.ok, true);
  assert.equal(m.changed, true);
  assert.equal(m.profile?.schemaVersion, 1);
  assert.ok(m.diagnostics.some((d) => d.code === 'STYLE_M_VERSION'));

  const current = { schemaVersion: 1, name: 'new' };
  const m2 = migrateStyleRaw(current);
  assert.equal(m2.ok, true);
  assert.equal(m2.changed, false);

  const future = migrateStyleRaw({ schemaVersion: 2, name: 'future' });
  assert.equal(future.ok, false);
  assert.ok(future.diagnostics.some((d) => d.code === 'STYLE_E_SCHEMA_UNSUPPORTED'));
});
