import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { createActivityController } from './activity-controller.js';
import { defineStore } from '@deepseek-ai/dsh-client-store';
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { ActivityAdd } from './activity-add.jsx';
import { activityUrl } from './activity-model.js';
import { LessonBindLauncher, LessonProgressSection } from './lesson-progress.jsx';
import {CompanionAvatar} from './companions.jsx';
import {COMPANIONS} from './companions.js';

function TaskLineage({lineageSessionId,displayTitle,openTitle,useSessions}) {
  const isChild=useSessions(state=>state.byId[lineageSessionId]?.origin==='subagent');
  if(!isChild)return null;
  return openTitle?<button type="button" className="nv-task-lineage" onClick={openTitle}>{displayTitle}</button>:<span className="nv-task-lineage">{displayTitle}</span>;
}
function ActivityIcon() {
  return <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><circle cx="4" cy="5" r="1.4"/><circle cx="4" cy="10" r="1.4"/><circle cx="4" cy="15" r="1.4"/><path d="M8 5h8M8 10h8M8 15h8"/></svg>;
}
function FileIcon() {
  return <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="M5 2.5h6l4 4v11H5zM11 2.5v4h4M7.5 10h5M7.5 13h5"/></svg>;
}
function Status({ row }) {
  return <span className={'nv-activity-status' + (row.failed ? ' is-failed' : row.running || row.pending ? ' is-running' : '')}>{row.status}</span>;
}
function useDropdownPosition(anchorRef, version, panelRef) {
  const [position, setPosition] = useState(null);
  useLayoutEffect(() => {
    const anchor = anchorRef.current, panel = panelRef.current;
    if (!anchor?.isConnected || !panel) { setPosition(null); return; }
    let frame = 0;
    const measure = () => {
      const button = anchor.getBoundingClientRect(), width = panel.getBoundingClientRect().width;
      const top = button.bottom + 8;
      const next = { top, left: Math.max(12, Math.min(button.right - width, window.innerWidth - width - 12)), maxHeight: Math.max(0, Math.min(620, window.innerHeight - top - 12)) };
      setPosition(previous => previous && Object.keys(next).every(key => next[key] === previous[key]) ? previous : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    // A split pane can move the button without changing the button's own size.
    for(let element=anchor;element;element=element.parentElement)observer.observe(element);
    observer.observe(panel);
    window.addEventListener('resize', schedule); window.addEventListener('scroll', schedule, true); measure();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true); };
  }, [anchorRef, version, panelRef]);
  return position;
}
function Section({ title, items, children, onAdd, empty, extra }) {
  const [limit, setLimit] = useState(6);
  return <section className="nv-activity-section" aria-label={title}>
    <h3>{title}{items.length > 0 && <span>{items.length}</span>}{onAdd && <button className="nv-activity-add-button" aria-label={'添加' + title} title={'添加' + title} onClick={onAdd}>＋</button>}</h3>
    {!items.length && !extra && <p className="nv-activity-section-empty">{empty}</p>}
    <div>{items.slice(0, limit).map(children)}</div>
    {extra}
    {items.length > limit && <button className="nv-activity-more" onClick={() => setLimit(items.length)}>查看全部 {items.length} 项 ↗</button>}
  </section>;
}
function AgentRow({ agent, onOpen }) {
  const [expanded, setExpanded] = useState(false);
  const partner=COMPANIONS.find(row=>row.id===agent.preset||agent.preset==='companion-deepseek-blind'&&row.id==='companion-deepseek');
  return <div className="nv-activity-agent">
    <div className="nv-activity-line">
      {partner?<CompanionAvatar {...partner} status={agent.running?'running':'idle'}/>:<span className={'nv-activity-dot' + (agent.running ? ' is-running' : '')} aria-hidden="true"/>}
      <button className="nv-activity-name" title={agent.label} disabled={!agent.canOpen} onClick={() => onOpen(agent)}>{agent.label}</button>
      <Status row={agent}/>
      <button className="nv-activity-disclosure" aria-label={'查看行为：' + agent.label} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '⌃' : '⌄'}</button>
    </div>
    <p className="nv-activity-summary">{agent.summary}</p>
    {expanded && <div className="nv-activity-agent-details">
      {agent.actions.length ? agent.actions.map(action => <div key={action.id}><span title={action.path}>{action.path.split('/').at(-1)}</span><Status row={action}/></div>) : <p>当前未加载文件操作，完整行为可在原生记录中查看。</p>}
      <button className="nv-activity-more" disabled={!agent.canOpen} onClick={() => onOpen(agent)}>打开记录 ↗</button>
    </div>}
  </div>;
}

export function ActivityPanel({ state, anchorRef, onClose, onOpenFile, onOpenAgent, onOpenJob, onStopJob, onRetry, onAdd, onRemove, onOpenSource, onBindLesson, onToggleLessonTask, onSetCurrentLessonTask, pins, timer }) {
  const ref = useRef(null), data = state.data;
  const [jobError, setJobError] = useState(''), [stopping, setStopping] = useState(null);
  const position = useDropdownPosition(anchorRef, state.anchorVersion, ref);
  useEffect(() => { if (position) ref.current?.querySelector('button')?.focus(); }, [Boolean(position)]);
  const rows = (derived, section) => [...new Map([...(pins[section] ?? []), ...derived].map(row => [row.key, row])).values()];
  const outputRows = rows(data.outputs, 'outputs'), sourceRows = rows(data.references, 'references');
  const material = section => row => <div className="nv-activity-line" key={row.key}>
    <button className="nv-activity-file nv-activity-line" title={row.path || row.url || '查看来源消息'} onClick={() => row.path || row.url ? onOpenFile(row) : onOpenSource(row)}>
      {row.url ? <span aria-hidden="true">↗</span> : <FileIcon/>}<span className="nv-activity-name">{row.title}</span><Status row={row}/>
    </button>
    {pins[section]?.some(pin => pin.key === row.key) && <button className="nv-activity-remove" aria-label={'从列表移除：' + row.title} title="从列表移除，保留文件" onClick={() => onRemove(section, row.key)}>×</button>}
  </div>;
  return <aside id="nv-activity-panel" ref={ref} className="nv-activity-panel" aria-label="本次活动" style={position ?? { visibility: 'hidden' }} onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented && (!ref.current || !event.target || ref.current.contains(event.target))) { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <header><h2>本次活动</h2><span>当前会话</span><button type="button" aria-label="收起活动浮窗" title="收起" onClick={onClose}>×</button></header>
    <div className="nv-activity-body">
      {state.loading && <p className="nv-activity-empty" role="status">正在读取活动记录…</p>}
      {state.error && <p className="nv-activity-notice" role="status">部分记录暂未加载。<button onClick={onRetry}>重试</button></p>}
      <LessonProgressSection
        state={state}
        onOpenFile={onOpenFile}
        onBindLesson={onBindLesson}
        onToggleTask={onToggleLessonTask}
        onSetCurrentTask={onSetCurrentLessonTask}
      />
      <Section title="输出内容" items={outputRows} onAdd={() => onAdd('outputs')} empty="创建文件或收纳网页">{material('outputs')}</Section>
      <Section title="子智能体" items={data.agents} empty="暂无子任务">{agent => <AgentRow key={agent.id} agent={agent} onOpen={onOpenAgent}/>}</Section>
      <Section title="后台进程" items={data.jobs} empty="暂无后台进程" extra={timer}>{job => <div className="nv-activity-line" key={job.id}>
        <button className="nv-activity-job nv-activity-line" title="打开所属会话查看任务" onClick={() => onOpenJob(job)}><span className="nv-activity-command" aria-hidden="true">⌘</span><span className="nv-activity-name">{job.label}</span><Status row={job}/></button>
        {job.canStop && <button className="nv-activity-more" disabled={stopping === job.id} onClick={async () => { setStopping(job.id); setJobError(''); try { await onStopJob(job); } catch (error) { setJobError(error.message); } finally { setStopping(null); } }}>停止</button>}
      </div>}</Section>
      {jobError && <p role="alert" className="nv-activity-notice">{jobError}</p>}
      <Section title="来源" items={sourceRows} onAdd={() => onAdd('references')} empty="添加文件、图片或网页">{material('references')}</Section>
      <LessonBindLauncher state={state} onBindLesson={onBindLesson} />
    </div>
    {(data.partial || state.limited) && <footer>{state.limited ? '已展开最近 8 个子任务；完整行为可打开记录查看。' : '基于当前已加载记录，较早活动可在原生轨迹中查看。'}</footer>}
  </aside>;
}

function ActivityButton({ controller, sessionId }) {
  const ref=useRef(null);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const open=state.open&&state.sessionId===sessionId;
  useEffect(()=>{
    if(!open)return;
    const element=ref.current;
    let frame=0;
    const check=()=>{frame=0;if(!element?.isConnected||!element.getClientRects().length||element.checkVisibility&&!element.checkVisibility({checkVisibilityCSS:true})){if(controller.anchorRef.current===element)controller.setOpen(false);}};
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(check);};
    const resize=new ResizeObserver(schedule),mutation=new MutationObserver(schedule);
    resize.observe(element);mutation.observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:['class','style','hidden','aria-hidden']});check();
    return()=>{cancelAnimationFrame(frame);resize.disconnect();mutation.disconnect();};
  },[open,controller]);
  useEffect(()=>{const element=ref.current;return()=>{if(controller.anchorRef.current===element){controller.setOpen(false);controller.setAnchor(null);}};},[controller,sessionId]);
  return <button ref={ref} data-activity-session={sessionId} type="button" className="nv-activity-trigger" title="本次活动" aria-label="本次活动" aria-expanded={open} aria-controls={open?'nv-activity-panel':undefined} onClick={event => { controller.trigger = event.currentTarget; controller.setAnchor(event.currentTarget); controller.toggle(sessionId); }}>
    <ActivityIcon/><span className="nv-activity-trigger-label">活动</span><svg className="nv-activity-trigger-chevron" width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="m3 4.5 3 3 3-3"/></svg>
  </button>;
}
function ActivityOverlay({ ctx, controller, onOpenFile, onOpenUrl, useStore, actions, renderSlot }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const collection = useStore(value => value.bySession[state.sessionId]);
  const canTime=ctx.sessions.list.getSnapshot().byId[state.sessionId]?.origin!=='subagent';
  const pins = collection ?? {};
  const [adding, setAdding] = useState(null), [image, setImage] = useState(null);
  const imageEpoch = useRef(0);
  const closeImage = () => { imageEpoch.current++; setImage(null); };
  useEffect(() => { setAdding(null); closeImage(); return () => { imageEpoch.current++; }; }, [state.sessionId, state.open]);
  const close = () => { imageEpoch.current++; controller.setOpen(false); if (controller.trigger?.isConnected) controller.trigger.focus(); };
  const open = row => {
    if (row.url) { const url = activityUrl(row.url); if (url) onOpenUrl(url); }
    else onOpenFile(row);
  };
  const openSource = async row => {
    if (row.type === 'image') {
      const sessionId = state.sessionId;
      const epoch = ++imageEpoch.current;
      const valid = () => imageEpoch.current === epoch && controller.getSnapshot().open && controller.getSnapshot().sessionId === sessionId;
      setImage({ loading: true });
      try { const url = await ctx.uiConversation.imageUrl(row.sourceSessionId, row.attachment); if (valid()) setImage({ url, title: row.title }); }
      catch { if (valid()) setImage({ error: true }); }
    } else controller.openSource(row);
  };
  return <>
    {state.open && state.sessionId && createPortal(<ActivityPanel key={state.sessionId} state={state} anchorRef={controller.anchorRef} onClose={close} onOpenFile={open} onOpenSource={openSource} onOpenAgent={agent => controller.openAgent(agent)} onOpenJob={job => controller.openJob(job)} onStopJob={job => controller.stopJob(job)} onRetry={() => controller.retry()} onBindLesson={(path, revision) => controller.bindLesson(path, revision)} onToggleLessonTask={(task, checked) => controller.toggleLessonTask(task, checked)} onSetCurrentLessonTask={(task, clear) => controller.setCurrentLessonTask(task, clear)} pins={pins} onAdd={setAdding} onRemove={(section, key) => actions.remove(state.sessionId, section, key)} timer={canTime?renderSlot?.('notara.activity.timer',{sessionId:state.sessionId},{fallback:null}):null}/>, document.body)}
    {state.open && adding && <ActivityAdd key={state.sessionId + adding} ctx={ctx} state={state} section={adding} isCurrent={()=>controller.getSnapshot().open&&controller.getSnapshot().sessionId===state.sessionId} onClose={() => setAdding(null)} onAdd={row => actions.add(state.sessionId, adding, row)} onOpenFile={open}/>}
    <Modal open={Boolean(image)} title={image?.title || '来源图片'} closeLabel="关闭图片预览" onClose={closeImage} className="nv-activity-image">{image?.url ? <img src={image.url} alt={image.title}/> : <p>{image?.error ? '图片暂时无法读取' : '正在读取图片…'}</p>}</Modal>
  </>;
}

function ChildConversation({native:Native,controller,...props}) {
  const taskName=props.useSessions(state=>state.byId[props.sessionId]?.projectionValues?.subagent?.label);
  const title=typeof taskName==='string'&&taskName.trim()?taskName:'子任务';
  return <div className="nv-activity-child-conversation"><header className="nv-activity-child-header"><span title={title}>{title}</span><ActivityButton controller={controller} sessionId={props.sessionId}/></header><Native {...props}/></div>;
}

export function installActivityPanel(ctx, { onOpenFile, onOpenUrl, onOpenAgent }) {
  const controller = createActivityController(ctx,{openAgent:onOpenAgent});
  // User collections are UI preferences, scoped by native session. They never
  // claim an agent delivered a file or a draft was sent, and do not alter logs.
  const collectionStore = defineStore({ init: () => ({ bySession: {} }), persist: 'notara.activity-collections.v1', actions: {
    add(draft, sessionId, section, row) {
      const pins = (draft.bySession[sessionId] ??= {}), list = (pins[section] ??= []);
      const index = list.findIndex(item => item.key === row.key);
      if (index < 0) list.push(row); else list[index] = row;
    },
    remove(draft, sessionId, section, key) { const pins = draft.bySession[sessionId]; if (pins?.[section]) pins[section] = pins[section].filter(row => row.key !== key); },
  } });
  const disposers = [
    ctx.slots.inject('sidebar.chat.conversation',()=>{
      let wrapped,updating=false;
      const sync=()=>{
        if(updating)return;updating=true;
        try{
          const native=ctx.slots.entries('sidebar.chat.conversation').find(entry=>entry.options.priority!==-25);
          if(native===wrapped?.native)return;
          wrapped?.off();wrapped=undefined;
          if(native)wrapped={native,off:ctx.slots.register({name:'sidebar.chat.conversation',priority:-25,inject:native.inject,locale:native.locale},props=><ChildConversation {...props} native={native.component} controller={controller}/>)};
        }finally{updating=false;}
      };
      const off=ctx.slots.subscribe('sidebar.chat.conversation',sync);sync();return()=>{off();wrapped?.off();};
    }),
    ctx.slots.inject('conversation.session.header.actions',()=>ctx.slots.register({name:'conversation.session.header.actions',id:'subagent-catalog',priority:-25,order:10},()=>null)),
    ctx.slots.inject('conversation.session.header.lineage',()=>ctx.slots.register({name:'conversation.session.header.lineage',priority:-25},TaskLineage)),
    ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({ name: 'conversation.session.header.utilities', id: 'notara-activity', order: 30 }, props => <ActivityButton {...props} controller={controller}/>)),
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'notara-activity', store: collectionStore, children:{'notara.activity.timer':{kind:'single',scope:'root'}} }, props => <ActivityOverlay {...props} ctx={ctx} controller={controller} onOpenFile={onOpenFile} onOpenUrl={onOpenUrl}/>)),
  ];
  const openActivity=event=>{
    const element=[...document.querySelectorAll('[data-activity-session]')].find(node=>node.dataset.activitySession===event.detail?.sessionId&&node.getClientRects().length&&(!node.checkVisibility||node.checkVisibility({checkVisibilityCSS:true})));
    if(!element)return;
    controller.trigger=element;controller.setAnchor(element);controller.openFrom(event.detail.sessionId);
  };
  window.addEventListener('notara:open-activity',openActivity);disposers.push(()=>window.removeEventListener('notara:open-activity',openActivity));
  return () => { disposers.reverse().forEach(dispose => dispose()); controller.dispose(); };
}
