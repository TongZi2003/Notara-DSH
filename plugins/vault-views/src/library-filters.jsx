import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Modal} from '@deepseek-ai/dsh-client-ui-primitives';
import {callVault, TYPE_LABELS} from './logic.js';
import {SearchField} from './search.jsx';
import {SearchDialog, VaultSearchDialog} from './search-dialog.jsx';
import {FilterOptions, TagMatchMode} from './filter-options.jsx';
import {tagLabel} from './card-presentation.js';

export function LibraryFilters({remote, search, setSearch, filters, setFilters, sourceTitle, onSource, view, baseQuery, hideSource = false, compact = false, savedFilter = false}) {
  const [picker,setPicker]=useState(''), [tags,setTags]=useState([]), [tagMatch,setTagMatch]=useState('all');
  const [searchOpen,setSearchOpen]=useState(false);
  const searchInput=useRef(null);
  useEffect(()=>{if(compact&&searchOpen)searchInput.current?.focus();},[compact,searchOpen]);
  const loadSources=useCallback(async({q,limit,offset})=>{
    const value=await callVault(remote,'query',{view:'sources',q,limit,offset});
    return {options:value.documents.map(doc=>({value:doc.path,label:doc.title})),total:value.total};
  },[remote]);
  const loadTags=useCallback(async({q,limit,offset})=>{
    const value=await callVault(remote,'query',{facet:'tags',search:q,limit,offset});
    if(value.facet!=='tags'||!Array.isArray(value.values)||!Number.isSafeInteger(value.total))throw new Error('标签候选响应无效');
    return {options:value.values.map(item=>({value:item.value,label:item.label||tagLabel(item.value)})),total:value.total};
  },[remote]);
  const editTags=()=>{setTags(filters.tags);setTagMatch(filters.tagMatch);setPicker('tags');};
  const count = Number(Boolean(filters.type)) + filters.tags.length + Number(Boolean(filters.sourcePath)) + Number(Boolean(filters.reviewStatus)) + Number(filters.minReviews !== '') + Number(savedFilter);
  const quickFilters = <div className="nv-library-quick-filters" aria-label="常用筛选">
      <select aria-label="筛选资料类型" value={filters.type==='guide'?'plan':filters.type} onChange={event=>setFilters(value=>({...value,type:event.target.value}))}>
        <option value="">类型</option>{Object.entries(TYPE_LABELS).filter(([key])=>key!=='guide').map(([key,label])=><option key={key} value={key}>{label}</option>)}
      </select>
      {!hideSource&&<button aria-label="筛选来源" title={sourceTitle||'来源'} aria-haspopup="dialog" aria-expanded={picker==='sources'} onClick={()=>setPicker('sources')}><span>{sourceTitle||'来源'}</span><span aria-hidden="true">⌄</span></button>}
      <button aria-label="筛选标签" aria-haspopup="dialog" aria-expanded={picker==='tags'} onClick={editTags}>标签{filters.tags.length?` · ${filters.tags.length}`:''}<span aria-hidden="true">⌄</span></button>
      {(filters.type||filters.tags.length||filters.sourcePath||filters.reviewStatus||filters.minReviews!=='')&&<button className="nv-library-clear" onClick={()=>{setFilters(value=>({...value,type:'',tags:[],sourcePath:'',reviewStatus:'',minReviews:''}));onSource(null);}}>清除筛选</button>}
    </div>;
  return <div className={'nv-library-filters'+(compact?' is-compact':'')}>
    {compact && <button type="button" aria-label="筛选" aria-haspopup="dialog" aria-expanded={Boolean(picker)} data-active={count>0} onClick={()=>setPicker('filters')}>筛选{count>0&&<span className="nv-filter-count">{count}</span>}</button>}
    {compact && <button type="button" aria-label="搜索" aria-expanded={searchOpen||Boolean(search)} data-active={Boolean(search)} onClick={()=>setSearchOpen(value=>!value)}>搜索</button>}
    {(!compact||searchOpen||search) && <SearchField inputRef={searchInput} label="搜索资料" placeholder="搜索资料…" value={search} onChange={setSearch} compact advancedLabel="高级搜索" advanced={picker==='advanced'} onToggle={()=>setPicker('advanced')} />}
    {!compact&&quickFilters}
    {picker==='filters'&&<Modal open headless title="筛选" backdropBlur={false} className="nv-filter-dialog nv-library-filter-dialog" onClose={()=>setPicker('')}><header><h2>筛选</h2><button aria-label="关闭筛选" onClick={()=>setPicker('')}>×</button></header><div className="nv-filter-body">{quickFilters}<button className="nv-library-advanced" onClick={()=>setPicker('advanced')}>高级搜索…</button></div></Modal>}
    {picker==='sources'&&<Modal open headless title="选择来源" backdropBlur={false} className="nv-filter-dialog" onClose={()=>setPicker('')}><header><h2>选择来源</h2><button aria-label="关闭来源选择" onClick={()=>setPicker('')}>×</button></header><div className="nv-filter-body"><FilterOptions label="来源" searchLabel="查找来源" optionPrefix="来源" autoFocus multiple={false} loadOptions={loadSources} selected={filters.sourcePath?[filters.sourcePath]:[]} onChange={values=>{onSource({path:values[0]});setPicker('');}} /></div></Modal>}
    {picker==='tags'&&<SearchDialog title="筛选标签" onClose={()=>setPicker('')} onReset={()=>{setTags([]);setTagMatch('all');}} onApply={()=>{setFilters(value=>({...value,tags,tagMatch}));setPicker('');}}><TagMatchMode value={tagMatch} onChange={setTagMatch}/><FilterOptions loadOptions={loadTags} selected={tags} onChange={setTags} searchLabel="查找资料标签" maxSelected={32} allowCustom autoFocus/></SearchDialog>}
    {picker==='advanced'&&<VaultSearchDialog {...{remote,search,filters,view,baseQuery}} onClose={()=>setPicker('')} onApply={(text,value)=>{setSearch(text);setFilters({...value,q:text});setPicker('');}} />}
  </div>;
}
