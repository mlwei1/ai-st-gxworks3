/**
 * M3 deliver：交付工程包结构、追溯矩阵、SHA256、仿真证据归档。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { deliverFromSpec } from '../src/deliver/index.ts';

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

test('deliver: 生成完整交付包 + 需求追溯矩阵 + SHA256', async () => {
  const dir = await tempDir('dsh-deliver-');
  try {
    const r = await deliverFromSpec({
      specPath: resolve('specs/motor_start_stop.json'),
      outDir: dir,
      generatedAt: '2026-01-01T00:00:00.000Z',
    });
    assert.equal(r.ok, true, `交付失败：${JSON.stringify(r.summary.diagnostics)}`);
    assert.equal(r.summary.template, 'motor_start_stop');
    assert.equal(r.summary.requirementCount, 5);
    assert.equal(r.summary.passCount, 5);

    const report = await readFile(resolve(dir, 'report.md'), 'utf8');
    assert.match(report, /需求追溯矩阵/);
    assert.match(report, /R1/);
    assert.match(report, /交付状态：\*\*PASS\*\*/);

    const traceRaw = JSON.parse(await readFile(resolve(dir, 'trace.json'), 'utf8')) as {
      trace: Array<Record<string, unknown>>;
    };
    assert.equal(traceRaw.trace.length, 5);
    for (const row of traceRaw.trace) {
      assert.equal(typeof row.id, 'string');
      assert.equal(row.template, 'motor_start_stop');
      assert.equal(row.localCheck, 'pass');
      assert.ok(Array.isArray(row.artifacts) && row.artifacts.length >= 1);
    }

    const delivery = JSON.parse(await readFile(resolve(dir, 'delivery.json'), 'utf8')) as {
      files: Array<{ path: string; sha256: string; bytes: number }>;
    };
    const paths = delivery.files.map((f) => f.path);
    assert.ok(paths.some((p) => p.endsWith('.st')), '缺少 ST 产物');
    assert.ok(paths.some((p) => p.endsWith('.xml')), '缺少 XML 产物');
    assert.ok(paths.includes('report.md'));
    assert.ok(paths.includes('trace.json'));
    for (const f of delivery.files) {
      assert.match(f.sha256, /^[0-9a-f]{64}$/);
      assert.ok(f.bytes > 0);
    }
    // delivery.json 自身不参与哈希清单
    assert.ok(!paths.includes('delivery.json'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('deliver: 注入仿真报告后 evidence 归档且 trace 标记 sim=pass', async () => {
  const dir = await tempDir('dsh-deliver-sim-');
  const simPath = join(dir, 'sim-report.json');
  await writeFile(simPath, JSON.stringify({ scenario: 'motor_start_stop_sim', ok: true, mismatchCount: 0 }), 'utf8');
  try {
    const r = await deliverFromSpec({
      specPath: resolve('specs/motor_start_stop.json'),
      outDir: join(dir, 'pkg'),
      simReportPath: simPath,
    });
    assert.equal(r.ok, true);
    assert.equal(r.summary.simReport?.ok, true);
    assert.ok(r.trace.every((row) => row.sim === 'pass'));

    const copied = JSON.parse(await readFile(join(dir, 'pkg', 'evidence', 'sim-report.json'), 'utf8')) as {
      ok: boolean;
    };
    assert.equal(copied.ok, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('deliver: 非法 spec 仍产出报告且状态 FAIL', async () => {
  const dir = await tempDir('dsh-deliver-bad-');
  const specPath = join(dir, 'bad_spec.json');
  await writeFile(
    specPath,
    JSON.stringify({
      name: 'bad_demo',
      cpu: { series: 'FX5U' },
      template: { name: 'no_such_template' },
      io: [{ device: 'X0', name: 'bStart', type: 'BOOL' }],
      requirements: [{ id: 'R1', text: '按下 X0 后输出 Y0' }],
    }),
    'utf8',
  );
  try {
    const r = await deliverFromSpec({ specPath, outDir: join(dir, 'pkg') });
    assert.equal(r.ok, false);
    const report = await readFile(join(dir, 'pkg', 'report.md'), 'utf8');
    assert.match(report, /交付状态：\*\*FAIL\*\*/);
    assert.match(report, /诊断摘要/);
    assert.match(report, /GEN_E_TEMPLATE|SPEC_E_/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
