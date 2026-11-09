import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareHandoff,handoffIdentity,childHandoffText,childHandoffRoute,assertHandoffImagesSupported} from '../handoff-context.js';
const signal=()=>new AbortController().signal;
function fixture(kind='user'){
  const parent={id:'parent',session:{header:{cwd:'/test'}}};
  const ref={attachmentId:'image-a',bytes:10,mediaType:'image/png',width:1,height:1};
  let reads=0;
  const services={sessionQuery:{readSurface:async()=>({session:{id:'parent',cwd:'/test'},events:[{type:'user/message',data:{source:{kind},content:[{type:'image',attachment:ref,offloaded:true}]}}]})},attachments:{imageLimits:{maxImagesPerMessage:2,maxImageBytes:20,maxMessageImageBytes:30},readImage:async value=>{reads++;return {ref:value,data:new Uint8Array(10)};}}};
  return {parent,ref,services,ctx:{get:name=>services[name]},reads:()=>reads};
}
test('old text-only handoffs require no new services or identity fields',async()=>{
  const f=fixture();assert.deepEqual(handoffIdentity({}),[]);assert.deepEqual(handoffIdentity({parentImages:[]}),[]);
  assert.deepEqual(await prepareHandoff({get:()=>{throw Error('no services needed');}},f.parent,{},signal()),{parentImages:[],images:[]});
});
test('image ownership is checked before reading storage; received handoff images are reusable',async()=>{
  for(const kind of ['user','notara-topic-handoff','notara-child-handoff']){
    const f=fixture(kind);const result=await prepareHandoff(f.ctx,f.parent,{parentImages:['image-a','image-a']},signal());
    assert.deepEqual(result.images,[{type:'image',attachment:f.ref}]);assert.equal(f.reads(),1);
  }
  for(const kind of ['tool','model','agent-message']){
    const f=fixture(kind);await assert.rejects(prepareHandoff(f.ctx,f.parent,{parentImages:['image-a']},signal()),/不在当前会话/);assert.equal(f.reads(),0);
  }
  const f=fixture();await assert.rejects(prepareHandoff(f.ctx,f.parent,{parentImages:['other-session-image']},signal()),/不在当前会话/);assert.equal(f.reads(),0);
});
test('bad selections, unavailable bytes, size limits and cancellation fail without silently dropping images',async()=>{
  const f=fixture();
  await assert.rejects(prepareHandoff(f.ctx,f.parent,{parentImages:['a','b','c']},signal()),/单条消息限制/);
  await assert.rejects(prepareHandoff(f.ctx,f.parent,{parentImages:[{}]},signal()),/图片路径|附件引用/);
  f.services.attachments.readImage=async()=>{throw Error('missing bytes');};
  await assert.rejects(prepareHandoff(f.ctx,f.parent,{parentImages:['image-a']},signal()),/missing bytes/);
  f.services.attachments.readImage=async()=>({ref:{...f.ref,bytes:40}});
  await assert.rejects(prepareHandoff(f.ctx,f.parent,{parentImages:['image-a']},signal()),/大小限制/);
  await assert.rejects(prepareHandoff(f.ctx,f.parent,{},AbortSignal.abort()),{name:'AbortError'});
});
test('only generated initial route prefix is recognized; a worker is not told to call an unavailable messenger',()=>{
  const text=childHandoffText('parent','全部必要原话。',{kind:'worker'},{routePath:'路线/数学.md'});
  assert.equal(childHandoffRoute({content:[{type:'text',text}]}),'路线/数学.md');
  assert.doesNotMatch(text,/需要回信时联系/);assert.match(text,/具体缺项/);
  assert.equal(childHandoffRoute({content:[{type:'text',text:'学生随口提到路线/数学.md'}]}),undefined);
});
test('image-only capability check does not change text-only callers',async()=>{
  const ctx={get:()=>({resolveModelInfo:async()=>({inputModalities:['text']})})},agent={options:{provider:'test',model:'text'}};
  await assert.rejects(assertHandoffImagesSupported(ctx,agent,[{}],signal()),/does not support image/);
  await assertHandoffImagesSupported(ctx,agent,[],signal());
});
test('current image paths and unique display names resolve to the same owned attachment',async()=>{
 const f=fixture();f.ref.name='原题.png';
 f.services.fs={processPathFromHostPath:path=>path};f.services.attachments.imageHostPath=()=>'/attachments/original';
 for(const reference of ['原题.png','/attachments/original']){
  const value=await prepareHandoff(f.ctx,f.parent,{parentImages:[reference]},signal());
  assert.deepEqual(value.images,[{type:'image',attachment:f.ref}]);
 }
});
test('ambiguous attachment names require an exact path rather than choosing one',async()=>{
 const f=fixture();f.ref.name='原题.png';const second={...f.ref,attachmentId:'image-b'};
 f.services.sessionQuery.readSurface=async()=>({session:{id:'parent',cwd:'/test'},events:[{type:'user/message',data:{source:{kind:'user'},content:[{type:'image',attachment:f.ref},{type:'image',attachment:second}]}}]});
 await assert.rejects(prepareHandoff(f.ctx,f.parent,{parentImages:['原题.png']},signal()),/同名|多个/);
 assert.equal(f.reads(),0);
});
test('reading an uploaded image again does not replace its original display-name reference',async()=>{
 const f=fixture();f.ref.name='原题.png';f.parent.session.snapshotEvents=()=>[{type:'tool/call',data:{callId:'read',name:'read_image'}}];
 f.services.sessionQuery.readSurface=async()=>({session:{id:'parent',cwd:'/test'},events:[
  {type:'user/message',data:{source:{kind:'user'},content:[{type:'image',attachment:f.ref}]}},
  {type:'tool/result',data:{message:{toolCallId:'read',isError:false,content:[{type:'image',attachment:{...f.ref,name:'normalized-object'}}]}}},
 ]});
 for(const reference of ['原题.png','normalized-object'])assert.equal((await prepareHandoff(f.ctx,f.parent,{parentImages:[reference]},signal())).images[0].attachment.attachmentId,f.ref.attachmentId);
});
