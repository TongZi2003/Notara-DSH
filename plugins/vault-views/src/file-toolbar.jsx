import React,{useState} from 'react';
import {Menu} from '@deepseek-ai/dsh-client-ui-primitives';

export function FileToolbar({path,actions={},children}){
  const [open,setOpen]=useState(false);
  const items=[...(actions.onGraph?[{id:'graph',label:'查看当前资料图谱'}]:[]),...(actions.onRefresh?[{id:'refresh',label:'刷新当前资料'}]:[])];
  return <div className="nv-markdown-editbar nv-document-toolbar nv-surface-toolbar">
    {path&&<span className="nv-vault-doc-path" title={path}>{path.split('/').at(-1)}</span>}
    <div className="nv-markdown-actions" role="group" aria-label="文档操作">{children}
      {actions.onBring&&<button type="button" className="nv-doc-bring" aria-label={actions.bringLabel??'带入当前对话'} title={actions.bringLabel??'带入当前对话'} onClick={actions.onBring}><svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M4 4h12v9H9l-4 3v-3H4zM7 8h6"/></svg><span className="nv-doc-action-label">{actions.bringLabel??'带入对话'}</span></button>}
      {items.length>0&&<Menu portal compact autoFocus align="end" open={open} onClose={()=>setOpen(false)} items={items} onSelect={id=>{setOpen(false);if(id==='graph')actions.onGraph();if(id==='refresh')actions.onRefresh();}} anchor={<button type="button" aria-label="文档选项" title="文档选项" aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>⋯</button>}/>}
    </div>
  </div>;
}
