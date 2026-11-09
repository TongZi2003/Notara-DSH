import test from 'node:test';
import assert from 'node:assert/strict';
import { appendCanvasBlock, growCanvasBlock, mergeCanvasDocuments, overlaps } from '../canvas-flow.js';
const empty=()=>({nodes:[],edges:[],custom:'keep'});
const append=(doc,id,extra={})=>appendCanvasBlock(doc,{id,title:id,body:'正文',...extra});
test('continuation follows the last block, avoids manual obstacles and preserves previous coordinates',()=>{
  let doc=append(empty(),'a');
  const first={...doc.nodes[0]};
  doc.nodes.push({id:'manual',type:'text',x:first.x,y:first.y+first.height+28,width:480,height:400,text:'学生笔记'});
  doc=append(doc,'b');doc=append(doc,'c');
  assert.deepEqual(doc.nodes[0],first);
  for(let i=0;i<doc.nodes.length;i++)for(let j=i+1;j<doc.nodes.length;j++)assert.equal(overlaps(doc.nodes[i],doc.nodes[j]),false);
  assert.equal(doc.custom,'keep');
});
test('measured growth moves downstream flow, never pinned blocks or previous blocks',()=>{
  let doc=append(append(append(empty(),'a'),'b'),'c');
  doc.nodes.push({id:'pinned',type:'text',x:0,y:1200,width:480,height:200,text:'手动'});
  const pin={...doc.nodes.at(-1)},a={...doc.nodes[0]};
  doc=growCanvasBlock(doc,'b',1400);
  assert.deepEqual(doc.nodes[0],a);assert.deepEqual(doc.nodes.at(-1),pin);
  const b=doc.nodes.find(n=>n.id==='b'),c=doc.nodes.find(n=>n.id==='c');
  assert.equal(overlaps(b,pin),false);assert.equal(overlaps(b,c),false);assert.ok(c.y>b.y);
});
test('merge preserves unsaved student text and position while accepting new teacher blocks',()=>{
  const base=append(empty(),'a'),local=structuredClone(base);
  local.nodes[0].text+=' 学生补充';local.nodes[0].x=700;local.nodes[0].notaraFlow.pinned=true;
  const remote=append(base,'b'),merged=mergeCanvasDocuments(base,local,remote);
  assert.ok(merged);assert.equal(merged.nodes[0].text,local.nodes[0].text);assert.equal(merged.nodes[0].x,700);
  assert.equal(merged.nodes[1].x,700);assert.equal(merged.nodes[0].notaraFlow.pinned,true);
  const conflict=structuredClone(base);conflict.nodes[0].text='老师纠错';
  assert.equal(mergeCanvasDocuments(base,local,conflict),null);
});
test('beside placement preserves a pair and subsequent continuation goes below it',()=>{
  let doc=append(empty(),'a');doc=append(doc,'b',{after:'a',placement:'beside'});doc=append(doc,'c');
  assert.equal(doc.nodes[0].y,doc.nodes[1].y);assert.ok(doc.nodes[1].x>doc.nodes[0].x);assert.ok(doc.nodes[2].y>doc.nodes[1].y);
});
test('an anchored addition crossing a group boundary must avoid the group, not inherit stale containment',()=>{
  const doc={nodes:[{id:'group',type:'group',x:0,y:0,width:530,height:900},{id:'a',type:'text',text:'a',x:0,y:0,width:200,height:200}],edges:[]};
  const next=append(doc,'b',{after:'a',placement:'beside'}),b=next.nodes.at(-1);
  assert.equal(overlaps(b,doc.nodes[0]),false);assert.ok(b.y>=928);
});
test('a student deleting the incoming addition anchor produces a conflict, not a guessed position',()=>{
  const base=append(empty(),'a'),local={...base,nodes:[]},remote=append(base,'b',{after:'a'});
  assert.equal(mergeCanvasDocuments(base,local,remote),null);
});
test('a teaching append can reference the shared drawing without copying it or auto-growing its container',()=>{
  const next=appendCanvasBlock(empty(),{id:'shared',file:'白板/共绘.excalidraw'});assert.equal(next.nodes[0].type,'file');assert.equal(next.nodes[0].file,'白板/共绘.excalidraw');assert.equal(next.nodes[0].notaraFlow.autoHeight,false);
  assert.throws(()=>appendCanvasBlock(empty(),{id:'bad',file:'白板/共绘.excalidraw',body:'duplicate'}),/不能同时/);
});
test('Canvas references one native math element without a second definition',()=>{
  const next=appendCanvasBlock(empty(),{id:'math',file:'白板/共绘.excalidraw',mathElementId:'math-1'});assert.equal(next.nodes[0].subpath,'#element=math-1');assert.equal(next.nodes[0].text,undefined);
  assert.throws(()=>appendCanvasBlock(empty(),{id:'bad',body:'body',title:'wrong',mathElementId:'math-1'}),/reference_invalid/);
});
