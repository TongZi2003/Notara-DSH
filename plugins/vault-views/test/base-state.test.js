import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBase, serializeBase, evaluateBase, defaultLibraryBase } from '@oh-my-student/plugin-vault-sqlite/bases';
import { baseQuery, emptyBaseFilters, updatedBase, loadBase, presetIndex, baseColumns,baseViewLabel } from '../src/base-state.js';
test('learning-plan labels recognize legacy defaults without renaming custom saved views',()=>{
  for(const filters of ['notara.isGuide == true','notara.type == "guide"','notara.type == "plan"']){
    const view={name:'导读资料',filters};assert.equal(baseViewLabel(view),'学习计划');assert.equal(view.name,'导读资料');
    assert.equal(baseViewLabel({...view,name:'我的阅读安排'}),'我的阅读安排');
  }
  assert.equal(baseViewLabel({name:'导读资料',filters:'note.type == "card"'}),'导读资料');
});
test('creating from a browsing view keeps its scope instead of inheriting the last saved view',()=>{
  const base=defaultLibraryBase(),record={content:serializeBase(base)};
  const initialView={type:'table',name:'原始资料',order:['file.name','note.tags'],notara:{scope:'sources'},columnSize:{'file.name':320}};
  const saved=updatedBase(record,2,{initialView,name:'原文清单',layout:'table',order:initialView.order,filters:{...emptyBaseFilters(),q:'讲义'},append:true});
  const next=parseBase(saved.content);assert.deepEqual(next.views.slice(0,3),base.views);
  assert.deepEqual(next.views[3].notara,{scope:'sources',search:'讲义'});
  assert.equal(next.views[3].filters,undefined);assert.equal(next.views[3].columnSize['file.name'],320);
  assert.equal(presetIndex({views:[next.views[3]]},'all'),-1);
});
test('library presentation removes default review noise and redundant grouped type, without changing custom columns',()=>{
  const base=defaultLibraryBase(), original=serializeBase(base);
  assert.deepEqual(baseColumns(base.views[0]),['file.name','note.tags','notara.type']);
  assert.deepEqual(baseColumns({...base.views[0],groupBy:{property:'notara.type'}}),['file.name','note.tags']);
  assert.deepEqual(baseColumns(base.views[2]),['file.name'],'review cards show each question with its own source/date instead of repeated properties');
  assert.deepEqual(baseColumns({order:['file.name','notara.reviewCount']}),['file.name','notara.reviewCount']);
  assert.equal(serializeBase(base),original);
});
test('source filter survives saved view round-trip and can be explicitly cleared',()=>{
  const filters={...emptyBaseFilters(),sourcePath:'来源/讲义.md'};
  assert.equal(baseQuery('资料库.base',0,filters).sourcePath,filters.sourcePath);
  const saved=updatedBase({content:serializeBase(defaultLibraryBase())},0,{name:'讲义卡片',layout:'table',order:['file.name','note.tags'],filters,append:true});
  const base=parseBase(saved.content);assert.equal(base.views[3].notara.sourcePath,filters.sourcePath);
  assert.equal(presetIndex({views:[base.views[3]]},'all'),-1);
  const cleared=updatedBase(saved,3,{name:'讲义卡片',layout:'table',order:['file.name'],filters:emptyBaseFilters(),clearFilters:true});
  assert.equal(parseBase(cleared.content).views[3].notara,undefined);
});
test('saving a view preserves base/global filters, original views, query AND and explicit columns/layout', () => {
  const config=defaultLibraryBase(); config.views[0].notara={search:'原搜索'};
  const record={path:'资料库.base',revision:'r1',content:serializeBase(config)};
  const result=updatedBase(record,0,{name:'新视图',layout:'cards',order:['file.name','note.tags'],groupBy:'note.type',filters:{...emptyBaseFilters(),q:'新搜索',tags:['共同','数学'],sort:'updated'},append:true});
  const next=parseBase(result.content); assert.equal(next.views.length,4); assert.deepEqual(next.views[0],config.views[0]); assert.equal(next.filters,config.filters); assert.equal(next.views[3].notara.search,'原搜索 新搜索');
  assert.equal(next.views[3].type,'cards'); assert.equal(next.views[3].sort[0].direction,'DESC');
  const docs=[{path:'a.md',tags:['共同','数学'],frontmatter:{type:'card'}},{path:'b.md',tags:['共同','数学/代数'],frontmatter:{type:'source'}}];
  assert.deepEqual(evaluateBase(next,docs,3).rows.map(x=>x.path),['a.md'], 'saved tag selection remains exact, just like temporary search');
});
test('clearing a saved view leaves global constraints and new filters intact', () => {
  const config=defaultLibraryBase();config.views[2].notara={search:'旧搜索'};
  const updated=updatedBase({content:serializeBase(config)},2,{name:'任意卡片',layout:'table',order:['file.name'],filters:{...emptyBaseFilters(),type:'card'},append:false,clearFilters:true});
  const next=parseBase(updated.content); assert.equal(next.filters,config.filters); assert.equal(next.views[2].notara,undefined); assert.deepEqual(next.views[2].filters,{and:['notara.type == "card"']});
  assert.throws(()=>updatedBase({content:serializeBase(config)},0,{name:'待复习',append:true}),/同名/);
});
test('plain duplicate of every preset round-trips without anchors and rename retains navigation identity', () => {
  for(const index of [0,1,2]) {
    const record={content:serializeBase(defaultLibraryBase())};
    const copy=updatedBase(record,index,{name:'副本',layout:'cards',order:['file.name'],filters:emptyBaseFilters(),append:true});
    const config=parseBase(copy.content); assert.equal(config.views.length,4); evaluateBase(config,[],3); assert.equal(config.views[3].notara?.preset,undefined);
    config.views[index].name='改了名字'; assert.equal(presetIndex(config,['all','guides','review'][index]),index);
  }
});
test('Base query preserves configured sort unless explicitly overridden', () => {
  const query=baseQuery('资料库.base',2,emptyBaseFilters()); assert.equal(query.sort,undefined); assert.equal(query.type,undefined); assert.equal(query.reviewStatus,undefined); assert.equal(query.base.view,2);
});
test('card previews default off, persist per view and survive unrelated settings', () => {
  const config=defaultLibraryBase(), record={content:serializeBase(config)};
  assert.ok(config.views.every(view=>view.notara?.cardPreview !== true));
  const options={name:'全部资料',layout:'cards',order:['file.name','note.tags'],filters:emptyBaseFilters()};
  const enabled=updatedBase(record,0,{...options,cardPreview:true});
  const saved=parseBase(enabled.content);
  assert.equal(saved.views[0].notara.cardPreview,true);
  assert.equal(saved.views[1].notara.cardPreview,undefined);
  const table=updatedBase(enabled,0,{...options,layout:'table'});
  assert.equal(parseBase(table.content).views[0].notara.cardPreview,true);
  const disabled=updatedBase(table,0,{...options,cardPreview:false});
  assert.equal(parseBase(disabled.content).views[0].notara.cardPreview,undefined);
  assert.equal(parseBase(disabled.content).views[0].notara.preset,'all');
  saved.views[0].notara.cardPreview='true';
  assert.throws(()=>evaluateBase(saved,[],0),/正文预览设置无效/);
});
test('union tag conditions retain OR semantics when saved and reopened as a Base',()=>{
  const record={content:serializeBase(defaultLibraryBase())};
  const filters={...emptyBaseFilters(),tags:['数学','几何'],tagMatch:'any'};
  assert.equal(baseQuery('资料库.base',0,filters).tagMatch,'any');
  const saved=updatedBase(record,0,{name:'任一专题',layout:'table',order:['file.name'],filters,append:true});
  const config=parseBase(saved.content), docs=[['a',['数学']],['b',['几何']],['c',['数学','几何']],['d',[]]].map(([path,tags])=>({path:path+'.md',tags,frontmatter:{type:'card',tags}}));
  assert.deepEqual(evaluateBase(config,docs,saved.index).rows.map(doc=>doc.path),['a.md','b.md','c.md']);
  const intersection=updatedBase(record,0,{name:'共同专题',layout:'table',order:['file.name'],filters:{...filters,tagMatch:'all'},append:true});
  assert.deepEqual(evaluateBase(parseBase(intersection.content),docs,intersection.index).rows.map(doc=>doc.path),['c.md']);
});
test('initial Base creation never overwrites an existing unindexed or concurrently-created file', async () => {
  const calls=[], current={path:'资料库.base',content:'views: []',revision:'external'};
  const remote={query:async()=>({documents:[]}),save:async input=>{calls.push(input);throw new Error('conflict');},read:async()=>current};
  assert.equal(await loadBase(remote,current.path),current); assert.equal(calls[0].expectedRevision,null);
});
test('routes and lessons presets resolve real updatedBase views without tampering, and removed all-view returns -1', () => {
  const base = defaultLibraryBase();
  assert.equal(base.views.length, 3);
  assert.equal(presetIndex(base, 'routes'), -1);
  assert.equal(presetIndex(base, 'lessons'), -1);
  const withRoute = updatedBase({ content: serializeBase(base) }, 0, {
    name: '全部路线',
    layout: 'table',
    order: ['file.name', 'notara.type'],
    filters: { ...emptyBaseFilters(), type: 'route' },
    append: true,
    clearFilters: true,
  });
  const withBoth = parseBase(updatedBase({ content: withRoute.content }, 0, {
    name: '备课本清单',
    layout: 'cards',
    order: ['file.name', 'notara.type'],
    filters: { ...emptyBaseFilters(), type: 'lesson' },
    append: true,
    clearFilters: true,
  }).content);
  assert.deepEqual(withBoth.views[3].filters, { and: ['notara.type == "route"'] });
  assert.deepEqual(withBoth.views[4].filters, { and: ['notara.type == "lesson"'] });
  assert.equal(presetIndex(withBoth, 'routes'), 3);
  assert.equal(presetIndex(withBoth, 'lessons'), 4);

  const filteredRouteWithTag = parseBase(updatedBase({ content: serializeBase(base) }, 0, {
    name: '数学路线',
    layout: 'table',
    order: ['file.name'],
    filters: { ...emptyBaseFilters(), type: 'route', tags: ['数学'] },
    append: true,
    clearFilters: true,
  }).content);
  assert.equal(presetIndex(filteredRouteWithTag, 'routes'), -1, 'narrowed multi-clause tag+route view must not masquerade as global routes preset');

  const withoutAll = { ...base, views: base.views.slice(1) };
  assert.equal(presetIndex(withoutAll, 'all'), -1, 'removing 全部资料 must return -1 rather than falling back to a filtered view');
});
