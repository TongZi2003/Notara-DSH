import test from 'node:test';
import assert from 'node:assert/strict';
import {executeDrawing} from '../drawing-tool.js';
import {drawingBounds,makeDrawingElements} from '../../vault-sqlite/drawing-sync.js';
test('teacher searches and inserts native and SVG library assets without replacing student ink',async()=>{
  const student=makeDrawingElements([{kind:'rectangle',x:0,y:0,width:200,height:100}],()=> 'student')[0];
  let record={revision:'r1',content:JSON.stringify({type:'excalidraw',elements:[student],appState:{}})};
  const ctx={agentPresets:{composedPreset:()=> 'teacher'},workspaceRegistry:{resolveByPath:async()=>({id:'workspace'})},notaraVault:{read:async()=>record,drawingCommit:async args=>{assert.equal(args.respectActivity,true);assert.equal(args.base,record.content);record={revision:'r2',content:args.content};return record;}}};
  const exec={agent:{id:'a',ctx:{},session:{header:{cwd:'/fixture'}}},signal:new AbortController().signal,callId:'draw-library'};
  const found=JSON.parse((await executeDrawing(ctx,'teacher',{action:'library',query:'三角形'},exec)).result);assert.equal(found.items.length,3);
  await executeDrawing(ctx,'teacher',{action:'draw',path:'图.excalidraw',expectedRevision:'r1',after:'student',shapes:[{kind:'library',libraryId:found.items[0].id,x:0,y:0},{kind:'library',libraryId:'physics-circuits/and-gate',x:150,y:0}]},exec);
  const first=JSON.parse(record.content);assert.equal(Object.keys(first.files).length,1);assert.ok(first.elements.some(e=>e.type==='image'));
  assert.deepEqual(first.elements[0],student);assert.ok(drawingBounds(first.elements.slice(1)).y>=132,'negative local points must still clear the student drawing');
  const before=first.elements.map(e=>structuredClone(e));
  await executeDrawing(ctx,'teacher',{action:'draw',path:'图.excalidraw',expectedRevision:'r2',after:first.elements[0].id,shapes:[{kind:'library',libraryId:found.items[0].id,x:0,y:0}]},{...exec,callId:'next-library'});
  const later=JSON.parse(record.content);assert.deepEqual(later.elements.slice(0,before.length),before);assert.equal(new Set(later.elements.map(e=>e.id)).size,later.elements.length);
  await assert.rejects(executeDrawing(ctx,'teacher',{action:'draw',path:'图.excalidraw',expectedRevision:'r1',shapes:[{kind:'library',libraryId:found.items[0].id,x:0,y:0}]},{...exec,callId:'stale'}),/revision_conflict/);
});
test('teacher read never pairs one revision of elements with a newer PNG',async()=>{
  let images=0,previewRevision='r2';
  const ctx={agentPresets:{composedPreset:()=> 'teacher'},workspaceRegistry:{resolveByPath:async()=>({id:'workspace'})},notaraVault:{read:async()=>({revision:'r1',content:'{"type":"excalidraw","elements":[],"files":{}}'}),drawingPreview:async()=>({revision:previewRevision,png:'iVBORw0KGgo=',busyIds:[]})},get(name){return name==='attachments'?{saveImage:async()=>{images++;return {id:'image'};}}:{resolveModelInfo:async()=>({inputModalities:['image']})};}};
  const exec={agent:{id:'a',ctx:{},session:{header:{cwd:'/fixture'}},options:{provider:'test',model:'test'}},signal:new AbortController().signal,callId:'read'};
  const before=await executeDrawing(ctx,'teacher',{action:'read',path:'图.excalidraw'},exec);assert.equal(before.image,undefined);assert.equal(images,0);
  previewRevision='r1';const current=await executeDrawing(ctx,'teacher',{action:'read',path:'图.excalidraw'},exec);assert.ok(current.image);assert.equal(images,1);
});
