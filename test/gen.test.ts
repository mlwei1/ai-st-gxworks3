/**
 * `generateFromSpec` 端到端测试（spec → 模板 → ST → 检查 → XML 工程包）。
 * 产物写入系统临时目录，不污染仓库。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateFromSpec } from '../src/gen/generate.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');

async function newTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'aist-gen-'));
}

test('gen：motor_start_stop spec 生成成功，ST/XML/标签/manifest 齐全', async () => {
  const out = await newTempDir();
  try {
    const result = await generateFromSpec(resolve(repo, 'specs/motor_start_stop.json'), { outDir: out });
    assert.equal(result.ok, true, `诊断: ${JSON.stringify(result.diagnostics)}`);
    assert.equal(result.templateName, 'motor_start_stop');
    assert.ok(result.stPath && existsSync(result.stPath));
    assert.ok(result.xmlPath && existsSync(result.xmlPath));
    assert.ok(result.manifestPath && existsSync(result.manifestPath));
    assert.ok((result.labelFiles ?? []).length >= 1);
    const xml = await readFile(result.xmlPath!, 'utf8');
    assert.match(xml, /<Project /);
    assert.match(xml, /<BodyContent xsi:type="ST">/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('gen：非法 spec 返回失败且不遗留 XML', async () => {
  const out = await newTempDir();
  const specPath = join(out, 'bad.json');
  try {
    await writeFile(
      specPath,
      JSON.stringify({
        name: 'bad_spec',
        cpu: { series: 'FX5U' },
        template: { name: 'motor_start_stop' },
        io: [{ device: 'X198', name: 'bBad', type: 'BOOL' }],
        requirements: [{ id: 'R1', text: 'x' }],
      }),
      'utf8',
    );
    const result = await generateFromSpec(specPath, { outDir: join(out, 'artifacts') });
    assert.equal(result.ok, false);
    assert.ok(result.specDiagnostics.some((d) => d.code.startsWith('SPEC_E_IO_DEVICE')));
    assert.equal(result.xmlPath, undefined);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
