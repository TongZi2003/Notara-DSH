import { notifyVaultChanged } from '@oh-my-student/plugin-vault-sqlite/workspace-client';
import React,{useEffect,useRef,useState} from 'react';
import {Button,Input,Menu,Modal} from '@deepseek-ai/dsh-client-ui-primitives';
import {EMPTY_CANVAS,EMPTY_DRAWING,parseDrawingDocument} from '@oh-my-student/plugin-vault-sqlite/drawing-files';
import {isMathElement} from '@oh-my-student/plugin-vault-sqlite/drawing-math';
import {mathElementSubpath} from '@oh-my-student/plugin-vault-sqlite/math-reference';
import {markdownDraft} from './markdown-drafts.js';
import {defaultLibraryBase,serializeBase} from '@oh-my-student/plugin-vault-sqlite/bases';
import {callVault,relativePath} from './logic.js';

const types=[{id:'md',label:'Markdown 文档'},{id:'canvas',label:'Canvas 白板'},{id:'excalidraw',label:'Excalidraw 共绘'},{id:'base',label:'资料库视图'}];
export function CanvasFilePicker({files,remote,workspaceId,onPick,onClose}){
  const [query,setQuery]=useState(''),[creating,setCreating]=useState(false),[name,setName]=useState(''),[kind,setKind]=useState('md'),[typesOpen,setTypesOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const [drawing,setDrawing]=useState(null);
  const choose=async file=>{if(!file.path.endsWith('.excalidraw')){onPick(file);onClose();return;}setBusy(true);setError('');try{const record=await callVault(remote,'read',{path:file.path});if(!alive.current)return;const doc=parseDrawingDocument(markdownDraft(record,workspaceId).getSnapshot().text),maths=doc.elements.filter(e=>!e.isDeleted&&isMathElement(e));if(maths.length)setDrawing({file,maths});else{onPick(file);onClose();}}catch{if(alive.current)setError('无法读取白板，请稍后重试。');}finally{if(alive.current)setBusy(false);}};
  const terms=query.trim().toLowerCase().split(/\s+/).filter(Boolean),rows=files.filter(f=>terms.every(q=>`${f.title} ${f.path}`.toLowerCase().includes(q)));
  const create=async event=>{
    event.preventDefault();if(busy)return;setBusy(true);setError('');
    try{
      const title=name.trim().replace(/\.(md|canvas|excalidraw|base)$/i,'');if(!title)throw Error('请输入文件名');
      const path=relativePath(`${title}.${kind}`),content=kind==='canvas'?EMPTY_CANVAS:kind==='excalidraw'?EMPTY_DRAWING:kind==='base'?serializeBase(defaultLibraryBase()):`# ${title.split('/').at(-1)}\n\n`;
      const saved=await callVault(remote,'save',{path,content,expectedRevision:null});notifyVaultChanged(remote,{path:path,revision:saved.revision},workspaceId);
      if(alive.current){onPick({path,title:title.split('/').at(-1)});onClose();}
    }catch(e){if(alive.current)setError(e.message==='请输入文件名'?e.message:'新建失败，请检查文件名；同名文件不会被覆盖。');}finally{if(alive.current)setBusy(false);}
  };
  return <Modal open onClose={()=>{if(!busy)onClose();}} title="添加文件到 Canvas" closeLabel="关闭添加文件" className="nv-canvas-file-picker">
    <div className="nv-canvas-picker-search"><Input autoFocus className="nv-themed-field" aria-label="搜索文件名或路径" placeholder="搜索文件名或路径…" value={query} onChange={e=>setQuery(e.target.value)}/><Button size="sm" variant="outline" onClick={()=>setCreating(value=>!value)}>新建文件</Button></div>
    {creating&&<form className="nv-canvas-picker-create" onSubmit={create}>
      <div className="nv-new-file-field"><Input className="nv-themed-field" aria-label="新文件名称" placeholder="名称，可含文件夹路径" value={name} onChange={e=>setName(e.target.value)}/>
      <Menu portal align="end" open={typesOpen} onClose={()=>setTypesOpen(false)} items={types} selectedId={kind} onSelect={id=>{setKind(id);setTypesOpen(false);}} anchor={<Button type="button" size="sm" variant="ghost" aria-label="新建文件类型" aria-haspopup="menu" aria-expanded={typesOpen} onClick={()=>setTypesOpen(value=>!value)}>.{kind}⌄</Button>}/></div>
      <Button type="submit" variant="primary" size="sm" disabled={busy||!name.trim()}>{busy?'正在创建…':'创建并添加'}</Button>
    </form>}
    {error&&<p role="alert">{error}</p>}
    {drawing?<div className="nv-canvas-picker-results" aria-label="选择白板内容"><button onClick={()=>setDrawing(null)}>返回文件列表</button><button onClick={()=>{onPick(drawing.file);onClose();}}>添加整个白板</button>{drawing.maths.map((e,i)=><button key={e.id} onClick={()=>{onPick({...drawing.file,subpath:mathElementSubpath(e.id)});onClose();}}><span>添加数学图 · {e.customData.notaraTitle||`图 ${i+1}`}</span><small>与源白板共享，可在节点内直接拖动</small></button>)}</div>:<div className="nv-canvas-picker-results" aria-label="可添加的文件">{rows.length?rows.slice(0,300).map(file=><button type="button" key={file.path} disabled={busy} onClick={()=>choose(file)}><span>{file.title}</span><small>{file.path}</small></button>):<p>没有找到文件，可以直接新建。</p>}{rows.length>300&&<p>匹配较多，请继续输入以缩小范围。</p>}</div>}
  </Modal>;
}
