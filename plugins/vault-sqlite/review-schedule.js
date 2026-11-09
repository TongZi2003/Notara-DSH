// Browser-safe replay of the existing Markdown history. v1/v2 retain their
// original ladder; v3 observations never infer a date from a performance label.
import {REVIEW_INTERVALS} from './review-contract.js';
const fail=code=>{throw new Error(code);};
export function civilDay(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
export function validDay(day){
 if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day))fail('review_date_invalid');
 const date=new Date(`${day}T00:00:00Z`);if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==day)fail('review_date_invalid');return day;
}
export function addDays(day,days){validDay(day);const date=new Date(`${day}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+days);if(!Number.isFinite(date.getTime()))fail('review_date_invalid');return validDay(date.toISOString().slice(0,10));}
export function historyOf(fields){
 if(fields.review_history===undefined)return [];
 if(!Array.isArray(fields.review_history)||fields.review_history.some(row=>!row||typeof row!=='object'||Array.isArray(row)))fail('review_history_invalid');return fields.review_history;
}
export function validateFollowUp(value){
 if(value===null)return null;
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['afterDays','question','reason'].includes(key))||!Number.isSafeInteger(value.afterDays)||value.afterDays<0||typeof value.question!=='string'||!value.question.trim()||typeof value.reason!=='string'||!value.reason.trim())fail('review_followup_invalid');
 return {question:value.question.trim(),afterDays:value.afterDays,reason:value.reason.trim()};
}
function checkedSchedule(value){
 if(value===null)return null;
 if(!value||!Number.isInteger(value.stage)||value.stage<1||value.stage>5||value.intervalDays!==REVIEW_INTERVALS[value.stage-1])fail('review_history_invalid');
 if(validDay(value.nextReview)!==addDays(validDay(value.lastReview),value.intervalDays))fail('review_history_invalid');
 return {stage:value.stage,intervalDays:value.intervalDays,lastReview:value.lastReview,nextReview:value.nextReview};
}
export function legacySchedule(fields={}){
 if(!fields||typeof fields!=='object')return null;
 if(!['mastery','interval','last_review','next_review'].some(key=>fields[key]!=null&&fields[key]!==0)){if(fields.learned===true)fail('review_baseline_unavailable');return null;}
 return checkedSchedule({stage:fields.mastery,intervalDays:fields.interval,lastReview:fields.last_review,nextReview:fields.next_review});
}
function advance(schedule,{day,result,support}){
 if(result==='unchecked'||result==='done'&&schedule&&(support!=='independent'||day<schedule.nextReview))return schedule;
 const stage=result==='missed'?1:schedule?Math.min(5,schedule.stage+1):1;
 return {stage,intervalDays:REVIEW_INTERVALS[stage-1],lastReview:day,nextReview:addDays(day,REVIEW_INTERVALS[stage-1])};
}
function planMap(fields){
 const history=historyOf(fields),plans=new Map();let baseline=null;
 if(!history.length){try{baseline=legacySchedule(fields);}catch{}if(baseline)plans.set('',baseline);return plans;}
 const first=history[0];
 if(first.scheduleVersion===3){baseline=first.baseline??null;if(baseline)baseline=checkedSchedule(baseline);}
 else if(first.scheduleVersion===2)baseline=checkedSchedule(first.before);
 else if(first.scheduleVersion!==undefined)fail('review_history_invalid');
 else{if(!first.before||typeof first.before!=='object'||Array.isArray(first.before))fail('review_baseline_unavailable');try{baseline=legacySchedule(first.before);}catch{fail('review_baseline_unavailable');}}
 if(baseline)plans.set('',baseline);let previous=baseline?.lastReview??null;
 for(const row of history){
  if(row.revertedAt){if(typeof row.revertedAt!=='string'||!Number.isFinite(Date.parse(row.revertedAt)))fail('review_history_invalid');continue;}
  const day=validDay(row.day);if(previous&&day<previous)fail('review_history_invalid');previous=day;
  if(row.scheduleVersion===3){
   if(!['observation','continuation'].includes(row.kind)||typeof (row.heading??'')!=='string')fail('review_history_invalid');
   if(row.kind==='observation'&&(!['done','missed','unchecked'].includes(row.result)||!['independent','hint','explanation','unknown'].includes(row.support)))fail('review_history_invalid');
   if(Object.hasOwn(row,'followUp')){
    const followUp=validateFollowUp(row.followUp),heading=row.heading??'';
    if(followUp===null)plans.delete(heading);
    else plans.set(heading,{stage:null,intervalDays:followUp.afterDays,lastReview:day,nextReview:addDays(day,followUp.afterDays),question:followUp.question,reason:followUp.reason,recordId:row.id});
   }
  }else{
   if(row.scheduleVersion!==undefined&&row.scheduleVersion!==2)fail('review_history_invalid');
   if(!['done','missed','unchecked'].includes(row.result)||row.support!==undefined&&!['independent','hint','explanation','unknown'].includes(row.support))fail('review_history_invalid');
   const next=advance(plans.get('')??null,{...row,day,support:row.support??'unknown'});if(next)plans.set('',next);
  }
 }
 return plans;
}
export function reviewPlans(fields){return [...planMap(fields)].map(([heading,plan])=>({...plan,heading})).sort((a,b)=>a.nextReview.localeCompare(b.nextReview)||a.heading.localeCompare(b.heading));}
export function reviewSchedule(fields,heading=''){return planMap(fields).get(heading)??null;}
