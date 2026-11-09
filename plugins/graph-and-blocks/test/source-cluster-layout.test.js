import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation} from '../src/graph.js';
import {sourceClusterLayout} from '../src/source-cluster-layout.js';
const fixture=()=>({layout:'source-clusters',nodes:[
  {path:'A.pdf',title:'原始资料甲',type:'pdf',isSource:true},{path:'B.pdf',title:'原始资料乙',type:'pdf',isSource:true},
  ...Array.from({length:8},(_,i)=>({path:`a${i}`,title:`甲习题${i}`,type:'exercise',sourcePaths:['A.pdf']})),
  ...Array.from({length:6},(_,i)=>({path:`b${i}`,title:`乙习题${i}`,type:'exercise',sourcePaths:['B.pdf']})),
  {path:'shared',title:'共同方法',type:'method',sourcePaths:['A.pdf','B.pdf','A.pdf']},
  {path:'unknown',title:'独立笔记',type:'card',sourcePaths:[]},
  {path:'outside',title:'外部来源题目',type:'card',sourcePaths:['范围外.pdf']},
],edges:[{source:'a0',target:'b0',style:'solid'},{source:'shared',target:'A.pdf',style:'dashed'},{source:'shared',target:'B.pdf',style:'dashed'}]});
const run=(graph,positions=new Map(),origin={x:480,y:290})=>{const live=createSimulation(graph,()=>{},960,580,positions,new Map(),origin);live.simulation.stop();live.simulation.tick(150);return live;};
test('source clusters separate exclusive members, retain one shared node between sources and all real edges',()=>{
  const graph=fixture(),before=structuredClone(graph),live=run(graph),byPath=new Map(live.nodes.map(node=>[node.path,node]));
  assert.equal(live.clustered,true);
  const a=byPath.get('A.pdf'),b=byPath.get('B.pdf'),shared=byPath.get('shared'),distance=(x,y)=>Math.hypot(x.x-y.x,x.y-y.y);
  for(const node of live.nodes.filter(n=>/^a\d/.test(n.path)))assert.ok(distance(node,a)<distance(node,b));
  for(const node of live.nodes.filter(n=>/^b\d/.test(n.path)))assert.ok(distance(node,b)<distance(node,a));
  const t=((shared.x-a.x)*(b.x-a.x)+(shared.y-a.y)*(b.y-a.y))/distance(a,b)**2;
  assert.ok(t>0&&t<1,'shared material should lie between its source clusters');
  assert.equal(live.nodes.filter(n=>n.path==='shared').length,1);
  assert.deepEqual(live.links.map(edge=>[edge.source.path,edge.target.path,edge.style]),graph.edges.map(edge=>[edge.source,edge.target,edge.style]));
  assert.equal(live.clusters.filter(c=>c.sourcePath).length,2);
  assert.ok(live.clusters.some(c=>c.kind==='unassigned'&&c.paths.includes('unknown')));
  assert.ok(live.clusters.some(c=>c.kind==='outside'&&c.paths.includes('outside')));
  assert.ok(live.clusters.every(c=>!c.paths.includes('shared')),'shared cards must not be assigned to an arbitrary single source');
  assert.deepEqual(graph,before);
});
test('source layout respects manual pins and never invents a missing source node',()=>{
  const graph=fixture(),pins=new Map([['A.pdf',{x:-300,y:200,fx:-300,fy:200}],['a0',{x:600,y:800,fx:600,fy:800}]]),live=run(graph,pins);
  for(const [path,pin] of pins){const node=live.nodes.find(n=>n.path===path);assert.equal(node.x,pin.fx);assert.equal(node.y,pin.fy);}
  const anchors=value=>value.clusters.map(c=>[c.id,c.x,c.y]).sort((a,b)=>a[0].localeCompare(b[0]));
  assert.deepEqual(anchors(live),anchors(run(fixture())),'pinning one source must not relocate its entire cluster on refresh');
  assert.equal(live.nodes.some(n=>n.path==='范围外.pdf'),false);
  assert.equal(live.nodes.filter(n=>n.fx!=null).length,2);
  const limited=fixture();limited.nodes=limited.nodes.filter(n=>n.path!=='B.pdf');limited.edges=limited.edges.filter(e=>e.source!=='B.pdf'&&e.target!=='B.pdf');
  assert.equal(run(limited).clusters.some(c=>c.sourcePath==='B.pdf'),false);
});
test('source arrangement is deterministic across input order and a stable origin, and explicit centers take precedence',()=>{
  const graph=fixture(),live=run(graph),reversed=run({...graph,nodes:[...graph.nodes].reverse(),edges:[...graph.edges].reverse()});
  const positions=l=>l.nodes.map(n=>[n.path,n.x,n.y]).sort((a,b)=>a[0].localeCompare(b[0]));
  assert.deepEqual(positions(live),positions(reversed));
  graph.nodes[0].center=true;const focused=run(graph);assert.equal(focused.centered,true);assert.notEqual(focused.clustered,true);
  const plain=run({layout:'source-clusters',nodes:[{path:'none',title:'无来源卡片',type:'card'}],edges:[]});assert.notEqual(plain.clustered,true);assert.equal(plain.nodes.length,1);
});
test('many original sources use bounded packing and remain distinct',()=>{
  const graph={layout:'source-clusters',nodes:Array.from({length:65},(_,i)=>({path:`source${i}.pdf`,type:'pdf',isSource:true,title:`原始资料${i}`})),edges:[]};
  const live=run(graph);assert.equal(live.clusters.length,65);assert.equal(live.nodes.length,65);
  for(let i=0;i<live.clusters.length;i++)for(let j=i+1;j<live.clusters.length;j++){const a=live.clusters[i],b=live.clusters[j];assert.ok(Math.hypot(a.x-b.x,a.y-b.y)>a.radius+b.radius);}
});
test('long original-source captions have reserved space clear of surrounding node circles',()=>{
  const graph=fixture();graph.nodes[0].title='均值不等式及常考题型总结和完整原始资料';
  const live=run(graph),root=live.nodes.find(n=>n.path==='A.pdf'),box=root.labelBounds;
  for(const node of live.nodes.filter(n=>n.path!=='A.pdf'))assert.ok(node.x+12<=root.x+box.left+5||node.x-12>=root.x+box.right-5||node.y+12<=root.y+12||node.y-12>=root.y+box.bottom-5,`source caption must not be covered by ${node.path}`);
});

test('a chemistry-sized shared library packs in two dimensions, without a horizontal overflow tail',()=>{
  const sources=Array.from({length:9},(_,i)=>({path:`来源${i}.pdf`,title:`原始资料${i}`,type:'pdf',isSource:true}));
  const graph={nodes:[...sources,...Array.from({length:1309},(_,i)=>({path:`卡${i}`,title:`化学例题${i}`,type:'exercise',sourcePaths:i<1200?['来源0.pdf','来源1.pdf']:['来源2.pdf']}))],edges:[]};
  const layout=sourceClusterLayout(graph,sources,{x:480,y:290}),points=[...layout.targets.values()];
  const width=Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x));
  const height=Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y));
  assert.equal(layout.targets.size,1318);
  assert.ok(width<5000&&height<5000,`shared nodes must not form a long fallback tail: ${width} × ${height}`);
  assert.ok(width/height<3&&height/width<3,'both dimensions should carry shared cards');
  const shared=graph.nodes.filter(n=>n.sourcePaths?.length===2).map(n=>layout.targets.get(n.path));
  for(let i=0;i<shared.length;i++)for(let j=i+1;j<shared.length;j++)assert.ok(Math.hypot(shared[i].x-shared[j].x,shared[i].y-shared[j].y)>=32);
});
