import {createHash} from 'node:crypto';
import {realpathSync} from 'node:fs';
import {Service} from '@deepseek-ai/cordis';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {appendDelegatedPolicyOverrides,captureDelegatedPolicyOverrides,resolveChildAgentOptions} from '@deepseek-ai/dsh-subagent';
import {handoffIdentity,prepareHandoff,assertHandoffImagesSupported} from './handoff-context.js';
import {assertHandoffPrompt} from './handoff-retry.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
const handoffSource='notara-topic-handoff';
const TOPIC_PRESETS=new Set(['notara-teacher','notara-material-organizer']);
const canonical=path=>{try{return realpathSync(path);}catch{return null;}};
function recordedPreset(session,events){
  return events?.filter(e=>e.type==='agent-preset/selected').at(-1)?.data.agentPreset??session?.agentPreset;
}
export function messagesOf(snapshot){
  const messages=snapshot.events.filter(e=>e.type==='user/message').map(e=>e.data);
  const pending={'next-turn':[],'next-step':[]},claimed=[];
  for(const event of snapshot.events){
    if(event.type!=='agent/inbox/spliced')continue;
    const {target,start,removedCount=0,inserted,outcome}=event.data;
    const removed=pending[target]?.splice(start,removedCount,...inserted)??[];
    // Claim precedes async prompt assembly and user/message publication. A
    // retry during that gap must not resurrect accepted work. Queue edits and
    // explicit cancellations are not claims.
    if(!inserted.length&&outcome!=='canceled')claimed.push(...removed);
  }
  return [...messages,...claimed,...pending['next-turn'],...pending['next-step']];
}

/** Creates ordinary native conversations. No teaching entity, progress ledger, or second history. */
export class TopicConversations extends Service{
  static inject=['agents','sessions','sessionQuery','sessionPersistence','agentPresets'];
  constructor(ctx){
    super(ctx,'notaraTopics');this.pending=new Map();this.handles=new Map();this.turnSignals=new WeakMap();
    // Assembly precedes pre-step, and can itself await file/context reads.
    // Capture its public signal before those reads so an accepted stop cannot
    // enqueue a wake while the canceled turn is still cleaning up.
    ctx.on('system-prompt/assemble',(assembly,context,next)=>{if(context.agent&&context.signal)this.turnSignals.set(context.agent,context.signal);return next();});
    ctx.on('agent/pre-step',({agent,signal},next)=>{this.turnSignals.set(agent,signal);return next();});
    // Service.ctx is caller-traced by Cordis; retain the actual host owner.
    this.native={
      create:options=>ctx.agents.withoutInitiator(()=>ctx.agents.create(options)),
      resume:options=>ctx.agents.withoutInitiator(()=>ctx.agents.resume(options)),
      controller:()=>ctx.get('sessionController'),
      resolve:(controller,id)=>ctx.agents.withoutInitiator(()=>controller.resolveAgent(id)),
      attach:async(cwd,id)=>{const workspace=await ctx.get('workspaceRegistry')?.resolveByPath(cwd);if(workspace)await ctx.agents.withoutInitiator(()=>workspace.attachSession(id));},
    };
    ctx.effect(()=>async()=>{await Promise.allSettled([...this.pending.values()].map(row=>row.promise));await Promise.allSettled([...this.handles.values()].map(handle=>handle.dispose()));});
  }
  assertSender(agent,signal){signal.throwIfAborted();if(this.ctx.agents.get(agent.id)!==agent)throw new Error('发送会话已关闭');}
  async exclusive(key,fingerprint,run){
    const prior=this.pending.get(key);if(prior){if(prior.fingerprint!==fingerprint)throw new Error('同一请求携带了不同内容或角色，不能合并');return prior.promise;}
    const promise=run();this.pending.set(key,{fingerprint,promise});try{return await promise;}finally{this.pending.delete(key);}
  }
  read(id){return this.ctx.sessionQuery.readSession(id);}
  liveSnapshot(id){const agent=this.ctx.agents.get(id);return agent?{session:agent.session.header,events:agent.session.snapshotEvents()}:null;}
  snapshot(id){return this.liveSnapshot(id)??this.read(id);}
  async origin(id){const snapshot=await this.read(id);return messagesOf(snapshot).map(message=>message.source).find(source=>source?.kind===handoffSource)?.senderSessionId??null;}
  /** Shared by the tool router and transport; a home registration alone grants nothing. */
  async canSend(sender,targetId){
    const [from,to]=await Promise.all([this.snapshot(sender.id),this.snapshot(targetId)]);
    const deliveries=this.ctx.get('notaraSummaryDeliveries'),registry=this.ctx.get('workspaceRegistry');
    if(deliveries&&registry){
      await deliveries.ready;
      await Promise.all([registry.resolveByPath(from.session.cwd),registry.resolveByPath(to.session.cwd)]);
    }
    return this.permitsPair(sender.id,targetId,this.liveSnapshot(sender.id)??from,this.liveSnapshot(targetId)??to);
  }
  // No await: recheck live identities, roles, roots and receipt immediately
  // before inbox acceptance, after all cold-resume/authorization I/O.
  permitsPair(senderId,targetId,from,to){
    if(!from||!to)return false;
    const ordinary=(a,b)=>a.session.origin!=='subagent'&&b.session.origin!=='subagent'&&canonical(a.session.cwd)!==null&&canonical(a.session.cwd)===canonical(b.session.cwd);
    if(!ordinary(from,to))return false;
    const origin=snapshot=>messagesOf(snapshot).map(message=>message.source).find(source=>source?.kind===handoffSource)?.senderSessionId;
    if(origin(from)===targetId||origin(to)===senderId)return true;
    const deliveries=this.ctx.get('notaraSummaryDeliveries'),registry=this.ctx.get('workspaceRegistry');
    if(!deliveries?.store||!registry)return false;
    const fromWorkspace=registry.list().find(workspace=>canonical(workspace.path)===canonical(from.session.cwd));
    if(!fromWorkspace)return false;
    const root=canonical(fromWorkspace.path);
    if(!root)return false;
    const preset=(id,snapshot)=>{const live=this.ctx.agents.get(id);return live?this.ctx.agentPresets.composedPreset(live.ctx):recordedPreset(snapshot.session,snapshot.events);};
    const fromPreset=preset(senderId,from),toPreset=preset(targetId,to);
    return deliveries.store.entries().some(([,row])=>row.workspaceId===fromWorkspace.id&&row.root===root&&TOPIC_PRESETS.has(row.senderPreset??'notara-teacher')&&(
      row.senderSessionId===senderId&&row.recipientSessionId===targetId&&fromPreset===(row.senderPreset??'notara-teacher')&&toPreset==='notara-coordinator'||
      row.senderSessionId===targetId&&row.recipientSessionId===senderId&&toPreset===(row.senderPreset??'notara-teacher')&&fromPreset==='notara-coordinator'));
  }
  assertRelayActive(sender,targetId,targetState){
    const registry=this.ctx.get('workspaceRegistry');
    if([sender.id,targetId].some(id=>registry?.archivedSessionIds.includes(id)))throw new Error('归档会话不能接续会话来信');
    for(const id of [sender.id,targetId]){
      const active=this.turnSignals.get(this.ctx.agents.get(id));
      if(active?.aborted&&active.reason?.kind==='user')throw new Error('用户正在停止会话，不能排入新的会话来信');
      const snapshot=this.liveSnapshot(id)??targetState;
      let stopped=false;
      for(const event of snapshot.events){
        if(event.type==='turn/end'&&event.data.reason?.kind==='aborted'&&event.data.reason.reason?.kind==='user')stopped=true;
        else if(event.type==='user/message'&&event.data.source?.kind==='user')stopped=false;
      }
      if(stopped)throw new Error('用户已停止会话，须由用户继续后再发送新消息');
    }
  }
  async resume(id){
    const live=this.ctx.agents.get(id);if(live)return live;
    const {session,events}=await this.read(id);
    const preset=recordedPreset(session,events);
    const controller=this.native.controller();
    if(controller){
      const value=await this.native.resolve(controller,id);
      if(value.error)throw new Error(value.error.message);
      if(preset&&this.ctx.agentPresets.composedPreset(value.agent.ctx)!==preset)await this.ctx.agentPresets.mount(value.agent.ctx,preset);
      return value.agent;
    }
    const config=events.filter(e=>e.type==='request/header').at(-1)?.data.header.config;
    const picked=events.filter(e=>e.type==='model/selection').at(-1)?.data??config;
    const handle=await this.native.resume({resumeSessionId:id,...picked?{agentOptions:{provider:picked.provider,model:picked.model,...picked.reasoningEffort?{reasoningEffort:picked.reasoningEffort}:{}}}:{},setup:async childCtx=>{if(preset)await childCtx.get('agentPresets').mount(childCtx,preset);}});
    this.handles.set(id,handle);return handle.agent;
  }
  async release(id){const handle=this.handles.get(id);if(handle){await handle.dispose();this.handles.delete(id);}}
  async start(parent,args,key,signal,execution){
    assertHandoffPrompt(args.prompt);
    const targetPreset=args.preset??'notara-teacher';
    if(!TOPIC_PRESETS.has(targetPreset))throw new Error(`不允许创建独立会话角色：${String(targetPreset)}`);
    if(parent.session.header.origin==='subagent')throw new Error('独立会话须从主会话发起');
    const id=`notara-topic-${hash(JSON.stringify([parent.id,key])).slice(0,32)}`;
    const fingerprint=hash(JSON.stringify([targetPreset,args.description,args.prompt,...handoffIdentity(args)]));
    this.assertSender(parent,signal);
    return this.exclusive(id,fingerprint,async()=>{
      let agent=this.ctx.agents.get(id);
      const exists=agent||await this.ctx.sessionPersistence.stat(id);
      const existing=exists?await this.snapshot(id):null;
      const accepted=existing&&messagesOf(existing).find(message=>message.source?.kind===handoffSource);
      if(accepted&&(accepted.source.senderSessionId!==parent.id||accepted.source.fingerprint!==fingerprint))throw new Error('该请求已经用于另一份交接，请重试原请求');
      const prepared=accepted?null:await prepareHandoff(this.ctx,parent,args,signal,execution);
      if(!agent){
        if(exists)agent=await this.resume(id);
        else{
          const policy=captureDelegatedPolicyOverrides(parent);
          const handle=await this.native.create({sessionId:id,meta:{cwd:parent.session.header.cwd,agentPreset:targetPreset},agentOptions:resolveChildAgentOptions(parent,undefined,0),signal,
            setup:async(childCtx,child)=>{await childCtx.get('agentPresets').mount(childCtx,targetPreset);appendDelegatedPolicyOverrides(child.session,policy);},
          });
          this.handles.set(id,handle);agent=handle.agent;
        }
      }
      const composedPreset=this.ctx.agentPresets.composedPreset(agent.ctx)??agent.session.header.agentPreset;
      if(agent.session.header.cwd!==parent.session.header.cwd||agent.session.header.origin==='subagent'||composedPreset!==targetPreset){
        throw new Error('专题会话归属或角色不一致，不能复用已有会话');
      }
      if(!await this.ctx.sessions.flush(agent.session))throw new Error('新对话尚未保存，请重试');
      await this.native.attach(parent.session.header.cwd,id);
      const snapshot=await this.read(id);
      const prior=messagesOf(snapshot).map(message=>message.source).find(source=>source?.kind===handoffSource);
      if(prior&&(prior.senderSessionId!==parent.id||prior.fingerprint!==fingerprint||(prior.targetPreset&&prior.targetPreset!==targetPreset)))throw new Error('该请求已经用于另一份交接，请重试原请求');
      if(!prior){
        await assertHandoffImagesSupported(this.ctx,agent,prepared.images,signal);
        const controller=this.native.controller();if(controller)await controller.rename({sessionId:id,title:args.description});
        this.assertSender(parent,signal);
        const header=targetPreset==='notara-material-organizer'?`[资料整理交接；来源会话 ${parent.id}]`:`[专题交接；来源会话 ${parent.id}]`;
        agent.followup(createUserMessage({content:[{type:'text',text:`${header}\n这是发起会话提供的背景，不是学习者本人的发言。只把有学生原话或实际作答支持的内容视作已确认前置。\n${prepared.routePath?`本次学习路线：${JSON.stringify(prepared.routePath)}\n`:''}\n${args.prompt}`},...prepared.images],source:{kind:handoffSource,form:'relay',senderSessionId:parent.id,targetPreset,fingerprint,...prepared.routePath?{routePath:prepared.routePath}:{}}}));
        if(!await this.ctx.sessions.flush(agent.session))throw new Error('交接消息尚未保存，请重试');
      }
      return {kind:'topic',id,preset:targetPreset,title:args.description};
    });
  }
  /** Ordinary relay along a native handoff or an exact durable delivery pair. */
  async send(sender,targetId,message,key,signal){
    this.assertSender(sender,signal);
    const rpcId=`notara-relay:${hash(JSON.stringify([sender.id,key]))}`,fingerprint=hash(JSON.stringify([targetId,message]));
    return this.exclusive(rpcId,fingerprint,async()=>{
    if(!await this.canSend(sender,targetId))throw new Error('只能联系原交接相邻会话或交付回执绑定的工作会话与首页');
    const targetState=await this.snapshot(targetId);
    const existing=messagesOf(targetState).find(item=>item.source?.rpcId===rpcId);
    if(existing){
      if(existing.source.fingerprint!==fingerprint)throw new Error('同一投递请求的消息内容不同');
      const live=this.ctx.agents.get(targetId);
      if(live&&!await this.ctx.sessions.flush(live.session))throw new Error('已有消息尚未保存，请重试原请求');
      return {messageId:existing.id};
    }
    this.assertSender(sender,signal);
    this.assertRelayActive(sender,targetId,targetState);
    const target=await this.resume(targetId);
    if(!await this.canSend(sender,targetId))throw new Error('会话角色或交付归属已变化，不能继续投递');
    this.assertSender(sender,signal);
    if(this.ctx.agents.get(targetId)!==target||!this.permitsPair(sender.id,targetId,this.liveSnapshot(sender.id),this.liveSnapshot(targetId)))throw new Error('会话角色或交付归属已变化，不能继续投递');
    this.assertRelayActive(sender,targetId,targetState);
    const value=createUserMessage({content:[{type:'text',text:`[会话来信；发送者 ${sender.id}]\n这是另一会话的消息，不是学生发言。若决定回复，请用 send_message(agent_id:"${sender.id}",message:"回复内容")；写在当前窗口不会送达。告知无需自动回信；投递成功不代表对方已回答。\n\n${message}`}],source:{kind:'agent-message',form:'relay',senderSessionId:sender.id,rpcId,fingerprint}});
    target.followup(value);
    if(!await this.ctx.sessions.flush(target.session))throw new Error('消息尚未保存，请重试原请求');
    return {messageId:value.id};
    });
  }
}
