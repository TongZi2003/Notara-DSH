import test from 'node:test';
import assert from 'node:assert/strict';
import { graphCandidates, nodesInBox, mergeSelection, createGraphSelectionStore, GRAPH_SELECTION_LIMIT } from '../src/graph-selection.js';
import {projectGraph} from '../src/graph.js';
const relatedNodes=(graph,roots,hops)=>projectGraph(graph,roots,[],hops).nodes;
const nodes=[['a','concept'],['b','source'],['c','method'],['d','exercise'],['e','file']].map(([path,type])=>({path:path+'.md',title:path,type,tags:[]}));
const graph={nodes,edges:[['a','b'],['b','c'],['c','d'],['d','b'],['d','e']].map(([s,t])=>({source:s+'.md',target:t+'.md'}))};
test('related candidates expand by shortest distance, in either direction, without repeats',()=>{
  assert.deepEqual(relatedNodes(graph,['a.md'],1).map(n=>n.path),['a.md','b.md']);
  assert.deepEqual(relatedNodes(graph,['a.md'],2).map(n=>n.path),['a.md','b.md','c.md','d.md']);
  assert.equal(relatedNodes(graph,['a.md','b.md'],3).length,4);
  assert.deepEqual(relatedNodes(graph,['e.md'],1).map(n=>n.path),['d.md','e.md']);
  assert.equal(relatedNodes(graph,['missing.md'],3).length,0);
});
test('card types and literal search narrow candidates without changing related-node traversal',()=>{
  assert.deepEqual(graphCandidates(graph.nodes,'cards','').map(n=>n.path),['a.md','c.md','d.md']);
  assert.equal(graphCandidates(graph.nodes,'method','c').length,1);
  assert.equal(graphCandidates(graph.nodes,'concept','b').length,0);
  assert.equal(relatedNodes(graph,['a.md'],2).some(n=>n.type==='source'),true);
});
test('selection merges without duplication, and over-limit additions are rejected rather than truncated',()=>{
  const old=['a.md'];assert.deepEqual(mergeSelection(old,['a.md','b.md']),['a.md','b.md']);
  assert.throws(()=>mergeSelection(old,Array.from({length:GRAPH_SELECTION_LIMIT},(_,i)=>`${i}.md`)),/12/);
  assert.deepEqual(old,['a.md']);
});
test('marquee selection uses transformed node positions after pan and zoom',()=>{
  const placed=[{path:'a',x:20,y:30},{path:'b',x:70,y:30}];
  assert.deepEqual(nodesInBox(placed,{x:45,y:55,width:10,height:15},{x:10,y:0,scale:2}),['a']);
});
test('workspace selection notifies all retained graph surfaces and clears after its initiating surface unmounts',()=>{
  const a=createGraphSelectionStore(),b=createGraphSelectionStore();let first=0,second=0;
  const dispose=a.subscribe(()=>first++);a.subscribe(()=>second++);a.set(['a.md']);dispose();
  a.set(previous=>previous.filter(path=>path!=='a.md'));
  assert.deepEqual(a.getSnapshot(),[]);assert.deepEqual(b.getSnapshot(),[]);assert.equal(first,1);assert.equal(second,2);
});
