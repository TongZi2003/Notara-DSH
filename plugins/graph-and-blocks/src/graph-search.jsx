import React, { useMemo, useState } from 'react';
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { projectGraph, matchesTags, graphTags } from './graph.js';
import { FilterOptions, TagMatchMode } from './filter-options.jsx';
import { graphCandidates } from './graph-selection.js';

export function GraphSearchDialog({ data, nodes, filters, relations = 'backbone', centerRelations = relations, mode = 'all', onClose, onApply }) {
  const [draft, setDraft] = useState(() => ({ ...filters, centers: [...filters.centers], tags: [...filters.tags] }));
  const [resetKey,setResetKey] = useState(0);
  const tags = useMemo(() => {const all=new Map(nodes.flatMap(graphTags).map(tag=>[tag.value,{...tag,label:tag.target?`${tag.label} · 知识实体`:tag.label}]));for(const value of filters.tags)if(!all.has(value))all.set(value,{value,label:value});return [...all.values()].sort((a,b)=>a.label.localeCompare(b.label,'zh-CN'));}, [nodes,filters.tags]);
  // Preview the mode that applying this draft will use, including center navigation.
  const count = graphCandidates(projectGraph(data, draft.centers, draft.tags, draft.hops, draft.tagMatch, draft.centers.length ? centerRelations : relations).nodes,draft.type,'',draft.centers).length;
  const title = mode === 'tags' ? '筛选标签' : mode === 'centers' ? '中心节点' : '图谱高级搜索';
  const centerNodes = nodes.filter(node => draft.centers.includes(node.path) || matchesTags(graphTags(node).map(tag=>tag.value),draft.tags,draft.tagMatch));
  const clear = () => { setDraft(value => mode === 'tags' ? {...value,tags:[]} : mode === 'centers' ? {...value,centers:[],hops:1} : {...value,centers:[],tags:[],hops:1,tagMatch:'all'}); setResetKey(value=>value+1); };
  return <Modal open onClose={onClose} title={title} headless backdropBlur={false} className="nv-block-filter-dialog">
    <form onSubmit={event => { event.preventDefault(); onApply(draft); }}>
      <header><h2>{title}</h2><button type="button" aria-label={`关闭${title}`} onClick={onClose}>×</button></header>
      <div className="nv-filter-body">
        {mode !== 'centers' && <fieldset><legend>标签</legend><TagMatchMode value={draft.tagMatch} onChange={tagMatch=>setDraft(value=>({...value,tagMatch}))}/><FilterOptions key={`tags:${resetKey}`} options={tags} selected={draft.tags} onChange={tags=>setDraft(value=>({...value,tags}))} searchLabel="查找图谱标签" optionPrefix="图谱标签" autoFocus maxSelected={32}/></fieldset>}
        {mode === 'tags' && draft.centers.length > 0 && <p className="nv-filter-help">保留当前中心节点与联系范围</p>}
        {mode !== 'tags' && <>
          <fieldset className="nv-filter-section"><legend>中心节点 <small>可多选，留空查看全部</small></legend><FilterOptions key={`centers:${resetKey}`} label="中心节点" options={centerNodes.map(node=>({value:node.path,label:node.title}))} selected={draft.centers} onChange={centers=>setDraft(value=>({...value,centers}))} searchLabel="查找中心资料" optionPrefix="中心资料" autoFocus={mode==='centers'}/>{draft.tags.length > 0 && <p className="nv-filter-help">从符合标签的资料中选择中心，已选中心保留</p>}</fieldset>
          <label className="nv-filter-field">联系范围<select aria-label="中心联系范围" value={draft.hops} disabled={!draft.centers.length} onChange={event => setDraft(value => ({ ...value, hops: Number(event.target.value) }))}><option value="0">仅中心节点</option><option value="1">直接相连</option><option value="2">两层联系</option><option value="3">三层联系</option></select></label>
        </>}
      </div>
      <footer><button type="button" onClick={clear}>{mode === 'tags' ? '清空标签' : mode === 'centers' ? '清空中心' : '清空条件'}</button><span role="status">{count} 份符合条件</span><button type="button" onClick={onClose}>取消</button><button type="submit" className="nv-filter-apply">应用</button></footer>
    </form>
  </Modal>;
}
