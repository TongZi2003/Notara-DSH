import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDelegation} from '../tools.js';
import {restoreHandoffRetry,HandoffImageError,imageRetryError} from '../handoff-retry.js';

const original={preset:'notara-teacher',description:'本题讨论',prompt:'学生原话：我得到1.5。老师只提示了系数。\n$$\n2x^2+y^2=3\n$$\n结尾偏好：先自己想。',routePath:'路线.md',parentImages:['bad.png']};
const failed=(id,args,error='[notara-image-handoff] 引用无效',seq=0)=>[
 {seq,type:'tool/call',data:{callId:id,name:'subagent',arguments:JSON.stringify(args)}},
 {seq:seq+1,type:'tool/result',sourceEventSeqs:[seq],data:{...(error.startsWith('[notara-image-handoff]')?{error:{name:'HandoffImageError',code:'NOTARA_IMAGE_HANDOFF_NOT_STARTED'}}:{}),message:{toolCallId:id,isError:true,content:[{type:'text',text:error}]}}},
];
const parent=events=>({session:{snapshotEvents:()=>events}});
test('placeholder delegation is rejected while genuine short tasks remain valid',()=>{
 for(const prompt of ['占位','（占位，图片校验后替换）','placeholder'])assert.throws(()=>buildDelegation('notara-coordinator',{...original,prompt}),/完整交接|占位/);
 assert.equal(buildDelegation('notara-coordinator',{...original,prompt:'解释这一步。'}).prompt,'解释这一步。');
 assert.equal(buildDelegation('notara-coordinator',{...original,prompt:'请解释代码中的占位符，并检查实例。'}).prompt,'请解释代码中的占位符，并检查实例。');
});
test('image retry restores the exact original handoff from native events, changing only image references',()=>{
 const args=restoreHandoffRetry(parent(failed('call-original',original)),{preset:original.preset,description:original.description,retryOf:'call-original',parentImages:['媒体/原题.png']});
 assert.deepEqual(args,{...original,parentImages:['媒体/原题.png']});
 assert.equal(restoreHandoffRetry(parent([]),original),original,'existing calls stay unchanged');
});
test('retry cannot replace facts, drop images, target another task or reuse a successful call',()=>{
 const p=parent(failed('call-original',original)),base={preset:original.preset,description:original.description,retryOf:'call-original',parentImages:['媒体/原题.png']};
 for(const extra of [{prompt:'占位'},{routePath:'其他路线.md'},{description:'另一个任务'},{preset:'worker-review'},{parentImages:[]}])assert.throws(()=>restoreHandoffRetry(p,{...base,...extra}));
 assert.throws(()=>restoreHandoffRetry(p,{...base,retryOf:'foreign-call'}));
 assert.throws(()=>restoreHandoffRetry(parent(failed('call-original',original,'other error')),base));
 const success=failed('call-original',original);success[1].data.message.isError=false;
 assert.throws(()=>restoreHandoffRetry(parent(success),base));
});
test('a second image correction and replay still recover the full original task',()=>{
 const retry={preset:original.preset,description:original.description,retryOf:'call-original',parentImages:['still-bad.png']};
 const events=[...failed('call-original',original),...failed('call-retry',retry,undefined,2)];
 const restored=restoreHandoffRetry(parent(JSON.parse(JSON.stringify(events))),{preset:original.preset,description:original.description,retryOf:'call-retry',parentImages:['媒体/原题.png']});
 assert.equal(restored.prompt,original.prompt);assert.equal(restored.routePath,original.routePath);
});
test('an event retry reference disambiguates repeated provider call IDs and binds the exact result',()=>{
 const second={...original,prompt:'另一份完整原文，不应拿第一份代替。'};
 const events=[...failed('call_0',original),...failed('call_0',second,undefined,2)];
 const args={preset:original.preset,description:original.description,parentImages:['媒体/原题.png']};
 assert.throws(()=>restoreHandoffRetry(parent(events),{...args,retryOf:'call_0'}),/唯一|重复|精确/);
 assert.equal(restoreHandoffRetry(parent(events),{...args,retryOf:'event:2'}).prompt,second.prompt);
 const receipt=imageRetryError(new HandoffImageError('缺图',['原题.png']),'call_0',second,parent(events));
 assert.match(receipt.message,/调用ID重复/);assert.doesNotMatch(receipt.message,/retryOf/);
 events[3].sourceEventSeqs=[0];assert.throws(()=>restoreHandoffRetry(parent(events),{...args,retryOf:'event:2'}));
});
test('a quoted error marker in worker output cannot authorize restarting an already started task',()=>{
 const events=failed('worker',original,'worker budget exhausted; partial output: [notara-image-handoff] example');
 assert.throws(()=>restoreHandoffRetry(parent(events),{preset:original.preset,description:original.description,retryOf:'worker',parentImages:['媒体/原题.png']}));
});
test('image rejection offers usable references and an explicit retry without repeating or truncating the prompt',()=>{
 const error=imageRetryError(new HandoffImageError('没有找到图片',['媒体/原题.png']),'call-original',original);
 assert.match(error.message,/retryOf/);assert.match(error.message,/call-original/);assert.match(error.message,/媒体\/原题.png/);assert.match(error.message,/未启动/);
 assert.ok(!error.message.includes(original.prompt));
});
