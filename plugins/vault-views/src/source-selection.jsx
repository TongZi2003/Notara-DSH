import React,{useEffect,useRef,useState} from 'react';
import {useSuccessFeedback} from '@oh-my-student/plugin-graph-and-blocks/success-feedback';
import {callVault,sourceCard,verifyDisplayedSource} from './logic.js';
import {subscribeVaultChanges,notifyVaultChanged} from '@oh-my-student/plugin-vault-sqlite/workspace-client';

export function useSourceCards(remote,path,record){
  const [state,setState]=useState({references:[],total:0,path,remote});
  useEffect(()=>{
    let live=true,seq=0;
    const read=async()=>{
      const generation=++seq;
      try{
        const references=[];let total=0;
        do{
          const value=await callVault(remote,'query',{referencesTo:path,limit:200,offset:references.length});
          if(!live||generation!==seq)return;
          total=value.total??0;references.push(...(value.references??[]));
          if(!value.references?.length)break;
        }while(references.length<total);
        setState({references,total,path,remote});
      }catch{if(live&&generation===seq)setState({references:[],total:0,path,remote});}
    };
    const refresh=()=>void read();
    refresh();const stop=subscribeVaultChanges(remote,refresh);
    return()=>{live=false;stop();};
  },[remote,path,record?.revision]);
  return state.path===path&&state.remote===remote?state:{references:[],total:0};
}
export function SelectionActions({record,selection,disabled=false,remote,onBring,onOpen,onSaved,workspaceId,captureOwner}){
  const [successToast,showSuccess,clearSuccess]=useSuccessFeedback();
  const [creating,setCreating]=useState(false),[title,setTitle]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const pin={path:record.path,revision:record.revision,workspaceId,...selection};
  disabled=disabled||Boolean(selection?.revision&&selection.revision!==record.revision);
  const run=async action=>{if(disabled||!selection)return;const isCurrent=captureOwner?.()??(()=>true);setBusy(true);setNotice('');clearSuccess();try{await action(()=>alive.current&&isCurrent());}catch(error){if(alive.current&&isCurrent())setNotice(error.message||'操作未完成，请重试');}finally{if(alive.current)setBusy(false);}};
  const bring=generate=>run(async current=>{await onBring?.([pin],generate?'请基于这个选区整理一张知识卡片，使用合适的卡片类型并写入摘要。原样保留资料引用中的完整来源定位，包括选区和来源版本；不要把来源内容记为我的掌握证据。':'请围绕我选中的这部分和我讨论。');if(current())showSuccess('已加入对话草稿，可补充问题后发送。');});
  const create=event=>{event.preventDefault();void run(async current=>{const input=sourceCard({...pin,title});await verifyDisplayedSource(remote,record);if(!current())return;const saved=await callVault(remote,'save',input);notifyVaultChanged(remote,{path:input.path,revision:saved.revision},workspaceId);if(current()){setCreating(false);setTitle('');onSaved?.();onOpen?.({path:input.path});}});};
  return <div className="nv-source-selection"><div className="nv-vault-toolbar">
    <span>{selection?.range?'已选择文字':'已选择来源区域'}</span>
    <button disabled={disabled||busy||!selection||!onBring} onMouseDown={event=>event.preventDefault()} onClick={()=>bring(false)}>讨论选区</button>
    <button disabled={disabled||busy||!selection} onMouseDown={event=>event.preventDefault()} onClick={()=>setCreating(!creating)}>创建来源卡片</button>
    <button disabled={disabled||busy||!selection||!onBring} onMouseDown={event=>event.preventDefault()} onClick={()=>bring(true)}>请老师生成卡片</button>
  </div>{disabled&&<p role="status">请先保存修改，再引用当前选区。</p>}
    {creating&&<form className="nv-vault-toolbar" onSubmit={create}><label>卡片标题 <input aria-label="选区卡片标题" maxLength={100} required value={title} onChange={event=>setTitle(event.target.value)}/></label><button disabled={disabled||busy||!title.trim()}>创建卡片</button><button type="button" onClick={()=>setCreating(false)}>取消</button></form>}
    {successToast}{notice&&<p role="status">{notice}</p>}
  </div>;
}
