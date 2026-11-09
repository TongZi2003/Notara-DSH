import test from 'node:test';
import assert from 'node:assert/strict';
import * as sources from '../src/source-graph.js';
import {createSimulation,nodeAppearance,isOriginalSource} from '../src/graph.js';

test('explicit entity and example types precede legacy title guesses without changing source identity',()=>{
  for(const [type,title,kind] of [
    ['concept','实验与方法导读','knowledge'],['method','实验导读','method'],['exercise','方法选择实验','example'],
    ['card','实验案例','example'],['card','方法比较','method'],[undefined,'方法比较','method'],
    ['source','实验方法原文','knowledge'],['pdf','实验方法原文','knowledge'],
  ])assert.equal(nodeAppearance({type,title}).kind,kind,`${type}: ${title}`);
  const source={path:'原文.pdf',title:'实验方法',type:'pdf',isSource:true},before=structuredClone(source);
  nodeAppearance(source);assert.deepEqual(source,before);assert.equal(isOriginalSource(source),true);
});

test('edge colors follow provenance and knowledge roles rather than line style or a source endpoint alone',()=>{
  const nodes=new Map([
    {path:'a',type:'card',sourcePaths:['pdf']},{path:'b',type:'concept'},
    {path:'pdf',type:'source',isSource:true},{path:'image',type:'image',isSource:true},
    {path:'guide',type:'source',isSource:false},{path:'diary',type:'diary'},
  ].map(n=>[n.path,n]));
  assert.equal(sources.graphEdgeKind({source:'a',target:'pdf'},nodes),'source');
  assert.equal(sources.graphEdgeKind({source:'pdf',target:'a'},nodes),'source');
  assert.equal(sources.graphEdgeKind({source:'b',target:'pdf'},nodes),'reference','ordinary PDF mentions are not proven provenance');
  assert.equal(sources.graphEdgeKind({source:'a',target:'b',style:'dashed'},nodes),'knowledge');
  assert.equal(sources.graphEdgeKind({source:'a',target:'b',style:'solid'},nodes),'knowledge');
  assert.equal(sources.graphEdgeKind({source:'guide',target:'a',style:'solid'},nodes),'reference');
  assert.equal(sources.graphEdgeKind({source:'diary',target:'a'},nodes),'reference');
  assert.equal(sources.graphEdgeKind({source:'a',target:'b',knowledge:false},nodes),'reference','host exclusions take precedence over a legacy card type');
});
test('shared-only source clusters count every member while keeping a single physical card and compact footprint',()=>{
  const graph={layout:'source-clusters',nodes:[{path:'A',title:'来源甲',type:'source',isSource:true},{path:'B',title:'来源乙',type:'source',isSource:true},{path:'s',title:'共享题目',type:'card',sourcePaths:['A','B','A']}],edges:[]};
  const live=createSimulation(graph);live.simulation.stop();
  assert.equal(live.nodes.filter(n=>n.path==='s').length,1);
  for(const group of live.clusters){assert.deepEqual(group.memberPaths,['s']);assert.deepEqual(group.sharedPaths,['s']);assert.ok(group.radius<60,'a shared-only source should not leave a large empty circle');}
  assert.deepEqual(graph.nodes[2].sourcePaths,['A','B','A']);
});
test('relation filtering uses recorded knowledge edges, independently of support and source organization',()=>{
  for(const support of ['independent','hint','explanation','unknown']){
    const edge={style:'solid',support};
    assert.equal(sources.graphRelationVisible(edge,'knowledge','established'),true);
    assert.equal(sources.graphRelationVisible(edge,'knowledge','potential'),false);
  }
  assert.equal(sources.graphRelationVisible({style:'dashed'},'knowledge','potential'),true);
  assert.equal(sources.graphRelationVisible({style:'dashed'},'knowledge','established'),false);
  for(const mode of ['established','potential']){
    assert.equal(sources.graphRelationVisible({style:'solid'},'reference',mode),false,'a reference is not learning evidence');
    assert.equal(sources.graphRelationVisible({style:'dashed'},'source',mode),true,'provenance remains available');
    assert.equal(sources.graphRelationVisible({style:'dashed',organization:true},'source',mode),true);
    assert.equal(sources.graphRelationVisible({},'knowledge',mode),false,'an unknown style cannot imply either status');
  }
  assert.equal(sources.graphRelationVisible({style:'solid'},'reference','all'),true);
});
