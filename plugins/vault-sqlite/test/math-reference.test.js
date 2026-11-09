import test from 'node:test';import assert from 'node:assert/strict';
import {drawingMathElement,mathElementId,mathElementSubpath,updateDrawingMath} from '../math-reference.js';
import {makeDrawingElements,mergeDrawingDocuments} from '../drawing-sync.js';
test('a math reference resolves exactly, preserves ink and cannot resurrect deleted or changed objects',()=>{
  const math={version:1,source:'point A = (0, 0) drag',values:{},drags:{}},[element]=makeDrawingElements([{kind:'math',x:0,y:0,math}],()=> 'math-1');
  const doc={type:'excalidraw',elements:[element,...makeDrawingElements([{kind:'text',x:800,y:0,text:'保留的笔迹'}],()=> 'ink')],files:{},appState:{}};
  assert.equal(mathElementId(mathElementSubpath('math-1')),'math-1');assert.equal(mathElementId('#标题'),null);assert.throws(()=>mathElementId('#element=%'),/invalid/);
  const next=updateDrawingMath(doc,'math-1',{...math,drags:{A:{x:1,y:2}}},math.source);assert.deepEqual(next.elements[1],doc.elements[1]);assert.equal(drawingMathElement(next,'math-1').customData.notaraMath.drags.A.x,1);
  assert.throws(()=>drawingMathElement(doc,'ink'),/missing/);assert.throws(()=>drawingMathElement({...doc,elements:[{...element,isDeleted:true}]},'math-1'),/missing/);
  assert.throws(()=>updateDrawingMath(doc,'math-1',math,'changed'),/changed/);
  const removed={...doc,elements:[{...element,isDeleted:true},doc.elements[1]]};assert.equal(mergeDrawingDocuments(doc,next,removed),null);
});
