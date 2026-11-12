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
import { generateFromSpec } from '../src/gen/generate.ts';
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
  assert.equal(loaded.spec!.labels?.language, 'zh', 'robot_steps_v2 应配置中文标签');
});

test('工业生成：包含模式/急停/报警/手动/停止序列骨架', async () => {
  const loaded = await loadSpecFile(specPath);
  assert.equal(loaded.ok, true);
  const { source } = generateStepSequence(loaded.spec!);
  assert.match(source, /FUNCTION_BLOCK FB_Cylinder/);
  assert.match(source, /FUNCTION_BLOCK FB_CylinderSV/);
  assert.match(source, /n模式 : INT := 0/);
  assert.match(source, /IF X2 THEN/);
  assert.match(source, /fb竖直缸 : FB_Cylinder/);
  assert.match(source, /fb夹爪 : FB_CylinderSV/);
  assert.match(source, /fb竖直缸\(b使能 :=/);
  assert.match(source, /b报警 => b竖直缸报警, n报警码 => n竖直缸报警码/);
  assert.match(source, /b手动竖直缸上升沿 := M10 AND NOT b手动竖直缸上次/);
  assert.match(source, /b气缸位置正常 :=/);
  assert.match(source, /n停止步号 := 1/);
  assert.match(source, /M100 := \(n模式 = 0\)/);
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
    assert.ok(text.includes('b报警'), 'XML 正文应包含报警逻辑');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('工业生成：XML 全局标签带软元件地址与注释（导入 GX 后可见）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-globals-'));
  try {
    const r = await generateFromSpec(specPath, { outDir: dir });
    assert.equal(r.ok, true, r.diagnostics.map((d) => d.message).join('; '));
    const { readFile } = await import('node:fs/promises');
    const xml = await readFile(r.xmlPath!, 'utf8');
    assert.match(xml, /<GlobalVars constant="false" retain="false">/);
    assert.ok(xml.includes('<Variable name="启动按钮">'), '应包含中文 IO 全局标签 启动按钮');
    assert.ok(xml.includes('<Address address="X0"/>'), '启动按钮 应分配到 X0');
    assert.ok(xml.includes('<Variable name="触摸屏启动">'), '应包含中文 HMI 全局标签 触摸屏启动');
    assert.ok(xml.includes('<Address address="M0"/>'), '触摸屏启动 应分配到 M0');
    assert.ok(xml.includes('<Variable name="当前步号">'), '应包含中文步号数据标签');
    assert.ok(xml.includes('<Address address="D0"/>'), '当前步号 应分配到 D0');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('标签语言：可覆盖为英文（正式项目用）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-labels-en-'));
  try {
    const r = await generateFromSpec(specPath, { outDir: dir, labelLanguage: 'en' });
    assert.equal(r.ok, true);
    const { readFile } = await import('node:fs/promises');
    const st = await readFile(r.stPath!, 'utf8');
    assert.match(st, /^VAR_GLOBAL/m);
    assert.match(st, /bStart : BOOL AT X0;/);
    assert.match(st, /bHmiStart : BOOL AT M0;/);
    assert.ok(!st.includes('启动按钮 : BOOL'), '英文模式下不应出现中文标签名');
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
