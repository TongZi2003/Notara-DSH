import React,{useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {bindVaultRemote,workspaceForSession,subscribeWorkspace} from '@oh-my-student/plugin-vault-sqlite/workspace-client';
import {currentSessionId,captureSourceOwner,bringDrawingSnapshot} from './composer.js';
import {callVault} from './logic.js';
import {DrawingPreview,ExcalidrawEditor} from './excalidraw-editor.jsx';
import {findDrawingSnapshot} from './drawing-chat-model.js';
import {markdownGeneration} from './markdown-drafts.js';

let activeKey=null;const listeners=new Set();
const activate=key=>{activeKey=key;for(const f of listeners)f();};
const subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
export function DrawingChat({ctx,ownerSessionId,occurrenceKey,callId,beforeSeq,openFile}){
  const source=useMemo(()=>ctx.uiConversation.binding(ownerSessionId).target('chat'),[ctx,ownerSessionId]);
  const chat=useSyncExternalStore(f=>source.subscribe(f),()=>source.getSnapshot());
  const snapshot=useMemo(()=>findDrawingSnapshot(chat?.nodes.values(),callId,beforeSeq),[chat,callId,beforeSeq]);
  const workspace=useSyncExternalStore(f=>subscribeWorkspace(ctx,f),()=>workspaceForSession(ctx,ownerSessionId));
  const current=useSyncExternalStore(f=>{const offs=[ctx.sessions.list.subscribe(f)];const face=ctx.get('uiSession')?.adapter?.current;if(face)offs.push(face.subscribe(f));return()=>offs.forEach(off=>off());},()=>currentSessionId(ctx));
  const key=JSON.stringify([ownerSessionId,callId,occurrenceKey]),active=useSyncExternalStore(subscribe,()=>activeKey)===key;
  const remote=useMemo(()=>snapshot?bindVaultRemote(ctx.remote.notaraVault,snapshot.workspaceId):null,[ctx,snapshot?.workspaceId]);
  const [record,setRecord]=useState(null),[error,setError]=useState(''),[visible,setVisible]=useState(false),host=useRef(null),generation=useRef(0);
  const editable=snapshot&&current===ownerSessionId&&workspace===snapshot.workspaceId;
  useEffect(()=>{const node=host.current;if(!node)return;const observer=new IntersectionObserver(entries=>setVisible(entries.some(e=>e.isIntersecting)),{rootMargin:'240px'});observer.observe(node);return()=>observer.disconnect();},[]);
  useEffect(()=>{if(!active||!editable){generation.current++;setRecord(null);}},[active,editable]);
  useEffect(()=>()=>{generation.current++;if(activeKey===key)activate(null);},[key]);
  const start=async()=>{
    if(!editable)return;activate(key);setError('');const token=++generation.current;
    // Stamp the read before awaiting it, just like file-pane reads. The opening
    // record must not be replayed over later save receipts by useDocumentDraft.
    const readGeneration=markdownGeneration(snapshot.workspaceId,snapshot.path);
    try{const loaded=await callVault(remote,'read',{path:snapshot.path});if(token===generation.current&&currentSessionId(ctx)===ownerSessionId&&workspaceForSession(ctx,ownerSessionId)===snapshot.workspaceId)setRecord({...loaded,readGeneration});}
    catch{if(token===generation.current)setError('原白板暂不可读，历史画面仍保留。');}
  };
  return <section ref={host} className="nv-chat-drawing" aria-label="对话白板">
    {!snapshot?<p role="status">这份白板快照尚未载入，请加载对应历史记录。</p>:<>
      <header><strong>{snapshot.path.split('/').at(-1).replace(/\.excalidraw$/,'')}</strong><span>{active&&record?'正在编辑最新白板':'当时的板书'}</span>
        {active?<button onClick={()=>activate(null)}>结束绘图</button>:<button disabled={!editable} onClick={start}>动手画</button>}
        <button disabled={!editable} onClick={()=>{activate(null);openFile?.(snapshot.path);}}>展开白板</button></header>
      {error&&<p role="alert">{error}</p>}
      {active&&record&&editable?<ExcalidrawEditor key={key} record={record} workspaceId={snapshot.workspaceId} remote={remote} documentHeader={{}} captureOwner={()=>captureSourceOwner(ctx)} onSnapshot={(image,owner)=>bringDrawingSnapshot(ctx,image,owner)}/>
        :<div className="nv-chat-drawing-preview">{visible?<DrawingPreview content={snapshot.content}/>:<span>白板预览</span>}</div>}
    </>}
  </section>;
}
export function installDrawingChat(ctx){return ctx.slots.registerFactory({name:'notara.drawing.content',scope:'root'},props=><DrawingChat {...props} ctx={ctx}/>);}
