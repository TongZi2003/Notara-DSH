import React,{useEffect,useState,useSyncExternalStore} from 'react';
import {SuccessToast} from '@oh-my-student/plugin-graph-and-blocks/success-feedback';
import {subscribeWorkspace,workspaceForSession} from '@oh-my-student/plugin-vault-sqlite/workspace-client';
import {currentSessionId} from './composer.js';
import {whiteboardStatusLabel} from './whiteboard-feedback.js';

function useWhiteboardOwner(ctx){
 const sessionId=useSyncExternalStore(fn=>subscribeWorkspace(ctx,fn),()=>currentSessionId(ctx));
 const workspaceId=useSyncExternalStore(fn=>subscribeWorkspace(ctx,fn),()=>workspaceForSession(ctx,sessionId));
 return {sessionId,workspaceId};
}

export function WhiteboardFeedback({ctx,store}){
 const receipt=useSyncExternalStore(store.subscribe,store.getSnapshot),owner=useWhiteboardOwner(ctx);
 const current=receipt&&receipt.sessionId===owner.sessionId&&receipt.workspaceId===owner.workspaceId;
 useEffect(()=>{if(receipt&&!current)store.dismiss(receipt.seq);},[receipt,current,store]);
 return current?<SuccessToast key={receipt.seq} text={receipt.text} onDone={()=>store.dismiss(receipt.seq)}/>:null;
}

function SavedWhiteboardStatus({ctx,sessionId,workspaceId,path}){
 const [label,setLabel]=useState('正在读取白板状态…');
 useEffect(()=>{
  let live=true;
  ctx.remote.notaraVault.whiteboard({sessionId,workspaceId}).then(response=>{
   if(!live)return;
   setLabel(response?.ok?whiteboardStatusLabel(response.value,path):'白板教学 · 状态暂不可用');
  },()=>{if(live)setLabel('白板教学 · 状态暂不可用');});
  return()=>{live=false;};
 },[ctx,sessionId,workspaceId,path]);
 return <span>{label}</span>;
}

// Mounted only while the native canvas menu is open: always read the actual
// binding, including after reload, instead of retaining the last command label.
export function WhiteboardMenuStatus({ctx,workspaceId,path}){
 const owner=useWhiteboardOwner(ctx);
 if(!owner.sessionId||owner.workspaceId===null||owner.workspaceId!==workspaceId)return <span>此白板未用于当前会话教学</span>;
 return <SavedWhiteboardStatus key={JSON.stringify([owner.sessionId,workspaceId,path])} {...{ctx,workspaceId,path}} sessionId={owner.sessionId}/>;
}
