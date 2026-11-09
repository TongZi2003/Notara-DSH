import React, { useCallback, useEffect, useState } from 'react';
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { callVault, queryInput, TYPE_LABELS } from './logic.js';
import { FilterOptions, TagMatchMode } from './filter-options.jsx';
import { tagLabel } from './card-presentation.js';

export function SearchDialog({ title, onClose, onApply, onReset, children, status, anchorRef }) {
  useEffect(() => {
    if (!anchorRef?.current) return;
    const observer = new ResizeObserver(entries => { if (!entries[0].contentRect.width) onClose(); });
    observer.observe(anchorRef.current); return () => observer.disconnect();
  }, []);
  return <Modal open title={title} headless backdropBlur={false} onClose={onClose} className="nv-filter-dialog">
    <form onSubmit={event => { event.preventDefault(); onApply(); }}>
      <header><h2>{title}</h2><button type="button" aria-label={`关闭${title}`} onClick={onClose}>×</button></header>
      <div className="nv-filter-body">{children}</div>
      <footer><button type="button" onClick={onReset}>清空条件</button><span role="status">{status}</span><button type="button" onClick={onClose}>取消</button><button type="submit" className="nv-filter-apply">应用</button></footer>
    </form>
  </Modal>;
}

export function SimpleSearchDialog({ title, query, value, label, options, onApply, onClose, anchorRef }) {
  const [text, setText] = useState(query), [draft, setDraft] = useState(value);
  return <SearchDialog {...{ title, onClose, anchorRef }} onApply={() => onApply(text, draft)} onReset={() => { setText(''); setDraft(options[0][0]); }}>
    <label className="nv-filter-query"><input data-modal-autofocus type="search" aria-label={`${title}关键词`} placeholder="输入关键词…" value={text} onChange={event => setText(event.target.value)} /></label>
    <fieldset><legend>{label}</legend><div className="nv-filter-choices">{options.map(([key, text]) => <label key={key}><input type="radio" name="filter-option" aria-label={text} checked={draft === key} onChange={() => setDraft(key)} /><span>{text}</span></label>)}</div></fieldset>
  </SearchDialog>;
}

export function VaultSearchDialog({ remote, search, filters, view, baseQuery, onApply, onClose, anchorRef }) {
  const [draft, setDraft] = useState(() => ({ ...filters, tags: [...filters.tags] })), [text, setText] = useState(search), [resetKey,setResetKey] = useState(0);
  const [count, setCount] = useState(null);
  const review = view === 'review';
  const update = patch => setDraft(value => ({ ...value, ...patch }));
  const loadTags=useCallback(async({q,limit,offset})=>{
    const value=await callVault(remote,'query',{facet:'tags',search:q,limit,offset});
    if(value.facet!=='tags'||!Array.isArray(value.values)||!Number.isSafeInteger(value.total))throw new Error('标签候选响应无效');
    return {options:value.values.map(item=>({value:item.value,label:(item.label||tagLabel(item.value))+(item.target?' · 知识实体':''),count:item.count})),total:value.total};
  },[remote]);
  const query = queryInput({ ...draft, q: text, limit: 1, offset: 0 }, view);
  if (baseQuery) { query.base = baseQuery; if (!draft.sort) delete query.sort; }
  const input = JSON.stringify(query);
  useEffect(() => {
    let live = true; setCount(null);
    const timer = setTimeout(() => callVault(remote, 'query', JSON.parse(input)).then(value => { if (live) setCount(value.total); }, () => { if (live) setCount('failed'); }), 150);
    return () => { live = false; clearTimeout(timer); };
  }, [remote, input]);
  return <SearchDialog title="资料高级搜索" {...{ onClose, anchorRef }} onApply={() => onApply(text, draft)} onReset={() => { setText(''); setDraft({ ...filters, tags: [], tagMatch:'all', type: '', reviewStatus: '', minReviews: '', sort: 'title' }); setResetKey(value=>value+1); }} status={count === null ? '正在查找…' : count === 'failed' ? '暂时无法预览数量' : `${count} 份符合条件`}>
    <label className="nv-filter-query"><input data-modal-autofocus type="search" aria-label="资料搜索关键词" placeholder="搜索标题、内容或标签…" value={text} onChange={event => setText(event.target.value)} /></label>
    {review && <p className="nv-filter-preset">当前视图：类型为卡片 · 复习已到期</p>}
    <div className="nv-filter-columns">
      <label className="nv-filter-field">资料类型<select aria-label="资料类型" value={draft.type==='guide'?'plan':draft.type} onChange={event => update({ type: event.target.value })}><option value="">全部类型</option>{Object.entries(TYPE_LABELS).filter(([key])=>key!=='guide').map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label className="nv-filter-field">排序<select aria-label="资料排序" value={draft.sort} onChange={event => update({ sort: event.target.value })}>{baseQuery && <option value="">按视图设置</option>}<option value="title">按标题</option><option value="updated">最近修改</option><option value="due">复习时间</option><option value="reviewCount">复习次数</option></select></label>
    </div>
    <fieldset className="nv-filter-section"><legend>标签</legend><TagMatchMode value={draft.tagMatch} onChange={tagMatch=>setDraft(value=>({...value,tagMatch}))}/><FilterOptions key={resetKey} selected={draft.tags} onChange={tags=>update({tags})} loadOptions={loadTags} searchLabel="查找资料标签" maxSelected={32} allowCustom /></fieldset>
    <div className="nv-filter-columns">
      <label className="nv-filter-field">复习期限<select aria-label="复习期限" disabled={review} value={review ? 'due' : draft.reviewStatus || 'all'} onChange={event => update({ reviewStatus: event.target.value })}><option value="all">全部期限</option><option value="due">已到期</option><option value="scheduled">以后继续</option><option value="pending">未安排</option><option value="needs-review">复习记录需核对</option><option value="learning">旧排期：短期</option><option value="familiar">旧排期：长期</option></select></label>
      <label className="nv-filter-field">至少复习次数<input aria-label="最少复习记录次数" type="number" min="0" step="1" placeholder="不限" value={draft.minReviews} onChange={event => update({ minReviews: event.target.value })} /></label>
    </div>
  </SearchDialog>;
}
