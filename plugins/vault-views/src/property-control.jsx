import React, { useEffect, useState } from 'react';
import {tagLabel} from './card-presentation.js';

export function propertyType(key,value) {
  if (key === 'tags') return 'tags';
  if (Array.isArray(value)) return value.every(item => ['string','number','boolean'].includes(typeof item)) ? 'list' : 'object';
  if (typeof value === 'boolean') return 'checkbox';
  if (typeof value === 'number') return 'number';
  if (value && typeof value === 'object') return 'object';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return 'datetime-local';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date';
  return 'text';
}
export const PROPERTY_TYPES = {text:'文本',list:'列表',number:'数字',checkbox:'复选框',date:'日期','datetime-local':'日期与时间'};
export const PROPERTY_ICONS = {text:'T',list:'☷',tags:'#',number:'#',checkbox:'☑',date:'▦','datetime-local':'▦',object:'{}'};

export function PropertyControl({ name, value, type = propertyType(name,value), onCommit, disabled = false, autoFocus = false, knowledgeTags=[], onOpen }) {
  const [text,setText] = useState(value == null ? '' : String(value)), [tag,setTag] = useState(''), [error,setError] = useState('');
  useEffect(()=>{setText(value == null ? '' : String(value));setError('');},[value]);
  const commit = next => { setError(''); try { onCommit(next); } catch(error) {setError(error.message);} };
  if(type === 'checkbox') return <input className="nv-property-checkbox" type="checkbox" aria-label={name} checked={Boolean(value)} disabled={disabled} onChange={event=>commit(event.target.checked)} />;
  if(type === 'tags' || type === 'list') {
    const list=Array.isArray(value) ? value : value == null ? [] : [value];
    const append=()=>{const values=tag.split(/[,，\n]/).map(value=>value.trim().replace(type === 'tags' ? /^#/ : /$^/, '')).filter(Boolean);if(values.length)commit([...new Set([...list,...values])]);setTag('');};
    return <div className="nv-property-list-control">{list.map((item,i)=>{const entity=type==='tags'?knowledgeTags.find(tag=>tag.raw===item):null,label=entity?.label||(type==='tags'?tagLabel(item):String(item));return <span className="nv-property-tag" key={i} title={label}><span>{label}</span>{entity&&onOpen&&<button type="button" aria-label={`打开知识实体 ${label}`} onClick={()=>onOpen({path:entity.target})}>↗</button>}<button type="button" aria-label={`移除${name} ${label}`} disabled={disabled} onClick={()=>commit(list.filter((_,index)=>index !== i))}>×</button></span>;})}<input autoFocus={autoFocus} aria-label={`添加${name}`} placeholder={type === 'tags' ? '添加标签…' : '添加值…'} value={tag} disabled={disabled} onChange={event=>setTag(event.target.value)} onBlur={append} onKeyDown={event=>{if(event.key === 'Enter' || event.key === ','){event.preventDefault();append();}if(event.key === 'Escape')setTag('');}} />{error&&<span role="alert">{error}</span>}</div>;
  }
  const finish=()=>{if(text === (value == null ? '' : String(value)))return;const next=text === '' ? null : type === 'number' ? Number(text) : text; if(type === 'number' && next !== null && !Number.isFinite(next)){setError('请输入有效数字');return;}commit(next);};
  return <div className="nv-property-input-control"><input autoFocus={autoFocus} type={type === 'object' ? 'text' : type} aria-label={name} value={text} placeholder="没有值" disabled={disabled} onChange={event=>setText(event.target.value)} onBlur={finish} onKeyDown={event=>{if(event.key === 'Enter'){event.preventDefault();finish();event.currentTarget.blur();}if(event.key === 'Escape'){setText(value == null ? '' : String(value));setError('');}}} />{error&&<span role="alert">{error}</span>}</div>;
}
