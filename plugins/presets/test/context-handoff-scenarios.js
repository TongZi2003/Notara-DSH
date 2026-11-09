import assert from 'node:assert/strict';
import test from 'node:test';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export function registerContextHandoffTests({harness}) {
  for(const parentPreset of ['notara-coordinator','notara-teacher'])test(`first ${parentPreset} delegation request uses the explicit route before its handoff is published`,async t=>{
    const h=await harness(t,{withController:true}),{ctx,root,requests}=h;
    for(const [path,body] of [['数学.md','MATH_ROUTE_FULL_BODY'],['化学.md','CHEMISTRY_ROUTE_FULL_BODY']])await writeFile(join(root,path),`---\ntype: route\n---\n# 路线\n${body}`);
    const fiber=ctx.plugin(await import('../../vault-sqlite/index.js'),{root,cachePath:':memory:'});await fiber;
    const parent=await h.create(parentPreset);
    const result=await ctx.tools.execute({name:'subagent',callId:'route-first',agent:parent,signal:new AbortController().signal,arguments:{preset:'notara-teacher',description:'本课',prompt:'准备本课。',routePath:'数学.md'}});
    assert.equal(result.isError,false,JSON.stringify(result));await ctx.agents.get(result.value.id).whenIdle();
    const request=requests.find(row=>row.sessionId===result.value.id);assert.ok(request);
    const contexts=request.messages.filter(m=>m.source.kind==='notara-context-update').map(m=>JSON.stringify(m.content)).join('\n');
    assert.match(contexts,/MATH_ROUTE_FULL_BODY/);assert.doesNotMatch(contexts,/CHEMISTRY_ROUTE_FULL_BODY/);
  });
  for(const preset of ['notara-teacher','notara-material-organizer','worker-general','worker-review','companion-claude','companion-deepseek-blind']) {
    test(`selected parent images reach ${preset} without copying other classroom history`,async t=>{
      const {default:sharp}=await import('sharp');
      const h=await harness(t,{withController:true});const {ctx,requests}=h;
      const parent=await h.create(preset==='notara-material-organizer'?'notara-coordinator':'notara-teacher');
      const save=async background=>ctx.attachments.saveImage({mediaType:'image/png',data:await sharp({create:{width:10,height:10,channels:4,background}}).png().toBuffer(),name:'原题.png'});
      const wanted=await save('#ff0000'),other=await save('#0000ff');
      parent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'PRIVATE_PARENT_HISTORY'},{type:'image',attachment:wanted},{type:'image',attachment:other}]}));await parent.whenIdle();
      const args={preset,description:'原题图交接',parentImages:[wanted.attachmentId],...(preset==='companion-deepseek-blind'?{problem:'解释原题图',studentExplanation:'这是学生的完整解释。'}:{prompt:'核对所选原题图。学生原话：我以为这两边相等。已给帮助：只指出角标，没有提示解法。'})};
      const result=await ctx.tools.execute({name:'subagent',callId:'selected-image',arguments:args,agent:parent,signal:new AbortController().signal});
      assert.equal(result.isError,false,JSON.stringify(result));
      await ctx.subagents.waitForChildren(parent);await ctx.agents.get(result.value.id)?.whenIdle();
      const request=requests.find(row=>row.sessionId===result.value.id);assert.ok(request);
      const images=request.messages.flatMap(m=>m.content??[]).filter(b=>b.type==='image');
      assert.deepEqual(images.map(b=>b.attachment.attachmentId),[wanted.attachmentId]);
      assert.doesNotMatch(JSON.stringify(request.messages),/PRIVATE_PARENT_HISTORY/);
      if(preset==='companion-deepseek-blind')assert.equal(request.tools?.length??0,0);
      else assert.match(JSON.stringify(request.messages),/已给帮助：只指出角标，没有提示解法/);
    });
  }
  test('topic route and image handoff survives retry, cold read and a second worker hop',async t=>{
    const {default:sharp}=await import('sharp');
    const h=await harness(t,{withController:true}),{ctx,requests,root}=h;
    await writeFile(join(root,'路线.md'),'---\ntype: route\n---\n# 本次路线\n');
    const fiber=ctx.plugin(await import('../../vault-sqlite/index.js'),{root,cachePath:':memory:'});await fiber;
    const parent=await h.create('notara-coordinator');
    const ref=await ctx.attachments.saveImage({mediaType:'image/png',data:await sharp({create:{width:10,height:10,channels:4,background:'#00ff00'}}).png().toBuffer()});
    parent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'本次资料'},{type:'image',attachment:ref}]}));await parent.whenIdle();
    const args={preset:'notara-teacher',description:'专题',prompt:'保留必要课堂事实。',routePath:'路线.md',parentImages:[ref.attachmentId]},signal=new AbortController().signal;
    const first=await ctx.notaraTopics.start(parent,args,'same-handoff',signal),teacher=ctx.agents.get(first.id);await teacher.whenIdle();
    const again=await ctx.notaraTopics.start(parent,args,'same-handoff',signal);assert.equal(again.id,first.id);
    await assert.rejects(ctx.notaraTopics.start(parent,{...args,parentImages:[]},'same-handoff',signal),/另一份交接|不同内容/);
    await ctx.sessions.flush(teacher.session);const snapshot=await ctx.sessionQuery.readSession(teacher.id);
    const handoffs=snapshot.events.filter(e=>e.type==='user/message'&&e.data.source.kind==='notara-topic-handoff');
    assert.equal(handoffs.length,1);assert.equal(handoffs[0].data.source.routePath,'路线.md');
    assert.equal(handoffs[0].data.content.find(b=>b.type==='image').attachment.attachmentId,ref.attachmentId);
    const worker=await ctx.tools.execute({name:'subagent',callId:'second-hop',agent:teacher,signal,arguments:{preset:'worker-review',description:'核图',prompt:'只看原题图。',parentImages:[ref.attachmentId]}});
    assert.equal(worker.isError,false,JSON.stringify(worker));
    assert.ok(requests.find(r=>r.sessionId===worker.value.id).messages.flatMap(m=>m.content??[]).some(b=>b.type==='image'&&b.attachment.attachmentId===ref.attachmentId));
  });
}
