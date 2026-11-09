import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceGroups,graphForSource,crossSourceEdges} from '../src/source-graph.js';

test('source overview counts distinct cards, shares multi-source identity and excludes auxiliary files',()=>{
  const a={path:'A.pdf',title:'资料 A',type:'pdf',isSource:true},b={path:'B.md',title:'资料 B',type:'source',isSource:true},empty={path:'empty.pdf',title:'空资料',type:'pdf',isSource:true};
  const shared={path:'卡片/一.md',type:'concept',sourcePaths:['A.pdf','A.pdf','B.md']},orphan={path:'卡片/二.md',type:'method',sourcePaths:[]},note={path:'便签.md',type:'note'};
  const graph={nodes:[a,b,empty,shared,orphan,note],edges:[{source:shared.path,target:orphan.path,style:'solid'}]};
  const groups=sourceGroups(graph),ga=groups.find(group=>group.path===a.path),gb=groups.find(group=>group.path===b.path);
  assert.equal(ga.nodes.length,1);assert.equal(gb.nodes[0],ga.nodes[0]);
  assert.equal(groups.find(group=>group.path===empty.path).nodes.length,0);
  assert.deepEqual(groups.find(group=>group.id==='unassigned').nodes,[orphan]);
  assert.equal(groups.some(group=>group.id==='other'),false);
  assert.deepEqual(graphForSource(graph,ga),{nodes:[a,shared],edges:[]});
  const scoped=sourceGroups(graph,[shared]);assert.equal(scoped.length,2);assert.ok(scoped.every(group=>group.nodes.length===1));
  const restricted=sourceGroups({nodes:[shared],edges:[]});
  assert.equal(restricted.length,1);assert.equal(restricted[0].id,'outside');assert.equal(restricted[0].path,null);
  assert.doesNotMatch(JSON.stringify(restricted.map(group=>({title:group.title,path:group.path}))),/资料 A|A.pdf/);
});
test('cross-source emphasis uses only existing knowledge edges with disjoint known sources',()=>{
  const a={path:'a',type:'card',sourcePaths:['A']},b={path:'b',type:'concept',sourcePaths:['B']},shared={path:'s',type:'method',sourcePaths:['A','B']},unknown={path:'u',type:'exercise',sourcePaths:[]},source={path:'A',type:'source',sourcePaths:['B']};
  const edges=[b,shared,unknown,source].map(node=>({source:'a',target:node.path,style:'dashed'}));
  assert.deepEqual(crossSourceEdges({nodes:[a,b,shared,unknown,source],edges},'a'),[edges[0]]);
});
