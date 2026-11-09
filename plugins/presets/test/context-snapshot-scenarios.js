import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,readFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
const text=request=>request.messages.flatMap(m=>m.content).filter(b=>b.type==='text').map(b=>b.text).join('\n');
const updates=agent=>agent.session.snapshotEvents().filter(e=>e.type==='user/message'&&e.data.source.kind==='notara-context-update');
async function say(agent,message){agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:message}]}));await agent.whenIdle();}
async function mount(h){const fiber=h.ctx.plugin(await import('../../vault-sqlite/index.js'),{root:h.root,cachePath:':memory:'});await fiber;}
function* call(name,args,id){const argumentsText=JSON.stringify(args);yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'tool-call-delta',index:0,id,name,argumentsDelta:argumentsText};yield {type:'block-end',index:0,block:{type:'tool-call',id,name,arguments:argumentsText}};yield {type:'finish',reason:{kind:'tool-calls'}};}
function* reply(){yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:'继续讨论。'};yield {type:'block-end',index:0,block:{type:'text',text:'继续讨论。'}};yield {type:'finish',reason:{kind:'stop'}};}

export function registerContextSnapshotTests({harness}){
  test('native request retry after host compaction restores a missing full basis without reentering pre-step',async t=>{
    let overflow=false;
    const h=await harness(t,{withController:true,respond:function*(){
      if(overflow){overflow=false;yield {type:'finish',reason:{kind:'error',failure:{code:'CONTEXT_LENGTH_EXCEEDED',message:'fixture context overflow'}}};return;}
      yield*reply();
    }});
    const body='---\ntype: learner-profile\n---\n# 当前画像\n'+('必要完整条件\n'.repeat(700))+'压缩后末尾仍要在\n';
    await writeFile(join(h.root,'画像.md'),body);await mount(h);
    const teacher=await h.create('notara-teacher');await say(teacher,'开始');
    let preSteps=0,retries=0;
    teacher.ctx.on('agent/pre-step',async(_payload,next)=>{preSteps++;return next();});
    teacher.ctx.on('agent/request-error',async(_payload,next)=>{
      if(retries++)return next();
      const original=updates(teacher)[0];
      teacher.session.append('user/message',createUserMessage({source:{kind:'compact-checkpoint'},content:[{type:'text',text:'宿主压缩摘要'}]}),{surfaceOp:{op:'replace',startSeq:original.seq,endSeq:original.seq},sourceEventSeqs:[original.seq]});
      return {kind:'retry'};
    });
    overflow=true;await say(teacher,'继续');
    assert.equal(retries,1);assert.equal(preSteps,1);assert.equal(h.requests.length,3);
    assert.ok(text(h.requests.at(-1)).includes(body));
    assert.equal(text(h.requests.at(-1)).split('压缩后末尾仍要在').length-1,1);
  });
  test('native context updates preserve full learner state and stable request prefixes; own edits, external changes and cold resume',async t=>{
    const root=await mkdtemp(join(tmpdir(),'notara-context-native-'));t.after(()=>rm(root,{recursive:true,force:true}));
    const body='---\ntype: learner-profile\n---\n# 当前学情\n'+('完整学情。\n'.repeat(1800))+'$$\nf(x)=x^2\n$$\n偏好：先让我试。\n';
    await writeFile(join(root,'画像.md'),body);
    let command=null;
    const respond=function*(request){if(command){const c=command;command=null;yield*call(c.name,c.args,'own-'+request.messages.length);}else yield*reply();};
    const h=await harness(t,{withController:true,existingRoot:root,respond});await mount(h);
    const teacher=await h.create('notara-teacher');await say(teacher,'你好');
    const first=h.requests.at(-1),prefix=JSON.parse(JSON.stringify(first.messages));
    assert.ok(text(first).includes(body.split('---\n')[2]));assert.match(text(first),/当前本地日期/);
    assert.match(updates(teacher)[0].data.content[0].text,/^<system-reminder>\n/);
    const initialCount=updates(teacher).length;
    for(let i=0;i<3;i++)await say(teacher,'继续'+i);
    assert.equal(updates(teacher).length,initialCount);
    assert.deepEqual(h.requests.at(-1).messages.slice(0,prefix.length),prefix);
    await writeFile(join(root,'画像.md'),body.replace('先让我试','先画图再试'));
    await say(teacher,'接着来');
    const changed=updates(teacher).at(-1).data.content[0].text;
    assert.match(changed,/-偏好：先让我试/);assert.match(changed,/\+偏好：先画图再试/);assert.ok(changed.length<2000);
    assert.match(changed,/^<system-reminder>\n/);assert.match(changed,/\n<\/system-reminder>$/);
    const beforeOwn=updates(teacher).length;
    command={name:'edit',args:{file_path:'画像.md',old_string:'先画图再试',new_string:'先给具体例子'}};
    await say(teacher,'请记住我的新偏好');
    assert.match(await readFile(join(root,'画像.md'),'utf8'),/先给具体例子/);
    assert.equal(updates(teacher).length,beforeOwn,'own native edit must not inject another copy');
    const result=teacher.session.snapshotEvents().findLast(e=>e.type==='tool/result');
    assert.match(result.data.meta.notaraFileMutation.after,/先给具体例子/);
    command={name:'write',args:{file_path:'课堂草稿.md',content:'# 非关键文档\n仅供本会话使用'}};
    await say(teacher,'保存草稿');assert.equal(updates(teacher).length,beforeOwn,'unrelated own files are not key-context removals');
    command={name:'edit',args:{file_path:'画像.md',old_string:'不存在的内容',new_string:'不能被记住的内容'}};
    await say(teacher,'试一次失败编辑');assert.equal(updates(teacher).length,beforeOwn);
    const events=teacher.session.snapshotEvents();assert.ok(!events.some(e=>e.type==='compaction/prune'||e.surfaceOp?.op==='replace'));
    const id=teacher.id;await h.ctx.sessions.flush(teacher.session);await h.handles.get(id).dispose();await h.ctx.fiber.dispose();
    await writeFile(join(root,'画像.md'),(await readFile(join(root,'画像.md'),'utf8')).replace('先给具体例子','先用图像解释'));
    const cold=await harness(t,{withController:true,existingRoot:root});await mount(cold);
    const restored=await cold.ctx.notaraTopics.resume(id);assert.ok(restored);assert.equal(restored.id,id);
    await say(restored,'重新接着学');
    const delta=updates(restored).at(-1).data.content[0].text;
    assert.match(delta,/-偏好：先给具体例子/);assert.match(delta,/\+偏好：先用图像解释/);
    const count=updates(restored).length;await say(restored,'继续');assert.equal(updates(restored).length,count);
    assert.equal(text(cold.requests.at(-1)).split('完整学情。').length-1,1800,'full profile appears only once across restore');
  });
  test('native Bash file changes are delivered as background diffs at the next request, even after a nonzero exit',async t=>{
    let command=null;
    const h=await harness(t,{withController:true,withBash:true,respond:function*(request){
      if(command){const args=command;command=null;yield*call('bash',args,'bash-'+request.messages.length);}else yield*reply();
    }});
    const body='---\ntype: learner-profile\n---\n# 当前学情\n'+('必要学情保持完整\n'.repeat(1000))+'当前目标：先想清楚再计算。\n';
    await writeFile(join(h.root,'画像.md'),body);await mount(h);
    const teacher=await h.create('notara-coordinator');await say(teacher,'开始讨论');
    const prefix=JSON.parse(JSON.stringify(h.requests.at(-1).messages));
    for(const [note,exitCode]of [['补充偏好：先画图。',0],['可用时间：三十分钟。',7]]){
      const count=updates(teacher).length;
      command={description:'Update isolated fixture profile',command:`printf '%s\\n' '${note}' >> '画像.md'; exit ${exitCode}`,timeoutMs:5000};
      await say(teacher,'继续');
      assert.ok((await readFile(join(h.root,'画像.md'),'utf8')).includes(note));
      const result=teacher.session.snapshotEvents().findLast(e=>e.type==='tool/result');
      assert.equal(result.data.meta?.notaraFileMutation,undefined,'Bash output cannot certify the final document contents');
      assert.equal(updates(teacher).length,count+1);
      const reminder=updates(teacher).at(-1).data.content[0].text;
      assert.match(reminder,/^<system-reminder>\n/);assert.match(reminder,/文件变化："画像.md"/);
      assert.ok(reminder.includes('+'+note));assert.ok(reminder.length<2000);assert.doesNotMatch(reminder,/外部修改/);
      assert.ok(text(h.requests.at(-1)).includes(reminder),'next actual provider request receives the diff');
      assert.deepEqual(h.requests.at(-1).messages.slice(0,prefix.length),prefix);
      await say(teacher,'接着讨论');assert.equal(updates(teacher).length,count+1);
    }
    // Diff hunks legitimately repeat a few surrounding lines, not the profile.
    assert.equal(text(h.requests.at(-1)).split('必要学情保持完整\n'.repeat(1000)).length-1,1);
    assert.ok(!teacher.session.snapshotEvents().some(e=>e.type==='compaction/prune'||e.surfaceOp?.op==='replace'));
  });
}
