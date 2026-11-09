// Ported conceptually from Pi calendarProjection: dates/files remain the authority.
import {calendarTaskDate,isLearningPlan} from '@oh-my-student/plugin-vault-sqlite/markdown-projection';
import {isCardType} from '@oh-my-student/plugin-vault-sqlite/review-contract';
export function validDay(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const date=new Date(value+'T12:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;}
export function dayInZone(now=new Date(),timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone){const parts=new Intl.DateTimeFormat('en',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);return ['year','month','day'].map(type=>parts.find(part=>part.type===type).value).join('-');}
export function shiftDay(day,n){const date=new Date(day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+n);return date.toISOString().slice(0,10);}
export function monthDays(month){if(!validDay(month+'-01'))throw new Error('日期无效');const first=month+'-01',offset=(new Date(first+'T12:00:00Z').getUTCDay()+6)%7;return Array.from({length:42},(_,i)=>shiftDay(first,i-offset));}
export function shiftMonth(month,n){const date=new Date(month+'-01T12:00:00Z');date.setUTCMonth(date.getUTCMonth()+n);return date.toISOString().slice(0,7);}
function diaryDate(doc){const fm=doc.frontmatter??{};if(doc.type==='daily')return typeof fm.date==='string'?fm.date:null;if(fm.type)return null;return /^(?:日记\/)?(\d{4}-\d{2}-\d{2})\.md$/.exec(doc.path)?.[1]??null;}
export function projectCalendar({documents,partial=false,invalid:unread=[]},{from,to,today}){
  if(!validDay(from)||!validDay(to)||from>to||to>shiftDay(from,366))throw new Error('日历范围无效');
  const events=[],overdue=[],invalid=[...unread].map(path=>({path,reason:'资料未能索引'}));
  const put=event=>{if(!validDay(event.date)){invalid.push({path:event.path,reason:'日期无效'});return;}if(event.date>=from&&event.date<=to)events.push(event);if(event.kind!=='daily'&&!event.checked&&event.date<today)overdue.push(event);};
  for(const doc of documents){const fm=doc.frontmatter??{},base={path:doc.path,title:doc.title,revision:doc.revision},day=diaryDate(doc);
    if(day)put({...base,key:'daily:'+doc.path,kind:'daily',date:day,summary:doc.summary??''});
    if(!isCardType(doc.type)&&isLearningPlan({...doc,template:fm.template===true})){
      for(const task of doc.tasks??[]){
        if(task.hidden)continue;
        const explicit=calendarTaskDate(task.text);
        if(explicit)put({...base,...task,documentTitle:doc.title,title:explicit.title,date:explicit.date,key:`plan:${doc.path}:${task.line}`,kind:'plan'});
      }
    }else if(isCardType(doc.type)&&fm.template!==true&&!/^(模板|日记)\//.test(doc.path)){
      for(const plan of doc.reviewPlans??[]){
        if(!plan.question?.trim())continue;
        put({...base,documentTitle:doc.title,title:plan.question,date:plan.nextReview,heading:plan.heading??'',recordId:plan.recordId,key:`question:${doc.path}:${plan.heading??''}`,kind:'question'});
      }
    }
  }
  const order=(a,b)=>a.date.localeCompare(b.date)||a.kind.localeCompare(b.kind)||a.title.localeCompare(b.title,'zh');
  events.sort(order);overdue.sort(order);
  return {from,to,today,events,overdue,partial,invalid};
}

export function agendaForDay(data,date){
  const rows=(data?.events??[]).filter(row=>row.kind!=='daily'&&row.date===date);
  return date===data?.today?[...(data.overdue??[]),...rows]:rows;
}
