import {parseMarkdown} from '@oh-my-student/plugin-vault-sqlite/frontmatter';
import {markdownFacts,isLearningPlan,calendarTaskDate,replaceCalendarTaskDate} from '@oh-my-student/plugin-vault-sqlite/markdown-projection';
import {isCardType} from '@oh-my-student/plugin-vault-sqlite/review-contract';
import {reviewPlans,civilDay} from '@oh-my-student/plugin-vault-sqlite/review-schedule';
import {validDay} from './model.js';

/** Dates remain in the original plan line or continuation history. */
export function rescheduleCalendarItem(store,input,now=new Date()){
  if(!validDay(input.date))throw Error('calendar_date_invalid');
  const today=civilDay(now);
  if(input.date<today)throw Error('calendar_date_past');
  if(typeof input.expectedRevision!=='string')throw Error('vault_revision_required');
  const record=store.read({path:input.path});
  if(record.revision!==input.expectedRevision)throw Error('vault_revision_conflict');
  const {fields,body}=parseMarkdown(record.content);
  const doc={...fields,path:record.path,title:fields.title??body.match(/^#\s+(.+)\r?$/m)?.[1]??'',tags:Array.isArray(fields.tags)?fields.tags:typeof fields.tags==='string'?[fields.tags]:[]};
  if(input.kind==='plan'){
    if(isCardType(fields.type)||!isLearningPlan(doc))throw Error('calendar_plan_required');
    const offset=record.content.slice(0,record.content.length-body.length).split('\n').length-1;
    const task=markdownFacts(body,offset).tasks.find(row=>row.line===input.line&&!row.hidden);
    if(!task||task.checked||task.text!==input.expectedText||!calendarTaskDate(task.text))throw Error('vault_task_conflict');
    const lines=record.content.split('\n'),line=lines[task.line-1];
    const match=line.match(/^(\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]\s+)(.*?)(\r?)$/);
    lines[task.line-1]=match[1]+replaceCalendarTaskDate(match[2],input.date)+match[3];
    return store.save({path:record.path,content:lines.join('\n'),expectedRevision:record.revision});
  }
  if(input.kind==='question'){
    if(!isCardType(fields.type)||fields.template===true||/^(模板|日记)\//.test(record.path))throw Error('review_card_required');
    const plan=reviewPlans(fields).find(row=>row.recordId===input.recordId&&row.question);
    if(!plan||typeof input.recordId!=='string')throw Error('review_record_conflict');
    const afterDays=Math.round((Date.parse(input.date+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000);
    return store.scheduleReview({path:record.path,heading:plan.heading,expectedRevision:record.revision,followUp:{afterDays,question:plan.question,reason:plan.reason}});
  }
  throw Error('calendar_item_invalid');
}
