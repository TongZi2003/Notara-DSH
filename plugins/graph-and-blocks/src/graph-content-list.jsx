import React, {useState,useRef,useEffect} from 'react';
import {listSelectionGesture,selectCandidates} from './selection-interaction.js';

/** Bounded lists keep a large case collection out of both the canvas and DOM. */
export function GraphContentList({nodes,label,picked,onOpen,onInspect,onToggle,showHeader=true}){
  const [page,setPage]=useState(0),size=8,last=Math.max(0,Math.ceil(nodes.length/size)-1),current=Math.min(page,last),start=current*size;
  const anchor=useRef(null),[notice,setNotice]=useState('');
  useEffect(()=>{anchor.current=null;setNotice('');},[current]);
  const select=(node,event)=>{
    if(!onToggle)return;
    try {
      const next=selectCandidates(picked,nodes.slice(start,start+size).map(item=>item.path),node.path,anchor.current,event);
      anchor.current=next.anchor;setNotice('');
      for(const path of new Set([...picked,...next.paths]))if(picked.includes(path)!==next.paths.includes(path))onToggle(path);
    } catch(error){setNotice(error.message);}
  };
  return <section className="nv-graph-content-list" aria-label={label}>
    {showHeader&&<header><strong>{label}</strong><span>{nodes.length} 项资料</span></header>}
    <ul>{nodes.slice(start,start+size).map(node=><li key={node.path} onClickCapture={event=>{if(onToggle&&listSelectionGesture(event)){event.preventDefault();event.stopPropagation();select(node,event);}}}>
      <button type="button" className="nv-graph-content-title" aria-label={'打开 '+node.title} onClick={()=>onOpen(node.path)}>{node.title}</button>
      <div><button type="button" aria-label={'查看联系 '+node.title} onClick={()=>onInspect(node.path)}>联系</button>{onToggle&&<button type="button" aria-label={(picked.includes(node.path)?'移出候选 ':'加入候选 ')+node.title} aria-pressed={picked.includes(node.path)} onClick={event=>select(node,event)}>{picked.includes(node.path)?'已选':'选择'}</button>}</div>
    </li>)}</ul>
    {notice&&<p role="status">{notice}</p>}
    {nodes.length>size&&<footer><span>{start+1}–{Math.min(start+size,nodes.length)} / {nodes.length}</span><button type="button" aria-label="上一页" disabled={!current} onClick={()=>setPage(current-1)}>‹</button><button type="button" aria-label="下一页" disabled={current===last} onClick={()=>setPage(current+1)}>›</button></footer>}
  </section>;
}
