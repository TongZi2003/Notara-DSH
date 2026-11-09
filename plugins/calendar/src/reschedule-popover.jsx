import React,{useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {MenuSurface,useAnchoredPosition,useDismissOnOutsidePointer} from '@deepseek-ai/dsh-client-ui-primitives';
import {monthDays,shiftDay,shiftMonth} from '../model.js';

export function ReschedulePopover({anchor,row,today,busy,onSelect,onClose}){
  const anchorRef=useRef(anchor),panelRef=useRef(null),titleId=useId();
  const [custom,setCustom]=useState(false),[month,setMonth]=useState((row.date<today?today:row.date).slice(0,7));
  const position=useAnchoredPosition({open:true,anchorRef,panelRef,align:'end',gap:6,margin:12});
  useDismissOnOutsidePointer(anchorRef,true,()=>onClose(false),panelRef);
  const positioned=position!==null;
  useEffect(()=>{if(positioned)panelRef.current?.querySelector('button:not(:disabled)')?.focus({preventScroll:true});},[custom,positioned]);
  return createPortal(<MenuSurface ref={panelRef} compact className="nc-reschedule-popover" role="dialog" aria-labelledby={titleId}
    style={{...position,visibility:position?'visible':'hidden'}}
    onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose(true);}}}>
    <strong id={titleId}>改期</strong>
    <fieldset disabled={busy} aria-busy={busy}>
      {!custom?<>
        {[['明天',1],['3 天后',3],['下周',7]].map(([label,days])=><button key={days} onClick={()=>onSelect(row,shiftDay(today,days))}>{label}</button>)}
        <button onClick={()=>setCustom(true)}>选日期…</button>
      </>:<>
        <nav aria-label="选择提醒月份"><button aria-label="上个月" disabled={month<=today.slice(0,7)} onClick={()=>setMonth(shiftMonth(month,-1))}>‹</button><strong>{month.replace('-','年')}月</strong><button aria-label="下个月" onClick={()=>setMonth(shiftMonth(month,1))}>›</button></nav>
        <div className="nc-date-picker">
          {['一','二','三','四','五','六','日'].map(day=><span key={day}>{day}</span>)}
          {monthDays(month).map(day=><button key={day} aria-label={day} aria-current={day===today?'date':undefined} aria-pressed={day===row.date} disabled={day<today} data-outside={!day.startsWith(month)||undefined} onClick={()=>onSelect(row,day)}>{Number(day.slice(8))}</button>)}
        </div>
      </>}
    </fieldset>
  </MenuSurface>,document.body);
}
