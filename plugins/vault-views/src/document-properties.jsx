import React, { useEffect, useMemo, useRef, useState } from 'react';
import { documentProperties, propertyLabels, propertyTags } from './document-properties.js';
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives';
import { patchFields, parseMarkdown } from '@oh-my-student/plugin-vault-sqlite/frontmatter';
import { PropertyControl, propertyType, PROPERTY_TYPES, PROPERTY_ICONS } from './property-control.jsx';
import { TYPE_LABELS } from './logic.js';
import { DocumentTags } from './document-tags.jsx';

function PropertyValue({ value, depth = 0 }) {
  if (value == null || value === '') return <span className="nv-property-empty">—</span>;
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value !== 'object') return String(value);
  const entries = Object.entries(value);
  if (depth >= 3) return <span>{Array.isArray(value) ? `${entries.length} 项` : `${entries.length} 个属性`}</span>;
  return <details className="nv-property-nested"><summary>{Array.isArray(value) ? `${entries.length} 项` : `${entries.length} 个属性`}</summary><dl>{entries.map(([key, item]) => <div key={key}><dt>{Array.isArray(value) ? Number(key) + 1 : propertyLabels[key] || key}</dt><dd><PropertyValue value={item} depth={depth + 1} /></dd></div>)}</dl></details>;
}

export function DocumentProperties({ content, onSource, compact = false, knowledgeTags = [], onOpen, onTag }) {
  const properties = useMemo(() => documentProperties(content), [content]);
  if (!properties || !properties.error && !properties.entries.length) return null;
  return <section className={`nv-document-properties${compact ? ' nv-document-properties-compact' : ''}`} aria-label="文档属性">
    <div className="nv-properties-heading"><span>文档属性</span>{properties.error && onSource && <button onClick={onSource}>{compact ? '打开文件' : '检查源码'}</button>}</div>
    {properties.error ? <p role="status">属性格式暂时无法解析，原文仍保留在源码中。</p> : <dl>{properties.entries.map(([key, value]) => {
      const tags = key === 'tags' ? propertyTags(value) : null;
      const display = key === 'type' && typeof value === 'string' ? TYPE_LABELS[value] || (value === 'note' ? '笔记' : value) : value;
      return <div className={`nv-property-row${['tags', 'title', 'aliases'].includes(key) ? ' nv-property-wide' : ''}`} key={key} data-property={key}>
        <dt title={key}>{propertyLabels[key] || key}</dt>
        <dd>{tags?.length ? <div className="nv-property-tags" aria-label="文档标签"><DocumentTags document={{tags,knowledgeTags}} onOpen={onOpen} onTag={onTag}/></div> : <PropertyValue value={display} />}</dd>
      </div>;
    })}</dl>}
  </section>;
}

export function EditableDocumentProperties({content,onChange,onSource,onActions,onFocus,knowledgeTags=[],onOpen}) {
  const parsed=useMemo(()=>documentProperties(content),[content]), [collapsed,setCollapsed]=useState(false), [menu,setMenu]=useState(null), [adding,setAdding]=useState(false), [newKey,setNewKey]=useState(''), [error,setError]=useState('');
  const history=useRef([]), owner=useRef(Symbol('property-editor')), latest=useRef(content); latest.current=content;
  const [version,bump]=useState(0);
  const [typeHints,setTypeHints]=useState({});
  useEffect(()=>{onActions?.(owner.current,{canUndo:history.current.length>0,undo:()=>{const last=history.current.pop();if(!last)return false;const current=parseMarkdown(latest.current).fields;if(Object.keys(last.after).some(key=>JSON.stringify(current[key])!==JSON.stringify(last.after[key]))){history.current.push(last);setError('属性已变化，无法撤销这一步。');return false;}const next=patchFields(latest.current,last.before);latest.current=next;onChange(next);bump(value=>value+1);return true;}});},[version,onChange,onActions]);
  useEffect(()=>()=>onActions?.(owner.current,null),[]);
  const edit=changes=>{try {const before=latest.current, after=patchFields(before,changes);if(before === after)return;const fields=parseMarkdown(before).fields;history.current.push({before:Object.fromEntries(Object.keys(changes).map(key=>[key,fields[key]])),after:{...changes}});latest.current=after;onChange(after);bump(value=>value+1);setError('');}catch(error){setError('属性格式无法修改，请检查源码。');}};
  const add=event=>{event?.preventDefault();const key=newKey.trim();if(!/^[\p{L}_][\p{L}\p{N}_-]{0,100}$/u.test(key)||['__proto__','constructor','prototype'].includes(key)){setError('属性名称请使用文字、数字、下划线或短横线');return;}if(Object.hasOwn(parseMarkdown(content).fields,key)){setError('已存在同名属性');return;}edit({[key]:null});setNewKey('');setAdding(false);};
  const rename=(key,name)=>{name=name.trim();if(name === key)return;if(!/^[\p{L}_][\p{L}\p{N}_-]{0,100}$/u.test(name)||['__proto__','constructor','prototype'].includes(name)||Object.hasOwn(parseMarkdown(content).fields,name)){setError('属性名无效或已存在');return;}edit({[key]:undefined,[name]:parseMarkdown(content).fields[key]});};
  const convert=(key,value,type)=>{
    if(value==null||value===''){setTypeHints(hints=>({...hints,[key]:type}));return;}
    let next=value;
    if(type==='text')next=Array.isArray(value)?value.join(', '):String(value);
    else if(type==='list')next=Array.isArray(value)?value:[value];
    else if(type==='number'){next=Number(value);if(!Number.isFinite(next)){setError('当前值无法转为数字，请先修改内容');return;}}
    else if(type==='checkbox'){if(![true,false,'true','false',1,0].includes(value)){setError('当前值无法转为复选框，请先清空或填写 true / false');return;}next=value===true||value==='true'||value===1;}
    else if(type==='date'||type==='datetime-local'){if(!/^\d{4}-\d{2}-\d{2}/.test(String(value))){setError('请先填写有效日期');return;}next=String(value).slice(0,type==='date'?10:16);if(type==='datetime-local'&&next.length===10)next+='T00:00';}
    setTypeHints(hints=>({...hints,[key]:type}));edit({[key]:next});
  };
  if(parsed?.error)return <DocumentProperties {...{content,onSource}} />;
  return <section className="nv-document-properties nv-properties-editable" aria-label="文档属性" onFocusCapture={onFocus}>
    <div className="nv-properties-heading"><button className="nv-properties-collapse" aria-expanded={!collapsed} onClick={()=>setCollapsed(value=>!value)}><span aria-hidden="true">{collapsed?'›':'⌄'}</span> 文档属性 <small>{parsed?.entries.length || 0}</small></button></div>
    {!collapsed && <><div className="nv-properties-rows">{(parsed?.entries || []).map(([key,value])=>{const type=key==='tags'?'tags':typeHints[key]||propertyType(key,value);return <div className="nv-property-edit-row" key={key} data-property={key}>
      <Menu portal compact autoFocus open={menu === key} onClose={()=>setMenu(null)} items={[...(type === 'object'||key === 'tags'?[]:Object.entries(PROPERTY_TYPES).map(([id,label])=>({id,label}))),{id:'remove',label:'移除属性'}]} onSelect={id=>{setMenu(null);if(id === 'remove')edit({[key]:undefined});else convert(key,value,id);}} anchor={<button className="nv-property-type" title={PROPERTY_TYPES[type] || type} aria-label={`属性 ${key} 的类型与操作`} aria-haspopup="menu" aria-expanded={menu===key} onClick={()=>setMenu(value=>value===key?null:key)}>{PROPERTY_ICONS[type]}</button>} />
      <input className="nv-property-key" aria-label={`属性名称 ${key}`} title={key} defaultValue={key} onBlur={event=>rename(key,event.target.value)} onKeyDown={event=>{if(event.key === 'Enter')event.currentTarget.blur();}} />
      <div className="nv-property-value">{type === 'object'?<PropertyValue value={value}/>:<PropertyControl name={propertyLabels[key]||key} {...{value,type,knowledgeTags,onOpen}} onCommit={next=>edit({[key]:next})}/>}</div>
    </div>;})}</div>
    {adding?<form className="nv-property-add" onSubmit={add}><input autoFocus aria-label="新属性名称" placeholder="属性名称" value={newKey} onChange={event=>setNewKey(event.target.value)}/><button type="submit">添加</button><button type="button" onClick={()=>setAdding(false)}>取消</button></form>:<button className="nv-property-add-button" onClick={()=>setAdding(true)}>＋ 添加属性</button>}
    </>}{error&&<p role="alert" className="nv-property-error">{error}</p>}
  </section>;
}
