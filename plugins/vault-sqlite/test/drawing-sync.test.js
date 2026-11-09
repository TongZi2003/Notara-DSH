import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {mergeDrawingDocuments,makeDrawingElements,validateDrawing,applyDrawingNativeDelta} from '../drawing-sync.js';
import {createVaultStore} from '../vault-indexer.js';
const empty=()=>({type:'excalidraw',version:2,elements:[],files:{},appState:{viewBackgroundColor:'#fff'}});
const shape=(id,x=0)=>makeDrawingElements([{kind:'rectangle',x,y:0,width:100,height:100}],()=>id)[0];
test('different drawing elements merge, same-element changes and delete/edit conflicts do not',()=>{
  const base={...empty(),elements:[shape('a'),shape('b',200)]},local=structuredClone(base),remote=structuredClone(base);
  local.elements[0].x=20;remote.elements[1].y=30;
  const merged=mergeDrawingDocuments(base,local,remote);assert.equal(merged.elements[0].x,20);assert.equal(merged.elements[1].y,30);
  remote.elements[0].x=40;assert.equal(mergeDrawingDocuments(base,local,remote),null);
  remote.elements[0]={...base.elements[0],isDeleted:true};assert.equal(mergeDrawingDocuments(base,local,remote),null);
});
test('deletion tombstones survive and duplicate IDs/dangling bindings are rejected',()=>{
  const a=shape('a'),base={...empty(),elements:[a]},deleted={...base,elements:[{...a,isDeleted:true}]};
  assert.equal(mergeDrawingDocuments(base,base,deleted).elements[0].isDeleted,true);
  assert.throws(()=>validateDrawing({...base,elements:[a,a]}),/duplicate/);
  assert.throws(()=>validateDrawing({...base,elements:[{...a,containerId:'missing'}]}),/binding/);
});
test('native edits rebase over a teacher addition received while the hand is busy',()=>{
  const native={...empty(),elements:[shape('student')]},latest=structuredClone({...native,elements:[...native.elements,shape('teacher',200)]});
  const next=structuredClone(native);next.elements[0].width=180;
  const conflicts=[],merged=mergeDrawingDocuments(native,next,latest,conflicts);
  assert.deepEqual(merged.elements.map(e=>e.id),['student','teacher']);assert.equal(merged.elements[0].width,180);assert.deepEqual(conflicts,[]);
  latest.elements[0].width=220;const same=[];const preserved=mergeDrawingDocuments(native,next,latest,same);assert.ok(same.length);assert.equal(preserved.elements[0].width,180);assert.ok(preserved.elements.some(e=>e.id==='teacher'));
});
test('local layer order persists and independent additions remain present',()=>{
  const base={...empty(),elements:[shape('a'),shape('b')]},local={...base,elements:[base.elements[1],base.elements[0]]};
  assert.deepEqual(mergeDrawingDocuments(base,local,base).elements.map(e=>e.id),['b','a']);
  const remote={...base,elements:[...base.elements,shape('c')]};assert.ok(mergeDrawingDocuments(base,local,remote).elements.some(e=>e.id==='c'));
});
test('renderer-assigned fractional indices do not cause a false conflict on the first student move',()=>{
  const stored={...empty(),elements:[shape('a')]},native=structuredClone(stored);native.elements[0].index='a0';const moved=structuredClone(native);moved.elements[0].x=80;
  const conflicts=[],result=mergeDrawingDocuments(native,moved,stored,conflicts);assert.equal(result.elements[0].x,80);assert.deepEqual(conflicts,[]);
});
test('native text metrics and binding defaults are not mistaken for a simultaneous teacher edit',()=>{
  const source={...empty(),elements:makeDrawingElements([{kind:'text',x:0,y:0,text:'老师的文字'}],()=> 't')},native=structuredClone(source);
  native.elements[0].index='a0';native.elements[0].boundElements=[];native.elements[0].width=210;
  const moved=structuredClone(native);moved.elements[0].x=80;
  const edited=applyDrawingNativeDelta(source,native,moved),conflicts=[],merged=mergeDrawingDocuments(source,edited,source,conflicts);
  assert.equal(merged.elements[0].x,80);assert.deepEqual(conflicts,[]);
});
test('duplicating a shape preserves its native insertion layer between existing elements',()=>{
  const source={...empty(),elements:[shape('a'),shape('b')]},after={...source,elements:[source.elements[0],shape('copy'),source.elements[1]]};
  const edited=applyDrawingNativeDelta(source,source,after),merged=mergeDrawingDocuments(source,edited,source);
  assert.deepEqual(merged.elements.map(e=>e.id),['a','copy','b']);
});
test('drawing commits commute across revisions, protect active edits and reject stale element edits',async t=>{
  const root=mkdtempSync(join(tmpdir(),'drawing-sync-')),store=createVaultStore({root,cachePath:':memory:'});t.after(async()=>{await store.close();rmSync(root,{recursive:true,force:true});});
  const path='共绘.excalidraw',base={...empty(),elements:[shape('a')]};store.save({path,content:JSON.stringify(base),expectedRevision:null});
  const before=store.read({path}),one={...base,elements:[...base.elements,shape('b')]},two={...base,elements:[...base.elements,shape('c')]};
  store.drawingCommit({path,base:before.content,content:JSON.stringify(one)});
  const merged=store.drawingCommit({path,base:before.content,content:JSON.stringify(two)});assert.equal(JSON.parse(merged.content).elements.length,3);
  store.drawingActivity({path,clientId:'student',elementIds:['a']});
  const changed=JSON.parse(merged.content);changed.elements[0].x=80;
  assert.throws(()=>store.drawingCommit({path,base:merged.content,content:JSON.stringify(changed),respectActivity:true}),/drawing_busy/);
  store.drawingActivity({path,clientId:'student',elementIds:[]});
  store.drawingCommit({path,base:merged.content,content:JSON.stringify(changed),respectActivity:true});
  changed.elements[0].x=100;assert.throws(()=>store.drawingCommit({path,base:merged.content,content:JSON.stringify(changed)}),/drawing_conflict/);
});
