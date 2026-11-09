import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Modal} from '@deepseek-ai/dsh-client-ui-primitives';
import {createLibraryDrawing,drawingLibraryCategories,searchDrawingLibrary} from '@oh-my-student/plugin-vault-sqlite/drawing-library';

function Thumbnail({item,engine}){
  const host=useRef(null);
  useEffect(()=>{
    let alive=true;const target=host.current;
    const observer=new IntersectionObserver(entries=>{if(!entries.some(e=>e.isIntersecting))return;observer.disconnect();
      const scene=createLibraryDrawing(item.id);const elements=engine.restoreElements(scene.elements,null);
      engine.exportToSvg({elements,files:scene.files,appState:{exportBackground:false,exportWithDarkMode:false},exportPadding:8}).then(svg=>{
        if(alive){svg.setAttribute('aria-hidden','true');target.replaceChildren(svg);}
      }).catch(()=>{if(alive)target.textContent='预览暂不可用';});
    });observer.observe(target);return()=>{alive=false;observer.disconnect();};
  },[item,engine]);
  return <span ref={host} className="nv-library-thumbnail" aria-hidden="true"/>;
}
export function DrawingLibraryDialog({engine,onInsert,onClose}){
  const [query,setQuery]=useState(''),[category,setCategory]=useState('几何'),[error,setError]=useState('');
  const items=useMemo(()=>searchDrawingLibrary(query,category),[query,category]);
  return <Modal open onClose={onClose} title="图形库" closeLabel="关闭图形库" className="nv-library-dialog">
    <div className="nv-library-filter"><input aria-label="搜索图形" autoFocus value={query} placeholder="搜索名称，如三角形、电阻…" onChange={e=>{setQuery(e.target.value);if(e.target.value)setCategory('');}}/><select aria-label="图形分类" value={category} onChange={e=>setCategory(e.target.value)}><option value="">全部分类</option>{drawingLibraryCategories.map(name=><option key={name}>{name}</option>)}</select></div>
    {error&&<p role="alert">{error}</p>}
    <div className="nv-library-grid">{items.map(item=><button key={item.id} type="button" title={item.english} aria-label={`插入${item.name}`} onClick={()=>{try{onInsert(item.id);onClose();}catch(e){setError(e.message);}}}><Thumbnail item={item} engine={engine}/><strong>{item.name}</strong><small>{item.category}</small></button>)}{!items.length&&<p role="status">没有匹配的图形，试试其他名称。</p>}</div>
    <footer><span>{items.length} 个图形 · 点击插入，之后可移动和批注</span><a href="https://github.com/tamerUAE/excalimath" target="_blank" rel="noreferrer">ExcaliMath</a></footer>
  </Modal>;
}
