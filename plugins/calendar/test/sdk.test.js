import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {Context} from '@deepseek-ai/cordis';import {TypertRegistry} from '@deepseek-ai/dsh-typert-registry';import {TypertGatewayService} from '@deepseek-ai/dsh-api-gateway';import {RemoteAccessService} from '@deepseek-ai/dsh-api-remote-access';import {Peer} from '@deepseek-ai/dsh-client-connection';
import Vault from '@oh-my-student/plugin-vault-sqlite';import Calendar from '../index.js';
test('calendar reads and reschedules only the bound workspace with revision protection',async t=>{
 const root=await mkdtemp(join(tmpdir(),'calendar-rpc-')),ctx=new Context();
 t.after(async()=>{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});});
 for(const workspace of ['a','b']){await mkdir(join(root,workspace));await writeFile(join(root,workspace,'计划.md'),`---\ntype: plan\n---\n# ${workspace}\n- [ ] ${workspace}独有任务 📅 2026-10-27\n`);}
 ctx.provide('workspaceRegistry',{get:id=>['a','b'].includes(id)?{path:join(root,id)}:undefined});
 await ctx.plugin(TypertRegistry);await ctx.plugin(RemoteAccessService);await ctx.plugin(TypertGatewayService,{});
 await ctx.plugin(Vault,{root:join(root,'a'),cachePath:join(root,'cache'),now:()=>new Date(2026,9,27,12)});await ctx.plugin(Calendar);
 const peer=new Peer(ctx,{principal:{kind:'owner'}});t.after(()=>peer.dispose());
 const invoke=(method,input)=>ctx.typertGateway.invoke({namespace:'notaraCalendar',method,args:{input},peer});
 const view=workspaceId=>invoke('view',{workspaceId,from:'2026-10-01',to:'2026-10-31',timeZone:'Asia/Shanghai'});
 const [a,b]=await Promise.all([view('a'),view('b')]);assert.equal(a.events[0].title,'a独有任务');assert.equal(b.events[0].title,'b独有任务');
 assert.equal(a.today,'2026-10-27');
 const otherZone=await invoke('view',{workspaceId:'a',from:'2026-10-01',to:'2026-10-31',timeZone:'Pacific/Honolulu'});assert.equal(otherZone.today,a.today,'calendar and review writes share the runtime civil day, not the browser clock');
 const row=a.events[0],request={workspaceId:'a',kind:'plan',path:row.path,line:row.line,expectedText:row.text,expectedRevision:row.revision,date:'2026-10-29'};
 await invoke('reschedule',request);
 assert.match(await readFile(join(root,'a','计划.md'),'utf8'),/2026-10-29/);assert.match(await readFile(join(root,'b','计划.md'),'utf8'),/2026-10-27/);
 await assert.rejects(invoke('reschedule',request),/revision_conflict/);
 await assert.rejects(invoke('reschedule',{...request,workspaceId:'b'}),/revision_conflict/);
 await assert.rejects(view('missing'),/workspace_not_found/);await assert.rejects(view(null),/工作区/);
 await assert.rejects(invoke('reschedule',{...request,workspaceId:null}),/工作区/);
});
