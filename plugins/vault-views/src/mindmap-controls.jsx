import React,{useEffect,useRef,useState} from 'react';
import {Modal} from '@deepseek-ai/dsh-client-ui-primitives';
import {mindmapTitle,mindmapOutline} from '@oh-my-student/plugin-vault-sqlite/drawing-mindmap';
export const MINDMAP_EXAMPLE='- 导数压轴题\n  - 研究函数\n    - 定义域\n    - 单调性\n    - 极值\n  - 证明零点\n    - 存在性\n    - 唯一性\n  - 整理方法\n    - 取点\n    - 构造辅助函数';
export function MindmapOutlineDialog({initial=MINDMAP_EXAMPLE,readOnly=false,onCreate,onClose}){
  const [text,setText]=useState(initial),[error,setError]=useState('');
  return <Modal open title={readOnly?'导图大纲':'新建思维导图'} closeLabel="关闭导图大纲" onClose={onClose} className="nv-mindmap-dialog">
    <p>{readOnly?'选中后可以复制。折叠分支也包含在大纲中。':'用缩进表示层级，每行以“- ”开头。将生成可编辑的原生图形。'}</p>
    <textarea aria-label="导图大纲" autoFocus value={text} readOnly={readOnly} onChange={e=>setText(e.target.value)} spellCheck={false}/>
    {error&&<p role="alert">{error}</p>}
    <footer>{readOnly?<button onClick={onClose}>完成</button>:<button onClick={()=>{try{onCreate(text);onClose();}catch(e){setError(e.message);}}}>插入导图</button>}</footer>
  </Modal>;
}
export function MindmapControls({doc,node,onAction,onSelect,onNew,onClose,disabled}){
  const title=node?mindmapTitle(doc,node.id):'',[text,setText]=useState(title),[outline,setOutline]=useState(null),input=useRef(null);
  useEffect(()=>setText(title),[node?.id,title]);
  const changed=Boolean(node)&&text.trim()!==title;
  return <div className="nv-mindmap-controls" role="toolbar" aria-label="思维导图操作">
    <span className="nv-mindmap-label">思维导图 · 实验</span><button onClick={onNew} disabled={disabled}>新建</button>
    <select aria-label="选择导图节点" value={node?.id??''} disabled={disabled} onChange={e=>onSelect(e.target.value)}><option value="" disabled>选择节点</option>{doc.elements.filter(e=>!e.isDeleted&&e.customData?.notaraMindmap&&!e.customData.notaraMindmapHidden).map(e=><option key={e.id} value={e.id}>{mindmapTitle(doc,e.id)}{e.customData.notaraMindmap.collapsed?' · 已折叠':''}</option>)}</select>
    <input ref={input} aria-label="节点名称" placeholder={node?'节点名称':'先选一个节点'} value={text} maxLength={200} disabled={!node||disabled} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(changed)onAction({type:'rename',text});}if(e.key==='Escape'){e.stopPropagation();setText(title);input.current.blur();}}}/>
    {changed&&<button onClick={()=>onAction({type:'rename',text})} disabled={disabled}>改名</button>}
    <button title="画布聚焦时按 Tab" disabled={!node||disabled} onClick={()=>onAction({type:'child'})}>＋子节点</button>
    <button title="画布聚焦时按 Enter" disabled={!node?.customData.notaraMindmap.parent||disabled} onClick={()=>onAction({type:'sibling'})}>＋同级</button>
    <button title="Alt / Option + 1" disabled={!node||disabled} aria-pressed={node?.customData.notaraMindmap.collapsed??false} onClick={()=>onAction({type:'fold'})}>{node?.customData.notaraMindmap.collapsed?'展开分支':'折叠分支'}</button>
    <button title="拖动节点也会固定位置" disabled={!node||disabled} aria-pressed={node?.customData.notaraMindmap.pinned??false} onClick={()=>onAction({type:'pin'})}>固定位置</button>
    <button disabled={!node||disabled} onClick={()=>onAction({type:'layout'})}>整理排布</button>
    <button disabled={!node} onClick={()=>setOutline(mindmapOutline(doc,node.id))}>导出大纲</button>
    <button disabled={!node||disabled} onClick={()=>onAction({type:'remove'})}>删除分支</button><button aria-label="关闭思维导图操作" onClick={onClose}>×</button>
    {outline!==null&&<MindmapOutlineDialog initial={outline} readOnly onClose={()=>setOutline(null)}/>}
  </div>;
}
