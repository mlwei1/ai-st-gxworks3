/**
 * 工业步进程序生成器测试：模式/气缸监视/手动/停止序列/HMI。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { loadSpecFile, parseSpec } from '../src/spec/load.ts';
import { generateStepSequence } from '../src/gen/step-sequence.ts';
import { parseWithRecovery } from '../src/dialect/recovery.ts';
import { analyzeST } from '../src/dialect/analyzer.ts';
import { buildXmlFromStFile } from '../src/pipeline/build.ts';

const specPath = resolve('specs/robot_transfer_steps_v2.json');

test('工业 spec：industrial 段能加载并规范化', async () => {
  const loaded = await loadSpecFile(specPath);
  assert.equal(loaded.ok, true, loaded.diagnostics.map((d) => d.message).join('; '));
  const seq = loaded.spec!.sequence!;
  assert.ok(seq.industrial, 'sequence.industrial 应存在');
  assert.equal(seq.industrial!.estop, 'X2');
  assert.equal(seq.industrial!.cylinders.length, 3);
  assert.equal(seq.industrial!.cylinders[2].valve, 'single');
  assert.equal(seq.industrial!.stopSequence.length, 4);
  assert.equal(seq.industrial!.hmi.start, 'M0');
});

test('工业生成：包含模式/急停/报警/手动/停止序列骨架', async () => {
  const loaded = await loadSpecFile(specPath);
  assert.equal(loaded.ok, true);
  const { source } = generateStepSequence(loaded.spec!);
  assert.match(source, /nMode : INT := 0/);
  assert.match(source, /IF X2 THEN/);
  assert.match(source, /nAlarmCode := 10/);
  assert.match(source, /tC1Ext\(IN :=/);
  assert.match(source, /bBtn1Edge := M10 AND NOT bBtn1Last/);
  assert.match(source, /bCylOK :=/);
  assert.match(source, /nStopStep := 1/);
  assert.match(source, /Y2 := bC3Clamp/);
  assert.match(source, /M100 := \(nMode = 0\)/);
});

test('工业生成：语法/方言检查 0 error', async () => {
  const loaded = await loadSpecFile(specPath);
  assert.equal(loaded.ok, true);
  const { source } = generateStepSequence(loaded.spec!);
  const { ast, errors } = parseWithRecovery(source);
  assert.deepEqual(errors, [], errors.map((e) => e.message).join('; '));
  const diags = analyzeST(ast, { target: 'FX5U' });
  const errs = diags.filter((d) => d.severity === 'error');
  assert.deepEqual(errs, [], errs.map((d) => d.message).join('; '));
});

test('工业生成：可构建 IEC XML', async () => {
  const loaded = await loadSpecFile(specPath);
  assert.equal(loaded.ok, true);
  const dir = await mkdtemp(join(tmpdir(), 'dsh-industrial-'));
  try {
    const stPath = join(dir, 'robot_v2.st');
    await (await import('node:fs/promises')).writeFile(stPath, generateStepSequence(loaded.spec!).source, 'utf8');
    const xml = await buildXmlFromStFile(stPath, { outDir: dir, projectName: 'robot_v2' });
    assert.equal(xml.ok, true, xml.diagnostics.map((d) => d.message).join('; '));
    const text = await (await import('node:fs/promises')).readFile(xml.xmlPath!, 'utf8');
    assert.match(text, /<ST>/);
    assert.ok(text.includes('bAlarm'), 'XML 正文应包含报警逻辑');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('工业 spec：缺少 estop 时报错', () => {
  const bad = parseSpec({
    name: 'bad_industrial',
    cpu: { series: 'FX5U' },
    template: { name: 'step_sequence' },
    io: [],
    requirements: [{ id: 'R1', text: 'x' }],
    sequence: {
      steps: [{ id: 'S1', actions: [{ target: 'Y0', value: 'ON' }], next: { condition: 'X0', to: 'END' } }],
      industrial: {
        hmi: {},
        cylinders: [],
        manualButtons: [],
        stopSequence: [],
      },
    },
  });
  assert.equal(bad.ok, false);
  const codes = bad.diagnostics.map((d) => d.code);
  assert.ok(codes.includes('SPEC_E_INDUSTRIAL_ESTOP'), codes.join(','));
});
