/**
 * ST 步进程序（SFC/STL 的 ST 实现）测试：
 *  - spec.sequence 校验（重复步/未知目标/初始步/模板匹配）
 *  - 生成结果结构（步转移 CASE、输出驱动、分支、延时、赋值动作）
 *  - 端到端 gen（ST + IEC XML，分析器 0 error）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { parseSpec } from '../src/spec/index.ts';
import { generateFromSpec } from '../src/gen/generate.ts';
import { generateStepSequence } from '../src/gen/step-sequence.ts';
import type { RequirementSpec } from '../src/spec/schema.ts';

function baseSpec(sequenceOverrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'demo_step',
    cpu: { series: 'FX5U' },
    template: { name: 'step_sequence' },
    io: [
      { device: 'X0', name: 'bStart', type: 'BOOL' },
      { device: 'X1', name: 'bStop', type: 'BOOL' },
      { device: 'X2', name: 'bFault', type: 'BOOL' },
      { device: 'X10', name: 'bPosA', type: 'BOOL' },
      { device: 'X11', name: 'bPosB', type: 'BOOL' },
      { device: 'Y0', name: 'bOut', type: 'BOOL' },
    ],
    requirements: [{ id: 'R1', text: '启动后按步执行，到位信号推进' }],
    sequence: {
      initialStep: 'S1',
      steps: [
        { id: 'S1', name: '第一步', actions: [{ target: 'Y0', value: 'ON' }], next: { condition: 'X10', to: 'S2' } },
        { id: 'S2', name: '第二步', actions: [{ target: 'Y0', value: 'ON' }], next: { condition: 'X11', to: 'END' } },
      ],
      ...sequenceOverrides,
    },
  };
}

function specResult(overrides: Record<string, unknown> = {}) {
  return parseSpec(baseSpec(overrides));
}

test('步进 spec：合法 sequence 可加载并生成代码', () => {
  const r = specResult();
  assert.equal(r.ok, true, r.diagnostics.map((d) => d.message).join('; '));
  assert.ok(r.spec?.sequence);
  assert.equal(r.spec!.sequence!.steps.length, 2);
  const gen = generateStepSequence(r.spec!);
  assert.match(gen.source, /CASE nStep OF/);
  assert.match(gen.source, /IF \(X10\) THEN/);
  assert.match(gen.source, /Y0 := TRUE;/);
});

test('步进 spec：重复步 ID 报错', () => {
  const r = specResult({
    steps: [
      { id: 'S1', actions: [{ target: 'Y0', value: 'ON' }] },
      { id: 'S1', actions: [{ target: 'Y0', value: 'OFF' }] },
    ],
  });
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some((d) => d.code === 'SPEC_E_SEQUENCE_STEP_DUP'));
});

test('步进 spec：未知转移目标报错', () => {
  const r = specResult({
    steps: [{ id: 'S1', actions: [{ target: 'Y0', value: 'ON' }], next: { condition: 'X10', to: 'S9' } }],
  });
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some((d) => d.code === 'SPEC_E_SEQUENCE_TRANSITION_TARGET'));
});

test('步进 spec：initialStep 不存在报错', () => {
  const r = specResult({ initialStep: 'S0' });
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some((d) => d.code === 'SPEC_E_SEQUENCE_INITIAL'));
});

test('步进 spec：sequence 与 template.name 必须匹配', () => {
  const raw = baseSpec();
  (raw.template as Record<string, unknown>).name = 'motor_start_stop';
  const r1 = parseSpec(raw);
  assert.equal(r1.ok, false);
  assert.ok(r1.diagnostics.some((d) => d.code === 'SPEC_E_SEQUENCE_TEMPLATE'));

  const r2 = parseSpec({ ...baseSpec(), template: { name: 'step_sequence' }, sequence: undefined });
  assert.equal(r2.ok, false);
  assert.ok(r2.diagnostics.some((d) => d.code === 'SPEC_E_SEQUENCE_MISSING'));
});

test('步进生成：选择分支（多条转移）→ ELSIF', () => {
  const raw = baseSpec();
  (raw.sequence as Record<string, unknown>).steps = [
    {
      id: 'S1',
      actions: [{ target: 'Y0', value: 'ON' }],
      next: [
        { condition: 'X10', to: 'S2' },
        { condition: 'X11', to: 'S2' },
      ],
    },
    { id: 'S2', actions: [{ target: 'Y0', value: 'OFF' }], next: { condition: 'X11', to: 'END' } },
  ];
  const r = parseSpec(raw);
  assert.equal(r.ok, true, r.diagnostics.map((d) => d.message).join('; '));
  const gen = generateStepSequence(r.spec!);
  assert.match(gen.source, /ELSIF \(X11\) THEN/);
});

test('步进生成：延时转移 → 共享 TON + 每步设定', () => {
  const raw = baseSpec();
  (raw.sequence as Record<string, unknown>).steps = [
    { id: 'S1', actions: [{ target: 'Y0', value: 'ON' }], next: { delayMs: 1500, to: 'S2' } },
    { id: 'S2', actions: [{ target: 'Y0', value: 'OFF' }], next: { condition: 'X10', to: 'END' } },
  ];
  const r = parseSpec(raw);
  assert.equal(r.ok, true, r.diagnostics.map((d) => d.message).join('; '));
  const gen = generateStepSequence(r.spec!);
  assert.match(gen.source, /tStep\(IN := bRun AND NOT bTimerDone AND NOT bTimerReset/);
  assert.match(gen.source, /T#1500ms/);
  assert.match(gen.source, /IF bTimerDone THEN/);
});

test('步进生成：表达式动作（计数/赋值）', () => {
  const raw = baseSpec();
  raw.vars = [{ name: 'nCount', type: 'INT', scope: 'local', initial: '0' }];
  (raw.sequence as Record<string, unknown>).steps = [
    { id: 'S1', actions: [{ target: 'nCount', expression: 'nCount + 1' }], next: { condition: 'X10', to: 'END' } },
  ];
  const r = parseSpec(raw);
  assert.equal(r.ok, true, r.diagnostics.map((d) => d.message).join('; '));
  const gen = generateStepSequence(r.spec!);
  assert.match(gen.source, /nCount := nCount \+ 1;/);
});

test('步进端到端：gen 示例 spec 生成 ST + XML 且 0 error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-step-'));
  try {
    const r = await generateFromSpec(resolve('specs/robot_transfer_steps.json'), { outDir: dir });
    assert.equal(r.ok, true, [...r.specDiagnostics, ...r.diagnostics].map((d) => d.message).join('; '));
    assert.equal(r.templateName, 'step_sequence');
    assert.equal(r.generator, 'template');
    assert.ok(r.stPath && r.xmlPath);

    const st = await readFile(r.stPath!, 'utf8');
    assert.match(st, /PROGRAM Main/);
    assert.match(st, /CASE nStep OF/);
    // 正文使用全局标签（ST 文件头有 VAR_GLOBAL 映射块）
    assert.match(st, /VAR_GLOBAL/);
    assert.match(st, /bDownPos : BOOL AT X10;/);
    assert.match(st, /IF \(bDownPos\) THEN/);
    assert.match(st, /bLeft := TRUE;/);
    assert.match(st, /nStep := 0; bRun := FALSE;/);

    const xml = await readFile(r.xmlPath!, 'utf8');
    assert.match(xml, /IEC61131|<Project/);
    assert.match(xml, /<GlobalVars/);
    assert.match(xml, /<Address address="X10"\/>/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('步进生成：无转移的步保持当前步（不生成 IF）', () => {
  const spec = {
    name: 'demo_hold',
    cpu: { series: 'FX5U' as const },
    template: { name: 'step_sequence' },
    io: [{ device: 'Y0', name: 'bOut', type: 'BOOL' as const }],
    requirements: [{ id: 'R1', text: '单步保持' }],
    sequence: { steps: [{ id: 'S1', actions: [{ target: 'Y0', value: 'ON' as const }] }] },
  } as RequirementSpec;
  const gen = generateStepSequence(spec);
  assert.match(gen.source, /无转移条件：保持本步/);
});
