/**
 * 温度仿真 harness 的静态验证（语法/方言/XML 结构）。
 * 真正执行依赖 GX Simulator3（人工或后续自动化），这里只保证脚手架本身可导入。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { parseWithRecovery } from '../src/dialect/recovery.ts';
import { analyzeST } from '../src/dialect/analyzer.ts';
import { buildXmlFromStFile } from '../src/pipeline/build.ts';

const harnessPath = resolve('sim/temperature_two_position.harness.st');

/** 字面量反引号 r 反引号 n（历史 bug：被 // 注释吞掉整段代码） */
const LITERAL_ESCAPE = String.fromCharCode(96) + 'r' + String.fromCharCode(96) + 'n';

test('温度 harness：语法/方言检查 0 error', async () => {
  const src = await readFile(harnessPath, 'utf8');
  const { ast, errors } = parseWithRecovery(src);
  assert.deepEqual(errors, [], `语法错误：${errors.map((e) => e.message).join('; ')}`);
  const diags = analyzeST(ast, { target: 'FX5U' });
  const errs = diags.filter((d) => d.severity === 'error');
  assert.deepEqual(errs, [], `方言错误：${errs.map((d) => d.message).join('; ')}`);
});

test('温度 harness：包含 1 秒时钟、阶段记录与自检', async () => {
  const src = await readFile(harnessPath, 'utf8');
  assert.match(src, /tTick\(IN := NOT tTick\.Q, PT := T#1s\);/);
  assert.match(src, /D0 := nScan;/);
  assert.match(src, /D310 := nBits/);
  assert.match(src, /D316 := nBits/);
  assert.match(src, /D320 := 0/);
  assert.match(src, /D320 := 1/);
});

test('温度 harness：源码不含字面量转义序列（防止被 // 注释吞掉）', async () => {
  const src = await readFile(harnessPath, 'utf8');
  assert.ok(!src.includes(LITERAL_ESCAPE), '源码中不应出现字面量转义序列');
});

test('温度 harness：可构建 XML（正文含 harness 逻辑）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-harness-'));
  try {
    const r = await buildXmlFromStFile(harnessPath, { outDir: dir, projectName: 'temp_harness' });
    assert.equal(r.ok, true, r.diagnostics.map((d) => d.message).join('; '));
    const xml = await readFile(r.xmlPath!, 'utf8');
    assert.match(xml, /<ST>/);
    assert.ok(xml.includes('D310 := nBits'), 'XML 正文应包含阶段记录');
    assert.ok(xml.includes('tTick'), 'XML 正文应包含 TON 节拍');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
