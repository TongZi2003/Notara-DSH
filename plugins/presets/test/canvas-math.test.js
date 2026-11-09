import test from 'node:test';import assert from 'node:assert/strict';
import {executeCanvas} from '../canvas-tool.js';
test('standalone Canvas writes do not acquire the new optional binding-storage prerequisite',async()=>{
 let saved=false;
 const ctx={get:()=>undefined,agentPresets:{composedPreset:()=> 'notara-teacher'},workspaceRegistry:{resolveByPath:async()=>({id:'ws'})},notaraVault:{whiteboards:{saveCanvas(){throw Error('binding storage must not be required');}},read:async()=>({content:'{"nodes":[],"edges":[]}',revision:'r1'}),save:async()=>{saved=true;return {revision:'r2'};}}};
 await executeCanvas(ctx,'notara-teacher',{action:'append',path:'独立资料.canvas',expectedRevision:'r1',title:'资料',body:'正文'},{agent:{id:'teacher',ctx:{},session:{header:{cwd:'/fixture'}}},callId:'new',signal:new AbortController().signal});
 assert.equal(saved,true);
});
test('Canvas tool binds the exact math object in its own workspace before saving the reference',async()=>{
  const reads=[],saves=[],ctx={agentPresets:{composedPreset:()=> 'teacher'},workspaceRegistry:{resolveByPath:async()=>({id:'workspace-a'})},notaraVault:{read:async args=>{reads.push(args);return args.path.endsWith('.canvas')?{revision:'r1',content:'{"nodes":[],"edges":[]}'}:{revision:'r1',content:JSON.stringify({type:'excalidraw',elements:[{id:'math',type:'embeddable',customData:{notaraMath:{source:'point A = (0, 0)'}}},{id:'ink',type:'text'}]})};},save:async args=>{saves.push(args);return {revision:'r2'};}}},exec={agent:{id:'a',ctx:{},session:{header:{cwd:'/fixture'}}},callId:'append-math',signal:new AbortController().signal};
  await executeCanvas(ctx,'teacher',{action:'append',path:'课堂.canvas',file:'图.excalidraw',mathElementId:'math',expectedRevision:'r1'},exec);
  assert.ok(reads.every(r=>r.workspaceId==='workspace-a'));assert.equal(JSON.parse(saves[0].content).nodes[0].subpath,'#element=math');assert.equal(saves[0].expectedRevision,'r1');
  await assert.rejects(executeCanvas(ctx,'teacher',{action:'append',path:'课堂.canvas',file:'图.excalidraw',mathElementId:'ink',expectedRevision:'r1'},exec),/missing/);assert.equal(saves.length,1);
});
