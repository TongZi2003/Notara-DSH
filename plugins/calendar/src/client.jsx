import React,{useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {workspaceForSession,subscribeWorkspace,bindVaultRemote,subscribeVaultChanges,notifyVaultChanged} from '@oh-my-student/plugin-vault-sqlite/workspace-client';
import {dayInZone,monthDays,shiftDay,shiftMonth,agendaForDay} from '../model.js';
import {dateStatus,selectedDateLabel,planPresentation} from './presentation.js';
import {ReschedulePopover} from './reschedule-popover.jsx';
import {CONTRIBUTION} from '../remote.js';
import baseStyles from './styles.css';
import toolbarStyles from './toolbar.css';
const styles=baseStyles+'\n'+toolbarStyles;
const KIND='notara-calendar',ID='@oh-my-student/plugin-calendar';
const Icon=()=> <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v5m8-5v5M4 11h16m-12 4h2m4 0h2m-8 3h2"/></svg>;
async function value(promise){const result=await promise;if(result.ok===false)throw new Error(result.error?.message||'资料操作失败');return result.ok===true?result.value:result;}
function CalendarPage({ctx,workspaceId,visible,ownerSessionId,renderSlot}){
  const [date,setDate]=useState(()=>dayInZone()),[month,setMonth]=useState(()=>dayInZone().slice(0,7));
  const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[tick,setTick]=useState(0),[diary,setDiary]=useState(null);
  const [editing,setEditing]=useState(null);
  const dateChosen=useRef(false);
  const chooseDate=day=>{dateChosen.current=true;setDate(day);setMonth(day.slice(0,7));};
  const chooseMonth=month=>{dateChosen.current=true;setMonth(month);};
  const lifecycle=useRef({visible,date,epoch:0,alive:true});
  if(lifecycle.current.visible!==visible||lifecycle.current.date!==date)lifecycle.current.epoch++;
  Object.assign(lifecycle.current,{visible,date});
  useEffect(()=>{lifecycle.current.alive=true;return()=>{lifecycle.current.alive=false;lifecycle.current.epoch++;};},[]);
  useEffect(()=>{setEditing(null);},[date,visible]);
  const days=monthDays(month),from=days[0],to=days.at(-1),today=data?.today??dayInZone();
  const remote=bindVaultRemote(ctx.remote.notaraVault,workspaceId);
  useEffect(()=>{
    if(!visible)return;
    let alive=true,pending=false,again=false;
    const refresh=async()=>{
      if(pending){again=true;return;}pending=true;
      try{
        const next=await value(ctx.remote.notaraCalendar.view({workspaceId,from,to}));
        if(alive){setData(next);setError('');if(!dateChosen.current){dateChosen.current=true;setDate(next.today);setMonth(next.today.slice(0,7));}}
      }catch{if(alive)setError('日历暂时无法读取，请刷新后重试。');}
      finally{pending=false;if(alive&&again){again=false;void refresh();}}
    };
    void refresh();
    const unsubscribe=subscribeVaultChanges(remote,refresh),timer=setInterval(refresh,15000);
    window.addEventListener('focus',refresh);
    return()=>{alive=false;unsubscribe();clearInterval(timer);window.removeEventListener('focus',refresh);};
  },[ctx,workspaceId,from,to,tick,visible]);
  const diaries=(data?.events??[]).filter(row=>row.kind==='daily'&&row.date===date);
  const items=agendaForDay(data,date),plans=items.filter(row=>row.kind==='plan'),questions=items.filter(row=>row.kind==='question');
  const diaryPath=diaries[0]?.path,diaryRevision=diaries[0]?.revision;
  useEffect(()=>{
    setDiary(null);if(!diaryPath||!visible)return;let alive=true;
    void value(remote.read({path:diaryPath})).then(record=>{if(alive)setDiary(record.content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,''));},()=>{if(alive)setError('日记暂时无法读取。');});
    return()=>{alive=false;};
  },[ctx,workspaceId,diaryPath,diaryRevision,visible]);
  const ownerCurrent=()=>ctx.get('uiSession')?.adapter.current.getSnapshot()?.key===ownerSessionId&&workspaceForSession(ctx,ownerSessionId)===workspaceId;
  const open=target=>{if(lifecycle.current.alive&&lifecycle.current.visible&&ownerCurrent())window.dispatchEvent(new CustomEvent('notara:open-document',{detail:{...(typeof target==='string'?{path:target}:target),workspaceId}}));};
  const saved=receipt=>{notifyVaultChanged(remote,receipt);setTick(n=>n+1);};
  const create=async()=>{
    if(!ownerCurrent())return;const epoch=lifecycle.current.epoch;setBusy(true);setError('');
    const path=`日记/${date}.md`;
    try{
      const receipt=await value(remote.save({path,expectedRevision:null,content:`---\ntype: daily\ndate: ${date}\ntitle: ${date} 日记\n---\n# ${date}\n\n## 日记\n\n`}));
      saved(receipt);if(lifecycle.current.epoch===epoch)open(path);
    }catch{setError('日记未创建，文件可能已存在或资料已变化，请刷新。');}finally{setBusy(false);}
  };
  const toggle=async row=>{
    if(!ownerCurrent())return;setBusy(true);setError('');
    try{saved(await value(remote.toggleTask({path:row.path,line:row.line,checked:!row.checked,expectedText:row.text,expectedRevision:row.revision})));}
    catch{setError('计划未更新，内容可能已修改，请刷新后重试。');}finally{setBusy(false);}
  };
  const closeReschedule=restoreFocus=>{if(restoreFocus&&editing?.anchor.isConnected)editing.anchor.focus({preventScroll:true});setEditing(null);};
  const reschedule=async(row,nextDate)=>{
    if(!ownerCurrent()||busy)return;setBusy(true);setError('');
    try{
      saved(await value(ctx.remote.notaraCalendar.reschedule({workspaceId,path:row.path,kind:row.kind,line:row.line,expectedText:row.text,recordId:row.recordId,expectedRevision:row.revision,date:nextDate})));
      closeReschedule(true);
    }catch(error){
      setError(/calendar_date/.test(error.message)?'请选择今天或以后的有效日期。':'未能改期，内容可能已更新。请刷新后重新选择。');
    }finally{setBusy(false);}
  };
  const markdown=content=>renderSlot('notara.calendar.diary',{content,onOpen:open,remote});
  const itemRow=row=>{const view=row.kind==='plan'?planPresentation(row.title):{title:row.title,sources:[]},status=dateStatus(row.date,today,row.checked);return <li key={row.key} className="nc-agenda-item" data-kind={row.kind} data-done={row.checked||undefined}>
    {row.kind==='plan'&&<input type="checkbox" aria-label={row.title} checked={row.checked} disabled={busy} onChange={()=>void toggle(row)}/>}
    <div className="nc-item-body">
      <div className="nc-item-heading">
        <div className="nc-item-text">{markdown(view.title)}</div>
        <div className="nc-item-actions" data-open={editing?.row.key===row.key||undefined}>
          {row.kind==='question'&&renderSlot('notara.calendar.question',{workspaceId,document:{path:row.path,title:row.documentTitle,revision:row.revision},plan:{heading:row.heading,question:row.title,nextReview:row.date},onError:setError,disabled:busy})}
          {!row.checked&&<button disabled={busy} aria-label={`改期：${row.title}`} title="改期" aria-haspopup="dialog" aria-expanded={editing?.row.key===row.key} onClick={event=>{const anchor=event.currentTarget;setEditing(current=>current?.row.key===row.key?null:{row,anchor});}}>⋯</button>}
        </div>
      </div>
      <div className="nc-item-meta">
        <button className="nc-link nc-source-link" onClick={()=>open(row.path)}>{row.documentTitle||row.path.split('/').at(-1).replace(/\.md$/i,'')}</button>
        {view.sources.map((ref,index)=><React.Fragment key={index}><span aria-hidden="true">·</span><button className="nc-link nc-source-link" onClick={()=>open(ref)}>{ref.label}</button></React.Fragment>)}
        <span aria-hidden="true">·</span><time dateTime={row.date} className={status.overdue?'nc-overdue':undefined}>{status.text}</time>
      </div>
    </div>
  </li>;};
  return <section className="nc-calendar" aria-label="学习日历">
    <header className="nc-toolbar nv-surface-toolbar"><Icon/><strong>日历</strong><time className="nc-selected-date" dateTime={date}>{selectedDateLabel(date)}</time><nav aria-label="切换日期"><button aria-label="前一天" onClick={()=>chooseDate(shiftDay(date,-1))}>‹</button><button aria-label="后一天" onClick={()=>chooseDate(shiftDay(date,1))}>›</button></nav><button onClick={()=>chooseDate(today)}>今天</button><span className="nc-subtitle"/><button aria-label="刷新日历" onClick={()=>setTick(n=>n+1)}>↻</button></header>
    {error&&<p role="alert">{error}</p>}
    {(data?.partial||data?.invalid.length>0)&&<p className="nc-warning">{data.partial?'仅显示前10000份资料。':''}{data.invalid.length>0?`${data.invalid.length} 项资料日期或格式需检查。`:''}</p>}
    <div className="nc-layout">
      <div className="nc-month"><nav aria-label="月份"><button aria-label="上个月" onClick={()=>chooseMonth(shiftMonth(month,-1))}>‹</button><strong>{month.replace('-',' 年 ')} 月</strong><button aria-label="下个月" onClick={()=>chooseMonth(shiftMonth(month,1))}>›</button></nav>
        <div className="nc-grid">{['一','二','三','四','五','六','日'].map(day=><span key={day} className="nc-weekday">{day}</span>)}{days.map(day=><button key={day} aria-label={day} aria-current={day===today?'date':undefined} aria-pressed={day===date} data-outside={!day.startsWith(month)||undefined} onClick={()=>chooseDate(day)}><span>{Number(day.slice(-2))}</span>{(data?.events.some(row=>row.date===day)||day===today&&data?.overdue.length>0)&&<i/>}</button>)}</div>
      </div>
      <div className="nc-agenda">{!data?<p>正在读取资料…</p>:<>
        <section aria-label="计划学习"><h2>计划学习 <span>{plans.filter(row=>!row.checked).length}</span></h2>{plans.length?<ul>{plans.map(itemRow)}</ul>:<p className="nc-empty">没有待开始的学习计划。</p>}</section>
        <section aria-label="到期问题"><h2>{date>today?'下次可以继续':'到期问题'} <span>{questions.length}</span></h2>{questions.length?<ul>{questions.map(itemRow)}</ul>:<p className="nc-empty">没有需要回来继续的问题。</p>}</section>
        <section aria-label="当天日记"><div className="nc-section-title"><h2>日记</h2>{!diaries.length&&<button disabled={busy} onClick={()=>void create()}>＋ 写日记</button>}</div>{diaries.length?<><div className="nc-diary-links">{diaries.map(row=><button className="nc-link" key={row.key} onClick={()=>open(row.path)}>{row.title}</button>)}</div>{diary!==null&&<div className="nc-diary">{markdown(diary)}</div>}</>:null}</section>
      </>}</div>
    </div>
    {editing&&visible&&<ReschedulePopover key={editing.row.key} {...editing} today={today} busy={busy} onSelect={reschedule} onClose={closeReschedule}/>}
  </section>;
}
function CalendarTab({ctx,sessionId,useTabInfo,renderSlot}){const info=useTabInfo(),workspaceId=useSyncExternalStore(fn=>subscribeWorkspace(ctx,fn),()=>workspaceForSession(ctx,sessionId));return workspaceId===null?<p className="nc-empty">请先选择工作区。</p>:<CalendarPage key={workspaceId??'default'} ctx={ctx} renderSlot={renderSlot} ownerSessionId={sessionId} workspaceId={workspaceId} visible={info.tab.visible&&info.sidebar.expanded}/>;}
export default {name:ID,inject:['remote','slots','sessions','sidebarRightTabs'],async apply(ctx){await ctx.effect(()=>ctx.remote.$mount(CONTRIBUTION));ctx.effect(()=>{const style=document.createElement('style');style.textContent=styles;style.dataset.plugin=ID;document.head.append(style);return()=>style.remove();});ctx.inject(['remote.notaraCalendar','remote.notaraVault'],scope=>{
  scope.effect(()=>scope.sidebarRightTabs.register({id:ID,kind:KIND,keepMounted:true,title:()=> '日历'}));
  scope.effect(()=>scope.slots.inject('sidebar.right.pane.tab',()=>scope.slots.register({name:'sidebar.right.pane.tab',key:ID,children:{'notara.calendar.diary':{kind:'single',scope:'root'},'notara.calendar.question':{kind:'single',scope:'root'}}},props=><CalendarTab {...props} ctx={scope}/>)));
  scope.effect(()=>scope.slots.inject('sidebar.right.pane.tab.title',()=>scope.slots.register({name:'sidebar.right.pane.tab.title',key:ID},()=> <span className="nc-tab-title"><Icon/>日历</span>)));
  scope.effect(()=>scope.slots.inject('sidebar.footer.action',()=>scope.slots.register({name:'sidebar.footer.action',id:'notara-calendar',order:4},({wide})=><button className="nc-launch" aria-label="日历" title="日历" onClick={()=>window.dispatchEvent(new CustomEvent('notara:open-calendar'))}><Icon/>{wide&&<span>日历</span>}</button>)));
});}};
