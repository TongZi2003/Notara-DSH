import test from 'node:test';
import assert from 'node:assert/strict';
import {edgeGeometry,edgeDescription,RELATION_LABELS} from '../src/graph-edge-display.js';

test('relation descriptions separate meaning from learning state and use student-facing titles',()=>{
  const nodes=new Map([{path:'a.md',title:'导数定义'},{path:'b.md',title:'求导方法'}].map(n=>[n.path,n]));
  const edge={source:'a.md',target:'b.md',kind:'prerequisite',style:'solid',context:'路线一',description:'用 [[卡片/极限|极限]] 说明。'};
  assert.equal(edgeDescription(edge,'prerequisite',nodes),'前序依赖 · 先学 导数定义 → 再学 求导方法 · 已建立 · 路线：路线一：用 极限 说明。');
  assert.match(edgeDescription({...edge,style:'dashed'},'prerequisite',nodes),/潜在／待建立/);
  for(const kind of ['source','reference'])assert.doesNotMatch(edgeDescription({...edge,kind,context:'',description:''},kind,nodes),/已建立|待建立/);
  assert.equal(edgeDescription({organization:true},'source',nodes),'组织关系 · 资料中涉及的知识与具体例子');
  assert.equal(edgeDescription({style:'solid'},'knowledge',nodes),'知识联系 · 已建立');
  assert.equal(Object.keys(RELATION_LABELS).length,5);
});

test('association bends only its stroke; other endpoints, directed padding and parallel routes stay unchanged',()=>{
  const source={path:'a',x:10,y:20},target={path:'b',x:210,y:20};
  const example={source,target,kind:'example'},prerequisite={source,target,kind:'prerequisite'},association={source,target,kind:'association'};
  assert.deepEqual(edgeGeometry(example,[example]),{x1:10,y1:20,x2:210,y2:20});
  assert.deepEqual(edgeGeometry(prerequisite,[prerequisite]),{x1:10,y1:20,x2:196,y2:20});
  assert.match(edgeGeometry(association,[association]).d,/^M 10 20 Q 110 44 210 20$/);
  assert.deepEqual(edgeGeometry(prerequisite,[prerequisite,example]),{x1:10,y1:16,x2:196,y2:16});
  const reverse={source:target,target:source,kind:'association'};
  assert.match(edgeGeometry(reverse,[reverse]).d,/Q 110 44/,'curvature is stable for either storage direction');
  const loop={source,target:source,kind:'prerequisite'};
  assert.match(edgeGeometry(loop,[loop]).d,/ C /);
  const coincident={source,target:{...target,x:10,y:20},kind:'association'};
  assert.doesNotMatch(edgeGeometry(coincident,[coincident]).d,/NaN|Infinity/);
  assert.deepEqual(source,{path:'a',x:10,y:20});assert.deepEqual(target,{path:'b',x:210,y:20});
});
