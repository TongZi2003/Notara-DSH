import test from 'node:test';
import assert from 'node:assert/strict';
import * as sources from '../src/source-graph.js';
import {createSimulation} from '../src/graph.js';

const study=(graph,group)=>{assert.equal(typeof sources.sourceStudyGraph,'function','source detail needs a source → knowledge → content projection');return sources.sourceStudyGraph(graph,group);};
function fixture(count=6){
  const source={path:'讲义.pdf',title:'不等式讲义（一）',type:'pdf',isSource:true};
  const topics=[{path:'均值.md',title:'均值不等式',type:'concept',sourcePaths:[]},{path:'柯西.md',title:'柯西不等式',type:'method',sourcePaths:[]}];
  const exercises=Array.from({length:count},(_,i)=>({path:`题${i+1}.md`,title:`第${i+1}题：完整条件与解题方法`,type:'exercise',sourcePaths:[source.path]}));
  const edges=exercises.map(node=>({source:node.path,target:source.path,style:'dashed',knowledge:false}));
  for(const [topic,items] of [[topics[0],[1,2,3]],[topics[1],[3,4,5]]])for(const i of items)edges.push({source:topic.path,target:`题${i}.md`,knowledge:true,style:topic===topics[0]&&i===3?'solid':'dashed'});
  return {nodes:[source,...topics,...exercises],edges};
}
const group=graph=>sources.sourceGroups(graph).find(row=>row.path==='讲义.pdf');

test('source → knowledge → questions keeps one shared question and preserves real evidence styles',()=>{
  const graph=fixture(),before=structuredClone(graph),result=study(graph,group(graph));
  assert.equal(result.layout,'source-hierarchy');assert.equal(result.sourcePath,'讲义.pdf');
  assert.equal(result.nodes.length,9);assert.equal(result.nodes.filter(node=>node.path==='题3.md').length,1);
  assert.deepEqual(result.nodes.filter(node=>node.sourceLayer==='knowledge').map(node=>node.path).sort(),['均值.md','柯西.md']);
  assert.deepEqual(result.branches.map(edge=>[edge.source,edge.target]).sort(),[['讲义.pdf','均值.md'],['讲义.pdf','柯西.md']]);
  assert.ok(result.branches.every(edge=>edge.style==='dashed'&&edge.organization===true));
  assert.equal(result.edges.find(edge=>edge.source==='均值.md'&&edge.target==='题3.md').style,'solid');
  assert.equal(result.edges.find(edge=>edge.source==='柯西.md'&&edge.target==='题3.md').style,'dashed');
  const provenance=result.edges.filter(edge=>[edge.source,edge.target].includes('讲义.pdf'));
  assert.deepEqual(provenance,graph.edges.filter(edge=>edge.target==='讲义.pdf'),'every question retains its actual source edge, including shared questions');
  assert.ok(provenance.every(edge=>sources.graphEdgeKind(edge,new Map(result.nodes.map(node=>[node.path,node])))==='source'));
  assert.deepEqual(graph,before,'display hierarchy must not alter card facts or RPC input');
});

test('knowledge hubs obey explicit relation kind, scope and separate same-title identities',()=>{
  const graph=fixture();graph.nodes.push({path:'无关概念.md',title:'同名知识点',type:'concept'},{path:'日记.md',title:'日记',type:'diary'});
  graph.edges.push({source:'无关概念.md',target:'题1.md',knowledge:false,style:'solid'},{source:'日记.md',target:'题2.md',knowledge:false,style:'dashed'});
  graph.nodes[1].title=graph.nodes[2].title='同名知识点';
  const result=study(graph,group(graph));
  assert.equal(result.nodes.filter(node=>node.title==='同名知识点').length,2);
  assert.ok(!result.nodes.some(node=>['无关概念.md','日记.md'].includes(node.path)));
  const limited={nodes:graph.nodes.filter(node=>node.path!=='柯西.md'),edges:graph.edges.filter(edge=>edge.source!=='柯西.md'&&edge.target!=='柯西.md')};
  assert.ok(!study(limited,group(limited)).nodes.some(node=>node.path==='柯西.md'));
});

test('absent sources, unassigned groups and no known concepts retain the existing view',()=>{
  const graph=fixture();graph.nodes=graph.nodes.filter(node=>node.type!=='concept'&&node.type!=='method');graph.edges=graph.edges.filter(edge=>!edge.knowledge);
  assert.deepEqual(study(graph,group(graph)),sources.graphForSource(graph,group(graph)));
  const unassigned={id:'unassigned',path:null,nodes:graph.nodes.filter(node=>node.type==='exercise')};
  assert.deepEqual(study(graph,unassigned),sources.graphForSource(graph,unassigned));
  assert.deepEqual(study(graph,null),{nodes:[],edges:[]});
  const noSource={...fixture(),nodes:fixture().nodes.filter(node=>!node.isSource)};
  assert.equal(study(noSource,{path:'讲义.pdf',nodes:noSource.nodes}).layout,undefined);
});

const run=(graph,positions=new Map())=>{const live=createSimulation(graph,()=>{},1200,580,positions,new Map(),{x:500,y:300});live.simulation.stop();return live;};
function assertNoOverlap(nodes){
  for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
    const a=nodes[i],b=nodes[j],aa=a.labelBounds,bb=b.labelBounds;
    assert.ok(a.x+aa.right<=b.x+bb.left||b.x+bb.right<=a.x+aa.left||a.y+aa.bottom<=b.y+bb.top||b.y+bb.bottom<=a.y+aa.top,`${a.path} overlaps ${b.path}`);
  }
}

test('hierarchical layout shows three layers and a shared question only once',()=>{
  const graph=fixture(),local=study(graph,group(graph)),live=run(local);
  assert.equal(live.hierarchical,true);assert.equal(live.nodes.length,9);
  const source=live.nodes.find(node=>node.path==='讲义.pdf'),topics=live.nodes.filter(node=>node.sourceLayer==='knowledge'),items=live.nodes.filter(node=>node.sourceLayer==='content');
  assert.ok(topics.every(node=>node.x>source.x));assert.ok(items.every(node=>topics.every(topic=>node.x>topic.x)));
  assert.equal(new Set(items.map(node=>node.x)).size,1,'a shared question stays in the question layer, not an extra fourth lane');
  assert.equal(live.links.filter(edge=>[edge.source.path,edge.target.path].includes('题3.md')).length,3,'two knowledge links and one source link, with one shared node');
  assertNoOverlap(live.nodes);
  const reversed=run({...local,nodes:[...local.nodes].reverse(),edges:[...local.edges].reverse(),branches:[...local.branches].reverse()});
  const coords=nodes=>nodes.map(node=>[node.path,node.x,node.y]).sort((a,b)=>a[0].localeCompare(b[0]));assert.deepEqual(coords(live.nodes),coords(reversed.nodes));
  const previous=run({...local,edges:local.edges.filter(edge=>![edge.source,edge.target].includes('讲义.pdf')||[edge.source,edge.target].includes('题6.md'))});
  live.simulation.tick(150);previous.simulation.tick(150);
  assert.deepEqual(coords(live.nodes),coords(previous.nodes),'restoring provenance edges must not move any node in the hierarchy');
});

test('dense branches reserve complete titles and preserve manual pins',()=>{
  const graph=fixture(27);for(let i=7;i<=27;i++)graph.edges.push({source:'均值.md',target:`题${i}.md`,knowledge:true,style:'dashed'});
  const local=study(graph,group(graph)),live=run(local);assertNoOverlap(live.nodes);
  const span=Math.max(...live.nodes.map(node=>node.y+node.labelBounds.bottom))-Math.min(...live.nodes.map(node=>node.y+node.labelBounds.top));assert.ok(span<1100,'dense branches must use multiple columns instead of one very tall list');
  const pinned=run(local,new Map([['题3.md',{x:123,y:456,fx:123,fy:456}]]));assert.equal(pinned.nodes.find(node=>node.path==='题3.md').x,123);assert.equal(pinned.nodes.find(node=>node.path==='题3.md').fy,456);
  const mixed=fixture(11);mixed.nodes.push(...['定义域','对数'].map(title=>({path:title+'.md',title,type:'concept',sourcePaths:['讲义.pdf']})));
  mixed.edges=mixed.edges.filter(edge=>!edge.knowledge);
  for(const [topic,items] of [['均值.md',[1,2,3,4,6,7]],['柯西.md',[5,6,7]]])for(const i of items)mixed.edges.push({source:topic,target:`题${i}.md`,knowledge:true,style:'dashed'});
  const several=run(study(mixed,group(mixed)));assertNoOverlap(several.nodes);
  const verticalSpan=Math.max(...several.nodes.map(node=>node.y+node.labelBounds.bottom))-Math.min(...several.nodes.map(node=>node.y+node.labelBounds.top));
  assert.ok(verticalSpan<800,'several knowledge branches should use available width instead of shrinking the entire source view');
});
