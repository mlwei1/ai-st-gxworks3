/**
 * style 规则校验 + HMI/报警表导出测试。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { loadStyleFile } from '../src/style/index.ts';
import { validateStyleProfile } from '../src/style/validate.ts';
import { buildAlarmRows, buildHmiRows, exportHmiCsvFiles, renderAlarmCsv } from '../src/emit/hmi-csv.ts';
import { loadSpecFile } from '../src/spec/load.ts';
import { generateFromSpec } from '../src/gen/generate.ts';

const profilePath = resolve('profiles/industrial/robot_transfer_habits.json');
const specPath = resolve('specs/robot_transfer_steps_v2.json');

test('validate：合法档案无 error', async () => {
  const p = (await loadStyleFile(profilePath)).profile!;
  const diags = validateStyleProfile(p);
  assert.equal(diags.filter((d) => d.severity === 'error').length, 0, diags.map((d) => d.message).join('; '));
});

test('validate：标签名重复/非法、改名循环、非法前缀', () => {
  const p = {
    schemaVersion: 1 as const,
    name: 'bad',
    labels: { names: { X0: '启动按钮', X1: '启动按钮', 'Y??': '非法 名' } },
    naming: {
      prefixes: { BOOL: 'b', INT: 'b' },
      renames: { a: 'b', b: 'a', 'c d': 'e' },
    },
  };
  const codes = validateStyleProfile(p).map((d) => d.code);
  assert.ok(codes.includes('STYLE_C_DEVICE'), codes.join(','));
  assert.ok(codes.includes('STYLE_C_LABEL_DUP'), codes.join(','));
  assert.ok(codes.includes('STYLE_C_LABEL_NAME'), codes.join(','));
  assert.ok(codes.includes('STYLE_C_RENAME_CYCLE'), codes.join(','));
  assert.ok(codes.includes('STYLE_C_RENAME_FROM'), codes.join(','));
  assert.ok(codes.includes('STYLE_C_PREFIX_DUP'), codes.join(','));
});

test('HMI 表：命令/状态/数据/手动按钮与标签一致', async () => {
  const loaded = await loadSpecFile(specPath);
  const style = (await loadStyleFile(profilePath)).profile!;
  const rows = buildHmiRows(loaded.spec!, style);
  const m0 = rows.find((r) => r.address === 'M0');
  assert.equal(m0?.name, '触摸屏启动');
  assert.equal(rows.find((r) => r.address === 'M10')?.name, '手动竖直缸');
  assert.equal(rows.find((r) => r.address === 'M100')?.description, '待机');
  assert.equal(rows.find((r) => r.address === 'D0')?.type, 'INT');
});

test('报警表：spec 报警码 + style 兜底映射', async () => {
  const loaded = await loadSpecFile(specPath);
  const style = (await loadStyleFile(profilePath)).profile!;
  const rows = buildAlarmRows(loaded.spec!, style);
  assert.ok(rows.some((r) => r.code === 10 && r.name.includes('竖直缸')));
  assert.ok(rows.some((r) => r.code === 30 && r.name.includes('夹爪')));

  // spec 去掉报警码后，style 档案 mapping 应兜底
  const spec = loaded.spec!;
  for (const c of spec.sequence!.industrial!.cylinders) {
    delete c.alarmExtend;
    delete c.alarmRetract;
  }
  const fallback = buildAlarmRows(spec, style);
  assert.ok(fallback.some((r) => r.code === 10), fallback.map((r) => r.code).join(','));
  assert.ok(fallback.some((r) => r.code === 31));

  const csv = renderAlarmCsv(rows);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /报警代码,报警名称/);
});

test('gen：工业程序自动导出 hmi_map.csv / alarm_map.csv', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-hmi-'));
  try {
    const style = (await loadStyleFile(profilePath)).profile!;
    const r = await generateFromSpec(specPath, { outDir: dir, style });
    assert.equal(r.ok, true, r.diagnostics.map((d) => d.message).join('; '));
    assert.ok(r.hmiCsvPath?.endsWith('hmi_map.csv'));
    assert.ok(r.alarmCsvPath?.endsWith('alarm_map.csv'));
    const hmi = await readFile(r.hmiCsvPath!, 'utf8');
    assert.match(hmi, /触摸屏启动/);
    const alarm = await readFile(r.alarmCsvPath!, 'utf8');
    assert.match(alarm, /竖直缸伸出超时/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
