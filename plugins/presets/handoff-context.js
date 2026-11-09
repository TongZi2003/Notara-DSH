import {resolveImageAttachmentAccess} from '@deepseek-ai/dsh-llm';
import {randomUUID} from 'node:crypto';
import {HandoffImageError} from './handoff-retry.js';

const IMAGE_SOURCES=new Set(['user','notara-topic-handoff','notara-child-handoff']);
const ROUTE_PREFIX='本次学习路线：';

export function handoffOptions(args) {
  if(args.parentImages!==undefined&&(!Array.isArray(args.parentImages)||args.parentImages.some(id=>typeof id!=='string'||!id.trim())))throw new Error('parentImages 必须填写图片路径或已有附件引用');
  if(args.routePath!==undefined&&(typeof args.routePath!=='string'||!args.routePath.trim()))throw new Error('routePath 须为已读取的学习路线相对路径');
  return {parentImages:[...new Set(args.parentImages??[])],...(args.routePath===undefined?{}:{routePath:args.routePath})};
}

/** Optional additions do not change the identity of existing text-only retries. */
export function handoffIdentity(args) {
  const options=handoffOptions(args);
  return options.parentImages.length||options.routePath!==undefined ? [options] : [];
}

export async function prepareHandoff(ctx,parent,args,signal,execution) {
  const options=handoffOptions(args),images=[];
  signal.throwIfAborted();
  if(options.parentImages.length){
    const query=ctx.get('sessionQuery'),attachments=ctx.get('attachments');
    if(!query||!attachments)throw new Error('当前宿主无法交接图片；保留原任务，请先恢复图片服务');
    const limits=attachments.imageLimits;
    if(options.parentImages.length>limits.maxImagesPerMessage)throw new Error('所选图片超过单条消息限制，请只选本任务必要原图');
    const snapshot=await query.readSurface(parent.id);signal.throwIfAborted();
    if(snapshot.session.id!==parent.id||snapshot.session.cwd!==parent.session.header.cwd)throw new Error('图片交接会话归属不一致');
    const refs=new Map(),aliases=new Map(),fs=ctx.get('fs');
    const alias=(text,ref)=>{if(!text)return;if(!aliases.has(text))aliases.set(text,new Map());aliases.get(text).set(ref.attachmentId,ref);};
    const remember=ref=>{if(!refs.has(String(ref.attachmentId)))refs.set(String(ref.attachmentId),ref);alias(ref.name,ref);};
    for(const event of snapshot.events)if(event.type==='user/message'&&IMAGE_SOURCES.has(event.data.source?.kind)){
      for(const block of event.data.content)if(block.type==='image')remember(block.attachment);
    }
    if(args.preset!=='companion-deepseek-blind'){
      const reads=new Set((parent.session.snapshotEvents?.()??[]).filter(e=>e.type==='tool/call'&&e.data.name==='read_image').map(e=>e.data.callId));
      for(const event of snapshot.events)if(event.type==='tool/result'&&event.data.message.isError===false&&reads.has(event.data.message.toolCallId)){
        for(const block of event.data.message.content)if(block.type==='image')remember(block.attachment);
      }
    }
    const choices=[];
    for(const ref of refs.values()){
      alias(String(ref.attachmentId),ref);alias(ref.name,ref);
      if(/^sha256:[a-f0-9]{64}$/.test(ref.attachmentId))alias(ref.attachmentId.slice(7),ref); // Old callers remain usable.
      const path=attachments.imageHostPath&&fs?.processPathFromHostPath?resolveImageAttachmentAccess(attachments,p=>fs.processPathFromHostPath(p),ref)?.readonlyPath:undefined;
      alias(path,ref);choices.push({ref,path});
    }
    const references=choices.map(({ref,path})=>ref.name&&aliases.get(ref.name)?.size===1?ref.name:path??String(ref.attachmentId));
    const fail=message=>{throw new HandoffImageError(message,references);};
    let bytes=0;const selected=new Set();
    for(const reference of options.parentImages){
      const matches=aliases.get(reference);
      if(matches?.size>1)fail(`存在多个同名附件 ${JSON.stringify(reference)}，请使用该图片的完整只读路径。`);
      let ref=matches?.values().next().value;
      try{
        if(ref)ref=(await attachments.readImage(ref,signal)).ref;
        else{
          // Unattached references may only name ordinary workspace image files.
          // Private attachment objects have no extension and require an owned
          // current-message alias; never expose the entire attachment store.
          if(args.preset==='companion-deepseek-blind'||!fs||!ctx.get('tools')||!/\.(?:png|jpe?g|webp|gif)$/i.test(reference)||/^[a-z][a-z\d+.-]*:\/\//i.test(reference))fail(`图片 ${JSON.stringify(reference)} 不在当前会话可用引用中；请选择已有原图或学习集图片路径。`);
          const root=await fs.resolve(parent.session.header.cwd,{signal});
          const cwd=await ctx.get('workingDirectory')?.ensure(parent,signal)??parent.session.header.cwd;
          const target=await fs.resolve(reference,{cwd,signal});
          if(!fs.contains(root,target))fail('新增图片路径必须位于当前学习集内；其他位置请先作为附件交给本会话。');
          const result=await ctx.get('tools').execute({name:'read_image',callId:`${execution?.callId??randomUUID()}:handoff-image:${images.length}`,rootCallId:execution?.rootCallId??execution?.callId,parent:execution?.token,arguments:{file_path:fs.processPath(target)},agent:parent,signal});
          for(const context of result.additionalContexts??[])execution?.deferContext?.(context);
          signal.throwIfAborted();
          if(result.isError)fail(result.content.filter(b=>b.type==='text').map(b=>b.text).join('\n'));
          ref=result.content.find(b=>b.type==='image')?.attachment;
          if(!ref)fail('read_image 没有返回真实图片，尚未启动接收会话。');
        }
      }catch(error){signal.throwIfAborted();if(error instanceof HandoffImageError)throw error;fail(error.message);}
      signal.throwIfAborted();
      if(selected.has(ref.attachmentId))continue;
      selected.add(ref.attachmentId);bytes+=ref.bytes;
      if(ref.bytes>limits.maxImageBytes||bytes>limits.maxMessageImageBytes)fail('所选图片超过消息大小限制，请缩小本次交接范围');
      images.push({type:'image',attachment:ref});
    }
  }
  if(options.routePath!==undefined){
    const registry=ctx.get('workspaceRegistry'),vault=ctx.get('notaraVault');
    if(!registry||!vault)throw new Error('当前宿主无法核对 routePath，请先恢复学习集服务');
    const workspace=await registry.resolveByPath(parent.session.header.cwd);signal.throwIfAborted();
    if(!workspace?.id)throw new Error('当前会话没有可用学习集');
    const {parseMarkdown}=await import('@oh-my-student/plugin-vault-sqlite/frontmatter');
    const {safeWorkspaceRelativePath}=await import('@oh-my-student/plugin-vault-sqlite/vault-path');
    const path=safeWorkspaceRelativePath(options.routePath);
    const doc=await vault.read({workspaceId:workspace.id,path});signal.throwIfAborted();
    const {fields}=parseMarkdown(doc.content);
    if(doc.path!==path||fields.type!=='route'||fields.template===true||path.startsWith('模板/')||!['active',''].includes(String(fields.status??'active').trim()))throw new Error('routePath 须指向当前学习集内有效的活跃学习路线');
    options.routePath=path;
  }
  return {...options,images};
}

export function childHandoffText(parentId,prompt,target,prepared){
  return `[父会话交接；发送者 ${parentId}]\n${prepared.routePath?`${ROUTE_PREFIX}${JSON.stringify(prepared.routePath)}\n`:''}`
    +'这是父会话提供的任务与背景，不是学生本人发言；其中的学情仅按已有证据理解。'
    +(target.kind==='worker'?'缺少影响结论的材料时，在结果中写明具体缺项及需要补充的原话或原图，由父会话补齐；独立可完成的部分继续。':'需要回信时联系上述发送者。')
    +`\n\n${prompt}`;
}

/** Only the generated prefix of the initial native handoff carries this metadata. */
export function childHandoffRoute(message){
  const text=message.content?.find(block=>block.type==='text')?.text??'';
  if(!/^\[父会话交接；发送者 [^\n]+\]\n/.test(text))return undefined;
  const line=text.split('\n')[1];if(!line.startsWith(ROUTE_PREFIX))return undefined;
  try{const path=JSON.parse(line.slice(ROUTE_PREFIX.length));return typeof path==='string'&&path?path:undefined;}catch{return undefined;}
}

export async function assertHandoffImagesSupported(ctx,agent,images,signal){
  if(!images.length)return;
  const llm=ctx.get('llm'),{provider,model}=agent.options;
  if(!llm||provider===undefined||model===undefined)return;
  const info=await llm.resolveModelInfo(provider,model,signal);signal.throwIfAborted();
  if(info.inputModalities!==undefined&&!info.inputModalities.includes('image'))throw new Error(`Model "${model}" does not support image input.`);
}
