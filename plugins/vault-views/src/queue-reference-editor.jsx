import React,{useMemo,useSyncExternalStore} from 'react';
import {editableUserText,restoreUserTextEdit} from '../../graph-and-blocks/src/user-message-text.js';

export function QueueReferenceEditor({Native,userText,...props}){
  useSyncExternalStore(l=>userText.subscribe(l),()=>userText.getSnapshot(),()=>userText.getSnapshot());
  const evaluate=useMemo(()=>userText.createEvaluator(),[userText]);
  const inbox=props.useProjection('inbox');
  const edits=new Map();
  for(const row of inbox?.['next-turn']??[]){
    if(!row.content.every(part=>part.type==='text'))continue;
    const raw=row.content.map(part=>part.text).join('');
    edits.set(row.id,editableUserText(raw,evaluate({text:raw,facts:{}})));
  }
  const useProjection=key=>{
    const value=props.useProjection(key);
    if(key!=='inbox'||!value?.['next-turn'])return value;
    return {...value,'next-turn':value['next-turn'].map(row=>edits.has(row.id)?{...row,content:[{type:'text',text:edits.get(row.id).text}]}:row)};
  };
  const updateQueue=(id,action)=>{
    if(action.kind==='edit'&&edits.has(id)){
      const edit=edits.get(id);
      try{
        const text=restoreUserTextEdit(action.content.map(part=>part.text).join(''),edit.references);
        return props.updateQueue(id,{...action,content:[{type:'text',text}]});
      }catch(error){props.notify('error',error.message);return Promise.reject(error);}
    }
    return props.updateQueue(id,action);
  };
  return <Native {...props} useProjection={useProjection} updateQueue={updateQueue}/>;
}
export function installQueueReferenceEditor(ctx){
  const slot='conversation.input.dock';let installed,guard=false,disposed=false;
  const sync=()=>{
    if(guard||disposed)return;guard=true;
    try{
      const original=ctx.slots.entries(slot).find(row=>row.options.id==='queue'&&row.options.priority!==-20);
      if(installed?.original===original)return;
      installed?.off();installed=undefined;if(!original)return;
      const Native=original.component;
      installed={original,off:ctx.slots.register({name:slot,id:'queue',priority:-20,locale:original.locale,inject:original.inject},props=><QueueReferenceEditor {...props} Native={Native} userText={ctx.uiConversation.userText}/>)};
    }finally{guard=false;}
  };
  const stop=ctx.slots.subscribe(slot,sync);
  try{sync();}catch(error){stop();installed?.off();throw error;}
  return ()=>{disposed=true;stop();installed?.off();};
}
