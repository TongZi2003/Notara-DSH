import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseBase, serializeBase, evaluateBase, defaultLibraryBase, filtersToBase,learningReviewBase } from '../bases.js';
import { createVaultStore } from '../vault-indexer.js';
test('built-in review predicate admits diary plans without rewriting custom view scope',()=>{
 const old={type:'table',name:'待复习',notara:{preset:'review'},filters:{and:['notara.type == "card"','date(notara.reviewDue) <= today()']}};
 const custom={...old,filters:{and:[...old.filters.and,'file.hasTag("数学")']}},config={views:[old,custom]};
 learningReviewBase(config);assert.equal(config.views[0].filters,'date(notara.reviewDue) <= today()');assert.equal(config.views[1],custom);assert.equal(custom.filters.and.length,3);
});
test('review question projection uses real saved fields and filters each diary topic before display',async t=>{
 const root=mkdtempSync(join(tmpdir(),'notara-base-questions-'));const store=createVaultStore({root,now:()=>new Date('2026-11-07T12:00:00+08:00')});t.after(async()=>{await store.close();rmSync(root,{recursive:true,force:true});});
 let saved=store.save({path:'讨论.md',content:'---\ntype: diary\nmode: focus\n---\n## 今天\n真实记录\n## 以后\n另一次记录\n',expectedRevision:null});
 for(const [heading,question,afterDays] of [['今天','现在的问题',0],['以后','未来的问题',6]])saved=store.scheduleReview({path:'讨论.md',heading,expectedRevision:saved.revision,followUp:{question,afterDays,reason:'安排依据'}});
 const config=defaultLibraryBase();config.views[2].filters={and:[config.views[2].filters,'note.mode == "focus"']};config.views[2].order=['file.name'];
 store.save({path:'资料库.base',content:serializeBase(config),expectedRevision:null});
 const result=store.query({base:{path:'资料库.base',view:2}}).documents[0];
 assert.equal(result.reviewPlans.length,2);assert.deepEqual(result.viewReviewPlans.map(p=>p.question),['现在的问题']);assert.equal(result.frontmatter,undefined);
 const ordinary=store.query({base:{path:'资料库.base',view:0}}).documents[0];assert.equal(ordinary.viewReviewPlans,undefined);
});

test('current review filters use schedule projections; explicit raw-property queries stay raw',()=>{
  const document={path:'a.md',type:'card',reviewDue:'2026-10-25',reviewStatus:'learning',reviewStage:1,frontmatter:{mastery:5}};
  const config={views:[{type:'table',filters:{and:filtersToBase({reviewStatus:'familiar'})},order:['notara.reviewStage']}]};
  assert.equal(evaluateBase(config,[document]).rows.length,0);
  config.views[0].filters='note.mastery >= 4';assert.equal(evaluateBase(config,[document]).rows.length,1);
  config.views[0].filters={and:filtersToBase({reviewStatus:'pending'})};
  assert.equal(evaluateBase(config,[{...document,reviewDue:null,reviewStage:null,reviewStatus:'needs-review'}]).rows.length,0);
});

test('safe YAML preserves comments and unknown fields but refuses unsupported execution', () => {
  const text = '# 保留注释\r\nfilters: \'file.ext == "md"\'\r\nviews:\r\n  - type: table\r\n    name: 全部\r\ncustom: untouched\r\n';
  const config = parseBase(text); assert.equal(serializeBase(config),text);
  config.views[0].name = '重命名'; assert.match(serializeBase(config),/# 保留注释/); assert.match(serializeBase(config),/custom: untouched/);
  assert.throws(() => evaluateBase(config,[]),/base.custom/);
  for (const source of ['a: &x {}\nb: *x','__proto__: {}','views: []\nviews: []']) assert.throws(() => parseBase(source));
  assert.throws(() => evaluateBase({views:[{type:'table',filters:'process.exit()'}]},[]));
});
test('AND filters, multiple tags, strict dates and missing properties', () => {
  const config = defaultLibraryBase();
  config.filters = {and:['file.ext == "md"','file.hasTag("数学")','file.hasTag("共同")']};
  const docs = [
    {path:'a.md',tags:['数学/代数','共同'],frontmatter:{type:'card'},reviewDue:'2026-10-25'},
    {path:'b.md',tags:['数学','共同'],frontmatter:{type:'card'},reviewDue:'2026-10-26'},
    {path:'c.md',tags:['数学','共同'],frontmatter:{type:'card'},reviewDue:'2026-02-30'},
    {path:'d.md',tags:['数学'],frontmatter:{type:'card'},reviewDue:'2026-10-25'},
  ];
  docs.forEach(doc => {doc.type=doc.frontmatter.type;});
  assert.deepEqual(evaluateBase(config,docs,2,{today:'2026-10-25'}).rows.map(x=>x.path),['a.md']);
  config.views[0].sort=[{property:'notara.reviewCount',direction:'DESC'}];
  assert.equal(evaluateBase(config,docs).rows.length,3);
  config.views[0].groupBy={property:'bad.foo'}; assert.throws(() => evaluateBase(config,docs));
});
test('Base queries use cached files, persist CAS, combine saved + temporary search, and keep review facts authoritative', async t => {
  const root=mkdtempSync(join(tmpdir(),'notara-base-'));
  const card='---\ntype: card\ntags: [数学, 共同]\nlearned: true\nmastery: 1\ninterval: 1\nlast_review: 2026-10-24\nnext_review: 2026-10-25\n---\n# 甲\n矩阵特征内容\n';
  writeFileSync(join(root,'甲.md'),card);
  writeFileSync(join(root,'乙.md'),'---\ntype: source\ntags: [数学, 共同]\n---\n# 乙\n矩阵来源\n');
  writeFileSync(join(root,'专题导读.md'),'# 专题导读\n- [ ] 读甲\n');
  writeFileSync(join(root,'无效日期.md'),'---\ntype: card\nnext_review: 2000-01-01\n---\n未安排');
  const store=createVaultStore({root,now:()=>new Date('2026-10-25T12:00:00+08:00')});
  t.after(async()=>{await store.close();rmSync(root,{recursive:true,force:true});});
  const path='资料库.base';
  const saved=store.save({path,content:serializeBase(defaultLibraryBase()),expectedRevision:null});
  assert.equal(store.read({path}).mimeType,'application/yaml');
  assert.equal(store.query({base:{path,view:0}}).total,4);
  assert.deepEqual(store.query({base:{path,view:1}}).documents.map(x=>x.path),['专题导读.md']);
  assert.deepEqual(store.query({base:{path,view:2}}).documents.map(x=>x.path),['甲.md']);
  const config=parseBase(store.read({path}).content); config.views[0].notara={search:'矩阵'};
  config.views[0].filters='file.hasTag("共同")'; config.views[0].type='cards'; config.views[0].order=['file.name','note.tags'];
  store.save({path,content:serializeBase(config),expectedRevision:saved.revision});
  assert.throws(()=>store.query({base:{path,view:0,expectedRevision:saved.revision}}),/base_revision_conflict/);
  assert.throws(()=>store.save({path,content:'views: []',expectedRevision:saved.revision}),/revision_conflict/);
  const before={...store.metrics};
  const result=store.query({base:{path,view:0},q:'特征',tags:['数学'],limit:1});
  assert.equal(result.total,1); assert.equal(result.documents[0].title,'甲');
  assert.deepEqual(result.documents[0].properties['note.tags'],['数学','共同']);
  assert.equal(store.metrics.scans,before.scans); assert.equal(store.metrics.fileReads,before.fileReads+1);
  assert.equal(readFileSync(join(root,'甲.md'),'utf8'),card);
  const propertyRead=store.read({path:'乙.md'});
  const propertySaved=store.save({path:'乙.md',properties:{tags:['数学','新标签'],score:5,enabled:true},expectedRevision:propertyRead.revision});
  assert.equal(store.query({q:'来源',tags:['新标签']}).total,1);
  assert.throws(()=>store.save({path:'乙.md',properties:{score:6},expectedRevision:propertyRead.revision}),/revision_conflict/);
  assert.throws(()=>store.save({path:'乙.md',properties:{'bad\nkey':'injection'},expectedRevision:propertySaved.revision}),/property_invalid/);
  assert.equal(store.read({path:'乙.md'}).content.split('---\n').at(-1),propertyRead.content.split('---\n').at(-1));
  const binaryConfig={views:[{type:'table',name:'白板',filters:'notara.type == "canvas"'}]};
  store.save({path:'白板.canvas',content:'{"nodes":[],"edges":[]}',expectedRevision:null});
  store.save({path:'白板库.base',content:serializeBase(binaryConfig),expectedRevision:null});
  assert.equal(store.query({base:{path:'白板库.base',view:0}}).total,store.query({type:'canvas'}).total);
  store.recordReview({path:'甲.md',result:'done',support:'independent',keyStep:'矩阵',note:'已独立写出矩阵推导',followUp:{question:'换一个矩阵再比较',afterDays:8,reason:'这次完整走通，下周再迁移'}});
  assert.equal(store.query({base:{path,view:2}}).total,0);
  store.undoReview({path:'甲.md'}); assert.equal(store.query({base:{path,view:2}}).total,1);
  writeFileSync(join(root,'非法.base'),Buffer.from([0xff,0xfe])); assert.throws(()=>store.read({path:'非法.base'}));
});

test('Base filters distinguish legacy guides, routes, and lessons while preserving custom views', async t => {
  const root = mkdtempSync(join(tmpdir(), 'notara-base-roles-'));
  writeFileSync(join(root, '导读.md'), '---\ntype: source\ntags: [导读]\n---\n# 导读\n- [ ] 读材料\n');
  writeFileSync(join(root, '原件.md'), '---\ntype: source\n---\n# 原件\n原始讲义\n');
  writeFileSync(join(root, '路线.md'), '---\ntype: route\n---\n# 学习路线\n- [ ] 里程碑\n');
  writeFileSync(join(root, '备课.md'), '---\ntype: lesson\n---\n# 备课本\n- [ ] 环节一\n');
  const customBase = [
    'views:',
    '  - type: table',
    '    name: 资料导读',
    '    filters: \'notara.type == "guide"\'',
    '    notara:',
    '      preset: guides',
    '  - type: table',
    '    name: 我的路线',
    '    filters: \'notara.type == "route"\'',
    '    notara:',
    '      preset: routes',
    '  - type: table',
    '    name: 我的备课本',
    '    filters: \'notara.type == "lesson"\'',
    '    notara:',
    '      preset: lessons',
  ].join('\n');
  writeFileSync(join(root, '教学文档.base'), customBase);
  const store = createVaultStore({ root });
  t.after(async () => { await store.close(); rmSync(root, { recursive: true, force: true }); });
  assert.deepEqual(store.query({ base: { path: '教学文档.base', view: 0 } }).documents.map(d => d.path), ['导读.md']);
  assert.deepEqual(store.query({ base: { path: '教学文档.base', view: 1 } }).documents.map(d => d.path), ['路线.md']);
  assert.deepEqual(store.query({ base: { path: '教学文档.base', view: 2 } }).documents.map(d => d.path), ['备课.md']);
});
