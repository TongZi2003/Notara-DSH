import React, { useId, useRef, useState } from 'react';
import { TYPE_LABELS } from './logic.js';
import { VaultSearchDialog } from './search-dialog.jsx';
import {cardTags,tagLabel} from './card-presentation.js';

export function SearchField({ label, placeholder = label, value, onChange, advanced, onToggle, controls, count = 0, compact = false, buttonRef, inputRef, advancedLabel }) {
  return <div className={`nv-search${compact ? ' nv-search-compact' : ''}`}>
    <svg className="nv-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
    <input ref={inputRef} type="search" aria-label={label} placeholder={placeholder} value={value} onChange={event => onChange(event.target.value)} />
    {value && <button type="button" className="nv-search-clear" aria-label={`清除${label}`} title="清除搜索" onClick={() => onChange('')}>×</button>}
    <button ref={buttonRef} type="button" className="nv-search-advanced" aria-label={advancedLabel || (compact ? '高级搜索文件' : '高级搜索')} aria-haspopup="dialog" aria-expanded={advanced} aria-controls={controls} title={advancedLabel || '高级搜索'} onClick={onToggle}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M3 6h7m4 0h7M3 12h12m4 0h2M3 18h2m4 0h12" /><circle cx="12" cy="6" r="2" /><circle cx="17" cy="12" r="2" /><circle cx="7" cy="18" r="2" /></svg>
      {!compact && <span>高级搜索</span>}{count > 0 && <span className="nv-search-count">{count}</span>}
    </button>
  </div>;
}

export function VaultFilters({ remote, search, setSearch, filters, setFilters, view, baseQuery, documents=[] }) {
  const [expanded, setExpanded] = useState(false), button = useRef(null);
  const review = view === 'review';
  const count = Number(Boolean(review || filters.type)) + Number(Boolean(filters.minReviews)) + Number(review || Boolean(filters.reviewStatus && filters.reviewStatus !== 'all')) + filters.tags.length;
  const remove = key => setFilters(value => ({ ...value, [key]: '' }));
  const names=new Map(documents.flatMap(cardTags).map(tag=>[tag.value,tag.label]));
  return <div className="nv-vault-filters">
    <SearchField label="搜索资料" placeholder="搜索标题、内容或标签…" value={search} onChange={setSearch} advanced={expanded} onToggle={() => setExpanded(true)} count={count} buttonRef={button} />
    {expanded && <VaultSearchDialog {...{ remote, search, filters, view, baseQuery }} anchorRef={button} onClose={() => setExpanded(false)} onApply={(text, value) => { setSearch(text); setFilters({ ...value, q: text }); setExpanded(false); }} />}
    <div className="nv-filter-applied" aria-label="资料筛选条件">
      {filters.tags.slice(0,3).map(tag=><button className="nv-vault-tag" key={tag} aria-label={`移除标签 ${names.get(tag)||tagLabel(tag)}`} onClick={()=>setFilters(value=>({...value,tags:value.tags.filter(item=>item!==tag)}))}>{names.get(tag)||tagLabel(tag)} ×</button>)}
      {filters.tags.length>3&&<button type="button" onClick={()=>setExpanded(true)}>已选 {filters.tags.length} 个标签</button>}
      {filters.tags.length>1&&<button type="button" onClick={()=>setExpanded(true)}>{filters.tagMatch==='any'?'任一标签 · 并集':'全部标签 · 交集'}</button>}
      {review ? <><span>类型：卡片</span><span>复习：已到期</span></> : <>{filters.type && <button aria-label="移除资料类型条件" onClick={() => remove('type')}>{TYPE_LABELS[filters.type] || filters.type} ×</button>}{filters.reviewStatus && filters.reviewStatus !== 'all' && <button aria-label="移除复习期限条件" onClick={() => remove('reviewStatus')}>复习：{({ due: '已到期', pending: '未安排', learning: '短期复查', familiar: '间隔复习', 'needs-review':'复习记录需核对' })[filters.reviewStatus]} ×</button>}</>}
      {filters.minReviews !== '' && <button aria-label="移除复习次数条件" onClick={() => remove('minReviews')}>至少 {filters.minReviews} 次记录 ×</button>}
    </div>
  </div>;
}
