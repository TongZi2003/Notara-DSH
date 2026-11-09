import test from 'node:test';
import assert from 'node:assert/strict';
import {mathDefinition,MATH_EXAMPLES} from '../src/domain/drawing-math.js';
import {splitDrawingBlocks} from '../src/drawing-blocks.js';
import {makeDrawingElements,mergeDrawingDocuments} from '../../vault-sqlite/drawing-sync.js';
import {mathSourceElement} from '../../vault-sqlite/drawing-math.js';
test('math definitions retain parameters, free points and 3D camera while rejecting scripts and answers',()=>{
  for(const source of Object.values(MATH_EXAMPLES))assert.ok(mathDefinition(source).spec.objects.length);
  assert.equal(mathDefinition(MATH_EXAMPLES['函数'],{values:{a:1.4}}).data.values.a,1.4);
  assert.equal(mathDefinition(MATH_EXAMPLES['平面几何'],{drags:{B:{x:5,y:1}}}).data.drags.B.x,5);
  assert.equal(mathDefinition(MATH_EXAMPLES['立体几何'],{camera:{yaw:1,pitch:.4,zoom:2}}).data.camera.zoom,2);
  assert.throws(()=>mathDefinition('function f(x) = fetch(x)'));
  assert.throws(()=>mathDefinition(MATH_EXAMPLES['函数']+'\nask point "answer"'));
  assert.throws(()=>mathDefinition(MATH_EXAMPLES['函数'],{values:{a:99}}));
});
test('render images normalize to mathematical source, and independent ink survives a math edit',()=>{
  const e=makeDrawingElements([{kind:'math',math:mathDefinition(MATH_EXAMPLES['函数']).data,x:0,y:0}],()=> 'm')[0];
  const normalized=mathSourceElement({...e,type:'image',fileId:'notara-math-render-hash',status:'saved',scale:[1,1],crop:null});assert.deepEqual(normalized,e);
  const transformed=mathSourceElement({...e,type:'image',fileId:'cache',status:'saved',scale:[-1,1],crop:{x:20,y:20,width:700,height:480,naturalWidth:760,naturalHeight:520}});
  assert.deepEqual(transformed.customData.notaraMathView.scale,[-1,1]);assert.equal(transformed.customData.notaraMathView.crop.width,700);
  const base={type:'excalidraw',elements:[e],files:{},appState:{}},local=structuredClone(base),remote=structuredClone(base);
  local.elements[0].customData.notaraMath.values.a=1.4;remote.elements.push(...makeDrawingElements([{kind:'line',x:0,y:0,points:[[0,0],[10,20]]}],()=> 'ink'));
  const merged=mergeDrawingDocuments(base,local,remote);assert.equal(merged.elements.length,2);assert.equal(merged.elements[0].customData.notaraMath.values.a,1.4);
});
test('drawing flow fences ignore code examples and conceal incomplete references',()=>{
  assert.equal(splitDrawingBlocks('Hello\n```drawing\ncall-1\n```\nNext')[1].callId,'call-1');
  assert.equal(splitDrawingBlocks('````md\n```drawing\ncall-1\n```\n````').length,1);
  assert.equal(splitDrawingBlocks('`drawing`').length,1);
  assert.equal(splitDrawingBlocks('```drawing\ncall')[0].callId,null);
});
