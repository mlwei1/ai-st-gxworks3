/**
 * 多级 style 档案合并 + 修改 diff 候选规则提取测试。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { mergeStyleProfiles, resolveStyleFiles, type StyleProfile } from '../src/style/index.ts';
import { extractStyleCandidates, renderCandidateMarkdown } from '../src/style/diff-candidates.ts';
import { diffStyleProfiles, renderStyleDiff } from '../src/style/diff.ts';

function prof(over: Partial<StyleProfile>): StyleProfile {
  return { schemaVersion: 1, name: 'x', ...over } as StyleProfile;
}

test('style 多级合并：后者覆盖标量、对象递归、数组合并去重', () => {
  const user = prof({
    name: 'user_base',
    scope: 'user',
    labels: { language: 'zh' },
    naming: { prefixes: { BOOL: 'b', INT: 'n' }, examples: ['a'] },
    defaults: { cylinderTimeoutMs: 5000 },
    reviewChecklist: ['检查1'],
  });
  const project = prof({
    name: 'project_over',
    scope: 'project',
    labels: { language: 'en' },
    naming: { prefixes: { INPUT_BOOL: 'x' }, examples: ['a', 'b'] },
    defaults: { cylinderTimeoutMs: 8000 },
    reviewChecklist: ['检查2'],
  });
  const merged = mergeStyleProfiles([user, project]);
  assert.equal(merged.labels?.language, 'en');
  assert.equal(merged.scope, 'project');
  assert.equal(merged.naming?.prefixes?.BOOL, 'b');
  assert.equal(merged.naming?.prefixes?.INPUT_BOOL, 'x');
  assert.deepEqual(merged.naming?.examples, ['a', 'b']);
  assert.equal(merged.defaults?.cylinderTimeoutMs, 8000);
  assert.deepEqual(merged.reviewChecklist, ['检查1', '检查2']);
  assert.equal(merged.name, 'user_base+project_over');
});

test('style 多文件解析：缺失文件报错', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-style-multi-'));
  try {
    const a = join(dir, 'a.json');
    await writeFile(a, JSON.stringify(prof({ name: 'a', labels: { language: 'zh' } })), 'utf8');
    const ok = await resolveStyleFiles([a]);
    assert.equal(ok.ok, true);
    assert.equal(ok.profile?.labels?.language, 'zh');

    const bad = await resolveStyleFiles([a, join(dir, 'missing.json')]);
    assert.equal(bad.ok, false);
    assert.ok(bad.diagnostics.length > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('style 多级合并：labels.names 深合并，项目覆盖同名软元件', () => {
  const user = prof({
    name: 'user',
    labels: { language: 'zh', names: { X0: '启动', X1: '停止' } },
    naming: { prefixes: { BOOL: 'b' } },
  });
  const project = prof({
    name: 'project',
    scope: 'project',
    labels: { names: { X0: '开始按钮', X2: '急停' } },
    naming: { prefixes: { BOOL: 'q' } },
  });
  const merged = mergeStyleProfiles([user, project]);
  assert.deepEqual(merged.labels?.names, { X0: '开始按钮', X1: '停止', X2: '急停' });
  assert.equal(merged.naming?.prefixes?.BOOL, 'q');
  assert.equal(merged.labels?.language, 'zh');
});

test('style diff：比较两个档案的字段差异', () => {
  const a = prof({
    name: 'a',
    labels: { language: 'en', names: { X0: '启动' } },
    defaults: { cylinderTimeoutMs: 5000 },
  });
  const b = prof({
    name: 'b',
    labels: { language: 'zh', names: { X0: '启动', X1: '停止' } },
    defaults: { cylinderTimeoutMs: 8000 },
  });
  const entries = diffStyleProfiles(a, b);
  const paths = entries.map((e) => e.path);
  assert.ok(paths.includes('labels.language'));
  assert.ok(paths.includes('labels.names.X1'));
  assert.ok(paths.includes('defaults.cylinderTimeoutMs'));
  assert.equal(entries.find((e) => e.path === 'labels.language')?.kind, 'changed');
  assert.equal(entries.find((e) => e.path === 'labels.names.X1')?.kind, 'added');
  const md = renderStyleDiff(entries, 'a', 'b');
  assert.match(md, /labels.names.X1/);
  assert.equal(diffStyleProfiles(a, a).length, 0);
});

test('diff 候选：全局标签改名 / 局部改名 / 语言与前缀推断', () => {
  const generated = `VAR_GLOBAL
    bStart : BOOL AT X0; '启动按钮'
END_VAR

PROGRAM Main
VAR
    nStep : INT := 0;
    fbCyl1 : FB_Cylinder;
END_VAR
    nStep := nStep + 1;
END_PROGRAM
`;
  const actual = `VAR_GLOBAL
    启动按钮 : BOOL AT X0; '启动按钮'
END_VAR

PROGRAM Main
VAR
    n步号 : INT := 0;
    fb竖直缸 : FB_Cylinder;
END_VAR
    n步号 := n步号 + 1;
END_PROGRAM
`;
  const r = extractStyleCandidates(generated, actual);
  assert.equal(r.ok, true, r.parseErrors.join('; '));
  const kinds = r.candidates.map((c) => c.kind);
  assert.ok(kinds.includes('label-rename'), kinds.join(','));
  assert.ok(kinds.includes('local-rename'), kinds.join(','));
  assert.ok(kinds.includes('language'), kinds.join(','));
  assert.ok(kinds.includes('naming-prefix'), kinds.join(','));
  const rename = r.candidates.find((c) => c.kind === 'label-rename');
  assert.equal(rename?.before, 'bStart');
  assert.equal(rename?.after, '启动按钮');
  assert.equal(rename?.device, 'X0');
  const lang = r.candidates.find((c) => c.kind === 'language');
  assert.equal(lang?.after, 'zh');
  const prefix = r.candidates.find((c) => c.kind === 'naming-prefix');
  assert.equal(prefix?.prefixes?.INT, 'n');
  assert.equal(prefix?.prefixes?.FB_INSTANCE, 'fb');

  const md = renderCandidateMarkdown(r);
  assert.match(md, /label-rename/);
  assert.match(md, /启动按钮/);
});

test('diff 候选：无差异时为空', () => {
  const st = `PROGRAM Main
VAR
    bRun : BOOL := FALSE;
END_VAR
    bRun := TRUE;
END_PROGRAM
`;
  const r = extractStyleCandidates(st, st);
  assert.equal(r.ok, true);
  assert.equal(r.candidates.length, 0);
});
