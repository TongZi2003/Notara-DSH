import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request } from '@playwright/test';
import { startNativeRuntime } from '../scripts/native-runtime.mjs';

test('native DSH HTTP: eight Vault RPCs, CAS, evidence and host disable/re-enable', { timeout: 60_000 }, async () => {
  const runtime = await startNativeRuntime({ enabled: ['vault-sqlite'] });
  const origin = new URL(runtime.authUrl).origin;
  const api = await request.newContext({ baseURL: origin, extraHTTPHeaders: { origin } });
  try {
    await api.get(runtime.authUrl);
    async function raw(method, input = {}) {
      const endpoint = `notaraVault/${method}`;
      const response = await api.post(`/api/${endpoint}`, { data: {
        type: 'client-request', rpcId: randomUUID(), method: endpoint, payload: { args: { input } },
      } });
      if (response.status() === 404) return { ok: false, error: { code: 'http_404' } };
      assert.equal(response.status(), 200);
      const body = await response.json();
      return body.result;
    }
    async function call(method, input = {}) {
      const result = await raw(method, input);
      assert.equal(result.ok, true, JSON.stringify(result));
      return result.value;
    }
    const before = await call('query');
    assert.ok(before.total >= 4);
    const a = 'integration/A.md', b = 'integration/B.md';
    const source = '---\ntype: card\ntitle: Integration A\ntags: [integration, evidence]\n---\n# A\n## 参考理解\n[[integration/B]]\n## 学生理解\n### 已建立的联系\n- [[integration/B]]：能说明 A 与 B 的关系。\n';
    await call('save', { path: b, content: '---\ntype: card\ntitle: Integration B\ntags: [integration]\n---\n# B\n', expectedRevision: null });
    const saved = await call('save', { path: a, content: source, expectedRevision: null });
    const read = await call('read', { path: a });
    assert.equal(read.content, source);
    assert.equal(read.revision, saved.revision);
    assert.equal((await call('query', { tags: ['integration', 'evidence'] })).total, 1);
    assert.ok((await call('query', { q: 'Integration' })).total >= 2);
    const graph = await call('graph', { focusPath: a, hops: 1 });
    assert.ok(graph.edges.some(edge => edge.source === a && edge.target === b && edge.style === 'solid'));
    const guide = '00-integration导读.md';
    const guideSaved = await call('save', { path: guide, content: '---\ntype: guide\ntitle: Integration guide\n---\n# 导读\n- [ ] 第一个任务\n- [ ] 第二个任务\n', expectedRevision: null });
    await call('toggleTask', { path: guide, line: 6, checked: true, expectedRevision: guideSaved.revision, expectedText: '第一个任务' });
    assert.match((await call('read', { path: guide })).content, /- \[x\] 第一个任务/);
    const home = await call('homeRecommendations');
    assert.equal(home.guide.path, guide);
    assert.equal(home.guide.completed, 1);
    await call('recordReview', { path: a, result: 'done', support: 'hint', keyStep: '解释第一步', note: '集成测试生成的提示后完成记录' });
    const reviewed = (await call('query', { tags: ['integration', 'evidence'] })).documents[0];
    assert.equal(reviewed.reviewCount, 1);
    assert.equal(reviewed.lastSupport, 'hint');
    if ('independentReviewCount' in reviewed) assert.equal(reviewed.independentReviewCount, 0);
    assert.equal((await raw('save', { path: a, content: 'stale overwrite', expectedRevision: saved.revision })).ok, false);
    await call('undoReview', { path: a });
    assert.equal((await call('query', { tags: ['integration', 'evidence'] })).documents[0].reviewCount, 0);
    assert.equal((await raw('read', { path: '../outside.md' })).ok, false);
    await runtime.setEnabled('vault-sqlite', false);
    const waitFor = async predicate => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        if (await predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('Native plugin lifecycle change did not settle');
    };
    await waitFor(async () => (await raw('query')).error?.code === 'http_404');
    await runtime.setEnabled('vault-sqlite', true);
    await waitFor(async () => (await raw('query')).ok);
    assert.match((await call('read', { path: a })).content, /## 学生理解/);
  } finally { await api.dispose(); await runtime.stop(); }
});
