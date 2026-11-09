import test from 'node:test';
import assert from 'node:assert/strict';
import * as sources from '../src/source-graph.js';
import {projectGraph,createSimulation} from '../src/graph.js';
import {fixture} from './knowledge-backbone.fixture.js';

test('source overview folds only cases with a visible source and leaves the catalog untouched',()=>{
  const graph=projectGraph(fixture()),before=structuredClone(graph);
  const overview=sources.sourceOverviewGraph(graph);
  assert.equal(overview.nodes.length,7);
  assert.ok(overview.edges.every(edge=>overview.nodes.some(n=>n.path===edge.source)&&overview.nodes.some(n=>n.path===edge.target)));
  const cases={...graph,nodes:graph.nodes.filter(n=>n.type==='exercise'),edges:[]};
  assert.deepEqual(sources.sourceOverviewGraph(cases).nodes,cases.nodes,'type/scope filters must not hide cases whose source is outside the view');
  assert.deepEqual(graph,before);
});

test('knowledge view preserves declared dependency routes, cycles and shared example retrieval',()=>{
  const graph=projectGraph(fixture()),overview=sources.knowledgeOverviewGraph(graph);
  assert.equal(overview.nodes.length,6);
  assert.equal(overview.edges.filter(e=>e.source==='A'&&e.target==='B'&&e.kind==='prerequisite').length,2);
  assert.equal(overview.nodes.find(n=>n.path==='B').dependencyCycle,true);
  assert.ok(overview.edges.every(e=>e.kind!=='example'&&e.kind!=='source'));
  assert.equal(sources.sourceExamples(graph,'A').length,4);
  assert.deepEqual(sources.sourceExamples(graph,'A'),sources.sourceExamples(graph,'B'));
});

test('explicit backbone display folds examples and provenance without changing the public complete study graph',()=>{
  const data=fixture(),before=structuredClone(data),graph=projectGraph(data),group=sources.sourceGroups(graph)[0];
  const complete=sources.sourceStudyGraph(graph,group);
  const display=sources.sourceStudyGraph(graph,group,{display:'backbone'});
  assert.equal(display.nodes.length,6,'the default UI should draw only knowledge and methods');
  assert.equal(display.presentation,'backbone');
  assert.deepEqual(display.edges,complete.edges.filter(e=>e.kind==='prerequisite'));
  assert.deepEqual(display.branches,[],'source membership is conveyed by the source heading, not a radiation fan');
  assert.equal(complete.nodes.length,11,'two-argument callers still get every example and the source');
  assert.equal(complete.edges.length,17);
  assert.deepEqual(data,before);
});

test('example lists follow real example/legacy knowledge links and deduplicate shared identities',()=>{
  const graph=projectGraph(fixture());
  graph.nodes.push({path:'reference-only',type:'exercise',sourcePaths:['原书.pdf']});
  graph.edges.push({source:'A',target:'reference-only',kind:'reference',style:'solid'});
  const study=sources.sourceStudyGraph(graph,sources.sourceGroups(graph)[0]);
  assert.equal(typeof sources.sourceExamples,'function');
  assert.deepEqual(sources.sourceExamples(study,'A').map(n=>n.path).sort(),['医学病案','历史事件','实验','题目']);
  assert.deepEqual(sources.sourceExamples(study,'A'),sources.sourceExamples(study,'B'));
  const legacy={nodes:[{path:'C',type:'concept'},{path:'e',type:'card'},{path:'ref',type:'exercise'}],edges:[{source:'e',target:'C',knowledge:true},{source:'C',target:'e',knowledge:true},{source:'C',target:'ref',knowledge:false}]};
  assert.deepEqual(sources.sourceExamples(legacy,'C').map(n=>n.path),['e']);
});

test('older sources without a concept/method backbone keep their full entry point',()=>{
  const graph={nodes:[{path:'book',type:'source',isSource:true},{path:'e',type:'card',sourcePaths:['book']}],edges:[{source:'book',target:'e',style:'dashed'}]};
  const group=sources.sourceGroups(graph)[0];
  assert.deepEqual(sources.sourceStudyGraph(graph,group,{display:'backbone'}),sources.sourceStudyGraph(graph,group));
});

test('deep backbones wrap by their own depth and viewport, not the number of unfolded examples',()=>{
  const graph={relationsVersion:2,nodes:[{path:'book',type:'source',isSource:true},...Array.from({length:47},(_,i)=>({path:`k${i}`,title:`知识${i}的适用条件与方法`,type:'concept',sourcePaths:['book']}))],edges:Array.from({length:46},(_,i)=>({source:`k${i}`,target:`k${i+1}`,kind:'prerequisite',style:'dashed'}))};
  const display=sources.sourceStudyGraph(graph,sources.sourceGroups(graph)[0],{display:'backbone'});
  assert.equal(display.nodes.length,47);
  const run=width=>{const live=createSimulation(display,()=>{},width,740);live.simulation.stop();return live.nodes;};
  const wide=run(1380),narrow=run(760);
  assert.ok(Math.max(...wide.map(n=>n.x))-Math.min(...wide.map(n=>n.x))<1350,'47 prerequisite ranks must not become 47 columns');
  assert.ok(Math.max(...wide.map(n=>n.y))-Math.min(...wide.map(n=>n.y))<800);
  assert.ok(new Set(narrow.map(n=>n.x)).size<new Set(wide.map(n=>n.x)).size,'available width determines the column count');
  assert.equal(new Set(wide.map(n=>n.path)).size,47);
});
