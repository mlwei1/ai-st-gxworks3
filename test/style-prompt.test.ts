/**
 * 习惯档案注入提示词测试。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import { styleToPromptSection } from '../src/style/prompt.ts';
import { loadStyleFile } from '../src/style/index.ts';
import { buildSystemPrompt } from '../src/ai/prompt.ts';
import { specToRequirement } from '../src/gen/llm.ts';
import { loadSpecFile } from '../src/spec/load.ts';

const profilePath = resolve('profiles/industrial/robot_transfer_habits.json');

test('styleToPromptSection：包含语言/前缀/结构/自检清单', async () => {
  const style = (await loadStyleFile(profilePath)).profile!;
  const section = styleToPromptSection(style);
  assert.match(section, /用户编程习惯档案/);
  assert.match(section, /标签语言：中文/);
  assert.match(section, /命名前缀/);
  assert.match(section, /程序结构习惯/);
  assert.match(section, /生成后自检清单/);
  // 不带任何字段的空档案返回空串
  assert.equal(styleToPromptSection({ schemaVersion: 1, name: 'empty' }), '');
});

test('buildSystemPrompt：extra 段会追加到系统提示词', () => {
  const section = '【测试档案】必须使用中文标签';
  const sys = buildSystemPrompt('FX5U', section);
  assert.ok(sys.includes('目标 CPU'), '保留原有系统提示词');
  assert.ok(sys.includes(section), 'extra 段应被注入');
  assert.ok(sys.length > buildSystemPrompt('FX5U').length);
});

test('specToRequirement：追加习惯档案段', async () => {
  const loaded = await loadSpecFile(resolve('specs/robot_transfer_steps_v2.json'));
  const style = (await loadStyleFile(profilePath)).profile!;
  const withStyle = specToRequirement(loaded.spec!, style);
  const without = specToRequirement(loaded.spec!);
  assert.ok(withStyle.includes('用户编程习惯档案'));
  assert.ok(withStyle.includes('标签语言：中文'));
  assert.ok(withStyle.length > without.length);
});
