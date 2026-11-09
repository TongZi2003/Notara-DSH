import test from 'node:test';import assert from 'node:assert/strict';
import {canvasFigures,canvasFigureState,figureStateKey,updateCanvasFigureNode} from '../src/domain/figure-state.js';
import {MATH_EXAMPLES} from '../src/domain/drawing-math.js';
const fence=s=>'```figure\n'+s+'\n```';
test('Canvas figure state binds to occurrence and definition, without copying answers into the file',()=>{
  const source=MATH_EXAMPLES['圆与切线'],node={id:'node',text:fence(source)+'\n\n'+fence(source)};
  const [a,b]=canvasFigures(node.text);assert.notEqual(figureStateKey(a),figureStateKey(b));
  const next=updateCanvasFigureNode(node,figureStateKey(a),{drags:{P:{x:1,y:2,position:.2},A:{x:1,y:1}}});
  assert.equal(next.notaraFigures[figureStateKey(a)].drags.P.position,.2);assert.equal(next.notaraFigures[figureStateKey(b)],undefined);assert.equal(node.notaraFigures,undefined);
  assert.throws(()=>updateCanvasFigureNode({...node,text:fence(source.replace('(6, 0)','(5, 0)'))},figureStateKey(a),{}),/changed/);
  assert.equal(canvasFigures(fence(source+'\nask drag P "移动"')).length,0);assert.equal(canvasFigures('## 教师参考\n'+fence(source)).length,0);
  assert.throws(()=>updateCanvasFigureNode(node,figureStateKey(a),{drags:{P:{x:NaN,y:2}}}),/invalid/);
  const second=updateCanvasFigureNode(next,figureStateKey(b),{drags:{A:{x:4,y:4}}}),removed={...second,text:fence(source)};
  assert.deepEqual(canvasFigureState(removed),{},'a remaining duplicate cannot inherit the deleted occurrence');
  const fresh=updateCanvasFigureNode(removed,figureStateKey(a),{values:{}});assert.deepEqual(fresh.notaraFigures[figureStateKey(a)].drags,{});
});
test('Canvas saves parameter values and spatial camera independently of question drafts',()=>{
  const node={id:'space',text:fence(MATH_EXAMPLES['立体几何'])},[c]=canvasFigures(node.text),key=figureStateKey(c);
  const next=updateCanvasFigureNode(node,key,{values:{h:2.5},camera:{yaw:1,pitch:.4,zoom:1.3}});assert.equal(next.notaraFigures[key].camera.yaw,1);assert.equal(next.notaraFigures[key].values.h,2.5);
});
