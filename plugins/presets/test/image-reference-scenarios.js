import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createUserMessage,resolveImageAttachmentAccess} from '@deepseek-ai/dsh-llm';

export function registerImageReferenceTests({harness}){
 const png=async color=>(await import('sharp')).default({create:{width:12,height:12,channels:4,background:color}}).png().toBuffer();
 test('workspace image paths use native read_image and can be handed on by their existing attachment path',async t=>{
  const h=await harness(t,{withController:true,imageCapable:true}),{ctx,root,requests}=h,parent=await h.create('notara-coordinator');
  await mkdir(join(root,'媒体'));await writeFile(join(root,'媒体/原题.png'),await png('#fa0011'));
  const seen=[];ctx.on('tools/pre-execute',(exec,next)=>{if(exec.name==='read_image')seen.push({root:exec.rootCallId,agent:exec.agent.id,path:exec.arguments.file_path,parent:!!exec.parent});return next();});
  const result=await ctx.tools.execute({name:'subagent',callId:'workspace-image',arguments:{preset:'notara-teacher',description:'本题',prompt:'完整的课堂事实。',parentImages:['媒体/原题.png']},agent:parent,signal:new AbortController().signal});
  assert.equal(result.isError,false,JSON.stringify(result));const teacher=ctx.agents.get(result.value.id);await teacher.whenIdle();
  assert.equal(seen.length,1);assert.equal(seen[0].agent,parent.id);assert.equal(seen[0].root,'workspace-image');assert.equal(seen[0].parent,true);
  const first=requests.find(r=>r.sessionId===teacher.id),images=first.messages.flatMap(m=>m.content??[]).filter(b=>b.type==='image');assert.equal(images.length,1);
  const path=resolveImageAttachmentAccess(ctx.attachments,p=>ctx.fs.processPathFromHostPath(p),images[0].attachment).readonlyPath;
  const second=await ctx.tools.execute({name:'subagent',callId:'second-path',arguments:{preset:'worker-review',description:'核对原题',prompt:'对照原图。',parentImages:[path]},agent:teacher,signal:new AbortController().signal});
  assert.equal(second.isError,false,JSON.stringify(second));
  assert.deepEqual(requests.find(r=>r.sessionId===second.value.id).messages.flatMap(m=>m.content??[]).filter(b=>b.type==='image').map(b=>b.attachment.attachmentId),images.map(b=>b.attachment.attachmentId));
 });
 test('image paths cannot escape the workspace, borrow foreign attachments, or bypass native read denial',async t=>{
  const h=await harness(t,{withController:true}),{ctx,root}=h,parent=await h.create('notara-coordinator');
  const outside=await mkdtemp(join(tmpdir(),'notara-foreign-image-'));t.after(()=>rm(outside,{recursive:true,force:true}));
  await writeFile(join(outside,'外部.png'),await png('#1100fa'));await symlink(join(outside,'外部.png'),join(root,'逃逸.png'));
  await writeFile(join(root,'拒绝.png'),await png('#00fa11'));
  const foreign=await ctx.attachments.saveImage({mediaType:'image/png',data:await png('#99aa22'),name:'别的会话.png'});
  const path=resolveImageAttachmentAccess(ctx.attachments,p=>ctx.fs.processPathFromHostPath(p),foreign).readonlyPath;
  let reads=0;ctx.on('tools/pre-execute',(exec,next)=>{if(exec.name==='read_image'){reads++;return {kind:'deny',reason:'native-policy-denied'};}return next();});
  for(const reference of [join(outside,'外部.png'),'逃逸.png',path]){
   const result=await ctx.tools.execute({name:'subagent',callId:reference,arguments:{preset:'notara-teacher',description:'不应启动',prompt:'需要原图。',parentImages:[reference]},agent:parent,signal:new AbortController().signal});
   assert.equal(result.isError,true);assert.equal(reads,0);
  }
  const denied=await ctx.tools.execute({name:'subagent',callId:'denied',arguments:{preset:'notara-teacher',description:'不应启动',prompt:'需要原图。',parentImages:['拒绝.png']},agent:parent,signal:new AbortController().signal});
  assert.equal(denied.isError,true);assert.match(JSON.stringify(denied.content),/native-policy-denied/);assert.equal(reads,1);
 });
 test('blind image references still require an actual received original rather than an arbitrary workspace file',async t=>{
  const h=await harness(t,{withController:true}),{ctx,root}=h,parent=await h.create('notara-teacher');
  await writeFile(join(root,'答案.png'),await png('#aa2288'));
  const result=await ctx.tools.execute({name:'subagent',callId:'blind-outside-context',arguments:{preset:'companion-deepseek-blind',description:'听讲',problem:'原题',studentExplanation:'我的解释',parentImages:['答案.png']},agent:parent,signal:new AbortController().signal});
  assert.equal(result.isError,true);
 });
 test('a native read_image result can be handed on through its readonly attachment path',async t=>{
  let first=true;
  const h=await harness(t,{withController:true,imageCapable:true,respond:async function*(){
   if(first){first=false;yield {type:'block-start',index:0,blockType:'tool-call',id:'read-original',name:'read_image'};yield {type:'block-end',index:0,block:{type:'tool-call',id:'read-original',name:'read_image',arguments:JSON.stringify({file_path:'原题.png'})}};yield {type:'finish',reason:{kind:'tool-calls'}};return;}
   yield {type:'block-start',index:0,blockType:'text'};yield {type:'block-end',index:0,block:{type:'text',text:'已读图'}};yield {type:'finish',reason:{kind:'stop'}};
  }}),{ctx,root,requests}=h,parent=await h.create('notara-teacher');
  await writeFile(join(root,'原题.png'),await png('#cc2211'));
  parent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'看看原题.png'}]}));await parent.whenIdle();
  const ref=parent.session.snapshotEvents().find(e=>e.type==='tool/result')?.data.message.content.find(b=>b.type==='image')?.attachment;assert.ok(ref);
  const path=resolveImageAttachmentAccess(ctx.attachments,p=>ctx.fs.processPathFromHostPath(p),ref).readonlyPath;
  const result=await ctx.tools.execute({name:'subagent',callId:'forward-read-image',arguments:{preset:'worker-review',description:'看原图',prompt:'核对原图。',parentImages:[path]},agent:parent,signal:new AbortController().signal});
  assert.equal(result.isError,false,JSON.stringify(result));assert.equal(requests.find(r=>r.sessionId===result.value.id).messages.flatMap(m=>m.content??[]).filter(b=>b.type==='image').length,1);
 });
 test('native image retry restores original facts before the child first request; placeholders start no child',async t=>{
  const original='学生原话：我漏了2。\n老师已经提醒系数，尚未自己改正。\n$$\n2x^2+y^2=3\n$$\n请先让学生自己想。';
  let parentId,step=0;
  const h=await harness(t,{withController:true,respond:async function*(options){
   if(options.sessionId===parentId&&step++<2){
    const receipt=options.messages.flatMap(m=>m.content??[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
    const retryOf=step===2?/"retryOf":"(event:\d+)"/.exec(receipt)?.[1]:undefined;
    if(step===2)assert.ok(retryOf,'use the exact native event reference returned by the failed call');
    const call=step===1?{id:'bad-image',args:{preset:'notara-teacher',description:'图片讨论',prompt:original,parentImages:['missing.png']}}:{id:'fixed-image',args:{preset:'notara-teacher',description:'图片讨论',retryOf,parentImages:['原题.png']}};
    yield {type:'block-start',index:0,blockType:'tool-call',id:call.id,name:'subagent'};yield {type:'block-end',index:0,block:{type:'tool-call',id:call.id,name:'subagent',arguments:JSON.stringify(call.args)}};yield {type:'finish',reason:{kind:'tool-calls'}};return;}
   yield {type:'block-start',index:0,blockType:'text'};yield {type:'block-end',index:0,block:{type:'text',text:'fixture完成'}};yield {type:'finish',reason:{kind:'stop'}};
  }});
  const {ctx,requests}=h,parent=await h.create('notara-coordinator');parentId=parent.id;
  const ref=await ctx.attachments.saveImage({mediaType:'image/png',data:await png('#ffaa00'),name:'原题.png'});
  parent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'请交给老师'},{type:'image',attachment:ref}]}));await parent.whenIdle();
  const calls=parent.session.snapshotEvents().filter(e=>e.type==='tool/result').map(e=>e.data.message);assert.equal(calls[0].isError,true);assert.match(JSON.stringify(calls[0].content),/retryOf/);assert.equal(calls[1].isError,false);
  const id=/会话标识：(notara-topic-[a-z0-9]+)/.exec(calls[1].content[0].text)[1],child=ctx.agents.get(id);await child.whenIdle();
  const first=requests.find(r=>r.sessionId===id);assert.ok(first.messages.some(m=>m.content?.some(b=>b.type==='text'&&b.text.includes(original))));assert.equal(first.messages.flatMap(m=>m.content??[]).filter(b=>b.type==='image').length,1);
  const before=requests.length;
  const rejected=await ctx.tools.execute({name:'subagent',callId:'placeholder',arguments:{preset:'notara-teacher',description:'占位启动',prompt:'（占位，图片校验后替换）',parentImages:['原题.png']},agent:parent,signal:new AbortController().signal});
  assert.equal(rejected.isError,true);assert.equal(requests.length,before);
 });
}
