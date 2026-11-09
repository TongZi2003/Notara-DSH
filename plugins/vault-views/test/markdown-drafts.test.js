import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarkdownDraft } from '../src/markdown-drafts.js';
import { preserveDraftCopy } from '../src/document-recovery.js';
import { appendCanvasBlock } from '../../vault-sqlite/canvas-flow.js';
import {makeDrawingElements} from '../../vault-sqlite/drawing-sync.js';
test('drawing conflict remains locked across polls and in-flight save receipts until explicitly resolved',async()=>{
  const base={type:'excalidraw',version:2,elements:makeDrawingElements([{kind:'rectangle',x:0,y:0}],()=> 'a'),files:{},appState:{}};
  const record={path:'画图.excalidraw',content:JSON.stringify(base),revision:'v1'},local=structuredClone(base);local.elements[0].x=25;
  const remote=structuredClone(base);remote.elements[0].x=100;
  const conflict={...record,content:JSON.stringify(remote),revision:'v2'},draft=createMarkdownDraft(record);
  draft.edit(JSON.stringify(local),{share:true,conflict});remote.elements.push(makeDrawingElements([{kind:'ellipse',x:300,y:0}],()=> 'b')[0]);
  draft.receive({...record,content:JSON.stringify(remote),revision:'v3'});assert.equal(draft.getSnapshot().conflict.revision,'v3');assert.equal(JSON.parse(draft.getSnapshot().text).elements[0].x,25);
  let saved=false;assert.equal(await draft.save({drawingCommit:()=>{saved=true;}}),null);assert.equal(saved,false);
  const pending=createMarkdownDraft(record);pending.edit(JSON.stringify(local),{share:true});let release;const saving=pending.save({drawingCommit:()=>new Promise(resolve=>release=resolve)});
  local.elements[0].x=40;pending.edit(JSON.stringify(local),{share:true,conflict});release({ok:true,value:{content:JSON.stringify(base),revision:'v4'}});await saving;assert.ok(pending.getSnapshot().conflict);assert.equal(JSON.parse(pending.getSnapshot().text).elements[0].x,40);
});
test('Canvas receives teacher additions without losing unsaved student edits; competing text remains a conflict',()=>{
  const base=appendCanvasBlock({nodes:[],edges:[]},{id:'a',title:'题设',body:'x'});
  const record={path:'板书.canvas',content:JSON.stringify(base),revision:'v1'};
  const draft=createMarkdownDraft(record),local=structuredClone(base);local.nodes[0].x=800;local.nodes[0].notaraFlow.pinned=true;local.nodes[0].text+=' 我的理解';draft.edit(JSON.stringify(local));
  const next=appendCanvasBlock(base,{id:'b',title:'第一步',body:'y',after:'a'});
  draft.receive({...record,revision:'v2',content:JSON.stringify(next)});
  const merged=JSON.parse(draft.getSnapshot().text);
  assert.equal(merged.nodes.length,2);assert.equal(merged.nodes[0].x,800);assert.equal(merged.nodes[1].x,800);assert.ok(merged.nodes[0].text.endsWith('我的理解'));
  assert.equal(draft.getSnapshot().conflict,null);assert.equal(draft.getSnapshot().baseRevision,'v2');
  next.nodes[0].text='老师纠正';draft.receive({...record,revision:'v3',content:JSON.stringify(next)});
  assert.equal(draft.getSnapshot().conflict.revision,'v3');assert.deepEqual(JSON.parse(draft.getSnapshot().text),merged);
});
const record = { path: '文档.md', content: '# 初稿\r\n正文\r\n', revision: 'v1' };
function storage() { const values = new Map(); return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; }
test('an unmergeable native drawing preserves both drafts through reload, polling and copy recovery',async()=>{
  const record={path:'board.excalidraw',content:'latest shared drawing',revision:'v1'},cache=storage(),draft=createMarkdownDraft(record,{key:'conflict',storage:cache});
  draft.edit(record.content,{conflict:{...record,rejectedNativeContent:'native unsaved drawing'}});
  const restored=createMarkdownDraft(record,{key:'conflict',storage:cache});assert.equal(restored.getSnapshot().conflict.rejectedNativeContent,'native unsaved drawing');
  restored.receive({...record,content:'newer shared drawing',revision:'v2'});assert.equal(restored.getSnapshot().text,record.content);assert.equal(restored.getSnapshot().conflict.rejectedNativeContent,'native unsaved drawing');
  const copies=[];await preserveDraftCopy(restored,{save:async data=>{copies.push(data);return {revision:'copy'};},read:async()=>({...record,content:'newer shared drawing',revision:'v2'})},record.path);
  assert.deepEqual(copies.map(c=>c.content),['latest shared drawing','native unsaved drawing']);assert.equal(restored.getSnapshot().text,'newer shared drawing');assert.equal(restored.getSnapshot().conflict,null);
});
test('a failed in-flight save cannot discard a newer rejected native drawing',async()=>{
  const record={path:'board.excalidraw',content:'base',revision:'v1'},cache=storage(),draft=createMarkdownDraft(record,{key:'race',storage:cache});draft.edit('submitted');
  let reject;const saving=draft.save({drawingCommit:()=>new Promise((_,r)=>reject=r),read:async()=>({...record,content:'remote',revision:'v2'})});
  draft.edit('newest shared draft',{conflict:{...record,rejectedNativeContent:'unmerged native ink'}});reject(Error('drawing_conflict'));await saving;
  assert.equal(draft.getSnapshot().text,'newest shared draft');assert.equal(draft.getSnapshot().conflict.rejectedNativeContent,'unmerged native ink');
  const restored=createMarkdownDraft({...record,content:'remote',revision:'v2'},{key:'race',storage:cache});assert.equal(restored.getSnapshot().conflict.rejectedNativeContent,'unmerged native ink');
});
test('layout-only autosave eligibility belongs to the shared draft, and any human edit revokes it',async()=>{
  const draft=createMarkdownDraft(record),seen=[];draft.subscribe(()=>seen.push(draft.getSnapshot().layoutOnly));
  draft.edit('layout',{layout:true});assert.equal(draft.getSnapshot().layoutOnly,true);
  await draft.save({save:async()=>({ok:true,value:{revision:'v2'}})});assert.equal(draft.getSnapshot().layoutOnly,false);
  draft.edit('human from another view');draft.edit('layout after human',{layout:true});assert.equal(draft.getSnapshot().layoutOnly,false);
  assert.ok(seen.includes(true));assert.equal(seen.at(-1),false);
});
test('a late poll from another view cannot roll back an already received external version',()=>{
  const draft=createMarkdownDraft(record),generation=draft.getSnapshot().generation;
  draft.receive({...record,revision:'v3',content:'newest'},generation);
  draft.receive({...record,revision:'v2',content:'older'},generation);
  assert.equal(draft.getSnapshot().text,'newest');assert.equal(draft.getSnapshot().baseRevision,'v3');
});
test('save acknowledges only the submitted draft and preserves edits typed during the request', async () => {
  const cache = storage(), draft = createMarkdownDraft(record, { key: 'a', storage: cache });
  draft.edit('# 提交\r\n正文\r\n'); let finish, submitted;
  const saving = draft.save({ save(input) { submitted = input; return new Promise(resolve => { finish = resolve; }); } });
  draft.edit('# 后续修改\r\n正文\r\n'); finish({ ok: true, value: { revision: 'v2' } }); await saving;
  assert.equal(submitted.expectedRevision, 'v1'); assert.equal(submitted.content, '# 提交\r\n正文\r\n');
  assert.equal(draft.getSnapshot().text, '# 后续修改\r\n正文\r\n'); assert.equal(draft.getSnapshot().baseRevision, 'v2');
  assert.equal(createMarkdownDraft({ ...record, content: submitted.content, revision: 'v2' }, { key: 'a', storage: cache }).getSnapshot().text, '# 后续修改\r\n正文\r\n');
});
test('revision conflict retains the draft and requires an explicit save against the latest file', async () => {
  const draft = createMarkdownDraft(record); draft.edit('# 我的草稿\n');
  const latest = { ...record, content: '# 外部修改\n', revision: 'v2' };
  await draft.save({ save: async () => ({ ok: false, error: { code: 'vault_revision_conflict', message: 'changed' } }), read: async () => ({ ok: true, value: latest }) });
  assert.equal(draft.getSnapshot().text, '# 我的草稿\n'); assert.equal(draft.getSnapshot().conflict.revision, 'v2');
  let submitted; await draft.save({ save: async input => { submitted = input; return { ok: true, value: { revision: 'v3' } }; } }, true);
  assert.equal(submitted.expectedRevision, 'v2'); assert.equal(draft.getSnapshot().conflict, null);
});
test('storage keys isolate drafts with the same file name', () => {
  const cache = storage(), a = createMarkdownDraft(record, { key: 'workspace-a', storage: cache }); a.edit('甲');
  const b = createMarkdownDraft(record, { key: 'workspace-b', storage: cache }); assert.equal(b.getSnapshot().text, record.content);
  a.receive({ ...record, content: '磁盘新版本', revision: 'v2' }); assert.equal(a.getSnapshot().text, '甲'); assert.equal(a.getSnapshot().conflict.content, '磁盘新版本');
});
test('a delayed read from another tab cannot roll back an acknowledged save', async () => {
  const draft = createMarkdownDraft(record), readGeneration = draft.getSnapshot().generation;
  draft.edit('保存的新正文'); await draft.save({ save: async () => ({ ok: true, value: { revision: 'v2' } }) });
  draft.receive(record, readGeneration);
  assert.equal(draft.getSnapshot().text, '保存的新正文'); assert.equal(draft.getSnapshot().baseRevision, 'v2');
  draft.receive({ ...record, content: '保存之后的新外部版本', revision: 'v3' }, draft.getSnapshot().generation);
  assert.equal(draft.getSnapshot().text, '保存之后的新外部版本');
});
test('conflict copy recovery cannot erase edits made while saving the copy', async () => {
  const draft = createMarkdownDraft({ ...record, path: '白板.canvas' }); draft.edit('原来的草稿');
  const latest = { ...record, path: '白板.canvas', content: '文件外部版本', revision: 'v2' }; draft.receive(latest);
  let finish, copied;
  const recovering = preserveDraftCopy(draft, { save: input => { copied = input; return new Promise(resolve => { finish = resolve; }); }, read: async () => ({ ok: true, value: latest }) }, latest.path);
  draft.edit('恢复请求期间的新内容'); finish({ ok: true, value: { revision: 'copy1' } });
  const result = await recovering;
  assert.equal(result.loaded, false); assert.equal(copied.content, '原来的草稿'); assert.equal(copied.expectedRevision, null);
  assert.equal(draft.getSnapshot().text, '恢复请求期间的新内容'); assert.equal(draft.getSnapshot().conflict.content, latest.content);
  const stable = await preserveDraftCopy(draft, { save: async () => ({ ok: true, value: { revision: 'copy2' } }), read: async () => ({ ok: true, value: latest }) }, latest.path);
  assert.equal(stable.loaded, true); assert.equal(draft.getSnapshot().text, latest.content); assert.equal(draft.getSnapshot().conflict, null);
});
