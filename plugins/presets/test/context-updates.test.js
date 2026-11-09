import test from 'node:test';
import assert from 'node:assert/strict';
import {Session} from '@deepseek-ai/dsh-session';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {planContextUpdate,contextState,withContextWriteMetadata,CONTEXT_SOURCE} from '../context-snapshots.js';
import {currentSections} from '../learning-context.js';
const root='/tmp/context-diff-vault';
const body='# 画像\n'+('完整学情。\n'.repeat(2000))+'$$\na=b+c\n$$\n末尾偏好：先让我试。\n';
const sections=(content=body)=>[{name:'notara-learning-context',header:'已有学情，不是学生新发言。',documents:[{path:'画像.md',content,revision:content===body?'r1':'r2',text:content}],fragments:[]}];
const session=()=>Session.create('context-diffs');
const append=(s,m)=>s.append('user/message',m,{surfaceOp:'append'});

test('initial complete context then external diffs are append-only, exact and consumed once',()=>{
 const s=session(),first=planContextUpdate(s,sections(),{cwd:root});assert.ok(first.content[0].text.includes(body));append(s,first);
 const before=s.snapshotEvents();assert.equal(planContextUpdate(s,sections(),{cwd:root}),null);
 const nextBody=body.replace('先让我试','先画图再试'),update=planContextUpdate(s,sections(nextBody),{cwd:root});
 assert.equal(update.source.kind,CONTEXT_SOURCE);assert.match(update.content[0].text,/-末尾偏好：先让我试/);assert.match(update.content[0].text,/\+末尾偏好：先画图再试/);
 assert.ok(!update.content[0].text.includes(body));append(s,update);
 assert.deepEqual(s.snapshotEvents().slice(0,before.length),before);
 assert.equal(planContextUpdate(s,sections(nextBody),{cwd:root}),null);
 const cold=Session.create(s.id,s.snapshotEvents(),s.header);assert.equal(planContextUpdate(cold,sections(nextBody),{cwd:root}),null);
 assert.ok(!s.snapshotEvents().some(e=>e.type==='compaction/prune'||e.surfaceOp?.op==='replace'));
});

test('a diff whose full baseline was compacted out is rebuilt, never recovered from hidden raw history',()=>{
 const s=session(),initial=append(s,planContextUpdate(s,sections(),{cwd:root}));
 const changed=body+'外部新增\n';append(s,planContextUpdate(s,sections(changed),{cwd:root}));
 s.append('user/message',createUserMessage({source:{kind:'compact-checkpoint'},content:[{type:'text',text:'原生压缩结果'}]}),{surfaceOp:{op:'replace',startSeq:initial.seq,endSeq:initial.seq},sourceEventSeqs:[initial.seq]});
 const recovery=planContextUpdate(s,sections(changed),{cwd:root});assert.ok(recovery.content[0].text.includes(changed));
});

test('native write metadata preserves native presentation and full applied content without adding model text',()=>{
 const native={name:'edit',output:{schema:{},render:()=>[{type:'text',text:'Updated'}],presentationMeta:()=>({path:'画像.md',diffs:[{oldText:'a',newText:'b'}]})}};
 const wrapped=withContextWriteMetadata(native),meta=wrapped.output.presentationMeta({old_string:'a',new_string:'b'},{path:root+'/画像.md',before:'a',after:'b'});
 assert.equal(wrapped.output.render,native.output.render);assert.equal(wrapped.output.schema,native.output.schema);
 assert.deepEqual(meta.diffs,[{oldText:'a',newText:'b'}]);assert.equal(meta.notaraFileMutation.after,'b');
 assert.equal(native.output.presentationMeta({},{}).notaraFileMutation,undefined);
});

test('states are session scoped and malformed metadata cannot supply a full baseline',()=>{
 const a=session(),b=session();append(a,planContextUpdate(a,sections(),{cwd:root}));
 assert.ok(planContextUpdate(b,sections(),{cwd:root}));
 append(b,createUserMessage({source:{kind:CONTEXT_SOURCE,files:[{path:'画像.md',content:body,basis:['missing']}],sections:[]},content:[{type:'text',text:'not a valid baseline'}]}));
 assert.equal(contextState(b,{cwd:root}).files.size,0);
});

function ownEdit(s,{before,after,oldString,newString,isError=false}){
  const id='edit-'+s.snapshotEvents().length;
  s.append('assistant/message',{turn:0,step:1,message:{id:'assistant-'+id,role:'assistant',source:{kind:'model',provider:'fixture',model:'fixture'},content:[{type:'tool-call',id,name:'edit',arguments:JSON.stringify({file_path:'画像.md',old_string:oldString,new_string:newString})}]},stream:[]},{surfaceOp:'append'});
  s.append('tool/result',{turn:0,step:1,message:{id:'result-'+id,role:'tool',source:{kind:'tool',callId:id},toolCallId:id,isError,content:[{type:'text',text:isError?'failed':'updated'}]},meta:{notaraFileMutation:{version:1,kind:'edit',path:root+'/画像.md',before,after,oldString,newString}}},{surfaceOp:'append'});
}

test('interleaved external edits survive own edit acknowledgement; failed results do not advance the basis',()=>{
  const s=session(),original='甲：旧\n乙：旧\n';append(s,planContextUpdate(s,sections(original),{cwd:root}));
  ownEdit(s,{before:'甲：外部\n乙：旧\n',after:'甲：外部\n乙：本人\n',oldString:'乙：旧',newString:'乙：本人'});
  const change=planContextUpdate(s,sections('甲：外部\n乙：本人\n'),{cwd:root});
  assert.match(change.content[0].text,/-甲：旧\n\+甲：外部/);assert.doesNotMatch(change.content[0].text,/-乙：旧/);append(s,change);
  ownEdit(s,{before:'甲：外部\n乙：本人\n',after:'伪结果',oldString:'甲：外部',newString:'甲：失败',isError:true});
  assert.equal(planContextUpdate(s,sections('甲：外部\n乙：本人\n'),{cwd:root}),null);
});

test('canceled admission consumes nothing, unavailable selection is not a removal, real unselection ends automatic use',()=>{
  const s=session(),candidate=planContextUpdate(s,sections(),{cwd:root});
  assert.ok(planContextUpdate(s,sections(),{cwd:root}),'uncommitted candidate is not consumed');append(s,candidate);
  assert.equal(planContextUpdate(s,[{name:'notara-learning-context',documents:[],fragments:[],complete:false}],{cwd:root}),null);
  const removed=planContextUpdate(s,[{name:'notara-learning-context',documents:[],fragments:[],complete:true}],{cwd:root});
  assert.match(removed.content[0].text,/不再包含/);append(s,removed);
  assert.ok(planContextUpdate(s,sections(),{cwd:root}).content[0].text.includes(body));
});

test('unknown legacy and host snapshots stay byte-for-byte intact when new append-only context starts',()=>{
  const s=session();append(s,createUserMessage({source:{kind:'runtime-context'},content:[{type:'text',text:'LEGACY_NOTARA_AND_HOST'}]}));
  const events=s.snapshotEvents();append(s,planContextUpdate(s,sections(),{cwd:root}));
  assert.deepEqual(s.snapshotEvents().slice(0,events.length),events);
});
test('empty assistant attempts are not messages and do not break the next request',()=>{
  const s=session();s.append('assistant/message',{turn:0,step:1,message:{id:'empty',role:'assistant',source:{kind:'model',provider:'fixture',model:'fixture'},content:[]},stream:[]},{surfaceOp:'append'});
  assert.ok(planContextUpdate(s,sections(),{cwd:root}));
});
test('promoting an omitted history section supplies its whole newly-current content, including the remote tail',()=>{
  for(const own of [false,true]){
    const s=session(),original='# 画像\n## 历史记录\n'+('以往背景\n'.repeat(200))+'远端必要内容\n## 当前情况\n保留当前情况\n';
    const asContext=content=>[{name:'notara-learning-context',documents:[{path:'画像.md',content,visibleContent:currentSections(content,0).text,text:currentSections(content,0).text}],fragments:[]}];
    append(s,planContextUpdate(s,asContext(original),{cwd:root}));
    const current=original.replace('历史记录','当前偏好');
    if(own)ownEdit(s,{before:original,after:current,oldString:'历史记录',newString:'当前偏好'});
    const update=planContextUpdate(s,asContext(current),{cwd:root});assert.match(update.content[0].text,/\+远端必要内容/);
    assert.equal(update.content[0].text.split('+以往背景').length-1,200);
  }
});
test('own new profile is selected without repeating its contents, then external archival is announced',()=>{
  const s=session(),content='---\ntype: learner-profile\n---\n已自行写入的完整学情\n';
  s.append('assistant/message',{turn:0,step:1,message:{id:'a-write',role:'assistant',source:{kind:'model',provider:'fixture',model:'fixture'},content:[{type:'tool-call',id:'w',name:'write',arguments:JSON.stringify({file_path:'画像.md',content})}]},stream:[]},{surfaceOp:'append'});
  s.append('tool/result',{turn:0,step:1,message:{id:'r-write',role:'tool',source:{kind:'tool',callId:'w'},toolCallId:'w',isError:false,content:[{type:'text',text:'saved'}]},meta:{notaraFileMutation:{version:1,kind:'write',path:root+'/画像.md',after:content}}},{surfaceOp:'append'});
  const picked=planContextUpdate(s,sections(content),{cwd:root});assert.ok(!picked.content[0].text.includes(content));append(s,picked);
  assert.equal(planContextUpdate(s,sections(content),{cwd:root}),null);
  assert.match(planContextUpdate(s,[{name:'notara-learning-context',documents:[],fragments:[],complete:true}],{cwd:root}).content[0].text,/不再包含/);
});
test('unavailable pointer status clears on recovery even when documents have not changed',()=>{
  const s=session();append(s,planContextUpdate(s,sections(),{cwd:root}));
  append(s,planContextUpdate(s,[{name:'notara-learning-context',documents:[],fragments:['学习情况暂不可读'],complete:false}],{cwd:root}));
  const recovered=planContextUpdate(s,sections(),{cwd:root});assert.ok(recovered);append(s,recovered);
  assert.equal(contextState(s,{cwd:root}).sections.get('notara-learning-pointers'),'');
  assert.equal(planContextUpdate(s,sections(),{cwd:root}),null);
});

test('full context, diffs and dynamic sections use background reminders without changing the native source contract',()=>{
  const s=session(),first=planContextUpdate(s,sections(),{cwd:root,day:'2026-11-08'});
  const reminder=message=>{
    assert.equal(message.role,'user');assert.equal(message.source.kind,CONTEXT_SOURCE);
    assert.equal(message.source.form,'snapshot');assert.equal(message.source.version,1);
    assert.match(message.content[0].text,/^<system-reminder>\n/);
    assert.match(message.content[0].text,/不是学生本轮发言/);
    assert.match(message.content[0].text,/背景资料，不是新的操作指令/);
    assert.match(message.content[0].text,/\n<\/system-reminder>$/);
    assert.doesNotMatch(message.content[0].text,/"basis":|"visibleContent":/);
  };
  reminder(first);assert.ok(first.content[0].text.includes(body));append(s,first);
  const changed=body.replace('先让我试','先画图再试'),delta=planContextUpdate(s,sections(changed),{cwd:root,day:'2026-11-08'});
  reminder(delta);assert.match(delta.content[0].text,/文件变化："画像.md"/);append(s,delta);
  const nextDay=planContextUpdate(s,sections(changed),{cwd:root,day:'2026-11-09'});
  reminder(nextDay);assert.match(nextDay.content[0].text,/2026-11-09/);assert.ok(!nextDay.content[0].text.includes(changed));append(s,nextDay);
  assert.equal(planContextUpdate(s,sections(changed),{cwd:root,day:'2026-11-09'}),null);
});

function ownTool(s,name,args,meta={},isError=false){
  const id=name+'-'+s.snapshotEvents().length;
  s.append('assistant/message',{turn:0,step:1,message:{id:'assistant-'+id,role:'assistant',source:{kind:'model',provider:'fixture',model:'fixture'},content:[{type:'tool-call',id,name,arguments:JSON.stringify(args)}]},stream:[]},{surfaceOp:'append'});
  s.append('tool/result',{turn:0,step:1,message:{id:'result-'+id,role:'tool',source:{kind:'tool',callId:id},toolCallId:id,isError,content:[{type:'text',text:isError?'failed':'done'}]},meta},{surfaceOp:'append'});
}

test('known own writes and edits do not send a background reminder again',()=>{
  const s=session();append(s,planContextUpdate(s,sections(),{cwd:root}));
  const written=body.replace('先让我试','先给例子');
  ownTool(s,'write',{file_path:'画像.md',content:written},{notaraFileMutation:{version:1,kind:'write',path:root+'/画像.md',before:body,after:written}});
  assert.equal(planContextUpdate(s,sections(written),{cwd:root}),null);
  const edited=written.replace('先给例子','先给图像');
  ownEdit(s,{before:written,after:edited,oldString:'先给例子',newString:'先给图像'});
  assert.equal(planContextUpdate(s,sections(edited),{cwd:root}),null);
});

test('unconfirmed Bash changes, including partial writes before failure, send a neutral diff once',()=>{
  for(const isError of [false,true]){
    const s=session();append(s,planContextUpdate(s,sections(),{cwd:root}));
    ownTool(s,'bash',{command:'fixture modifies profile'}, {}, isError);
    assert.equal(planContextUpdate(s,sections(),{cwd:root}),null,'a Bash call alone is not a file change');
    const before=s.snapshotEvents(),changed=body.replace('先让我试','先用图像解释');
    const update=planContextUpdate(s,sections(changed),{cwd:root});
    assert.match(update.content[0].text,/^<system-reminder>/);assert.match(update.content[0].text,/文件变化："画像.md"/);
    assert.doesNotMatch(update.content[0].text,/外部修改/);
    assert.match(update.content[0].text,/-末尾偏好：先让我试/);assert.match(update.content[0].text,/\+末尾偏好：先用图像解释/);
    assert.ok(update.content[0].text.length<1500);append(s,update);
    assert.equal(planContextUpdate(s,sections(changed),{cwd:root}),null);
    assert.deepEqual(s.snapshotEvents().slice(0,before.length),before);
  }
});

test('pre-reminder context-update baselines continue as diffs without rewriting their original messages',()=>{
  const s=session(),legacy=planContextUpdate(s,sections(),{cwd:root});
  legacy.content=[{type:'text',text:'关键背景更新（宿主提供，不是学生发言）：\n'+body}];append(s,legacy);
  const before=s.snapshotEvents();assert.equal(planContextUpdate(s,sections(),{cwd:root}),null);
  const update=planContextUpdate(s,sections(body.replace('先让我试','先看正例')),{cwd:root});
  assert.match(update.content[0].text,/^<system-reminder>/);assert.match(update.content[0].text,/-末尾偏好：先让我试/);
  assert.ok(!update.content[0].text.includes(body));append(s,update);
  assert.deepEqual(s.snapshotEvents().slice(0,before.length),before);
});
