import test from 'node:test';
import assert from 'node:assert/strict';
import {EMPTY_DRAWING} from '../drawing-files.js';
import {validateDrawing,makeDrawingElements,mergeDrawingDocuments} from '../drawing-sync.js';
import {createMindmap,editMindmap,mindmapNode,mindmapOutline,visibleMindmapElements,repairMindmap} from '../drawing-mindmap.js';
let count=0;const id=()=>`m-${++count}`,empty=()=>JSON.parse(EMPTY_DRAWING),outline='- 导数压轴题\n  - 单调性\n    - 定义域\n    - 导函数符号\n  - 零点\n    - 存在性\n    - 唯一性';
const nodes=doc=>doc.elements.filter(e=>!e.isDeleted&&e.customData?.notaraMindmap);
test('mindmap uses native bound shapes and arrows and round-trips a Markdown tree',()=>{
  const {doc,nodeId}=createMindmap(empty(),outline,{x:100,y:150,id});validateDrawing(doc);assert.equal(nodes(doc).length,7);assert.equal(mindmapOutline(doc,nodeId),outline);assert.ok(doc.elements.some(e=>e.type==='arrow'&&e.startBinding&&e.endBinding));
  const overlaps=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;for(const a of nodes(doc))for(const b of nodes(doc))if(a!==b)assert.equal(overlaps(a,b),false);
});
test('child/sibling insertion, manual pin and layout retain unrelated ink',()=>{
  const ink=makeDrawingElements([{kind:'text',x:1100,y:800,text:'学生手写保留'}],id)[0],created=createMindmap({...empty(),elements:[ink]},outline,{x:0,y:0,id});
  let doc=created.doc,root=created.nodeId,child=nodes(doc).find(e=>e.customData.notaraMindmap.parent===root);doc=editMindmap(doc,child.id,{type:'child',text:'关键条件',id}).doc;assert.ok(mindmapOutline(doc,root).includes('关键条件'));
  const before=doc.elements.find(e=>e.id===child.id);doc=editMindmap(doc,child.id,{type:'pin'}).doc;doc=editMindmap(doc,child.id,{type:'sibling',text:'极值',id}).doc;doc=editMindmap(doc,root,{type:'layout'}).doc;
  assert.equal(doc.elements.find(e=>e.id===child.id).x,before.x);assert.equal(doc.elements.find(e=>e.id===child.id).y,before.y);assert.deepEqual(doc.elements.find(e=>e.id===ink.id),ink);validateDrawing(doc);
});
test('fold is reversible visibility, preserves source nodes, custom style and nested folds',()=>{
  const made=createMindmap(empty(),outline,{id});let doc=made.doc;const root=made.nodeId,child=nodes(doc).find(e=>e.customData.notaraMindmap.parent===root),grandchild=nodes(doc).find(e=>e.customData.notaraMindmap.parent===child.id);grandchild.opacity=65;
  doc=editMindmap(doc,child.id,{type:'fold'}).doc;assert.equal(doc.elements.find(e=>e.id===grandchild.id).opacity,0);assert.equal(doc.elements.find(e=>e.id===grandchild.id).isDeleted,false);assert.equal(mindmapOutline(doc,root),outline);validateDrawing(doc);
  doc=editMindmap(doc,root,{type:'fold'}).doc;doc=editMindmap(doc,root,{type:'fold'}).doc;assert.equal(visibleMindmapElements(doc.elements).some(e=>e.id===grandchild.id),false);
  doc=editMindmap(doc,child.id,{type:'fold'}).doc;assert.equal(doc.elements.find(e=>e.id===grandchild.id).opacity,65);assert.equal(nodes(doc).length,7);validateDrawing(doc);
});
test('branch deletion, stale ids and invalid outline are bounded; independent teacher ink merges',()=>{
  const made=createMindmap(empty(),outline,{id}),base=made.doc,child=nodes(base).find(e=>e.customData.notaraMindmap.parent===made.nodeId);
  const local=editMindmap(base,child.id,{type:'remove'}).doc;validateDrawing(local);assert.equal(nodes(local).length,4);assert.equal(mindmapNode(local,child.id),null);assert.throws(()=>editMindmap(local,child.id,{type:'child',text:'stale',id}));
  const teacher=makeDrawingElements([{kind:'text',x:1200,y:100,text:'老师补充'}],id)[0],merged=mergeDrawingDocuments(base,local,{...base,elements:[...base.elements,teacher]});assert.ok(merged);assert.ok(merged.elements.some(e=>e.id===teacher.id));
  assert.throws(()=>createMindmap(base,'- root\n      - skipped',{id}));assert.throws(()=>createMindmap(base,'- root\n- another root',{id}));assert.throws(()=>createMindmap(base,'- '+ 'x'.repeat(201),{id}));
});
test('native deletion releases hidden orphan branches, undo restores them, cross-links detach safely',()=>{
  const made=createMindmap(empty(),outline,{id}),root=made.nodeId;let doc=editMindmap(made.doc,root,{type:'fold'}).doc;
  const deleted=structuredClone(doc);for(const e of deleted.elements)if(e.id===root||e.containerId===root)e.isDeleted=true;
  const repaired=repairMindmap(deleted);assert.ok(visibleMindmapElements(repaired.elements).some(e=>metaRoot(e)));validateDrawing(repaired);
  const restored=repairMindmap({...repaired,elements:repaired.elements.map(e=>e.id===root||e.containerId===root?doc.elements.find(n=>n.id===e.id):e)});assert.equal(mindmapOutline(restored,root),outline);assert.equal(nodes(restored).filter(n=>n.customData.notaraMindmapHidden).length,6);validateDrawing(restored);
  const line=makeDrawingElements([{kind:'arrow',x:0,y:0,points:[[0,0],[100,0]]}],id)[0];line.endBinding={elementId:root,focus:0,gap:8};const withLink={...made.doc,elements:[...made.doc.elements,line]},removed=editMindmap(withLink,root,{type:'remove'}).doc;assert.equal(removed.elements.find(e=>e.id===line.id).endBinding,null);assert.equal(removed.elements.find(e=>e.id===line.id).isDeleted,false);validateDrawing(removed);
});
const metaRoot=e=>e.customData?.notaraMindmap?.parent===null;
