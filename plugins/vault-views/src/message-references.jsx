import React from 'react';
import {workspaceForSession} from '@oh-my-student/plugin-vault-sqlite/workspace-client';
import {installQueueReferenceEditor} from './queue-reference-editor.jsx';

/** Resolve against the message's Session, never the currently selected view. */
export function sourceMessageLocator(ctx,sessionId,pin){
  const workspaceId=pin.workspaceId??workspaceForSession(ctx,sessionId);
  if(!sessionId||workspaceId===null)return null;
  return {...pin,workspaceId,sourceSessionId:sessionId};
}
export function installMessageReferences(ctx,openDoc){
  const stopQueue=installQueueReferenceEditor(ctx);
  let stopNode;
  try{stopNode=ctx.slots.inject('conversation.user.text.node',()=>ctx.slots.register({name:'conversation.user.text.node',key:'notara-source'},({node,sessionId,interactive})=>{
    const locator=sourceMessageLocator(ctx,sessionId,node.data.pin);
    return interactive&&locator?<button type="button" className="nv-message-reference" onClick={()=>openDoc(locator)}>{node.data.label}</button>:<span className="nv-message-reference">{node.data.label}</span>;
  }));}catch(error){stopQueue();throw error;}
  return ()=>{stopNode();stopQueue();};
}
