/**
 * 候选规则采纳进 style 档案测试。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { adoptCandidates } from '../src/style/adopt.ts';
import type { StyleCandidate } from '../src/style/diff-candidates.ts';
import type { StyleProfile } from '../src/style/index.ts';

const base: StyleProfile = {
  schemaVersion: 1,
  name: 'base',
  labels: { language: 'en' },
  naming: { prefixes: { BOOL: 'b' } },
};

const candidates: StyleCandidate[] = [
  {
    kind: 'label-rename',
    confidence: 'high',
    device: 'X0',
    before: 'bStart',
    after: '启动按钮',
    message: '全局标签 X0：bStart → 启动按钮',
  },
  {
    kind: 'language',
    confidence: 'high',
    before: 'en',
    after: 'zh',
    message: '中文标识符占比高',
  },
  {
    kind: 'naming-prefix',
    confidence: 'medium',
    prefixes: { INT: 'n', INPUT_BOOL: 'x' },
    message: '前缀映射',
  },
  {
    kind: 'local-rename',
    confidence: 'medium',
    before: 'nStep',
    after: 'n步号',
    message: '局部变量改名',
  },
  {
    kind: 'body-edit',
    confidence: 'low',
    message: '正文修改',
  },
];

test('adopt：标签名/语言/前缀/改名写入档案，低置信跳过', () => {
  const r = adoptCandidates(base, candidates);
  assert.deepEqual(r.profile.labels?.names, { X0: '启动按钮' });
  assert.equal(r.profile.labels?.language, 'zh');
  assert.equal(r.profile.naming?.prefixes?.INT, 'n');
  assert.equal(r.profile.naming?.prefixes?.INPUT_BOOL, 'x');
  assert.equal(r.profile.naming?.prefixes?.BOOL, 'b'); // 保留原前缀
  assert.deepEqual(r.profile.naming?.renames, { nStep: 'n步号' });
  assert.equal(r.adopted.length, 4);
  assert.equal(r.skipped.length, 1);
  // 不修改入参
  assert.equal(base.labels?.language, 'en');
  assert.deepEqual(base.labels?.names, undefined);
});

test('adopt：最低置信度 high 时只采纳高置信', () => {
  const r = adoptCandidates(base, candidates, { minConfidence: 'high' });
  assert.equal(r.adopted.length, 2);
  assert.equal(r.profile.labels?.language, 'zh');
  assert.deepEqual(r.profile.labels?.names, { X0: '启动按钮' });
  assert.equal(r.profile.naming?.prefixes?.INT, undefined);
  assert.equal(r.profile.naming?.renames, undefined);
});
