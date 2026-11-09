import test from 'node:test';
import assert from 'node:assert/strict';
import {graphLayoutPlan,createSimulation,readGraph} from '../src/graph.js';
import {visibleGraphLabels} from '../src/graph-layout.js';
import {sourceStudyGraph,sourceStudyBackbone,sourceGroups} from '../src/source-graph.js';

test('spatial label lookup keeps the previous exact greedy order, exclusions and forced labels',()=>{
 const old=(items,scale,obstacles)=>{const visible=new Set(),occupied=[],overlaps=(a,b)=>a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom;
  for(const item of [...items].sort((a,b)=>b.priority-a.priority||a.path.localeCompare(b.path))){const p=4/Math.max(scale,.03),box={left:item.box.left-p,right:item.box.right+p,top:item.box.top-p,bottom:item.box.bottom+p};if(!item.forced&&(scale<.6&&item.priority<60||occupied.some(b=>overlaps(box,b))||obstacles.some(b=>b.path!==item.path&&overlaps(box,b.box))))continue;visible.add(item.path);occupied.push(box);}return visible;};
 let seed=7;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/2**32);
 const items=Array.from({length:700},(_,i)=>{const x=random()*6000-3000,y=random()*4000-2000;return {path:'节点'+i,priority:i%7*20,forced:i%37===0,box:{left:x,right:x+random()*170,top:y,bottom:y+32}};});
 const obstacles=items.filter((_,i)=>i%2).map(item=>({path:item.path,box:{...item.box,right:item.box.left+24,bottom:item.box.top+24}}));
 for(const scale of [.03,.5,.6,1,3])assert.deepEqual(visibleGraphLabels(items,scale,obstacles),old(items,scale,obstacles));
});

test('source backbone shares the complete projection without altering cycles, routes or fallback shapes',()=>{
 const graph={relationsVersion:2,nodes:[{path:'book',title:'书',type:'source',isSource:true},...['A','B','C'].map(path=>({path,title:path,type:'concept',sourcePaths:['book']})),{path:'case',title:'例子',type:'exercise',sourcePaths:['book']}],edges:[{source:'A',target:'B',kind:'prerequisite',context:'路线1'},{source:'B',target:'A',kind:'prerequisite',context:'路线2'},{source:'B',target:'C',kind:'prerequisite'},{source:'A',target:'case',kind:'example'}]};
 const group=sourceGroups(graph)[0],complete=sourceStudyGraph(graph,group),copy=structuredClone(complete);
 assert.deepEqual(sourceStudyBackbone(complete),sourceStudyGraph(graph,group,{display:'backbone'}));assert.deepEqual(complete,copy);
 assert.deepEqual(complete.nodes.filter(n=>n.dependencyCycle).map(n=>n.path),['A','B']);assert.equal(complete.nodes.find(n=>n.path==='C').dependencyRank,1);
 const empty=sourceStudyGraph(graph,undefined);assert.equal(sourceStudyBackbone(empty),empty);
});

test('layout plan cache ignores evidence style but invalidates mutable measurements, pins, viewport and membership',()=>{
 const graph={layout:'source-hierarchy',presentation:'backbone',relationsVersion:2,sourcePath:'book',nodes:[{path:'A',title:'知识',type:'concept',sourceLayer:'knowledge',dependencyRank:0,sourceParents:['book']}],edges:[]};
 const positions=new Map(),measurements=new Map([['A',{width:100,height:16}]]),cache=new Map();
 const plan=()=>graphLayoutPlan(graph,960,580,positions,measurements,undefined,cache);
 const first=plan();assert.deepEqual(plan(),first);assert.equal(cache.size,1);
 graph.edges=[{source:'A',target:'A',kind:'association',style:'solid',context:'新认识'}];assert.deepEqual(plan(),first);assert.equal(cache.size,1);
 measurements.set('A',{width:220,height:32});plan();assert.equal(cache.size,2);
 positions.set('book',{fx:13,fy:17});plan();assert.equal(cache.size,3);
 graphLayoutPlan(graph,420,720,positions,measurements,undefined,cache);assert.equal(cache.size,4);
 graph.nodes[0].title='不同标题';plan();assert.equal(cache.size,5);
 const fresh=graphLayoutPlan(graph,960,580,positions,measurements,undefined);assert.deepEqual(plan(),fresh);
 const a=createSimulation(graph,()=>{},960,580,positions,measurements,undefined,cache),b=createSimulation(graph,()=>{},960,580,positions,measurements);
 a.simulation.stop().tick(100);b.simulation.stop().tick(100);assert.deepEqual(a.nodes,b.nodes);assert.deepEqual(a.links,b.links);
});

test('graph reader keeps default RPC contract and accepts an explicit lightweight request',async()=>{
 const calls=[],remote={graph:async input=>{calls.push(input);return {ok:true,value:{nodes:[],edges:[]}};}};
 await readGraph(remote);await readGraph(remote,{compact:true});assert.deepEqual(calls,[{},{compact:true}]);
 await assert.rejects(()=>readGraph({graph:async()=>({ok:false})},{compact:true}));
});
