import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Menu, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { DEFAULT_BASE_PATH, DEFAULT_BASE_COLUMNS, BASE_PROPERTY_LABELS, basePropertyName, sortForBase, parseBase, serializeBase, evaluateBase } from '@oh-my-student/plugin-vault-sqlite/bases';
import { callVault, queryInput, isCardType, toggleTag, TYPE_LABELS } from './logic.js';
import { cardFields } from './card-presentation.js';
import { DocumentTags } from './document-tags.jsx';
import { emptyBaseFilters, baseQuery, loadBase, updatedBase, presetIndex, baseColumns, baseViewLabel } from './base-state.js';
import { LibraryFilters } from './library-filters.jsx';
import { BaseFilterDialog } from './base-filters.jsx';
import { BaseViewsManager } from './base-views-menu.jsx';
import { FilterOptions, FilterSelect } from './filter-options.jsx';
import { BaseGrid } from './base-grid.jsx';
import { createBaseWriter, gridDraftCache } from './base-mutations.js';
import { ReviewForm } from './workspace.jsx';
import { subscribeVaultChanges, vaultChangeIncludes, notifyVaultChanged } from '@oh-my-student/plugin-vault-sqlite/workspace-client';
import {isReviewDocument} from '@oh-my-student/plugin-vault-sqlite/review-contract';
import {reviewQuestions,reviewQuestionHeight} from './review-questions.js';
import {ReviewQuestionList} from './review-question-list.jsx';
import {selectCandidates,listSelectionGesture} from '@oh-my-student/plugin-graph-and-blocks/selection-interaction';
import {civilDay} from '@oh-my-student/plugin-vault-sqlite/review-schedule';

const display = value => value == null || value === '' ? '—' : Array.isArray(value) ? value.join(' · ') : typeof value === 'boolean' ? value ? '是' : '否' : String(value);
const labelOf = (config, property) => config.properties?.[property]?.displayName || BASE_PROPERTY_LABELS[property] || basePropertyName(property);

function ViewEditor({ record, index, layout, filters, append, initialView, write, onClose, onSaved, section = 'settings', availableProperties = [] }) {
  const config = useMemo(() => parseBase(record.content), [record.content]), view = initialView ?? config.views[index];
  const [name, setName] = useState(append ? '' : view.name || '未命名视图'), [order, setOrder] = useState(baseColumns(view, {grouped:false})), [groupBy, setGroup] = useState(view.groupBy?.property || '');
  const [sort, setSort] = useState(filters.sort ? sortForBase(filters.sort) : view.sort || []);
  const settings = section === 'settings' || append;
  const title = append ? '保存为视图' : ({properties:'显示属性',group:'资料分组',sort:'资料排序'})[section] || '视图设置';
  const [clearFilters, setClear] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const properties = [...new Set([...order, ...Object.keys(BASE_PROPERTY_LABELS), ...availableProperties.map(item => item.property)])].filter(key => !['file.tags','note.title','note.next_review'].includes(key) || order.includes(key));
  const toggle = key => setOrder(list => list.includes(key) ? list.filter(item => item !== key) : [...list, key]);
  const move = (i, delta) => setOrder(list => { const copy = [...list]; [copy[i],copy[i+delta]] = [copy[i+delta],copy[i]]; return copy; });
  const save = async event => {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try {
      let nextIndex;
      const saved = await write(current => {
        const target = current.views.findIndex(item => view.notara?.preset ? item.notara?.preset === view.notara.preset : item.name === view.name);
        if (target < 0 && !initialView) throw new Error('视图已移除，请刷新后重试。');
        const result = updatedBase({...record,content:serializeBase(current)}, target, {name, layout, order, groupBy, filters, append, clearFilters, sort, initialView});
        Object.assign(current,parseBase(result.content)); nextIndex=result.index;
      });
      onSaved(saved, nextIndex);
    } catch (error) { setError(error.code === 'vault_revision_conflict' ? '资料库配置已被其他窗口修改。当前填写已保留，请取消后刷新，再重新保存。' : error.message); }
    finally { setBusy(false); }
  };
  return <Modal open headless title={title} backdropBlur={false} onClose={() => !busy && onClose()} className="nv-filter-dialog nv-base-dialog"><form onSubmit={save}>
    <header><h2>{title}</h2><button type="button" aria-label="关闭视图设置" onClick={onClose} disabled={busy}>×</button></header>
    <div className="nv-filter-body">{settings && <><label className="nv-filter-field">视图名称<input data-modal-autofocus aria-label="视图名称" value={name} onChange={event => setName(event.target.value)} maxLength={60} placeholder="例如：线性代数待复习" /></label>
      <p className="nv-filter-help">保存当前{({cards:'卡片',table:'表格',graph:'图谱'})[layout]}布局、搜索、筛选和排序。资料正文仍保留在原文件中。</p></>}
      {(settings || section === 'properties') && <><fieldset><legend>显示属性</legend><FilterOptions options={properties.map(key=>({value:key,label:labelOf(config,key)}))} selected={order} onChange={setOrder} label="属性" searchLabel="查找显示属性" optionPrefix={label=>`显示${label}`} /></fieldset>
      <ol className="nv-base-property-order" aria-label="属性顺序">{order.map((key,i) => <li key={key}><span>{labelOf(config,key)}</span><button type="button" aria-label={`上移${labelOf(config,key)}`} disabled={!i} onClick={() => move(i,-1)}>↑</button><button type="button" aria-label={`下移${labelOf(config,key)}`} disabled={i === order.length-1} onClick={() => move(i,1)}>↓</button></li>)}</ol></>}
      {(settings || section === 'group') && <label className="nv-filter-field">分组<select aria-label="资料分组" value={groupBy} onChange={event => setGroup(event.target.value)}><option value="">不分组</option>{['notara.type','note.tags','file.folder','notara.reviewStatus'].map(key => <option key={key} value={key}>{labelOf(config,key)}</option>)}</select></label>}
      {(settings || section === 'sort') && <fieldset><legend>排序优先级</legend><div className="nv-base-sort-rules">{sort.map((rule,i) => <div key={i}><FilterSelect label={`排序属性 ${i+1}`} value={rule.property} onChange={property=>setSort(list=>list.map((item,n)=>n===i?{...item,property}:item))} options={properties.filter(key=>!['note.tags','file.tags'].includes(key)).map(key=>({value:key,label:labelOf(config,key)}))}/><select aria-label={`排序方向 ${i+1}`} value={rule.direction || 'ASC'} onChange={event => setSort(list => list.map((item,n) => n === i ? {...item,direction:event.target.value} : item))}><option value="ASC">升序</option><option value="DESC">降序</option></select><button type="button" aria-label={`移除排序 ${i+1}`} onClick={() => setSort(list => list.filter((_,n) => n !== i))}>×</button></div>)}</div><button type="button" className="nv-base-add-sort" onClick={() => setSort(list => [...list,{property:'file.name',direction:'ASC'}])}>＋ 添加排序</button></fieldset>}
      {settings && (view.filters || view.notara?.search || view.notara?.sourcePath || view.notara?.scope) && <label className="nv-base-reset"><input type="checkbox" checked={clearFilters} onChange={event => setClear(event.target.checked)} />清除原视图的筛选，仅保留本次新增条件</label>}
      {error && <p role="alert">{error}</p>}
    </div><footer><span /><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="nv-filter-apply" disabled={busy || !order.length}>{busy ? '保存中…' : '保存视图'}</button></footer>
  </form></Modal>;
}

export function BaseWorkspace({ path = DEFAULT_BASE_PATH, remote, workspaceId, onOpen, onBring, onReviewQuestion, renderSlot, renderMarkdown, externalCmd, onGraph }) {
  const [record, setRecord] = useState(null), [error, setError] = useState(''), [loadVersion, reload] = useState(0), [revision, refresh] = useState(0);
  const [index, setIndex] = useState(0), [layout, setLayout] = useState(null);
  const [sourceMode,setSourceMode]=useState(path===DEFAULT_BASE_PATH), [sourceView,setSourceView]=useState({type:'table',name:'原始资料',order:['file.name','note.tags'],sort:[]});
  const [sourceName,setSourceName]=useState('');
  const [filters, setFilters] = useState(emptyBaseFilters), [search, setSearch] = useState(''), [offset, setOffset] = useState(0);
  const [data, setData] = useState(null), [loading, setLoading] = useState(false), [queryError, setQueryError] = useState('');
  const [filterDialog,setFilterDialog]=useState(false), [manageViews,setManageViews]=useState(false), [menu, setMenu] = useState(''), [editor, setEditor] = useState(null), [selected, setSelected] = useState(new Map()), [message, setMessage] = useState(''), [bringing, setBringing] = useState(false);
  const [review, setReview] = useState(null), [reviewBusy, setReviewBusy] = useState(false);
  const [selecting,setSelecting]=useState(false);
  const selectionAnchor=useRef(null);
  const reviewDrafts = useMemo(() => new Map(), [workspaceId]);
  const activeViewRef = useRef(null);
  const gridDrafts=useMemo(()=>gridDraftCache(workspaceId,path),[workspaceId,path]);
  const recordRef=useRef(record);recordRef.current=record;
  const queryRef=useRef(null);
  const questionBusy=useRef(false);
  const writeConfig=useMemo(()=>createBaseWriter(remote,()=>recordRef.current,value=>{const previous=activeViewRef.current,next=parseBase(value.content);const found=next.views.findIndex(item=>previous?.notara?.preset?item.notara?.preset===previous.notara.preset:item.name===previous?.name);setIndex(current=>found>=0?found:Math.min(current,next.views.length-1));recordRef.current=value;setRecord(value);notifyVaultChanged(remote,{path,revision:value.revision},workspaceId);},error=>setMessage(error.code==='vault_revision_conflict'?'资料库配置已更新，修改未覆盖原文件，请刷新后重试。':error.message)),[remote,workspaceId,path]);
  const config = useMemo(() => { if (!record) return null; try { const value = parseBase(record.content); evaluateBase(value, [], Math.min(index, value.views?.length-1)); return value; } catch { return null; } }, [record, index]);
  const activeIndex = config ? Math.min(index, config.views.length-1) : 0, view = sourceMode ? sourceView : config?.views[activeIndex], activeLayout = layout || (view?.type==='cards'?'cards':'table');
  activeViewRef.current = config?.views[activeIndex];
  const changed = useCallback(() => { refresh(value => value+1); }, []);
  useEffect(() => {
    let live = true; setError('');
    loadBase(remote,path).then(value => { try { evaluateBase(parseBase(value.content), [], 0); if (live) { const nextConfig = parseBase(value.content), previous = activeViewRef.current; const found = previous ? nextConfig.views.findIndex(item => previous.notara?.preset ? item.notara?.preset === previous.notara.preset : item.name === previous.name) : 0; setIndex(Math.max(0,found)); setLayout(null); setSelected(new Map()); setRecord(value); refresh(value=>value+1); if(value.needsTreeRefresh)notifyVaultChanged(remote,{path,revision:value.revision},workspaceId); } } catch(error) { if(live) setError(error.message); } }, () => { if(live) setError('资料库配置无法读取，请检查文件后重试。'); });
    return () => {live = false;};
  }, [remote,path,loadVersion]);
  useEffect(() => { const timer = setTimeout(() => setFilters(value => ({...value,q:search})),120); return () => clearTimeout(timer); }, [search]);
  const switchView = next => { setSelecting(false); setSourceMode(next==='sources'); setSourceName(''); if(next!=='sources')setIndex(next); setLayout(null);  setFilters(emptyBaseFilters()); setSearch(''); setSelected(new Map()); setOffset(0); setMessage(''); };
  useEffect(() => {
    if (!externalCmd || !config) return;
    if (path===DEFAULT_BASE_PATH && ['table','sources'].includes(externalCmd.view)) { switchView('sources'); return; }
    if (externalCmd.view === 'graph') { onGraph?.({focusPath:externalCmd.focusPath??null}); }
    else if (externalCmd.view === 'routes' || externalCmd.view === 'lessons') {
      const saved = presetIndex(config, externalCmd.view);
      if (saved >= 0) { switchView(saved); return; }
      const allIndex = presetIndex(config, 'all');
      if (allIndex < 0) { setMessage('对应的保存视图已移除，请在视图菜单中选择。'); return; }
      switchView(allIndex);
      setFilters({ ...emptyBaseFilters(), type: externalCmd.view === 'routes' ? 'route' : 'lesson' });
    } else if (externalCmd.view) {
      const target = externalCmd.view === 'guides' || externalCmd.view === 'review' ? presetIndex(config,externalCmd.view) : presetIndex(config,'all');
      if (target < 0) { setMessage('对应的保存视图已移除，请在视图菜单中选择。'); return; }
      switchView(target);
      if (externalCmd.view === 'cards') setLayout('cards');
    }
  }, [externalCmd?.seq, Boolean(config)]);
  useEffect(() => { setOffset(0); }, [JSON.stringify(filters),activeIndex]);
  const sourcePath = filters.sourcePath || (!sourceMode && view?.notara?.sourcePath) || '';
  const browsingSources = sourceMode || view?.notara?.scope === 'sources';
  const newView = sourceMode ? {...sourceView,notara:sourcePath?{sourcePath}:{scope:'sources'}} : undefined;
  const sourceTitle = sourcePath ? sourceName || sourcePath.split('/').at(-1).replace(/\.[^.]+$/, '') : '';
  const chooseSource = doc => { setSourceName(doc?.title||''); setFilters(value=>({...value,sourcePath:doc?.path||''}));setSelected(new Map());setOffset(0); };
  const updateFilters = next => { const value=typeof next==='function'?next(filters):next; if(sourceMode&&!sourcePath&&value.type){const all=presetIndex(config,'all');if(all>=0){setIndex(all);setSourceMode(false);}}setFilters(value); };
  const input = sourceMode ? queryInput({...filters,offset,limit:100},sourcePath?'table':'sources') : baseQuery(path,activeIndex,filters,offset);
  if(sourceMode && !filters.sort && sourceView.sort.length) { input.sort='title'; input.sortDirection=sourceView.sort[0].direction; }
  if(input.base)input.base.expectedRevision = record?.revision;
  const query = JSON.stringify(input);
  useEffect(()=>{selectionAnchor.current=null;},[query]);
  useEffect(() => {
    if (!record || !config) return;
    let live = true; setLoading(true); if(queryRef.current!==query){setData(null);queryRef.current=query;} setQueryError('');
    callVault(remote,'query',JSON.parse(query)).then(value => { if(live) {
      setData(value); setLoading(false);
      const current = new Map((value.documents ?? []).map(document => [document.path, document]));
      setSelected(previous => new Map([...previous].map(([path, document]) => [path, current.get(path) ?? document])));
    } }, error => { if(live) {
      setQueryError(error.code === 'vault_base_revision_conflict' ? '资料库配置已更新，正在同步。' : error.message); setLoading(false);
      if (error.code === 'vault_base_revision_conflict') notifyVaultChanged(remote,{path:path},workspaceId);
    } });
    return () => {live=false;};
  }, [remote,query,record?.revision,revision]);
  useEffect(() => {
    let live = true, generation = 0;
    const sync = async change => {
      if (!vaultChangeIncludes(change, path)) { refresh(value => value+1); return; }
      const request = ++generation;
      let before;
      do {
        before = recordRef.current;
        if (!before) return; // The initial load owns configuration creation and recovery.
        try {
          const next = await callVault(remote, 'read', {path});
          if (!live || request !== generation) return;
          if (recordRef.current !== before) continue; // A local save won; read again instead of replacing it.
          const config = parseBase(next.content); evaluateBase(config, [], 0);
          if (next.revision !== before.revision) {
            const previous = activeViewRef.current;
            const found = config.views.findIndex(item => previous?.notara?.preset ? item.notara?.preset === previous.notara.preset : item.name === previous?.name);
            setIndex(current => found >= 0 ? found : Math.min(current, config.views.length-1));
            recordRef.current = next; setRecord(next);
          }
          refresh(value => value+1); return;
        } catch {
          if (live && request === generation) setMessage('资料库配置暂时无法同步，当前视图和填写已保留。');
          return;
        }
      } while (live && request === generation);
    };
    const stop = subscribeVaultChanges(remote, change => { void sync(change); }, workspaceId);
    return () => { live = false; generation++; stop(); };
  }, [remote, workspaceId, path]);
  const viewPatch=patch=>{if(sourceMode){setSourceView(value=>({...value,...patch}));return;}const target=view;void writeConfig(config=>{const index=config.views.findIndex(item=>target.notara?.preset?item.notara?.preset===target.notara.preset:item.name===target.name);if(index<0)throw new Error('视图已移除，请刷新');Object.assign(config.views[index],patch);}).catch(()=>{});};
  const documents = data?.documents || [],reviewMode=Boolean(config)&&!sourceMode&&presetIndex(config,'review')===activeIndex;
  // Only the synthetic source landing view is title-only. Saved views and
  // source-card detail keep their configured columns, even when a page is empty.
  const columns = baseColumns(view,{review:reviewMode}).filter(key => !(sourceMode && !sourcePath && key === 'note.tags'));
  const questions=useMemo(()=>new Map(reviewMode?documents.map(doc=>[doc.path,reviewQuestions(doc,{config,index:activeIndex,today:civilDay(new Date())})]):[]),[documents,config,activeIndex,reviewMode]);
  const askQuestion=async(doc,plan)=>{
    if(questionBusy.current)return;questionBusy.current=true;setBringing(true);setMessage('');
    try{if(!onReviewQuestion)throw Error('暂时无法带入长期教师，请从原对话继续');await onReviewQuestion(doc,plan);}
    catch(error){setMessage(error.message||'未能带入，原有草稿已保留');changed();}
    finally{questionBusy.current=false;setBringing(false);}
  };
  const questionList=doc=><ReviewQuestionList document={doc} questions={questions.get(doc.path)??[]} onQuestion={askQuestion} {...{onOpen,renderMarkdown}} busy={bringing}/>;
  const reviewHeight=(doc,widths,measure)=>columns.includes('file.name')?reviewQuestionHeight(questions.get(doc.path)??[],widths['file.name'],measure):0;
  const startRecord=()=>setReview({documents:(selected.size?[...selected.values()]:documents).filter(doc=>isReviewDocument(doc.type,doc.path)),index:0});

  const select = (doc,event={}) => setSelected(values => {
    try {
      const order=groups.flatMap(([,rows])=>rows.map(row=>row.path));
      const change=selectCandidates([...values.keys()],order,doc.path,selectionAnchor.current,event);
      const catalog=new Map([...values,...documents.map(row=>[row.path,row])]);
      selectionAnchor.current=change.anchor;
      return new Map(change.paths.map(path=>[path,catalog.get(path)]));
    } catch(error) { setMessage(error.message);return values; }
  });
  const selectCard=(doc,event)=>{if((listSelectionGesture(event)||(selecting&&(event.button===0||event.key===' ')))&&!event.target.closest('input,textarea,[contenteditable="true"]')){event.preventDefault();event.stopPropagation();select(doc,event);}};
  const cardSelectionProps=doc=>({tabIndex:0,'aria-label':`${selected.has(doc.path)?'已选资料':'资料'}：${doc.title}`,onClickCapture:event=>selectCard(doc,event),onKeyDownCapture:event=>{if(event.key===' ')selectCard(doc,event);else if(event.key==='Enter'&&event.target===event.currentTarget){event.preventDefault();selecting?select(doc,event):openRow(doc);}}});
  const bring = async () => { setBringing(true); setMessage(''); try { await onBring([...selected.values()], '请结合这些资料和我一起讨论。'); setSelected(new Map()); } catch { setMessage('未能带入，请打开可编辑的对话后重试；所选资料已保留'); } finally { setBringing(false); } };
  const onTag = tag => {if(!filters.tags.includes(tag)&&filters.tags.length>=32){setMessage('最多同时筛选 32 个标签，请先移除一些标签。');return;}setFilters(value => ({...value,tags:toggleTag(value.tags,tag)}));};
  const openRow = doc => browsingSources&&!sourcePath ? chooseSource(doc) : onOpen({path:doc.path});
  const cell = (doc,key) => {
    if(reviewMode&&key==='file.name')return questionList(doc);
    if (key === 'file.name' || key === 'note.title') return <button className="nv-vault-title-link" onClick={() => openRow(doc)}>{doc.title}</button>;
    if (key === 'note.tags' || key === 'file.tags') return <DocumentTags document={doc} selected={filters.tags} onTag={onTag} onOpen={onOpen}/>;
    const value = doc.properties?.[key];
    if (key === 'notara.type') return <span className="nv-base-type">{TYPE_LABELS[doc.isGuide && ['source', 'note'].includes(doc.type) ? 'guide' : doc.type] || '文档'}</span>;
    if (key === 'note.type') return <span className="nv-base-type">{TYPE_LABELS[doc.type] || doc.type || '文档'}</span>;
    if (key === 'notara.reviewCount' && !isReviewDocument(doc.type,doc.path)) return '—';
    if (key === 'notara.reviewStatus') return ({due:'已到期',pending:'未安排',scheduled:'已安排',learning:'旧排期',familiar:'旧排期','needs-review':'复习记录需核对'})[value] || '—';
    if (key === 'file.mtime' && value) return new Date(value).toLocaleDateString();
    return display(value);
  };
  const groups = useMemo(() => {
    if (!view?.groupBy) return [['',documents]];
    const map = new Map();
    for (const doc of documents) { const key = display(doc.group); if(!map.has(key)) map.set(key,[]); map.get(key).push(doc); }
    return [...map].sort(([a],[b]) => a.localeCompare(b,'zh-CN') * (view.groupBy.direction === 'DESC' ? -1 : 1));
  }, [documents,view]);
  if (error || (!config && record)) return <div className="nv-vault-empty" role="alert">{error || '资料库配置无效'}<button onClick={() => reload(value => value+1)}>重试</button></div>;
  if (!config) return <p className="nv-vault-empty" role="status">正在打开资料库…</p>;
  return <section className="nv-base-workspace" aria-label="资料库" data-base-path={path} data-selecting={selecting}>
    <div className="nv-base-toolbar nv-surface-toolbar">
      <span className="nv-base-name" title={path}>{path===DEFAULT_BASE_PATH?'资料库':path.split('/').at(-1).replace(/\.base$/,'')}<span aria-hidden="true"> › </span></span>
      <Menu portal compact autoFocus open={menu === 'views'} selectedId={sourceMode?'sources':String(activeIndex)} listClassName="nv-base-menu" onClose={() => setMenu('')} items={[...(path===DEFAULT_BASE_PATH?[{id:'sources',label:'原始资料'}]:[]),...config.views.map((item,i) => ({id:String(i), label:<span title={baseViewLabel(item)}>{baseViewLabel(item)}</span>}))]} footer={[{id:'new',label:'＋ 添加视图'},{id:'manage',label:'管理视图…'}]} onSelect={id => {setMenu('');if(id==='new')setEditor('new');else if(id==='manage')setManageViews(true);else switchView(id==='sources'?'sources':Number(id));}} anchor={<button className="nv-base-view" aria-label="切换保存的视图" aria-haspopup="menu" aria-expanded={menu === 'views'} onClick={() => setMenu(current => current === 'views' ? '' : 'views')} title={baseViewLabel(view)}><span>{baseViewLabel(view)}</span><svg className="nv-base-view-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true"><path d="m3 4.5 3 3 3-3"/></svg></button>} />
      <span className="nv-base-result-count" role="status">{data ? `${data.total} 个结果` : '…'}</span>
      {selecting&&<button type="button" data-active="true" onClick={()=>setSelecting(false)}>结束多选</button>}
      {!sourceMode&&<div className="nv-base-layout" role="group" aria-label="资料布局">{[['table','表格'],['cards','卡片']].map(([id,label]) => <button key={id} title={`${label}布局`} aria-label={`${label}布局`} aria-pressed={activeLayout===id} onClick={() => {setLayout(id);viewPatch({type:id});}}><svg className="nv-base-layout-icon" width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">{id==='table'?<path d="M3 3h14v14H3zM3 8h14M3 12h14M8 3v14"/>:<path d="M3 3h5v5H3zM12 3h5v5h-5zM3 12h5v5H3zM12 12h5v5h-5z"/>}</svg></button>)}</div>}
      <div className="nv-base-tools"><LibraryFilters compact savedFilter={Boolean(!sourceMode&&view.filters)} {...{remote,search,setSearch}} filters={{...filters,sourcePath}} setFilters={updateFilters} hideSource={sourceMode&&Boolean(sourcePath)} sourceTitle={sourceTitle} onSource={chooseSource} view={sourceMode&&!sourcePath?'sources':'table'} baseQuery={sourceMode?undefined:{path,view:activeIndex,expectedRevision:record.revision}} />{!sourceMode&&<><button className="nv-base-secondary" aria-label="排序" data-active={Boolean(view.sort?.length)} title="排序" onClick={() => setEditor('sort')}>排序</button><button className="nv-base-secondary" aria-label="分组" data-active={Boolean(view.groupBy)} title="分组" onClick={() => setEditor('group')}>分组</button><button className="nv-base-secondary" aria-label="属性" title="显示属性" onClick={() => setEditor('properties')}>属性</button></>}<button className="nv-base-secondary" aria-label="刷新资料" title="刷新资料与视图配置" onClick={() => {reload(value => value+1);}}>↻</button>
        <Menu portal compact autoFocus align="end" open={menu === 'actions'} onClose={() => setMenu('')} items={[{id:'select',label:selecting?'结束多选':'多选资料'},{id:'refresh',label:'刷新资料'},...(reviewMode&&documents.some(doc=>isReviewDocument(doc.type,doc.path))?[{id:'record',label:'记录学习实况…'}]:[]),...(!sourceMode?[{id:'sort',label:'排序'},{id:'group',label:'分组'},{id:'properties',label:'属性'},{id:'filters',label:'高级筛选…'},{id:'new',label:'保存为视图…'},{id:'settings',label:'视图设置…'}]:[])]} onSelect={id => {setMenu('');if(id==='select')setSelecting(value=>!value);else if(id==='refresh')reload(value=>value+1);else if(id==='record')startRecord();else if(id==='filters')setFilterDialog(true);else setEditor(id);}} anchor={<button aria-label="资料库操作" title="资料库操作" aria-haspopup="menu" aria-expanded={menu === 'actions'} onClick={() => setMenu(current => current === 'actions' ? '' : 'actions')}>⋯</button>} />
      </div>
    </div>
    <>
      {browsingSources&&sourcePath&&<div className="nv-library-source-heading"><button aria-label="返回原始资料" onClick={()=>{chooseSource(null);setFilters(emptyBaseFilters());setSearch('');}}>←</button><strong>{sourceTitle}</strong><button onClick={()=>onOpen({path:sourcePath})}>打开原文 ↗</button></div>}
      {(!sourceMode && !view.notara?.preset && (view.filters || view.notara?.search || view.notara?.sourcePath || view.notara?.scope)) && <div className="nv-base-conditions"><span className="nv-base-scope">{view.filters || view.notara?.search || view.notara?.sourcePath ? '已应用视图筛选' : (filters.tagMatch==='any'?'包含任一标签':'包含全部标签')}</span>{view.notara?.search && <span className="nv-vault-tag" title={view.notara.search}>搜索：{view.notara.search}</span>}{(filters.q || filters.tags.length || filters.type || filters.reviewStatus || filters.minReviews !== '' || filters.sort) ? <button className="nv-base-save-view" onClick={() => setEditor('new')}>保存为视图</button> : null}</div>}
      <div className="nv-vault-results nv-base-results" aria-busy={loading}>{queryError ? <p role="alert">{queryError}<button onClick={() => {reload(value => value+1);}}>重试</button></p> : !documents.length ? <p className="nv-vault-empty">{loading ? '正在读取资料…' : '当前视图没有符合条件的资料'}</p> : groups.map(([group,docs]) => <section className="nv-base-group" key={group}>{group && <h3>{['note.type','notara.type'].includes(view.groupBy?.property) ? TYPE_LABELS[group] || group : group}<small>{docs.length}</small></h3>}
        {activeLayout === 'table' ? <BaseGrid documents={docs} draftCache={gridDrafts} stateKey={JSON.stringify([sourceMode?'source-browser':'saved-view',sourceMode?sourcePath:view.notara?.preset||view.name,group])} {...{columns,view,cell,remote,selected,selecting,onSelect:select,onOpen}} labelOf={key=>reviewMode&&key==='file.name'?'问题与来源':labelOf(config,key)} estimateRowHeight={reviewMode?reviewHeight:undefined} onChanged={changed} onViewPatch={patch=>viewPatch(patch.order?{...patch,order:[...patch.order,...baseColumns(view,{grouped:false}).filter(key=>!columns.includes(key))]}:patch)} /> : <div className="nv-base-grid">{docs.map(doc => {
          if(reviewMode)return <article className={"nv-vault-card nv-review-question-card"+(selected.has(doc.path)?" is-picked":"")} key={doc.path} {...cardSelectionProps(doc)}>{questionList(doc)}</article>;
          const fields = cardFields(doc, columns);
          return <article className={"nv-vault-card"+(selected.has(doc.path)?" is-picked":"")} key={doc.path} {...cardSelectionProps(doc)}>
            <header><button className="nv-vault-title-link" onClick={() => openRow(doc)}>{doc.title}</button></header>
            {typeof doc.cardSummary === 'string' && doc.cardSummary.trim() && <p className="nv-vault-card-summary">{doc.cardSummary}</p>}
            {fields.length > 0 && <dl>{fields.map(key => <div key={key}><dt>{labelOf(config,key)}</dt><dd>{cell(doc,key)}</dd></div>)}</dl>}
          </article>;
        })}</div>}
      </section>)}</div>
      {(selected.size>0||data?.total>100||offset>0)&&<footer className="nv-base-footer"><span>{selected.size ? `已选 ${selected.size}` : ''}</span>{(data?.total > 100 || offset > 0) && <><button aria-label="上一批资料" disabled={!offset || loading} onClick={() => setOffset(value => Math.max(0,value-100))}>‹</button><span>{offset+1}–{offset+documents.length}</span><button aria-label="下一批资料" disabled={offset+100 >= data?.total || loading} onClick={() => setOffset(value => value+100)}>›</button></>}
        <div className="nv-base-footer-actions">{selected.size>0&&<button disabled={bringing} onClick={bring}>{bringing ? '正在带入…' : '批量带入当前对话'}</button>}{selected.size > 0 && <button onClick={() => setSelected(new Map())}>取消选择</button>}</div>
      </footer>}
    </>
    {message && <p className="nv-vault-notice" role="status">{message}</p>}
    {filterDialog && <BaseFilterDialog {...{record,index:activeIndex,availableProperties:data?.availableProperties}} onClose={()=>setFilterDialog(false)} onSave={async(global,filters)=>{const expected=record.revision;await writeConfig(config=>{if(recordRef.current.revision!==expected)throw new Error('资料库配置已变化，请重新打开筛选。');config.filters=global;config.views[activeIndex].filters=filters;});}} />}
    {manageViews && <BaseViewsManager config={config} write={writeConfig} onPick={switchView} onClose={()=>setManageViews(false)} />}
    {editor && <ViewEditor {...{record,layout:activeLayout}} initialView={editor==='new'?newView:undefined} write={writeConfig} filters={['new','settings'].includes(editor) ? {...filters,q:search} : emptyBaseFilters()} section={editor} availableProperties={data?.availableProperties} index={activeIndex} append={editor === 'new'} onClose={() => setEditor(null)} onSaved={(value,next) => {setRecord(value);if (['new','settings'].includes(editor)) switchView(next);setEditor(null);changed();}} />}
    {review?.documents.length > 0 && <Modal open headless title="复习资料" backdropBlur={false} onClose={() => !reviewBusy && setReview(null)} className="nv-filter-dialog nv-base-review-dialog"><header><h2>复习资料 · {review.index+1}/{review.documents.length}</h2><button aria-label="关闭复习" disabled={reviewBusy} onClick={() => setReview(null)}>×</button></header><div className="nv-filter-body"><button className="nv-vault-title-link" onClick={() => onOpen({path:review.documents[review.index].path})}>{review.documents[review.index].title} ↗</button><ReviewForm key={review.documents[review.index].path} document={review.documents[review.index]} remote={remote} onChanged={changed} draftStore={reviewDrafts} onBusy={setReviewBusy} /></div><footer><button disabled={!review.index || reviewBusy} onClick={() => setReview(value => ({...value,index:value.index-1}))}>上一张</button><span /><button disabled={reviewBusy || review.index === review.documents.length-1} onClick={() => setReview(value => ({...value,index:value.index+1}))}>下一张</button></footer></Modal>}
  </section>;
}
