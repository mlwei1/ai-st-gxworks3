/**
 * gen 的 LLM 兜底与编译错误回灌集成测试（注入假生成器，不触网）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { generateFromSpec } from '../src/gen/generate.ts';

const BAD_SPEC = {
  name: 'fallback_demo',
  title: '模板参数非法，触发 LLM 兜底',
  cpu: { series: 'FX5U', model: 'FX5U-32MT/ES' },
  // alarm_first_out 只支持 1..16，99 会让模板实例化抛错
  template: { name: 'alarm_first_out', params: { alarmCount: 99 } },
  io: [
    { device: 'X0', name: 'bIn', type: 'BOOL' },
    { device: 'Y0', name: 'bOut', type: 'BOOL' },
  ],
  requirements: [{ id: 'R1', text: '输入有效时输出 ON' }],
};

const GOOD_ST = `PROGRAM Main
VAR
    bRun : BOOL := FALSE;
END_VAR
    IF X0 THEN
        bRun := TRUE;
    END_IF;
    Y0 := bRun;
END_PROGRAM
`;

async function setup(): Promise<{ dir: string; specPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'aist-fallback-'));
  const specPath = join(dir, 'spec.json');
  await writeFile(specPath, JSON.stringify(BAD_SPEC), 'utf8');
  return { dir, specPath };
}

test('模板失败且未启用 LLM：返回 GEN_E_TEMPLATE，不产出 XML', async () => {
  const { dir, specPath } = await setup();
  try {
    const result = await generateFromSpec(specPath, { outDir: join(dir, 'out') });
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some((d) => d.code === 'GEN_E_TEMPLATE' && d.message.includes('alarmCount')));
    assert.equal(result.xmlPath, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('模板失败 + LLM 兜底：生成成功，generator=llm', async () => {
  const { dir, specPath } = await setup();
  try {
    const result = await generateFromSpec(specPath, {
      outDir: join(dir, 'out'),
      useLlm: true,
      llmGenerate: async () => GOOD_ST,
    });
    assert.equal(result.ok, true, `诊断: ${JSON.stringify(result.diagnostics)}`);
    assert.equal(result.generator, 'llm');
    assert.ok(result.xmlPath && existsSync(result.xmlPath));
    const manifest = JSON.parse(await readFile(result.manifestPath!, 'utf8')) as {
      generator: string;
    };
    assert.equal(manifest.generator, 'llm');
    const st = await readFile(result.stPath!, 'utf8');
    assert.match(st, /PROGRAM Main/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('编译错误回灌：首轮反馈包含 GX 错误码，重生成后成功', async () => {
  const { dir, specPath } = await setup();
  try {
    const feedbacks: string[] = [];
    const result = await generateFromSpec(specPath, {
      outDir: join(dir, 'out'),
      useLlm: true,
      compilerErrors: [
        { code: '0x11021040', message: '锁存区标签必须为 RETAIN', line: 12, pou: 'Main' },
      ],
      llmGenerate: async ({ feedback }) => {
        feedbacks.push(feedback);
        return GOOD_ST;
      },
    });
    assert.equal(result.ok, true, `诊断: ${JSON.stringify(result.diagnostics)}`);
    assert.equal(result.generator, 'llm');
    assert.ok(feedbacks[0]!.includes('0x11021040'), '首轮应带编译错误反馈');
    assert.equal(result.compilerDiagnostics?.length, 1);
    const manifest = JSON.parse(await readFile(result.manifestPath!, 'utf8')) as {
      compilerDiagnostics: unknown[];
    };
    assert.equal(manifest.compilerDiagnostics.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('编译错误回灌但未启用 LLM：告警并回退模板生成', async () => {
  const { dir } = await setup();
  try {
    // 这个 spec 模板本身会失败，因此最终仍然失败；重点检查告警与诊断
    const specPath = join(dir, 'spec.json');
    const result = await generateFromSpec(specPath, {
      outDir: join(dir, 'out'),
      compilerErrors: [{ message: '编译错误' }],
    });
    assert.equal(result.ok, false);
    assert.ok(result.warnings.some((w) => w.includes('未启用 --llm')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
