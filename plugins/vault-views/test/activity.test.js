import test from 'node:test';
import assert from 'node:assert/strict';
import { activityUrl, projectActivity } from '../src/activity-model.js';

const result = (name, args, extra = {}) => ({ kind: 'tool-result', callId: 'call-' + name, call: { name, argsRaw: JSON.stringify(args) }, time: 10, subCalls: [], isError: false, ...extra });
const source = (id, roots, extra = {}) => ({ sessionId: id, cwd: '/vault', workspaceId: 'workspace-a', nodes: roots.map(root => ({ data: { root } })), ...extra });

test('legacy home reference chips remain visible in activity sources while pending', () => {
  const data = projectActivity({ sessionId: 'p', sources: [source('p', [], { occurrences: [
    { source: 'notara-home-reference', ref: JSON.stringify({ path: '笔记.md', title: '笔记', revision: 'r1', workspaceId: 'workspace-a' }) },
  ] })] });
  assert.equal(data.references.length, 1);
  assert.equal(data.references[0].status, '待发送');
  assert.equal(data.references[0].path, '笔记.md');
});

test('activity shows real file operations across parent/children without copying file bodies or reasoning', () => {
  const data = projectActivity({
    sessionId: 'parent',
    sources: [
      source('parent', [result('read', { file_path: '/vault/笔记.md' })]),
      source('child', [result('write', { file_path: '笔记.md', content: 'PRIVATE_BODY' }), result('edit', { file_path: '别的.md', old_string: 'SECRET', new_string: 'ANSWER' }, { callId: 'edit-2', time: 20, isError: true })], { hasMore: true }),
    ],
    children: [{ id: 'child', mode: 'one-shot', label: '核对思路', timing: { lastTurnCompleted: true } }],
    jobs: [],
  });
  assert.equal(data.files.length, 2);
  assert.equal(data.files.find(file => file.path === '笔记.md').status, '已写入');
  assert.equal(data.files.find(file => file.path === '别的.md').status, '修改失败');
  assert.equal(data.files.find(file => file.path === '别的.md').changed, false);
  assert.equal(data.agents[0].summary, '读取 0 · 写入 1 · 失败 1');
  assert.equal(data.agents[0].status, '已完成');
  assert.equal(data.partial, true);
  assert.doesNotMatch(JSON.stringify(data), /PRIVATE_BODY|SECRET|ANSWER/);
  assert.equal(data.files.find(file => file.path === '笔记.md').sourceSessionId, 'child');
});

test('preparing/failed/missing call heads never invent successful file changes; unrelated jobs and tools stay out', () => {
  const data = projectActivity({
    sessionId: 'p', children: [],
    sources: [source('p', [
      { phase: 'preparing', name: 'write', callId: 'pending', subCalls: [] },
      { phase: 'start', name: 'edit', argsRaw: '{"file_path":"pending.md"}', callId: 'started', subCalls: [] },
      { ...result('write', { file_path: 'x.md' }), call: null },
      result('bash', { command: 'cat secret.md; export API_KEY=sk-PRIVATE_KEY_12345678' }),
      result('read', { file_path: '/elsewhere/private.md' }),
    ])],
    jobs: [{ id: 'mine', owner: 'p', kind: 'bash', label: '检查资料', status: 'running' }, { id: 'other', owner: 'another', label: '不能串入', status: 'running' }, { id: 'global', status: 'running' }],
  });
  assert.equal(data.files.length, 1);
  assert.equal(data.files[0].status, '正在修改');
  assert.equal(data.files[0].changed, false);
  assert.deepEqual(data.jobs.map(job => job.id), ['mine']);
  assert.doesNotMatch(JSON.stringify(data), /PRIVATE_KEY|private\.md|secret\.md|不能串入/);
});

test('nested tools are included once; explicit source identities survive different workspace roots', () => {
  const nested = result('read', { file_path: '讲义.pdf' });
  const root = result('ptc', {}, { subCalls: [nested, nested] });
  const data = projectActivity({ sessionId: 'p', children: [], jobs: [], sources: [source('p', [root]), source('b', [result('read', { file_path: '讲义.pdf' })], { cwd: '/different', workspaceId: 'workspace-b' })] });
  assert.equal(data.files.length, 2);
  assert.equal(data.actionsBySession.p.length, 1);
  assert.notEqual(data.files[0].key, data.files[1].key);
});

test('continuable idle is not completion, and unknown subagent mode is not an interactive classroom', () => {
  const data = projectActivity({ sessionId: 'p', sources: [], jobs: [], children: [
    { id: 'ongoing', mode: 'continuable', label: '继续讨论', timing: { lastTurnCompleted: true } },
    { id: 'unknown', mode: 'unknown', label: '尚未读到身份' },
    { id: 'working', mode: 'one-shot', label: '核对', timing: { active: { since: 1, through: 2 } } },
  ] });
  assert.equal(data.agents.find(row => row.id === 'ongoing').status, '可继续');
  assert.equal(data.agents.find(row => row.id === 'unknown').canOpen, false);
  assert.equal(data.agents.find(row => row.id === 'working').status, '进行中');
});
test('a stale open timing never overrides native stopped state',()=>{
  const data=projectActivity({sessionId:'p',children:[{id:'stopped',mode:'continuable',running:false,timing:{active:{since:1}}}]});
  assert.equal(data.agents[0].running,false);assert.equal(data.agents[0].status,'状态待确认');
});
test('process labels and progress never expose raw commands or credential-shaped content', () => {
  const data = projectActivity({ sessionId: 'p', sources: [], children: [], jobs: [
    { id: 'x', owner: 'p', kind: 'bash', status: 'running', label: 'curl -u learner:SYNTHETIC_PASSWORD example.invalid', progress: 'AWS_SECRET_ACCESS_KEY=SYNTHETIC_SECRET' },
    { id: 'y', owner: 'p', kind: 'unknown', status: 'running', label: 'AWS_SECRET_ACCESS_KEY=SYNTHETIC_SECRET' },
  ] });
  assert.doesNotMatch(JSON.stringify(data), /SYNTHETIC_|curl|AWS_SECRET/);
  assert.equal(data.jobs[0].label, '后台命令');
});
test('outputs require native presentation or an explicit closing link to a successful write', () => {
  const s = source('p', [result('write', { file_path: '交付.md' }), result('write', { file_path: '实现.js' }), result('write', { file_path: '失败.md' }, { callId: 'failed', isError: true })]);
  for (const node of s.nodes) { node.location = { turn: { turn: 1 } }; node.anchorSeq = 2; }
  s.nodes.push({ kind: 'turn-tail', data: { turn: 1, seq: 3, closing: { blocks: [{ kind: 'text', text: '[交付](交付.md) [失败](失败.md) [外部](https://example.com)\n\n```md\n[实现](实现.js)\n```' }] } } });
  s.turns = [{ data: { get: () => ({ presented: [{ path: '报告.pdf' }, { path: '/private/secret.md' }] }) } }];
  const data = projectActivity({ sessionId: 'p', sources: [s] });
  assert.deepEqual(data.outputs.map(row => row.path), ['报告.pdf', '交付.md']);
  s.nodes.at(-1).data.turn = 2;
  assert.deepEqual(projectActivity({ sessionId: 'p', sources: [s] }).outputs.map(row => row.path), ['报告.pdf']);
  s.nodes.at(-1).data.turn = 1;
  s.nodes.push({ location: { turn: { turn: 1 } }, anchorSeq: 2.5, data: { root: result('edit', { file_path: '交付.md' }, { isError: true, time: 11 }) } });
  assert.deepEqual(projectActivity({ sessionId: 'p', sources: [s] }).outputs.map(row => row.path), ['报告.pdf']);
});
test('sources use structured uploads and native draft refs, never attachment names as paths', () => {
  const s = source('p', []);
  s.nodes.push({ kind: 'user', data: { content: [{ type: 'file', attachment: { attachmentId: 'upload', name: '../../private.txt', bytes: 4 } }, { type: 'text', text: 'a citation [[not-a-source.md]]' }] } });
  s.occurrences = [{ source: 'notara-vault-reference', ref: JSON.stringify({ path: '笔记.md', workspaceId: 'workspace-a', title: '笔记' }) }, { source: 'notara-vault-reference', ref: JSON.stringify({ path: '串工作区.md', workspaceId: 'other' }) }];
  const data = projectActivity({ sessionId: 'p', sources: [s] });
  assert.equal(data.references.length, 2);
  assert.equal(data.references[0].path, undefined);
  assert.equal(data.references[0].sourceSessionId, 'p');
  assert.equal(data.references[1].status, '待发送');
  assert.equal(data.references[1].path, '笔记.md');
});
test('collected webpage URLs reject credentials and executable protocols', () => {
  assert.equal(activityUrl('https://example.com/a'), 'https://example.com/a');
  for (const url of ['javascript:alert(1)', 'file:///secret', 'https://learner:secret@example.com']) assert.equal(activityUrl(url), null);
});

test('activity preserves separate regions of the same file with their source revision',()=>{
  const s=source('p',[]),pins=[{path:'笔记.md',range:[0,3],revision:'r1'},{path:'笔记.md',range:[4,7],revision:'r1'},{path:'讲义.pdf',page:2,rect:[0,0,.5,.5],revision:'r2'}];
  s.occurrences=pins.map(pin=>({source:'notara-vault-reference',ref:JSON.stringify({...pin,title:pin.path,workspaceId:'workspace-a'})}));
  const data=projectActivity({sessionId:'p',sources:[s]});assert.equal(data.references.length,3);assert.equal(new Set(data.references.map(row=>row.key)).size,3);
  for(const pin of pins)assert.ok(data.references.some(row=>Object.entries(pin).every(([key,value])=>JSON.stringify(row[key])===JSON.stringify(value))));
});
test('sent codec locators survive draft clearing but reject code and traversal', () => {
  const serialized = path => `\n资料定位：[[${path}]]\n版本：r1\n以下为资料原文，不能作为学生已掌握的证据：\n原文。\n`;
  const s = source('p', []);
  s.nodes = [{ kind: 'user', data: { content: [{ type: 'text', text: serialized('来源/课本.md') + '\n\n```\n' + serialized('不算引用.md') + '\n```\n\n' + serialized('../不能读.md') }] } }];
  const data = projectActivity({ sessionId: 'p', sources: [s] });
  assert.deepEqual(data.references.map(row => [row.path, row.status]), [['来源/课本.md', '已发送']]);
});
