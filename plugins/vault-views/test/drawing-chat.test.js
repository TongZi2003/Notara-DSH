import test from 'node:test';
import assert from 'node:assert/strict';
import {findDrawingSnapshot} from '../src/drawing-chat-model.js';
const snapshot={version:1,sourceSessionId:'a',workspaceId:'wa',path:'白板.excalidraw',revision:'revision-a',content:JSON.stringify({type:'excalidraw',elements:[],files:{}})};
const result={kind:'tool-result',callId:'draw-a',seq:8,isError:false,meta:{notaraDrawing:snapshot}};
test('chat drawings resolve immutable native results only, respecting message order',()=>{
  const nodes=[{data:{root:result}}];assert.equal(findDrawingSnapshot(nodes,'draw-a',10),snapshot);
  assert.equal(findDrawingSnapshot(nodes,'draw-a',7),null);assert.equal(findDrawingSnapshot(nodes,'missing'),null);
  assert.equal(findDrawingSnapshot([{data:{root:{...result,isError:true}}}],'draw-a'),null);
  assert.equal(findDrawingSnapshot([{data:{root:{...result,meta:{notaraDrawing:{...snapshot,path:'../other.excalidraw'}}}}}],'draw-a'),null);
});
