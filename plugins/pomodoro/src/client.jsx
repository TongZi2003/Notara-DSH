import React,{useEffect,useState,useSyncExternalStore} from 'react';
import {Modal} from '@deepseek-ai/dsh-client-ui-primitives';
import {CONTRIBUTION} from '../remote.js';
import styles from './styles.css';
async function call(ctx,method,input){const result=await ctx.remote.notaraPomodoro[method](input);if(result.ok===false)throw new Error(result.error?.message||'计时操作失败');return result.ok===true?result.value:result;}
function Clock({ctx,sessionId}){
  const selection=ctx.get('uiSession')?.adapter.current;
  const sessions=useSyncExternalStore(fn=>ctx.sessions.list.subscribe(fn),()=>ctx.sessions.list.getSnapshot());
  const row=sessions.byId?.[sessionId],eligible=Boolean(row&&!row.blank&&row.origin!=='subagent');
  const [open,setOpen]=useState(false),[state,setState]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[duration,setDuration]=useState(45),[interval,setIntervalMinutes]=useState(10),[now,setNow]=useState(Date.now());
  useEffect(()=>{setOpen(false);setState(null);setError('');setBusy(false);},[sessionId]);
  useEffect(()=>{if(!eligible||busy)return;let alive=true;const poll=()=>call(ctx,'status',{sessionId}).then(value=>{if(alive)setState(value);},()=>{if(alive)setError('计时状态暂时无法读取');});void poll();const timer=setInterval(()=>{setNow(Date.now());void poll();},3000);return()=>{alive=false;clearInterval(timer);};},[sessionId,eligible,busy]);
  const run=async method=>{setBusy(true);setError('');try{const value=await call(ctx,method,{sessionId,durationMinutes:duration,intervalMinutes:interval,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,startedAt:state?.startedAt});if(selection?.getSnapshot()?.key===sessionId)setState(value);}catch(e){if(selection?.getSnapshot()?.key===sessionId)setError(e.message);}finally{if(selection?.getSnapshot()?.key===sessionId)setBusy(false);}};
  const remaining=state?.endsAt?Math.max(0,Math.ceil((Date.parse(state.endsAt)-now)/60000)):0;
  if(!eligible)return null;
  return <><button className="np-clock-launch" title="课堂番茄钟" aria-label="课堂番茄钟" onClick={()=>setOpen(true)}><svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="10" cy="11" r="6.5"/><path d="M7 1.5h6M10 1.5v3M10 7v4l2 1"/></svg><span>课堂计时</span><small>{state?.state==='running'?`剩余约 ${remaining} 分钟`:state?.state==='delivered'?'已结束':state?.state==='stopped'?'已停止':'设置'}</small></button>{open&&<Modal open title="课堂番茄钟" closeLabel="关闭番茄钟" onClose={()=>setOpen(false)} className="np-clock-dialog"><p className="np-clock-class">{row?.displayTitle||'请先打开课堂并发送第一条消息'}</p>{eligible?<><p role="status">{!state?'正在读取…':state.state==='running'?(remaining?`剩余约 ${remaining} 分钟`:'计划时间已到，等待提醒送达'):state.state==='delivered'?'本节提醒已全部送达':state.state==='stopped'?'计时已停止':'当前没有进行中的计时'}</p>{state?.state==='running'?<><p>每 {state.intervalMinutes} 分钟提醒老师 · 已送达 {state.delivered} 次</p>{state.partial&&<p role="alert">部分提醒缺失，可停止后重新开始。</p>}<button disabled={busy} onClick={()=>run('stop')}>停止计时</button></>:<form onSubmit={event=>{event.preventDefault();void run('start');}}><label>课堂时长（分钟）<input type="number" min="5" max="120" value={duration} onChange={event=>setDuration(Number(event.target.value))}/></label><label>提醒间隔（分钟）<input type="number" min="5" max="120" value={interval} onChange={event=>setIntervalMinutes(Number(event.target.value))}/></label><button type="submit" disabled={busy||!state}>开始计时</button></form>}<p className="np-clock-help">提醒绑定这节课堂，切换页面后继续计时。停止会取消尚未送出的提醒，已送达的消息保留。提醒是给老师的节奏参考，不代表学习完成。</p></>:<p>请在主课堂中开始计时；同学和子任务不单独计时。</p>}{error&&<p role="alert">{error}</p>}</Modal>}</>;
}
export default {name:'@oh-my-student/plugin-pomodoro/client',inject:['remote','slots','sessions'],async apply(ctx){
  await ctx.effect(()=>ctx.remote.$mount(CONTRIBUTION));
  ctx.effect(()=>{const style=document.createElement('style');style.textContent=styles;style.dataset.plugin='@oh-my-student/plugin-pomodoro';document.head.append(style);return()=>style.remove();});
  ctx.inject(['remote.notaraPomodoro'],scope=>scope.effect(()=>scope.slots.inject('notara.activity.timer',()=>scope.slots.register({name:'notara.activity.timer',id:'notara-pomodoro'},props=><Clock {...props} ctx={scope}/>))));
}};
