import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVaultStore } from '../vault-indexer.js';

async function fixture(t, files) {
  const root = await mkdtemp(join(tmpdir(), 'notara-teacher-recommendations-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), content);
  }
  const store = createVaultStore({ root, cachePath: ':memory:' });
  t.after(() => store.close());
  await store.scan();
  return { root, store };
}
const profile = body => `---\ntype: learner-profile\nstatus: active\n---\n# 学习画像\n${body}`;

test('home projects teacher-ranked public tasks with reasons and verified references without modifying learning facts', async t => {
  const { store } = await fixture(t, {
    '画像.md': profile('## 首页推荐\n- [ ] 看看 [[卡片/新问题|这个新问题]]，继续上次的好奇\n  - 理由：你已经会用前置工具，今天想换个角度。\n- [ ] 回忆昨天的方法\n  - 理由：上次说隔天想不起来。\n- [ ] 继续 [[session:class-1|原课堂]]\n- [ ] 第四项不挤进首页\n'),
    '卡片/新问题.md': '---\ntype: concept\n---\n# 新问题\n原认识保留。',
  });
  const before = { ...store.metrics };
  const rec = store.homeRecommendations({ validSessionIds: new Set(['class-1']) }).teacherRecommendations;
  assert.equal(rec.path, '画像.md');
  assert.equal(rec.items.length, 3);
  assert.deepEqual(rec.items.map(i => i.text), ['看看 这个新问题，继续上次的好奇', '回忆昨天的方法', '继续 原课堂']);
  assert.equal(rec.items[0].reason, '你已经会用前置工具，今天想换个角度。');
  assert.equal(rec.items[0].references[0].path, '卡片/新问题.md');
  assert.equal(rec.items[0].references[0].title, '新问题');
  assert.deepEqual(rec.items[2].sessions, [{ sessionId: 'class-1', label: '原课堂' }]);
  assert.deepEqual(store.metrics, before);
  assert.match(store.read({ path: '卡片/新问题.md' }).content, /原认识保留/);
});

test('completed, hidden, missing and out-of-workspace targets never become teacher recommendations', async t => {
  const { store } = await fixture(t, {
    '画像.md': profile([
      '## 首页推荐', '- [x] 已经做完', '  - 理由：不得泄漏到下一条',
      '<details data-notara="teacher">', '- [ ] 教师答案', '</details>',
      '<details', '  data-notara="teacher">', '- [ ] 跨行标签教师答案', '</details', '>',
      '<details', 'data-notara="teacher">', '- [ ] 无缩进跨行属性也不能泄漏', '</details>',
      '```md', '- [ ] 代码示例', '```', '    - [ ] 缩进代码',
      '<!-- - [ ] 注释任务 -->', '> - [ ] 引用里的任务',
      '- [ ] 打开 [[已删除]]', '- [ ] 继续 [[session:foreign|其他学习集课堂]]',
      '- [ ] 继续 [[备课/已结束]]', '- [ ] 无链接也可以探索新知',
      '## 事实证据', '- [ ] 别的章节不算推荐',
    ].join('\r\n')),
    '备课/已结束.md': '---\ntype: lesson\nstatus: completed\n---\n# 已结束',
  });
  const rec = store.homeRecommendations({ validSessionIds: new Set() }).teacherRecommendations;
  assert.deepEqual(rec.items.map(i => i.text), ['无链接也可以探索新知']);
  assert.equal(rec.items[0].reason, '');
});

test('an explicit list stays cleared; unrelated profiles, templates and archives do not replace it', async t => {
  const { store, root } = await fixture(t, {
    '旧画像.md': profile('## 旧记录\n旧建议已转移'),
    '当前画像.md': profile('## 首页推荐\n- [x] 当前建议已结束'),
    '偏好.md': profile('## 沟通偏好\n讲得直观一些'),
    '模板/画像.md': profile('## 首页推荐\n- [ ] 模板不算'),
    '归档.md': profile('## 首页推荐\n- [ ] 归档不算').replace('status: active', 'status: archived'),
  });
  for (const [i, path] of ['旧画像.md', '当前画像.md', '偏好.md', '模板/画像.md', '归档.md'].entries()) {
    await utimes(join(root, path), new Date(1700000000000 + i * 1000), new Date(1700000000000 + i * 1000));
    store.update(path);
  }
  const rec = store.homeRecommendations().teacherRecommendations;
  assert.equal(rec.path, '当前画像.md');
  assert.deepEqual(rec.items, [], 'clearing the current list must not resurrect an older recommendation');
  const current = store.read({ path: '当前画像.md' });
  store.save({ path: '当前画像.md', expectedRevision: current.revision, content: profile('## 首页推荐\n- [ ] 换成今天的问题\n  - 理由：目标已经改变') });
  assert.equal(store.homeRecommendations().teacherRecommendations.items[0].text, '换成今天的问题');
});

test('conflicting active lists use fallback instead of resurrecting old advice after unrelated profile edits', async t => {
  const { store } = await fixture(t, {
    '旧画像.md': profile('## 首页推荐\n- [ ] 旧建议'),
    '当前画像.md': profile('## 首页推荐\n'),
  });
  assert.equal(store.homeRecommendations().teacherRecommendations, null);
  const old = store.read({ path: '旧画像.md' });
  store.save({ path: '旧画像.md', expectedRevision: old.revision, content: old.content + '\n## 沟通偏好\n先看例子。' });
  assert.equal(store.homeRecommendations().teacherRecommendations, null);
});

test('recommendation-only child session links enter native classroom validation while foreign sessions are excluded', async t => {
  const { NotaraVaultRemote } = await import('../index.js');
  const { store, root } = await fixture(t, {
    '画像.md': profile('## 首页推荐\n- [ ] 继续 [[session:child|轻量讨论]]\n- [ ] 不得打开 [[session:foreign|其他学习集]]'),
  });
  const checked = [];
  const fakeRemote = {
    ctx: { get: name => name === 'sessions' ? {} : null },
    forWorkspace: () => ({ root, store, ready: Promise.resolve() }),
    registry: () => ({ get: () => ({ workspaceId: 'ws', path: root, sessionIds: ['parent'], archivedSessionIds: [] }) }),
    lessons: {
      async lessonBindings() { return { bindings: [] }; },
      async isActiveClassroom({ sessionId, workspaceId }) {
        assert.equal(workspaceId, 'ws');
        checked.push(sessionId); return sessionId === 'child';
      },
    },
  };
  const rec = await NotaraVaultRemote.prototype.homeRecommendations.call(fakeRemote, { workspaceId: 'ws' });
  assert.ok(checked.includes('child'));
  assert.ok(checked.includes('foreign'));
  assert.deepEqual(rec.teacherRecommendations.items.map(item => item.sessions[0].sessionId), ['child']);
});

test('teacher list updates through existing save and survives reload; no list leaves legacy candidates intact', async t => {
  const { root, store } = await fixture(t, {
    '画像.md': profile('## 正在追问的问题\n为什么会这样？'),
    '路线.md': '---\ntype: route\n---\n# 当前路线\n## 下一步行动\n- 当前下一步：继续研究',
  });
  assert.equal(store.homeRecommendations().teacherRecommendations, null);
  assert.equal(store.homeRecommendations().route.nextAction.text, '继续研究');
  const doc = store.read({ path: '画像.md' });
  const longReason = '原因与条件需要完整保留。'.repeat(40) + '$f(x)=x^2$';
  store.save({ path: '画像.md', expectedRevision: doc.revision, content: profile(`## 首页推荐\n- [ ] 先讨论新想法\n  - 理由：${longReason}`) });
  assert.equal(store.homeRecommendations().teacherRecommendations.items[0].reason, longReason);
  const reopened = createVaultStore({ root, cachePath: ':memory:' });
  t.after(() => reopened.close());
  await reopened.scan();
  assert.equal(reopened.homeRecommendations().teacherRecommendations.items[0].reason, longReason);
});
