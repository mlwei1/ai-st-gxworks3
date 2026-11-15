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
