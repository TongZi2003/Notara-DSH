import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,unlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Context} from '@deepseek-ai/cordis';
import * as StorageHub from '@deepseek-ai/dsh-storage';
import * as StorageJson from '@deepseek-ai/dsh-storage-json';
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain';
import plugin from '../index.js';

async function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'notara-whiteboard-')),vault=join(root,'vault'),other=join(root,'other');mkdirSync(vault);mkdirSync(other);
 const sessions=new Map(['teacher','coordinator','worker','companion'].map(role=>[role,{meta:{cwd:vault,agentPreset:role==='teacher'||role==='coordinator'?`notara-${role}`:`${role}-general`},events:[]}]));
 const ws={id:'a',path:vault,sessionIds:[...sessions.keys()]};let ctx;
 async function mount(){ctx=new Context();await ctx.plugin(StorageHub.default??StorageHub);await ctx.plugin(StorageJson.default??StorageJson,{root:join(root,'storage')});await ctx.plugin(StorageDomain.default??StorageDomain,{backend:'json'});ctx.provide('workspaceRegistry',{get:id=>id==='a'?ws:{id:'b',path:other,sessionIds:[]}});ctx.provide('sessionController',{inspect:async id=>sessions.get(id)??null});await ctx.plugin(plugin,{root:vault,cachePath:':memory:'});await ctx.notaraVault.ready;}
 await mount();t.after(async()=>{await ctx.fiber.dispose();rmSync(root,{recursive:true,force:true});});
 return {vault,sessions,ws,get api(){return ctx.notaraVault;},restart:async()=>{await ctx.fiber.dispose();await mount();}};
}
test('whiteboard activation is session-bound, idempotent, durable and disable retains the original file',async t=>{
 const f=await fixture(t),input={workspaceId:'a',sessionId:'teacher'};
 assert.equal((await f.api.whiteboard(input)).bound,false);
 const [a,b]=await Promise.all([f.api.setWhiteboard({...input,enabled:true}),f.api.setWhiteboard({...input,enabled:true})]);assert.equal(a.path,b.path);assert.equal(a.enabled,true);
 const file=join(f.vault,a.path),original=readFileSync(file,'utf8');assert.deepEqual(JSON.parse(original).nodes,[]);
 const off=await f.api.setWhiteboard({...input,enabled:false});assert.equal(off.enabled,false);assert.equal(off.path,a.path);assert.equal(readFileSync(file,'utf8'),original);
 await f.restart();assert.equal((await f.api.whiteboard(input)).enabled,false);assert.equal((await f.api.setWhiteboard({...input,enabled:true})).path,a.path);
 const c=await f.api.setWhiteboard({workspaceId:'a',sessionId:'coordinator',enabled:true});assert.notEqual(c.path,a.path);
 assert.equal((await f.api.lessonPlan({workspaceId:'a',sessionId:'coordinator'})).eligible,false,'whiteboard permission must not broaden lesson editing');
});
test('existing board binding preserves content and missing board is reported rather than silently replaced',async t=>{
 const f=await fixture(t),input={workspaceId:'a',sessionId:'teacher'},content=JSON.stringify({nodes:[{id:'student',type:'text',text:'学生自己的方法',x:12,y:34,width:300,height:200}],edges:[]});
 writeFileSync(join(f.vault,'已有.canvas'),content);
 const a=await f.api.setWhiteboard({...input,enabled:true,path:'已有.canvas'});assert.equal(a.path,'已有.canvas');assert.equal(readFileSync(join(f.vault,a.path),'utf8'),content);
 unlinkSync(join(f.vault,a.path));assert.equal((await f.api.whiteboard(input)).missing,true);
 await assert.rejects(f.api.setWhiteboard({...input,enabled:true}),/whiteboard_missing/);
 assert.equal((await f.api.setWhiteboard({...input,enabled:false})).enabled,false);
});
test('whiteboard rejects cross-workspace, archive, unknown sessions, nonteaching roles and invalid files',async t=>{
 const f=await fixture(t);
 for(const sessionId of ['worker','companion'])await assert.rejects(f.api.setWhiteboard({workspaceId:'a',sessionId,enabled:true}),/role_forbidden/);
 await assert.rejects(f.api.setWhiteboard({workspaceId:'b',sessionId:'teacher',enabled:true}),/workspace_mismatch/);
 await assert.rejects(f.api.setWhiteboard({workspaceId:'a',sessionId:'unknown',enabled:true}),/session_not_found/);
 const input={workspaceId:'a',sessionId:'teacher',enabled:true};
 await assert.rejects(f.api.setWhiteboard({...input,path:'../outside.canvas'}));
 writeFileSync(join(f.vault,'note.md'),'不是白板');await assert.rejects(f.api.setWhiteboard({...input,path:'note.md'}),/whiteboard_path/);
 writeFileSync(join(f.vault,'bad.canvas'),'not json');await assert.rejects(f.api.setWhiteboard({...input,path:'bad.canvas'}));assert.equal((await f.api.whiteboard(input)).bound,false);
 f.ws.archivedSessionIds=['teacher'];await assert.rejects(f.api.setWhiteboard(input),/archived/);
});
test('stopping a corrupt board succeeds; missing bound boards are not silently recreated by model writes',async t=>{
 const f=await fixture(t),input={workspaceId:'a',sessionId:'teacher'},bound=await f.api.setWhiteboard({...input,enabled:true});
 writeFileSync(join(f.vault,bound.path),'broken');
 assert.equal((await f.api.whiteboard(input)).invalid,true);
 assert.equal((await f.api.setWhiteboard({...input,enabled:false})).enabled,false);
 assert.equal((await f.api.whiteboard(input)).enabled,false);
 writeFileSync(join(f.vault,bound.path),'{"nodes":[],"edges":[]}');await f.api.setWhiteboard({...input,enabled:true});unlinkSync(join(f.vault,bound.path));
 await assert.rejects(f.api.whiteboards.saveCanvas({...input,path:bound.path,content:'{"nodes":[],"edges":[]}',expectedRevision:null}),/whiteboard_missing/);
});
test('automatic canvas commits share the activation queue, while unbound canvas creation keeps its original contract',async t=>{
 const f=await fixture(t),input={workspaceId:'a',sessionId:'teacher'},bound=await f.api.setWhiteboard({...input,enabled:true});
 const write={...input,path:bound.path,content:'{"nodes":[],"edges":[],"note":"teacher"}',expectedRevision:bound.revision};
 const [off,saved]=await Promise.allSettled([f.api.setWhiteboard({...input,enabled:false}),f.api.whiteboards.saveCanvas(write)]);
 assert.equal(off.status,'fulfilled');assert.equal(saved.status,'rejected');assert.match(saved.reason.message,/whiteboard_disabled/);
 assert.doesNotMatch(readFileSync(join(f.vault,bound.path),'utf8'),/teacher/);
 await f.api.whiteboards.saveCanvas({...input,path:'单独资料.canvas',content:'{"nodes":[],"edges":[]}',expectedRevision:null});
 assert.equal(JSON.parse(readFileSync(join(f.vault,'单独资料.canvas'),'utf8')).nodes.length,0);
});
test('canceling a queued teacher operation leaves the bound board unchanged',async t=>{
 const f=await fixture(t),input={workspaceId:'a',sessionId:'teacher'},bound=await f.api.setWhiteboard({...input,enabled:true});
 const original=readFileSync(join(f.vault,bound.path),'utf8'),controller=new AbortController();
 const enable=f.api.setWhiteboard({...input,enabled:true});
 const saving=f.api.whiteboards.saveCanvas({...input,path:bound.path,content:'{"nodes":[],"edges":[],"canceled":true}',expectedRevision:bound.revision,signal:controller.signal});
 controller.abort();await enable;await assert.rejects(saving,{name:'AbortError'});assert.equal(readFileSync(join(f.vault,bound.path),'utf8'),original);
});
