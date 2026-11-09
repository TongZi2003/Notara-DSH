import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import {tagLabel} from './card-presentation.js';

// Kept local to each standalone UI plugin: neither plugin requires the other to be enabled.
export function TagMatchMode({value='all',onChange}) {
  return <div className="nv-tag-match" role="group" aria-label="标签匹配方式">{[['any','任一标签（并集）'],['all','全部标签（交集）']].map(([mode,label])=><button type="button" key={mode} aria-pressed={value===mode} onClick={()=>onChange(mode)}>{label}</button>)}</div>;
}
export function FilterOptions({ options = [], selected = [], onChange, label = '标签', searchLabel = '查找标签', optionPrefix = '标签', autoFocus = false, maxSelected = Infinity, loadOptions, allowCustom = false, multiple = true }) {
  const [query,setQuery]=useState(''), [page,setPage]=useState(0), [onlySelected,setOnlySelected]=useState(false);
  const [remote,setRemote]=useState(null), [loading,setLoading]=useState(false), [error,setError]=useState(false), [retry,setRetry]=useState(0);
  const size=40, list=useRef(null), normalized=query.trim().replace(/^#/,''), key=JSON.stringify([normalized,page,retry]);
  const radioName=useId();
  const catalog=useMemo(()=>options.map(item=>typeof item==='string'?{value:item,label:item}:item),[options]);
  const knownNames=useRef(new Map());
  const names=useMemo(()=>{for(const item of [...catalog,...(remote?.options??[])])knownNames.current.set(item.value,item.label);for(const value of selected)if(!knownNames.current.has(value))knownNames.current.set(value,tagLabel(value));return new Map(knownNames.current);},[catalog,remote,selected]);
  const chosen=useMemo(()=>new Set(selected),[selected]);
  const searchInput=useRef(null);
  const matches=useMemo(()=>{
    const source=onlySelected?selected.map(value=>({value,label:names.get(value)||value})):catalog;
    const q=normalized.toLocaleLowerCase();
    return source.filter(item=>(item.label+' '+item.value).toLocaleLowerCase().includes(q));
  },[catalog,selected,names,onlySelected,normalized]);
  useEffect(()=>{
    if(!loadOptions||onlySelected){setLoading(false);setError(false);return;}
    let alive=true;setLoading(true);setError(false);
    const timer=setTimeout(()=>Promise.resolve().then(()=>loadOptions({q:normalized,offset:page*size,limit:size})).then(value=>{if(alive){setRemote({...value,key});setLoading(false);}},()=>{if(alive){setError(true);setLoading(false);}}),120);
    return()=>{alive=false;clearTimeout(timer);};
  },[loadOptions,onlySelected,key]);
  const paged=loadOptions&&!onlySelected;
  const ready=!paged||remote?.key===key;
  const total=paged?(ready?remote.total:0):matches.length;
  const visible=paged?(ready?remote.options:[]):matches.slice(page*size,(page+1)*size);
  useEffect(()=>{if(ready&&!loading&&page>0&&page*size>=total)setPage(Math.max(0,Math.ceil(total/size)-1));},[ready,loading,total,page]);
  useEffect(()=>{if(list.current)list.current.scrollTop=0;},[page,normalized,onlySelected]);
  const toggle=value=>{onChange(!multiple?[value]:chosen.has(value)?selected.filter(item=>item!==value):selected.length<maxSelected?[...selected,value]:selected);if(onlySelected&&chosen.has(value))requestAnimationFrame(()=>(list.current?.querySelector('input')||searchInput.current)?.focus());};
  const selectedMode=()=>{setOnlySelected(value=>!value);setPage(0);setQuery('');};
  return <div className="nv-filter-options">
    {multiple&&<div className="nv-filter-selection-summary"><button type="button" aria-label={`查看已选${label}`} aria-pressed={onlySelected} onClick={selectedMode}>已选 {selected.length} 项{onlySelected?' · 返回候选':''}</button>{selected.slice(0,3).map(value=><button type="button" className="nv-filter-selection-chip" key={value} title={names.get(value)||value} aria-label={`取消已选${label} ${names.get(value)||value}`} onClick={()=>toggle(value)}>{names.get(value)||value} ×</button>)}{selected.length>3&&<button type="button" onClick={selectedMode}>+{selected.length-3}</button>}{selected.length>0&&<button type="button" className="nv-filter-selection-clear" onClick={()=>onChange([])}>清空已选</button>}</div>}
    <input ref={searchInput} className="nv-filter-tag-query" data-modal-autofocus={autoFocus||undefined} type="search" aria-label={searchLabel} placeholder={`搜索${label}…`} value={query} onChange={event=>{setQuery(event.target.value);setPage(0);}} onKeyDown={event=>{if(event.key==='Enter')event.preventDefault();}}/>
    <div ref={list} className="nv-filter-options-list" role="group" aria-label={`${label}候选`} aria-busy={!error&&(loading||!ready)}>
      {error?<p className="nv-filter-help">候选暂时无法读取。<button type="button" onClick={()=>setRetry(value=>value+1)}>重试候选</button></p>:!loading&&ready&&!visible.length&&<p className="nv-filter-help">{onlySelected?'没有匹配的已选项':'没有匹配的候选项'}</p>}
      {selected.length>=maxSelected&&<p className="nv-filter-help">最多同时选择 {maxSelected} 项</p>}
      {visible.map(item=><label key={item.value}><input type={multiple?"checkbox":"radio"} name={multiple?undefined:radioName} aria-label={typeof optionPrefix==='function'?optionPrefix(item.label):`${optionPrefix} ${item.label}`} checked={chosen.has(item.value)} disabled={!chosen.has(item.value)&&selected.length>=maxSelected} onChange={()=>toggle(item.value)}/><span title={item.label}>{item.label}</span>{item.count!=null&&<small>{item.count}</small>}</label>)}
      {allowCustom&&normalized&&!chosen.has(normalized)&&!visible.some(item=>item.value===normalized)&&selected.length<maxSelected&&<button className="nv-filter-custom-option" type="button" onClick={()=>{toggle(normalized);setQuery('');setPage(0);}}>使用标签「{normalized}」</button>}
    </div>
    <div className="nv-filter-options-pages"><span aria-live="polite">{loading||!ready?'正在查找…':`${total} 项${total>size?` · 第 ${page+1}/${Math.ceil(total/size)} 页`:''}`}</span>{total>size&&<><button type="button" aria-label={`${label}上一页`} disabled={!page||loading} onClick={()=>setPage(value=>value-1)}>‹</button><button type="button" aria-label={`${label}下一页`} disabled={(page+1)*size>=total||loading} onClick={()=>setPage(value=>value+1)}>›</button></>}</div>
  </div>;
}

export function FilterSelect({options,value,onChange,label}) {
  const [open,setOpen]=useState(false);
  const items=options.map(item=>typeof item==='string'?{value:item,label:item}:item);
  if(items.length<=40)return <select aria-label={label} value={value} onChange={event=>onChange(event.target.value)}>{items.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select>;
  return <><button className="nv-filter-select-trigger" type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(true)}>{items.find(item=>item.value===value)?.label||value||'选择属性'}<span aria-hidden="true">⌄</span></button>{open&&<Modal open headless title={`选择${label}`} className="nv-filter-dialog" backdropBlur={false} onClose={()=>setOpen(false)}><header><h2>选择属性</h2><button type="button" aria-label="关闭属性选择" onClick={()=>setOpen(false)}>×</button></header><div className="nv-filter-body"><FilterOptions options={items} selected={[value]} onChange={values=>{onChange(values[0]);setOpen(false);}} label="属性" searchLabel="查找筛选属性" optionPrefix="属性" autoFocus multiple={false}/></div></Modal>}</>;
}
