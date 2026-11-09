import test from 'node:test';
import assert from 'node:assert/strict';
import { bringReferences, registerReferences, REFERENCE_SOURCE, currentSessionId, captureSourceOwner,bringDrawingSnapshot,sourceReferenceRule } from '../src/composer.js';
import { serializedSourcePins,referenceEnvelopes } from '../src/reference-facts.js';

test('historical home references display as source chips without eating surrounding student text', () => {
  const pin = { path: '卡片/定义.md', title: '定义', revision: 'r1', workspaceId: 'w1', recommendation: { path: '画像.md', revision: 'p1', line: 3, title: '继续理解定义', reason: '前次问题' } };
  const wire = `学习资料引用：${JSON.stringify(pin)}\n这是资料定位信息。请先读取原文并核对版本；仅带入引用不代表学生已读或掌握。 recommendation 是老师此前保存的推荐及依据，不是学生新表达的学情；按其 path 与 line 回读当前版本，目标变化时先对齐。`;
  const text = `我想问\n${wire}\n这里为什么成立？`;
  const row = sourceReferenceRule.match(text, 0);
  assert.equal(row.data.label, '定义');
  assert.deepEqual(row.data.pin, pin);
  assert.equal(text.slice(row.end), '\n这里为什么成立？');
  assert.equal(serializedSourcePins(text)[0].path, pin.path);
  for (const example of ['```text\n' + wire + '\n```', '`' + wire.replaceAll('\n', ' ') + '`', wire.split('\n')[0], wire.replace('卡片/定义.md', '../private.md')]) {
    assert.equal(sourceReferenceRule.match(example, 0), undefined);
  }
});

function fixture() {
  let state = { phase: 'plain', draft: '保留我已经写的内容', draftRev: 1, occurrences: [] }, active = 'lesson';
  let selected = 'notara-vault', sent = 0, source;
  const scope = { bail(_scope, event, request) { assert.equal(event, 'slash/input-insert-text'); assert.equal(request.span.draftRev, state.draftRev); state = { ...state, draft: state.draft + request.text, draftRev: state.draftRev + 1 }; return true; } };
  const ctx = {
    sessions: { list: { getSnapshot: () => ({ byId: { [active]: { id: active, retainedBy: { mainView: 1 } } } }) }, scope: () => scope },
    remote: { notaraVault: { read: async ({ path }) => ({ path, revision: 'r1', content: '原文' }) } },
    conversation: { send: () => sent++, blocks: { storeFor: () => ({ getSnapshot: () => null }) }, input: { for: () => ({ state: { getSnapshot: () => state }, insertReference(ref, span) { assert.equal(span.draftRev, state.draftRev); state = { ...state, draft: state.draft + '¤', draftRev: state.draftRev + 1, occurrences: [...state.occurrences, { ...ref, length: 1 }] }; return true; } }) } },
    layout: { selectPanel: id => { selected = id; } },
    inputTriggers: { registerSource(value) { source = value; return () => { source = undefined; }; } },
  };
  return { ctx, state: () => state, select: () => selected, sent: () => sent, source: () => source, active: value => { active = value; } };
}
function withImages(f) {
  const attachments = new Map(), input = f.ctx.conversation.input.for();
  f.ctx.conversation.input.for = () => input;
  f.ctx.conversation.createDrafts = (_id, files) => files.map(file => { const item = { id: `image-${attachments.size}`, kind: 'image', file }; attachments.set(item.id, item); return item; });
  f.ctx.conversation.resolveDraftAttachments = ids => ids.map(id => attachments.get(id)).filter(Boolean);
  f.ctx.conversation.releaseDraftAttachments = items => items.forEach(item => attachments.delete(item.id));
  input.addFiles = (refs, ids) => { for (const ref of refs) input.insertReference(ref, { draftRev: f.state().draftRev }); f.state().attachmentIds = [...f.state().attachmentIds ?? [], ...ids]; return true; };
  return { input, attachments };
}
test('PDF regions bring a native PNG together with the versioned locator, preserve drafts and deduplicate', async () => {
  const f = fixture(), { attachments } = withImages(f); registerReferences(f.ctx);
  const request = { path: '来源/a.pdf', revision: 'r1', page: 2, rect: [.1, .2, .3, .4] };
  let rendered = 0;
  f.ctx.remote.notaraVault.read = async () => ({ revision: 'r1', content: 'PDF', encoding: 'base64' });
  const renderPdf = async (record, pin) => { rendered++; assert.equal(record.content, 'PDF'); assert.deepEqual(pin.rect, request.rect); assert.equal(pin.page, 2); return new Blob(['pixels'], { type: 'image/png' }); };
  await bringReferences(f.ctx, [request, { ...request, rect: [.1000000001, .2, .3, .4] }], '一起看', undefined, { renderPdf });
  await bringReferences(f.ctx, [request], '一起看', undefined, { renderPdf });
  assert.equal(rendered, 1); assert.equal(attachments.size, 1); assert.equal(f.state().occurrences.length, 1);
  assert.equal([...attachments.values()][0].file.type, 'image/png');
  assert.match(f.state().draft, /^保留我已经写的内容/); assert.equal(f.sent(), 0);
  const pin = f.state().occurrences[0].ref, text = await f.source().codec.serialize(pin);
  assert.ok(text.includes([...attachments.values()][0].file.name)); assert.match(text, /所选区域/);
  f.ctx.remote.notaraVault.read = async () => ({ revision: 'r2' });
  await assert.rejects(() => f.source().codec.serialize(pin), /已经更新/);
});
test('PDF rendering failure, session switch and locked admission leave no new attachment or reference', async () => {
  const request = { path: 'a.pdf', revision: 'r1', page: 1, rect: [0, 0, .5, .5] };
  for (const mode of ['render-failure', 'switch', 'locked']) {
    const f = fixture(), { input, attachments } = withImages(f), before = f.state().draft;
    const renderPdf = async () => { if (mode === 'render-failure') throw new Error('render failed'); if (mode === 'switch') f.active('other'); return new Blob(['pixels']); };
    if (mode === 'locked') input.addFiles = () => false;
    await assert.rejects(() => bringReferences(f.ctx, [request], '', undefined, { renderPdf }));
    assert.equal(attachments.size, 0); assert.equal(f.state().occurrences.length, 0); assert.equal(f.state().draft, before);
  }
});
test('drawing snapshots preserve the existing draft, use native PNG attachments and respect input blocks/ownership',async()=>{
  const f=fixture(),attached=[],released=[];let block=null,created=0;
  f.ctx.get=name=>name==='conversation'?f.ctx.conversation:undefined;
  f.ctx.conversation.blocks.storeFor=()=>({getSnapshot:()=>block});
  f.ctx.conversation.createDrafts=(id,files)=>{assert.equal(id,'lesson');assert.equal(files[0].type,'image/png');created++;return [{id:'png'}];};
  f.ctx.conversation.releaseDraftAttachments=items=>released.push(...items);
  const input=f.ctx.conversation.input.for();input.addAttachments=ids=>{attached.push(...ids);return true;};input.removeAttachment=id=>attached.splice(attached.indexOf(id),1);f.ctx.conversation.input.for=()=>input;
  const snapshot={blob:new Blob(['png'],{type:'image/png'}),meta:{path:'图.excalidraw',workspaceId:undefined,revision:'r1',snapshotHash:'12345678',mode:'selection',elements:[{id:'e',text:'当时的内容'}]}};
  block={reason:'blocked'};await assert.rejects(()=>bringDrawingSnapshot(f.ctx,snapshot),/暂不可编辑/);assert.equal(created,0);block=null;
  const owner=captureSourceOwner(f.ctx);f.active('other');await assert.rejects(()=>bringDrawingSnapshot(f.ctx,snapshot,owner),/已切换/);assert.equal(created,0);f.active('lesson');
  await bringDrawingSnapshot(f.ctx,snapshot,owner);assert.deepEqual(attached,['png']);assert.match(f.state().draft,/^保留我已经写的内容/);assert.match(f.state().draft,/当时的内容/);snapshot.meta.elements[0].text='后来变了';assert.ok(!f.state().draft.includes('后来变了'));assert.equal(f.sent(),0);
  input.addAttachments=()=>false;await assert.rejects(()=>bringDrawingSnapshot(f.ctx,snapshot,owner),/暂不可编辑/);assert.equal(released.length,1);
});

test('source action ownership expires on session, scope or workspace replacement',()=>{
  const f=fixture();let workspaceId='a';
  f.ctx.get=name=>name==='workspaces'?{list:{getSnapshot:()=>({items:[{workspaceId,sessionIds:['lesson']}]})}}:undefined;
  let current=captureSourceOwner(f.ctx);assert.equal(current(),true);workspaceId='b';assert.equal(current(),false);
  current=captureSourceOwner(f.ctx);f.active('other');assert.equal(current(),false);
  f.active('lesson');current=captureSourceOwner(f.ctx);f.ctx.sessions.scope=()=>({});assert.equal(current(),false);
});

test('region drafts reject unversioned text or mixed locator kinds before insertion',async()=>{
  const f=fixture();
  await assert.rejects(()=>bringReferences(f.ctx,[{path:'a.md',range:[0,1]}]));
  await assert.rejects(()=>bringReferences(f.ctx,[{path:'a.md',revision:'r1',range:[0,1],page:1}]));
  assert.equal(f.state().occurrences.length,0);assert.equal(f.sent(),0);
});

test('reference target follows the selected native session rather than the first retained view', async()=>{
  const f=fixture();let selected={key:'child'};const scopes=[];
  f.ctx.get=name=>name==='uiSession'?{adapter:{current:{getSnapshot:()=>selected}}}:undefined;
  f.ctx.sessions.list.getSnapshot=()=>({byId:{lesson:{id:'lesson',retainedBy:{mainView:1}},child:{id:'child',retainedBy:{mainView:1}}}});
  const original=f.ctx.sessions.scope;f.ctx.sessions.scope=id=>{scopes.push(id);return original();};
  assert.equal(currentSessionId(f.ctx),'child');
  await bringReferences(f.ctx,[{path:'a.md'}]);assert.deepEqual([...new Set(scopes)],['child']);
  const before=f.state().draft;
  f.ctx.remote.notaraVault.read=async()=>{selected={key:'lesson'};return {revision:'r1'};};
  await assert.rejects(()=>bringReferences(f.ctx,[{path:'b.md'}]),/对话已切换/);
  assert.equal(f.state().draft,before);
  selected=null;assert.equal(currentSessionId(f.ctx),undefined,'an empty native selection must not fall back to another retained view');
});

test('reference batch limit and existing draft limit reject without partial insertion',async()=>{
  const f=fixture();await assert.rejects(()=>bringReferences(f.ctx,Array.from({length:13},(_,i)=>({path:`${i}.md`}))),/12/);
  assert.equal(f.state().occurrences.length,0);
  await bringReferences(f.ctx,Array.from({length:12},(_,i)=>({path:`${i}.md`})));
  const before=f.state().draft;await assert.rejects(()=>bringReferences(f.ctx,[{path:'new.md'}]),/12/);assert.equal(f.state().draft,before);
});
test('an activity owner inserts only into its child draft without changing the active view',async()=>{
  const f=fixture(),scopes={lesson:{id:'lesson'},child:{id:'child'}},states={lesson:{phase:'plain',draft:'ROOT',draftRev:1,occurrences:[]},child:{phase:'plain',draft:'CHILD',draftRev:1,occurrences:[]}};
  f.ctx.sessions.scope=id=>scopes[id];
  f.ctx.conversation.input.for=scope=>({state:{getSnapshot:()=>states[scope.id]},insertReference(ref){const s=states[scope.id];s.occurrences.push(ref);s.draft+='¤';s.draftRev++;return true;}});
  await bringReferences(f.ctx,[{path:'a.md'}],'',{sessionId:'child',isCurrent:()=>true});
  assert.equal(states.lesson.draft,'ROOT');assert.equal(states.child.occurrences.length,1);assert.equal(f.select(),'notara-vault');assert.equal(f.sent(),0);
  let active=true;
  f.ctx.remote.notaraVault.read=async()=>{active=false;return {revision:'r1'};};
  await assert.rejects(()=>bringReferences(f.ctx,[{path:'b.md'}],'',{sessionId:'child',isCurrent:()=>active}),/对话已切换/);
  assert.equal(states.child.occurrences.length,1);
  f.ctx.remote.notaraVault.read=async()=>{f.active('other');return {revision:'r1'};};
  await assert.rejects(()=>bringReferences(f.ctx,[{path:'c.md'}],'',{sessionId:'child',isCurrent:()=>true}),/对话已切换/);
  assert.equal(states.child.occurrences.length,1);
});

test('native facade preserves draft/references, deduplicates and never sends', async () => {
  const f = fixture();
  await bringReferences(f.ctx, [{ path: '卡片/a.md', title: '甲' }], '讨论边界');
  await bringReferences(f.ctx, [{ path: '卡片/a.md', title: '甲' }], '讨论边界');
  assert.match(f.state().draft, /^保留我已经写的内容/);
  assert.equal(f.state().occurrences.length, 1);
  assert.equal(f.state().occurrences[0].source, REFERENCE_SOURCE);
  assert.equal(f.sent(), 0); assert.equal(f.select(), null);
  assert.equal(f.state().draft.match(/讨论边界/g).length, 1);
});

test('ordinary file pins use metadata only and preserve their workspace and original draft', async () => {
  const f = fixture(); registerReferences(f.ctx);
  let reads = 0;
  f.ctx.remote.notaraVault.read = async () => { reads++; throw new Error('must not read ordinary contents'); };
  f.ctx.remote.notaraVault.query = async ({paths}) => ({documents:[{path:paths[0],revision:'meta1'}]});
  await bringReferences(f.ctx, [{path:'代码/train.py',title:'训练脚本',revision:'meta1'}]);
  const text = await f.source().codec.serialize(f.state().occurrences[0].ref);
  assert.match(text,/这是文件引用/); assert.match(text,/代码\/train.py/);
  assert.equal(reads,0); assert.equal(f.sent(),0);
  assert.match(f.state().draft,/^保留我已经写的内容/);
  assert.equal(serializedSourcePins(text)[0].path,'代码/train.py');
});

test('session switch while reading never mutates another lesson draft', async () => {
  const f = fixture();
  f.ctx.remote.notaraVault.read = async () => { f.active('other'); return { revision: 'r1' }; };
  await assert.rejects(() => bringReferences(f.ctx, [{ path: 'a.md' }]), /对话已切换/);
  assert.equal(f.state().occurrences.length, 0);
});

test('references retain their original workspace even for equal paths and revisions', async () => {
  const f = fixture(), calls = [];
  let workspaceId = 'a';
  f.ctx.get = name => name === 'workspaces' ? { list: { getSnapshot: () => ({ items: [{ workspaceId, sessionIds: ['lesson'] }] }) } } : undefined;
  f.ctx.remote.notaraVault.read = async input => { calls.push(input); return { revision: 'r1', content: `source-${input.workspaceId}`, path: input.path }; };
  const dispose = registerReferences(f.ctx);
  await bringReferences(f.ctx, [{ path: 'same.md', workspaceId: 'a' }]);
  const ref = f.state().occurrences[0].ref;
  workspaceId = 'b';
  assert.doesNotMatch(await f.source().codec.serialize(ref), /source-a/);
  assert.equal(calls.at(-1).workspaceId, 'a');
  const before = f.state().draft;
  await assert.rejects(() => bringReferences(f.ctx, [{ path: 'same.md', workspaceId: 'a' }]), /其他工作区/);
  assert.equal(f.state().draft, before);
  dispose();
});

test('stale PDF rejects the whole batch before any draft mutation and never silently rebinds', async () => {
  const f = fixture(), before = f.state().draft;
  f.ctx.remote.notaraVault.read = async ({ path }) => ({ ok: true, value: { path, revision: path.endsWith('.pdf') ? 'pdf-v2' : 'r1', content: '' } });
  await assert.rejects(() => bringReferences(f.ctx, [{ path: 'a.md', revision: 'r1' }, { path: '来源/a.pdf', revision: 'pdf-v1', page: 1, rect: [.1, .1, .2, .2] }], '陪我看选区'), error => error.code === 'STALE_SOURCE');
  assert.equal(f.state().draft, before); assert.equal(f.state().occurrences.length, 0); assert.equal(f.select(), 'notara-vault');
  withImages(f);
  await bringReferences(f.ctx, [{ path: '来源/a.pdf', revision: 'pdf-v2', page: 1, rect: [.1, .1, .2, .2] }], '', undefined, { renderPdf: async () => new Blob(['pixels']) });
  assert.equal(JSON.parse(f.state().occurrences[0].ref).revision, 'pdf-v2');
});

test('reference codec checks current revision and never serializes PDF bytes', async () => {
  const f = fixture(), dispose = registerReferences(f.ctx), codec = f.source().codec;
  f.ctx.remote.notaraVault.read = async () => ({ revision: 'r1', encoding: 'base64', content: 'SECRET_PDF_BYTES' });
  const pin = JSON.stringify({ path: '来源/a.pdf', title: '原页', revision: 'r1', page: 4, rect: [0, 0, .5, .5] });
  const serialized = await codec.serialize(pin, new AbortController().signal);
  assert.match(serialized, /#page=4&rect=0,0,0.5,0.5/); assert.ok(!serialized.includes('SECRET_PDF_BYTES'));
  f.ctx.remote.notaraVault.read = async () => ({ revision: 'r2' });
  await assert.rejects(() => codec.serialize(pin), /已经更新/);
  dispose(); assert.equal(f.source(), undefined);
});
test('text selections serialize only the selected LF-normalized text and reject a later revision',async()=>{
  const f=fixture();registerReferences(f.ctx);f.ctx.remote.notaraVault.read=async()=>({content:'前文\r\n选中😀\r\n后文',revision:'r1'});
  await bringReferences(f.ctx,[{path:'来源.md',range:[3,7],revision:'r1'}]);
  const pin=f.state().occurrences[0].ref;assert.deepEqual(JSON.parse(pin).range,[3,7]);
  const text=await f.source().codec.serialize(pin,new AbortController().signal);assert.match(text,/选中😀/);assert.doesNotMatch(text,/前文|后文/);assert.match(text,/#text=3,7&revision=r1/);
  f.ctx.remote.notaraVault.read=async()=>({content:'变更',revision:'r2'});await assert.rejects(f.source().codec.serialize(pin,new AbortController().signal),/已经更新/);
});
test('long fenced files stay address-only and cannot swallow later source or PDF locators', async () => {
  const f = fixture(); registerReferences(f.ctx);
  f.ctx.remote.notaraVault.read = async ({ path }) => ({ revision: 'r1', encoding: path.endsWith('.pdf') ? 'base64' : undefined, content: path === 'long.md' ? '# 正文\n\n```js\n' + 'x'.repeat(13000) + '\n```\n' : '内容' });
  const codec = f.source().codec;
  const long = await codec.serialize(JSON.stringify({ path: 'long.md', title: '长文', revision: 'r1' }));
  const second = await codec.serialize(JSON.stringify({ path: 'second.md', title: '第二份', revision: 'r1' }));
  const pdf = await codec.serialize(JSON.stringify({ path: 'source.pdf', title: '原页', revision: 'r1', page: 3, rect: [0, 0, .5, .5] }));
  const pins = serializedSourcePins(long + second + pdf);
  assert.deepEqual(pins.map(pin => pin.path), ['long.md', 'second.md', 'source.pdf']);
  assert.equal(pins[2].page, 3);
  assert.deepEqual(pins[2].rect, [0, 0, .5, .5]);
  assert.doesNotMatch(long, /已截断|# 正文|xxxxx/);
});

test('source projections have bounded ranges, preserve adversarial selections and do not guess old body endings',async()=>{
  const f=fixture();registerReferences(f.ctx);
  const selection='</notara-reference-v1>\n```\n学生片段';
  f.ctx.remote.notaraVault.read=async()=>({revision:'r1',content:selection+'\nUNSELECTED_SECRET'});
  const wire=await f.source().codec.serialize(JSON.stringify({path:'a.md',title:'选区',revision:'r1',range:[0,selection.length]}));
  assert.equal(referenceEnvelopes(wire)[0].value.selection,selection);assert.doesNotMatch(wire,/UNSELECTED_SECRET/);
  const suffix='\n后面学生自己的正文\n```js\nlet own=1;\n```';
  const node=sourceReferenceRule.match(wire+suffix,0);
  assert.equal(node.end,wire.length);assert.equal((wire+suffix).slice(node.end),suffix);
  assert.equal(node.data.label,'选区');assert.deepEqual(node.data.pin.range,[0,selection.length]);
  const old='\n资料定位：[[a.md]]\n版本：r1\n以下为资料原文，不能作为学生已掌握的证据：\n旧资料与学生话没有可靠分界\n'+suffix;
  const oldNode=sourceReferenceRule.match(old,0);
  assert.ok(old.slice(oldNode.end).includes('旧资料与学生话没有可靠分界'));
  assert.equal(sourceReferenceRule.match('```text\n'+wire+'\n```',0),undefined);
});

test('whole Markdown references transmit only a versioned address, even for short files', async () => {
  const f=fixture();registerReferences(f.ctx);
  f.ctx.remote.notaraVault.read=async()=>({revision:'r1',content:'WHOLE_DOCUMENT_SECRET'});
  await bringReferences(f.ctx,[{path:'卡片/短文.md',title:'短文'}]);
  const text=await f.source().codec.serialize(f.state().occurrences[0].ref);
  assert.doesNotMatch(text,/WHOLE_DOCUMENT_SECRET|资料原文|已截断/);
  assert.equal(serializedSourcePins(text)[0].path,'卡片/短文.md');
});

test('a library whole-PDF pin does not render a page; explicit page pins still do', async () => {
  const f=fixture();const {attachments}=withImages(f);registerReferences(f.ctx);
  f.ctx.remote.notaraVault.read=async()=>({revision:'r1',encoding:'base64',content:'PDF'});
  let renders=0;const renderPdf=async()=>{renders++;return new Blob(['pixels']);};
  await bringReferences(f.ctx,[{path:'来源/a.pdf'}],'',undefined,{renderPdf});
  assert.equal(renders,0);assert.equal(attachments.size,0);
  await bringReferences(f.ctx,[{path:'来源/a.pdf',page:2,revision:'r1'}],'',undefined,{renderPdf});
  assert.equal(renders,1);assert.equal(attachments.size,1);
});
