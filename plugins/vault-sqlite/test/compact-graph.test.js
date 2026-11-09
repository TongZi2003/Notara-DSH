import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createVaultStore} from '../vault-indexer.js';

test('compact graph is opt-in, preserves every relation and does not pollute full graph caches',async t=>{
 const root=mkdtempSync(join(tmpdir(),'compact-graph-'));let store;t.after(async()=>{await store?.close();rmSync(root,{recursive:true,force:true});});
 writeFileSync(join(root,'原书.md'),'---\ntype: source\n---\n原书');
 writeFileSync(join(root,'概念.md'),'---\ntype: concept\n---\n## 来源\n[[原书]]\n## 参考理解\n'+('完整说明。'.repeat(800)));
 writeFileSync(join(root,'方法.md'),'---\ntype: method\n---\n## 前序依赖\n- [[概念]]：先理解定义\n## 学生理解\n### 已建立的联系\n- [[概念]]：有关联');
 writeFileSync(join(root,'例子.md'),'---\ntype: exercise\ntags: ["[[概念|别名]]"]\n---\n## 来源\n[[原书]]');
 store=createVaultStore({root});const full=store.graph(),compact=store.graph({compact:true});
 assert.equal(compact.wireVersion,1,'explicit compact request uses its lighter transport');
 const {decodeCompactGraph}=await import('../graph-transport.js');const decoded=structuredClone(decodeCompactGraph(compact));
 assert.deepEqual(decoded.edges,full.edges);assert.deepEqual(decoded.nodes.map(n=>n.path),full.nodes.map(n=>n.path));
 for(const node of decoded.nodes){const expected=full.nodes.find(n=>n.path===node.path);for(const [key,value]of Object.entries(node))assert.deepEqual(value,expected[key]);assert.ok(!Object.hasOwn(node,'summary'));}
 assert.ok(JSON.stringify(compact).length<JSON.stringify(full).length*.7);
 compact.strings[0]='corrupt';compact.nodes[0].tags.push('corrupt');compact.edges[0][8][0][0]=-1;
 assert.deepEqual(store.graph(),full);assert.deepEqual(store.graph({compact:false}),full);assert.deepEqual(decodeCompactGraph(store.graph({compact:true})),decoded);
 assert.throws(()=>store.graph({compact:'yes'}),/vault_input_invalid/);
 const revision=store.read({path:'方法.md'}).revision;store.save({path:'方法.md',expectedRevision:revision,content:'---\ntype: method\n---\n修改后'});
 assert.deepEqual(decodeCompactGraph(store.graph({compact:true})).edges,store.graph().edges);
});
