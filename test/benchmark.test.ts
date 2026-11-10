/**
 * 基准场景回归：bench/*.json 全部走 gen 管线（spec → 模板 → 检查 → XML），
 * 断言无错误、产物齐全，并检查确定性。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateFromSpec } from '../src/gen/generate.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const benchDir = resolve(repo, 'bench');

test('bench：8 个基准场景全部可生成（0 error）且 ST/XML 齐全', async () => {
  const files = (await readdir(benchDir)).filter((f) => f.endsWith('.json')).sort();
  assert.ok(files.length >= 8, `基准场景不足：${files.join(', ')}`);

  for (const file of files) {
    const out = await mkdtemp(join(tmpdir(), 'aist-bench-'));
    try {
      const specPath = join(benchDir, file);
      const raw = JSON.parse(await readFile(specPath, 'utf8')) as {
        name: string;
        template: { name: string };
      };
      const result = await generateFromSpec(specPath, { outDir: out });
      assert.equal(result.ok, true, `${file}: ${JSON.stringify(result.diagnostics)}`);
      assert.equal(result.templateName, raw.template.name, `${file} 模板不匹配`);
      assert.ok(result.stPath && existsSync(result.stPath), `${file} 缺 ST`);
      assert.ok(result.xmlPath && existsSync(result.xmlPath), `${file} 缺 XML`);
      assert.ok(result.manifestPath && existsSync(result.manifestPath), `${file} 缺 manifest`);
      assert.deepEqual(
        result.diagnostics.filter((d) => d.severity === 'error'),
        [],
        `${file} 不应有 error 诊断`,
      );
      const xml = await readFile(result.xmlPath!, 'utf8');
      assert.match(xml, /<Program name="Main">/, `${file} XML 应含 Main 程序`);
      assert.match(xml, /<BodyContent xsi:type="ST">/, `${file} XML 应含 ST 正文`);

      // 同 spec 两次生成：ST 源码确定
      const again = await generateFromSpec(specPath, { outDir: join(out, 'again') });
      assert.equal(again.stSource, result.stSource, `${file} ST 输出不确定`);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  }
});
