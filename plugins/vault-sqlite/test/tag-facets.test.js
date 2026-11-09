import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,renameSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createVaultStore} from '../vault-indexer.js';
import {serializeBase,filtersToBase} from '../bases.js';

const document=(type,tags=[],title='')=>`---\ntype: ${type}\ntags: ${JSON.stringify(tags)}\n${title?`title: ${JSON.stringify(title)}\n`:''}---\n原始材料。`;
function fixture(t,files){
  const root=mkdtempSync(join(tmpdir(),'notara-entity-facets-'));
  for(const [path,content]of Object.entries(files)){mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),content);}
  const store=createVaultStore({root});
  t.after(async()=>{await store.close();rmSync(root,{recursive:true,force:true});});
  return {root,store};
}

test('tag facets aggregate entity aliases by target and count each document once, preserving raw non-entity tags',t=>{
  const raw=['[[卡片/均值|算术几何均值]]','[[卡片/均值.md|AM-GM]]','[[卡片/均值|算术几何均值]]','均值不等式','[[缺失|保留别名]]','[[卡片/旧卡]]','[[同名]]'];
  const {store,root}=fixture(t,{
    '卡片/均值.md':document('concept',[],'均值不等式'),'卡片/旧卡.md':document('card'),
    '甲/同名.md':document('concept'),'乙/同名.md':document('method'),
    '题目.md':document('exercise',raw),'实验.md':document('exercise',['[[均值|实验别名]]']),
    '历史.md':document('exercise',['[[卡片/均值.md]]']),
  });
  const before={...store.metrics},all=store.query({facet:'tags',limit:200});
  const entity=all.values.find(row=>row.target==='卡片/均值.md');
  assert.deepEqual({...entity},{value:'[[卡片/均值.md]]',count:3,label:'均值不等式',target:'卡片/均值.md'});
  assert.equal(all.total,5);
  assert.deepEqual(all.values.filter(row=>!row.target).map(row=>({...row})).sort((a,b)=>a.value.localeCompare(b.value)),[
    {value:'均值不等式',count:1},{value:'[[缺失|保留别名]]',count:1},{value:'[[卡片/旧卡]]',count:1},{value:'[[同名]]',count:1},
  ].sort((a,b)=>a.value.localeCompare(b.value)));
  assert.equal(store.query({tags:[entity.value]}).total,3);
  assert.equal(store.graph({tagFilter:entity.value}).nodes.length,3);
  assert.equal(store.metrics.fileReads,before.fileReads);assert.equal(store.metrics.scans,before.scans);
  store.save({path:'筛选.base',expectedRevision:null,content:serializeBase({filters:{and:filtersToBase({tags:[entity.value]})},views:[{type:'table'}]})});
  assert.equal(store.query({base:{path:'筛选.base'}}).total,3);
  assert.equal(readFileSync(join(root,'题目.md'),'utf8'),document('exercise',raw));
});

test('facet search discovers entity title and any alias while counts and pagination use complete aggregated groups',t=>{
  const {store}=fixture(t,{
    '卡片/A.md':document('concept',[],'知识标题Alpha'),'卡片/B.md':document('method',[],'知识标题Beta'),
    '一.md':document('exercise',['[[卡片/A|共同别名]]','[[卡片/A|独有别名100%_]]','[[卡片/B|共同别名]]','共同别名']),
    '二.md':document('exercise',['[[A|另一别名]]']),'三.md':document('exercise',['[[卡片/A.md]]']),
  });
  const before={...store.metrics};
  for(const search of ['知识标题Alpha','独有别名','另一别名','alpha','A.md','100%_']){
    const result=store.query({facet:'tags',search});
    assert.equal(result.total,1,search);
    assert.deepEqual({...result.values[0]},{value:'[[卡片/A.md]]',count:3,label:'知识标题Alpha',target:'卡片/A.md'},search);
  }
  assert.equal(store.query({facet:'tags',search:'100X_'}).total,0,'search is literal, not SQL wildcard matching');
  const all=store.query({facet:'tags',search:'共同别名',limit:200});
  assert.equal(all.total,3,'two target identities and one ordinary tag remain distinct');
  assert.equal(all.values.find(row=>row.target==='卡片/A.md').count,3,'an alias match in one document still returns the whole entity count');
  const pages=[];
  for(let offset=0;offset<3;offset++){
    const page=store.query({facet:'tags',search:'共同别名',limit:1,offset});
    assert.equal(page.total,3);pages.push(...page.values);
  }
  assert.deepEqual(pages,all.values);
  const outside=store.query({facet:'tags',search:'共同别名',limit:1,offset:3});assert.equal(outside.total,3);assert.deepEqual(outside.values,[]);
  assert.equal(store.metrics.fileReads,before.fileReads);assert.equal(store.metrics.scans,before.scans);
});

test('facet entity moves and metadata edits invalidate canonical groups without rewriting raw tags or reading on query',t=>{
  const raw=['[[卡片/A|旧别名]]','[[卡片/A.md|又一别名]]'];
  const {root,store}=fixture(t,{'卡片/A.md':document('concept',[],'原名'),'例子.md':document('exercise',raw)});
  assert.deepEqual({...store.query({facet:'tags'}).values[0]},{value:'[[卡片/A.md]]',count:1,label:'原名',target:'卡片/A.md'});
  const entity=store.read({path:'卡片/A.md'});
  store.save({path:entity.path,expectedRevision:entity.revision,content:document('method',[],'新标题')});
  assert.equal(store.query({facet:'tags',search:'新标题'}).values[0].label,'新标题');
  renameSync(join(root,'卡片/A.md'),join(root,'卡片/移动.md'));store.scan();
  const before={...store.metrics},after=store.query({facet:'tags'});
  assert.equal(after.total,2);
  assert.deepEqual(after.values.map(row=>({...row})),raw.map(value=>({value,count:1})).sort((a,b)=>a.value<b.value?-1:a.value>b.value?1:0));
  assert.equal(store.query({facet:'tags',search:'新标题'}).total,0);
  assert.equal(store.metrics.fileReads,before.fileReads);assert.equal(store.metrics.scans,before.scans);
  assert.equal(readFileSync(join(root,'例子.md'),'utf8'),document('exercise',raw));
});

test('tag facets page the full index without reading files or returning document DTOs', async t=>{
  const root=mkdtempSync(join(tmpdir(),'notara-tag-facets-')),cachePath=join(root,'cache.sqlite');
  writeFileSync(join(root,'A.md'),'---\ntags: [数学, 数学, SVD, "100%", "a_b", "folder/tag", "quote\'tag"]\n---\n# A');
  writeFileSync(join(root,'B.md'),'---\ntags: [数学, svd]\n---\n# B');
  const store=createVaultStore({root,cachePath});
  t.after(async()=>{await store.close();rmSync(root,{recursive:true,force:true});});
  const before={...store.metrics};
  const math=store.query({facet:'tags',search:'数学'});assert.equal(math.total,1);assert.deepEqual({...math.values[0]},{value:'数学',count:2});assert.equal(math.documents,undefined);
  assert.equal(store.query({facet:'tags',search:'sVd'}).total,2);
  for(const literal of ['%','_','/',"'"])assert.equal(store.query({facet:'tags',search:literal}).total,1);
  const all=store.query({facet:'tags',limit:200}), pages=[];
  for(let offset=0;offset<all.total;offset+=2)pages.push(...store.query({facet:'tags',limit:2,offset}).values.map(item=>item.value));
  assert.deepEqual(pages,all.values.map(item=>item.value));assert.equal(new Set(pages).size,pages.length);
  const outside=store.query({facet:'tags',offset:10000});assert.equal(outside.total,all.total);assert.equal(outside.values.length,0);
  for(const input of [{facet:'other'},{facet:'tags',base:{path:'x.base'}},{facet:'tags',limit:201},{facet:'tags',offset:-1},{facet:'tags',search:3},{facet:'tags',offset:Number.MAX_SAFE_INTEGER+1}])assert.throws(()=>store.query(input),/vault_input_invalid/);
  assert.equal(store.metrics.scans,before.scans);assert.equal(store.metrics.fileReads,before.fileReads);
  // Seed only this temporary cache to model a vocabulary outside the 10,000-document page.
  const index=new DatabaseSync(cachePath),insert=index.prepare('INSERT INTO documents(path,title,tags_json,frontmatter_json) VALUES(?,?,?,?)');
  index.exec('BEGIN');for(let i=0;i<10000;i++)insert.run(`cached-${i}.md`,String(i).padStart(5,'0'),'["常用"]','{}');insert.run('last.md','zz-last','["末页独有"]','{}');index.exec('COMMIT');index.close();
  assert.equal(store.query({limit:10000}).documents.some(doc=>doc.tags.includes('末页独有')),false);
  assert.equal(store.query({facet:'tags',search:'末页独有'}).total,1);
  const current=store.read({path:'B.md'});store.save({path:'B.md',content:'---\ntags: [更新标签]\n---\n# B',expectedRevision:current.revision});
  assert.equal(store.query({facet:'tags',search:'svd'}).total,1);assert.equal(store.query({facet:'tags',search:'更新标签'}).total,1);
});
