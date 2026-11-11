/**
 * XML 正文注释保留：IEC XML 的 <ST> 应携带源文件原始正文（含 // 与 (* *) 注释），
 * 而不是由 AST unparse 生成的无注释代码。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { extractPouBodies } from '../src/pipeline/pou-text.ts';
import { buildXmlFromStFile } from '../src/pipeline/build.ts';

const SRC = [
  '// 顶层说明：测试用程序',
  'PROGRAM Main',
  'VAR',
  '    bStart : BOOL; // 启动按钮',
  '    bOut : BOOL;',
  'END_VAR',
  '    // 主逻辑：启动置位',
  '    IF bStart THEN',
  '        bOut := TRUE;  (* 置位输出 *)',
  '    END_IF;',
  '    // 结尾注释',
  'END_PROGRAM',
].join('\n');

test('提取 POU 正文：保留注释并去掉 PROGRAM/VAR/END_PROGRAM', () => {
  const bodies = extractPouBodies(SRC);
  const body = bodies.get('Main');
  assert.ok(body, '应提取到 Main 正文');
  assert.ok(body!.includes('// 主逻辑：启动置位'));
  assert.ok(body!.includes('(* 置位输出 *)'));
  assert.ok(!body!.includes('PROGRAM Main'));
  assert.ok(!body!.includes('END_VAR'));
  assert.ok(!body!.includes('END_PROGRAM'));
});

test('XML <ST> 正文保留 // 与 (* *) 注释', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-xml-comments-'));
  try {
    const stPath = join(dir, 'Main.st');
    await writeFile(stPath, SRC, 'utf8');
    const r = await buildXmlFromStFile(stPath, { outDir: dir });
    assert.equal(r.ok, true, r.diagnostics.map((d) => d.message).join('; '));
    const xml = await readFile(r.xmlPath!, 'utf8');
    assert.ok(xml.includes('// 主逻辑：启动置位'), 'XML 正文应保留行注释');
    assert.ok(xml.includes('(* 置位输出 *)'), 'XML 正文应保留块注释');
    assert.ok(xml.includes('// 结尾注释'));
    assert.ok(xml.includes('bOut := TRUE;'));
    assert.ok(!xml.includes('PROGRAM Main'), 'XML 正文不应包含 PROGRAM 头');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('无 VAR 段的 POU 也能提取正文', () => {
  const src = ['FUNCTION F1 : INT', '    // 函数体注释', '    F1 := 1;', 'END_FUNCTION'].join('\n');
  const bodies = extractPouBodies(src);
  assert.equal(bodies.get('F1')?.trim(), '// 函数体注释\n    F1 := 1;');
});
