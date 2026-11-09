import React,{useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {Modal} from '@deepseek-ai/dsh-client-ui-primitives';
import {workspaceForSession} from '@oh-my-student/plugin-vault-sqlite/workspace-client';
import {COMPANIONS,INVITATION_MODES,insertCompanionInvitation,registerCompanionInvitations,subagentCallReceipt,sessionPreset} from './companions.js';
import {openWorkspaceSession} from './session-list.js';

// Ported from Pi's WorkerCompanion. Appearance is not a model-routing choice.
export function CompanionAvatar({avatar,name,status='idle',interactive=false}){
  const [gesture,setGesture]=useState(false),timer=useRef(null);
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  const face=<span className="nv-companion-float"><img src={`/notara/vault-views/companions/v1/${avatar}-bean-eyes.png`} alt="" draggable="false"/></span>;
  return interactive?<button type="button" className="nv-companion-avatar" data-state={status} data-wave={gesture||undefined} aria-label={`和${name}打招呼`} title={`和${name}打招呼`} onClick={()=>{clearTimeout(timer.current);setGesture(false);requestAnimationFrame(()=>setGesture(true));timer.current=setTimeout(()=>setGesture(false),900);}}>{face}</button>:<span className="nv-companion-avatar" data-state={status} aria-hidden="true">{face}</span>;
}

function InvitationPicker({ctx,sessionId,useAgentPresetSeat,load}){
  const seat=useAgentPresetSeat(value=>value),[open,setOpen]=useState(false),[mode,setMode]=useState('answer'),[error,setError]=useState('');
  const snapshot=useSyncExternalStore(fn=>ctx.sessions.list.subscribe(fn),()=>ctx.sessions.list.getSnapshot()),preset=sessionPreset(snapshot,sessionId);
  useEffect(()=>{void load?.();},[load]);
  useEffect(()=>{setOpen(false);setError('');},[sessionId,preset]);
  if(preset!=='notara-teacher')return null;
  const available=COMPANIONS.filter(row=>seat.options.some(option=>option.id===row.id));
  if(!available.length)return null;
  return <><button type="button" className="nv-companion-trigger" aria-label="邀请同学" title="邀请同学" aria-haspopup="dialog" aria-expanded={open} onClick={()=>{setError('');setOpen(true);}}><CompanionAvatar avatar="deepseek" name="大肥鱼"/><span>请同学</span></button>
    {open&&<Modal open title="邀请同学" onClose={()=>setOpen(false)} className="nv-companion-picker">
      <div className="nv-companion-mode" role="group" aria-label="邀请方式">{Object.entries(INVITATION_MODES).map(([value,label])=><button key={value} type="button" aria-pressed={mode===value} onClick={()=>setMode(value)}>{label}</button>)}</div>
      <div className="nv-companion-options">{available.filter(row=>mode!=='teach'||row.id==='companion-deepseek').map(row=><button key={row.id} type="button" aria-label={`邀请${row.name}`} onClick={()=>{try{insertCompanionInvitation(ctx,sessionId,{preset:row.id,mode});setOpen(false);}catch(error){setError(error.message);}}}><CompanionAvatar {...row}/><span><strong>{row.name}</strong><small>{row.description}</small></span><span aria-hidden="true">＋</span></button>)}</div>
      <p className="nv-companion-help">先加入草稿，写好问题后发送。{mode==='teach'?'请同时写出原始题面和你的讲解。':'同学沿用当前课堂的模型配置。'}</p>
      {error&&<p role="alert">{error}</p>}
    </Modal>}
  </>;
}
function CompanionSeat({ctx,sessionId}){
  const snapshot=useSyncExternalStore(fn=>ctx.sessions.list.subscribe(fn),()=>ctx.sessions.list.getSnapshot());
  const partner=COMPANIONS.find(row=>row.id===sessionPreset(snapshot,sessionId));
  if(!partner)return null;
  return <CompanionAvatar {...partner} status={snapshot.byId?.[sessionId]?.running?'running':'idle'} interactive/>;
}

export function installCompanions(ctx){
  const off=[registerCompanionInvitations(ctx)];
  let seats,tool,guard=false;
  const sync=()=>{
    if(guard)return;guard=true;
    try{
      const original=ctx.slots.entries('conversation.hero.agentPreset').find(entry=>entry.options.priority!==-20);
      if(original!==seats?.original){seats?.off.forEach(dispose=>dispose());seats=undefined;if(original)seats={original,off:[
        ctx.slots.inject('conversation.input.left',()=>ctx.slots.register({name:'conversation.input.left',id:'notara-invite-companion',inject:original.inject},props=><InvitationPicker {...props} ctx={ctx}/>)),
        ctx.slots.inject('conversation.session.header.actions',()=>ctx.slots.register({name:'conversation.session.header.actions',id:'notara-companion-avatar'},props=><CompanionSeat {...props} ctx={ctx}/>)),
      ]};}
      const native=ctx.slots.entries('tool.call.toolview').find(entry=>entry.options.key==='subagent'&&entry.options.priority!==-25);
      if(native!==tool?.original){tool?.dispose();tool=undefined;if(native){
        const Decorated=props=>{const callerPreset=sessionPreset(ctx.sessions?.list?.getSnapshot?.(),props.sessionId),receipt=subagentCallReceipt(props,callerPreset),failed=props.phase==='result'&&props.block.isError;return <div className="nv-companion-call nv-subagent-receipt"><div className="nv-companion-call-heading">{receipt.partner?<CompanionAvatar {...receipt.partner} interactive/>:<span aria-hidden="true">◇</span>}<span><strong>{receipt.name}</strong><small>{receipt.status}{receipt.blind?' · 不看解析':''}</small></span>{receipt.topicId?<button type="button" onClick={()=>openWorkspaceSession(ctx,receipt.topicId,workspaceForSession(ctx,props.sessionId))}>{receipt.organizer?'打开整理会话':'打开专题对话'}</button>:!receipt.isTopic&&<button type="button" onClick={()=>window.dispatchEvent(new CustomEvent('notara:open-activity',{detail:{sessionId:props.sessionId}}))}>在活动中查看</button>}{failed&&<button type="button" onClick={props.inspect}>查看错误</button>}</div></div>;};
        tool={original:native,dispose:ctx.slots.register({name:'tool.call.toolview',key:'subagent',priority:-25,locale:native.locale,inject:native.inject},Decorated)};
      }}
    }finally{guard=false;}
  };
  off.push(ctx.slots.subscribe('conversation.hero.agentPreset',sync),ctx.slots.subscribe('tool.call.toolview',sync));sync();
  return()=>{off.forEach(dispose=>dispose());seats?.off.forEach(dispose=>dispose());tool?.dispose();};
}
