import React, {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Modal} from '@deepseek-ai/dsh-client-ui-primitives';
import {FilterOptions} from './filter-options.jsx';
import {GRAPH_SELECTION_LIMIT} from './graph-selection.js';

export function GraphSelectionDialog({graph,selected,onApply,onClose}) {
  const [draft,setDraft]=useState(selected),title='已选资料';
  const options=graph.nodes.filter(node=>selected.includes(node.path)).map(node=>({value:node.path,label:node.title}));
  return <Modal open onClose={onClose} title={title} headless backdropBlur={false} className="nv-block-filter-dialog nv-graph-selection-dialog">
    <form onSubmit={event=>{event.preventDefault();onApply(draft);onClose();}}>
      <header><h2>{title}</h2><button type="button" aria-label={'关闭'+title} onClick={onClose}>×</button></header>
      <div className="nv-filter-body">
        <FilterOptions options={options} selected={draft} onChange={setDraft} label="资料" searchLabel="查找待选资料" optionPrefix="带入资料" maxSelected={GRAPH_SELECTION_LIMIT} autoFocus />
      </div>
      <footer><span>只加入选择，不发送消息</span><button type="button" onClick={onClose}>取消</button><button type="submit" className="nv-filter-apply">完成选择</button></footer>
    </form>
  </Modal>;
}

export function GraphContextMenu({position,count,busy,onClose,onBring,onExpand,onClear}) {
  const ref=useRef(null);
  useEffect(()=>{
    const close=event=>{if(event.type==='keydown'&&event.key!=='Escape')return;if(event.type==='pointerdown'&&ref.current?.contains(event.target))return;onClose();};
    document.addEventListener('pointerdown',close);document.addEventListener('keydown',close);window.addEventListener('resize',close);document.addEventListener('scroll',close,true);
    ref.current?.querySelector('button:not(:disabled)')?.focus();
    return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',close);window.removeEventListener('resize',close);document.removeEventListener('scroll',close,true);};
  },[onClose]);
  return createPortal(<div ref={ref} className="nv-graph-context-menu" role="menu" aria-label="图谱选择操作" style={{left:Math.max(8,Math.min(position.x,window.innerWidth-232)),top:Math.max(8,Math.min(position.y,window.innerHeight-150))}} onKeyDown={event=>{
    if(!['ArrowDown','ArrowUp'].includes(event.key))return;event.preventDefault();const items=[...ref.current.querySelectorAll('button:not(:disabled)')],index=items.indexOf(document.activeElement);items[(index+(event.key==='ArrowDown'?1:items.length-1))%items.length]?.focus();
  }}><button role="menuitem" disabled={!count||busy} onClick={()=>{onClose();onBring();}}>带入当前对话{count?`（${count}）`:''}</button><button role="menuitem" disabled={!count} onClick={()=>{onClose();onExpand();}}>以所选节点展开联系</button><button role="menuitem" disabled={!count} onClick={()=>{onClose();onClear();}}>清空选择</button></div>,document.body);
}
