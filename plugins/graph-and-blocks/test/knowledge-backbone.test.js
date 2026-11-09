import test from 'node:test';
import assert from 'node:assert/strict';
import {projectGraph,createSimulation} from '../src/graph.js';
import {sourceStudyGraph,sourceGroups,graphEdgeKind,graphRelationVisible} from '../src/source-graph.js';
import {fixture} from './knowledge-backbone.fixture.js';
test('v2 default backbone preserves explicit directions, alternative routes and direct edges without reference K6',()=>{
  const data=fixture(),graph=projectGraph(data);
  assert.equal(graph.relationsVersion,2);
  assert.equal(graph.nodes.length,11);
  assert.equal(graph.edges.length,17);
  assert.equal(graph.edges.filter(e=>e.kind==='prerequisite').length,5);
  assert.equal(projectGraph(data,[],[],1,'all','all').edges.length,data.edges.length);
  assert.equal(projectGraph(data).edges.filter(e=>e.source==='A'&&e.target==='B').length,2);
  assert.ok(projectGraph(data).edges.some(e=>e.source==='C'&&e.target==='B'));
  assert.equal(projectGraph(data,['A']).edges.some(e=>e.kind==='reference'),false,'a knowledge center does not turn ordinary references into the default backbone');
  for(const e of graph.edges)assert.equal(graphEdgeKind(e,new Map()),e.kind);
  assert.equal(graphRelationVisible({style:'solid'},'prerequisite','established'),true);
});
test('entity tags match the canonical target across aliases and do not collide with ordinary labels',()=>{
  const data=fixture();
  assert.deepEqual(projectGraph(data,[],['[[A]]']).nodes.map(n=>n.path).sort(),['医学病案','历史事件','实验','题目'].sort());
  data.nodes.find(n=>n.path==='F').tags=['别名'];
  assert.deepEqual(projectGraph(data,[],['别名']).nodes.map(n=>n.path),['F']);
});
test('source hierarchy ranks explicit dependencies, keeps cyclic groups, metadata and each multi-tag example once',()=>{
  const graph=projectGraph(fixture()),group=sourceGroups(graph).find(g=>g.path==='原书.pdf'),study=sourceStudyGraph(graph,group);
  assert.equal(study.relationsVersion,2);
  const byPath=new Map(study.nodes.map(n=>[n.path,n]));
  assert.equal(byPath.get('B').dependencyGroup,byPath.get('C').dependencyGroup);
  assert.ok(byPath.get('B').dependencyRank>byPath.get('A').dependencyRank);
  assert.deepEqual(byPath.get('实验').sourceParents,['A','B']);
  assert.equal(study.edges.filter(e=>e.kind==='prerequisite').length,5);
  const live=createSimulation(study,()=>{},1200,580);live.simulation.stop();
  assert.equal(live.nodes.filter(n=>n.path==='实验').length,1);
  assert.ok(live.nodes.find(n=>n.path==='B').x>live.nodes.find(n=>n.path==='A').x);
  assert.equal(live.nodes.find(n=>n.path==='B').x,live.nodes.find(n=>n.path==='C').x);
});

test('source details expand only one explicit dependency hop and never manufacture provenance for external entities',()=>{
  const graph={relationsVersion:2,nodes:[...['s1','s2','s3'].map(path=>({path,type:'source',isSource:true})),...['A','B','C','D'].map((path,i)=>({path,title:path,type:'concept',sourcePaths:[`s${Math.min(i+1,3)}`]}))],edges:[['A','B'],['B','C'],['C','D']].map(([source,target])=>({source,target,kind:'prerequisite',style:'dashed'}))};
  const groups=sourceGroups(graph),one=sourceStudyGraph(graph,groups.find(group=>group.path==='s1'));
  assert.deepEqual(one.nodes.map(node=>node.path).sort(),['A','B','s1']);
  assert.deepEqual(one.nodes.find(node=>node.path==='B').sourceParents,[]);
  assert.deepEqual(one.edges.map(edge=>[edge.source,edge.target]),[['A','B']]);
  const two=sourceStudyGraph(graph,groups.find(group=>group.path==='s2'));
  assert.deepEqual(two.nodes.map(node=>node.path).sort(),['A','B','C','s2']);
  assert.deepEqual(two.edges.map(edge=>[edge.source,edge.target]),[['A','B'],['B','C']]);
  assert.deepEqual(two.nodes.find(node=>node.path==='C').sourceParents,[]);
});

test('SCC members remain adjacent within their rank even when another title sorts between them',()=>{
  const data=fixture();data.nodes.find(node=>node.path==='C').title='知识Z';data.nodes.find(node=>node.path==='D').title='知识M';
  data.edges.push({source:'A',target:'D',kind:'prerequisite',style:'dashed',context:''});
  const graph=projectGraph(data),study=sourceStudyGraph(graph,sourceGroups(graph).find(group=>group.path==='原书.pdf'));
  const live=createSimulation(study);live.simulation.stop();
  const row=live.nodes.filter(node=>node.dependencyRank===1).sort((a,b)=>a.y-b.y).map(node=>node.path);
  assert.equal(Math.abs(row.indexOf('B')-row.indexOf('C')),1);
});

test('large source details keep the complete dependency backbone above a bounded example field',()=>{
  const source={path:'原书.pdf',title:'导数原书',type:'pdf',isSource:true};
  const topics=Array.from({length:34},(_,i)=>({path:`知识${i}`,title:`知识单元${i}的完整条件和使用方法`,type:i%2?'concept':'method',sourcePaths:[source.path]}));
  const examples=Array.from({length:680},(_,i)=>({path:`题${i}`,title:`第${i}题的完整题目条件与结论`,type:'exercise',sourcePaths:[source.path]}));
  const data={relationsVersion:2,nodes:[source,...topics,...examples],edges:[...topics.slice(1).map((n,i)=>({source:topics[Math.max(0,i-3)].path,target:n.path,kind:'prerequisite'})),...examples.flatMap((n,i)=>[{source:topics[i%34].path,target:n.path,kind:'example'},{source:topics[(i+1)%34].path,target:n.path,kind:'example'}])]};
  const graph=projectGraph(data),study=sourceStudyGraph(graph,sourceGroups(graph).find(g=>g.path===source.path));
  const live=createSimulation(study);live.simulation.stop();live.simulation.tick(100);
  assert.equal(live.nodes.length,715);assert.equal(live.links.length,study.edges.length+study.branches.length);
  const contents=live.nodes.filter(n=>n.sourceLayer==='content'),knowledge=live.nodes.filter(n=>n.sourceLayer==='knowledge');
  assert.ok(new Set(contents.map(n=>n.layoutTarget.x)).size>10,'hundreds of examples must wrap instead of extending one column');
  assert.ok(Math.max(...contents.map(n=>n.y))-Math.min(...contents.map(n=>n.y))<1600,'example field must not dwarf the actual backbone');
  assert.ok(Math.min(...contents.map(n=>n.y))>Math.max(...knowledge.map(n=>n.y)),'dense examples leave knowledge labels and dependency lanes clear');
  for(const edge of live.links.filter(e=>e.kind==='prerequisite'))assert.ok(edge.source.dependencyRank<edge.target.dependencyRank,'wrapping rank lanes must preserve each actual dependency and its direction');
  assert.deepEqual(live.links.slice(study.branches.length).map(e=>[e.source.path,e.target.path,e.kind]),study.edges.map(e=>[e.source,e.target,e.kind]));
  const pin={x:123,y:456,fx:123,fy:456};const pinned=createSimulation(study,()=>{},960,580,new Map([['题3',pin]]));pinned.simulation.stop();assert.equal(pinned.nodes.find(n=>n.path==='题3').fx,123);
});
