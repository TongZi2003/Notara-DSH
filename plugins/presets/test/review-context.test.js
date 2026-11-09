import test from 'node:test';
import assert from 'node:assert/strict';
import { readReviewContext } from '../review-context.js';
import { apply,collectRuntimeContexts } from '../prompt.js';
import { conversationReviewProposals } from '../../graph-and-blocks/src/review-proposals.js';

const proposal = (path = '卡片/A.md') => '```notara-review\n' + JSON.stringify({ targetPath: path, keyStep: '老师建议的关键步', result: 'done', support: 'independent', note: '老师建议' }) + '\n```';
const message = (id, text, seq) => ({ type: 'assistant/message', seq, data: { message: { id, role: 'assistant', content: [{ type: 'text', text }] } } });
function fixture(events = [message('m1', proposal(), 1)]) {
  const agent = { id: 'lesson', session: { header: { cwd: '/workspace/a' } } }, reads = [];
  let history = [], broken = false, workspace = { id: 'workspace-a' };
  const services = {
    workspaceRegistry: { resolveByPath: async cwd => { assert.equal(cwd, '/workspace/a'); return workspace; } },
    sessionQuery: { readSurface: async id => { assert.equal(id, 'lesson'); return { session: { id, cwd: '/workspace/a' }, inheritedEventCount: 1, events }; } },
    notaraVault: { read: async input => { reads.push(input); if (broken) throw Error('unavailable'); return { content: `---\ntype: card\nreview_history: ${JSON.stringify(history)}\n---\n` }; } },
  };
  const ctx = { get: name => services[name] };
  return { ctx, services, assembly: { agent, scope: agent }, reads, history: value => { history = value; }, fail: () => { broken = true; }, workspace: value => { workspace = value; } };
}
test('review lookup follows visible component identities across hidden text, retired blocks, details and drawings', () => {
  const source = '## 教师参考\n' + proposal('隐藏.md') + '\n## 学习\n```blank\n旧填空\n```\n<details>\n<summary>记录</summary>\n\n' + proposal() + '\n\n</details>\n```drawing\ncall-one\n```\n' + proposal('卡片/B.md');
  assert.deepEqual(conversationReviewProposals(source), [{ index: 1, targetPath: '卡片/A.md' }, { index: 2, targetPath: '卡片/B.md' }]);
  assert.deepEqual(conversationReviewProposals('````text\n' + proposal() + '\n````'), []);
  assert.deepEqual(conversationReviewProposals('```notara-review\n{}'), []);
});
test('next context reads actual confirmations and later retractions without accepting the suggested values', async () => {
  const f = fixture();
  let result = await readReviewContext(f.ctx, f.assembly);
  assert.match(result.text, /尚未找到确认记录/); assert.doesNotMatch(result.text, /老师建议的关键步/);
  const row = { source: { messageId: 'm1', index: 0 }, result: 'missed', support: 'hint', keyStep: '学生实际确认的步骤', note: '仍不清楚条件' };
  f.history([row]); result = await readReviewContext(f.ctx, f.assembly);
  assert.match(result.text, /已记录/); assert.match(result.text, /仍有卡点/); assert.match(result.text, /有提示/); assert.match(result.text, /学生实际确认的步骤/);
  f.history([{ ...row, revertedAt: '2026-10-30T10:00:00Z' }]); result = await readReviewContext(f.ctx, f.assembly);
  assert.match(result.text, /"status":"已撤销"/);
  assert.ok(f.reads.every(read => read.workspaceId === 'workspace-a' && read.path === '卡片/A.md'));
});
test('review context preserves complete long notes including formulas, code and Unicode', async () => {
  const f = fixture();
  const notes = [
    '原'.repeat(239) + '😀\n先核对定义域，再比较 $F(2-x_1)$ 与 $F(x_2)$。\n$$F(r)<F(x_2)\\Rightarrow r<x_2$$\n```js\nconst roots = [-2, 2];\n```\n末尾：提示后完成，尚未独立检验。',
    '完整记录：' + '证'.repeat(3989) + '末尾须保留。',
    '完整长备注：'+'真实提问与学生后续步骤。'.repeat(500)+'最后一句不能截掉。',
  ];
  assert.equal(notes[1].length, 4000);
  for (const note of notes) {
    f.history([{ source: { messageId: 'm1', index: 0 }, result: 'done', support: 'hint', keyStep: '检查同一单调区间', note }]);
    const result = await readReviewContext(f.ctx, f.assembly);
    const receipt = JSON.parse(result.text.split('\n').find(line => line.startsWith('{')));
    assert.equal(receipt.note, note);
    assert.equal(receipt.status, '已记录');
    assert.equal(receipt.support, '有提示');
    assert.doesNotMatch(result.text, /备注截短/);
  }
});
test('selected review receipts retain all long notes beyond the old aggregate length cap', async () => {
  const events = Array.from({ length: 41 }, (_, i) => message(`m${i}`, proposal(), i + 1));
  const f = fixture(events);
  const rows = events.map((event, i) => ({
    source: { messageId: event.data.message.id, index: 0 }, result: 'done', support: 'independent', keyStep: '核对条件',
    note: `第${i}次：` + '保留原话与必要条件。'.repeat(350) + `\n末尾证据${i}`,
  }));
  assert.ok(rows.every(row => row.note.length <= 4000));
  f.history(rows);
  const result = await readReviewContext(f.ctx, f.assembly);
  const receipts = result.text.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
  assert.equal(receipts.length, 16);
  assert.deepEqual(receipts.map(row => row.messageId), rows.slice(-16).map(row => row.source.messageId));
  assert.ok(receipts.every((row, i) => row.note === rows.slice(-16)[i].note), 'every selected note must be preserved verbatim');
  assert.ok(receipts.reduce((length, row) => length + row.note.length, 0) > 12000);
  assert.equal(f.reads.length, 1);
  assert.match(result.text, /另有24项较早建议未展开/);
});
test('inherited or other-message receipts cannot confirm this conversation and same-card reads are shared', async () => {
  const f = fixture([message('parent', proposal('父课.md'), 0), message('m1', proposal() + '\n' + proposal(), 1)]);
  f.history([{ source: { messageId: 'other', index: 0 }, result: 'done', support: 'independent', note: '别课确认' }]);
  const result = await readReviewContext(f.ctx, f.assembly);
  assert.equal(f.reads.length, 1); assert.doesNotMatch(result.text, /父课\.md|别课确认/);
  assert.equal(result.text.match(/"status":"尚未找到确认记录"/g).length, 2);
});
test('malformed matching history is not reported as a confirmed or reverted result', async () => {
  const f = fixture(), row = { source: { messageId: 'm1', index: 0 }, result: 'done', keyStep: '实际步骤', note: '实际备注' };
  for (const broken of [{ source: row.source }, { ...row, note: null }, { ...row, revertedAt: true }]) {
    f.history([broken]);
    const result = await readReviewContext(f.ctx, f.assembly);
    assert.match(result.text, /"status":"记录需核对"/);
    assert.doesNotMatch(result.text, /"status":"已记录"|"status":"已撤销"/);
  }
  f.history([row]);
  assert.match((await readReviewContext(f.ctx, f.assembly)).text, /"support":"不确定"/);
});
test('failed reads are unknown, missing workspace never reads the default Vault, and cancellation propagates', async () => {
  const f = fixture(); f.fail();
  assert.match((await readReviewContext(f.ctx, f.assembly)).text, /读取失败或记录不明确/);
  const g = fixture(); g.workspace(null);
  assert.match((await readReviewContext(g.ctx, g.assembly)).text, /未能读取/); assert.equal(g.reads.length, 0);
  assert.equal(await readReviewContext(g.ctx, {}), null);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readReviewContext(f.ctx, { ...f.assembly, signal: controller.signal }), { name: 'AbortError' });
});
test('request collector reads passive receipts without injecting or rewriting the assembled host context', async () => {
  const f = fixture(); let listener;
  f.ctx.systemPrompt = { section() {}, getSectionOrder: () => 0 };
  f.ctx.on = (name, fn) => { assert.equal(name, 'system-prompt/assemble'); listener = fn; };
  apply(f.ctx, { preset: 'notara-teacher' });
  assert.equal(listener,undefined);
  f.ctx.agentPresets=f.services.agentPresets={composedPreset:()=> 'notara-teacher'};
  const original = { sections: [], contexts: [{ name: 'existing', text: 'keep' }] };
  const result = await collectRuntimeContexts(f.ctx,f.assembly.agent);
  assert.deepEqual(original.contexts,[{name:'existing',text:'keep'}]);
  const receipt=result.find(item=>item.name==='notara-review-confirmations');
  assert.match(receipt.text,/尚未找到确认记录/);assert.equal(receipt.interpolate,false);
});
