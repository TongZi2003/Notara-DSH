import React,{useEffect,useRef,useState} from 'react';
import {parseDrawingDocument} from '@oh-my-student/plugin-vault-sqlite/drawing-files';
import {drawingMathElement,updateDrawingMath} from '@oh-my-student/plugin-vault-sqlite/math-reference';
import {sameDrawingElement} from '@oh-my-student/plugin-vault-sqlite/drawing-sync';
import {mathDefinition} from '@oh-my-student/plugin-graph-and-blocks/drawing-math';
import {useDocumentDraft} from './document-draft.jsx';
import {MathSurface,MathDrawingDialog} from './math-drawing.jsx';
import {callVault} from './logic.js';

/** The source Excalidraw element is authoritative, including its shared draft. */
export function MathReference({record,remote,locator,elementId,onOpen,unavailable=false}){
  const {draft,state,dirty,save}=useDocumentDraft({record,remote,workspaceId:remote.workspaceId??locator.workspaceId});
  const [error,setError]=useState(''),[editing,setEditing]=useState(null),initial=useRef(null),alive=useRef(true),gesture=useRef(false),editingRef=useRef(false),client=useRef(crypto.randomUUID());editingRef.current=Boolean(editing);
  const activity=()=>callVault(remote,'drawingActivity',{path:record.path,clientId:client.current,elementIds:gesture.current||editingRef.current?[elementId]:[]}).catch(()=>{});
  useEffect(()=>{alive.current=true;const end=()=>{gesture.current=false;void activity();};window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end);const timer=setInterval(()=>{if(gesture.current||editingRef.current)void activity();},1800);return()=>{alive.current=false;clearInterval(timer);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',end);void callVault(remote,'drawingActivity',{path:record.path,clientId:client.current,elementIds:[]}).catch(()=>{});};},[draft,remote,record.path,elementId]);
  useEffect(()=>{void activity();},[Boolean(editing)]);
  let element,definition;
  try{element=drawingMathElement(parseDrawingDocument(state.text),elementId);definition=mathDefinition(element.customData.notaraMath.source,element.customData.notaraMath);}catch{/* Keep the source draft; an invalid reference is never retargeted. */}
  useEffect(()=>{if(!definition){gesture.current=false;editingRef.current=false;setEditing(null);void activity();}},[Boolean(definition)]);
  if(!definition)return <p role="alert">引用的数学图已删除或无法读取。<button onClick={()=>onOpen?.(locator)}>打开源白板</button></p>;
  const source=definition.data.source;
  const change=(updater,meta)=>{
    if(!alive.current)return;
    if(meta?.initial){const current=initial.current?.source===source?initial.current:definition.data;initial.current=typeof updater==='function'?updater(current):updater;return;}
    try{
      if(unavailable)throw Error('源白板暂时无法读取，草稿已保留，请恢复连接后再应用。');
      const current=draft.getSnapshot();if(current.conflict)throw Error('源白板有冲突，请先打开原文件处理。');
      const doc=parseDrawingDocument(current.text),target=drawingMathElement(doc,elementId);if(target.customData.notaraMath.source!==source)throw Error('图形定义已变化，请重新编辑。');
      const base=mathDefinition(source,target.customData.notaraMath).data;
      if(initial.current?.source===source)base.drags={...initial.current.drags,...base.drags};
      const next=typeof updater==='function'?updater(base):updater,data=mathDefinition(next.source,next).data,result=updateDrawingMath(doc,elementId,data,source);
      if(result!==doc)draft.edit(JSON.stringify(result,null,2)+'\n',{share:false});setError('');
    }catch(e){setError(e.message.includes('missing')?'引用的数学图已删除，未覆盖源白板。':e.message);if(meta?.throwErrors)throw e;}
  };
  return <section className="nv-math-reference" aria-label="共享数学图" onPointerDownCapture={()=>{gesture.current=true;void activity();}}>
    <div className="nv-math-ref-surface"><MathSurface data={definition.data} onChange={state.conflict||unavailable?undefined:change}/></div>
    <div className="nv-math-parameters">{definition.spec.params.map(p=><label key={p.name}>{p.name} = {definition.data.values[p.name]}<input aria-label={`参数 ${p.name}`} type="range" min={p.min} max={p.max} step={p.step} value={definition.data.values[p.name]} disabled={Boolean(state.conflict)||unavailable} onChange={e=>{const value=Number(e.target.value);change(previous=>({...previous,values:{...previous.values,[p.name]:value}}));}}/></label>)}</div>
    <footer><span>{dirty?'源白板有未保存修改':'与源白板共享'}{state.saving?' · 保存中':''}</span><button onClick={()=>setEditing(structuredClone(element))} disabled={Boolean(state.conflict)||unavailable}>编辑数学图</button><button onClick={save} disabled={!dirty||state.saving||Boolean(state.conflict)||unavailable}>保存源白板</button></footer>
    {unavailable&&<p role="status">源白板暂时无法读取，草稿已保留，恢复连接后可以继续保存。</p>}
    {(error||state.conflict||state.message?.startsWith('保存失败'))&&<p role="alert">{error||state.message||'源白板有冲突，草稿已保留。'}<button onClick={()=>onOpen?.(locator)}>打开源白板</button></p>}
    {editing&&<MathDrawingDialog initial={editing.customData.notaraMath} onClose={()=>setEditing(null)} onApply={data=>{const current=drawingMathElement(parseDrawingDocument(draft.getSnapshot().text),elementId);if(!sameDrawingElement(editing,current)||draft.getSnapshot().conflict)throw Error('这个数学图已更新，请关闭后重新编辑。');change(data,{throwErrors:true});}}/>}
  </section>;
}
