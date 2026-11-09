import {randomUUID} from 'node:crypto';
import MarkdownIt from 'markdown-it';
import {parseMarkdown,patchFields} from './frontmatter.js';
import {isCardType,isReviewDocument} from './review-contract.js';
import {civilDay,reviewSchedule,reviewPlans,historyOf,legacySchedule,validateFollowUp} from './review-schedule.js';
export {REVIEW_INTERVALS,CARD_TYPES,isCardType} from './review-contract.js';
export {civilDay,addDays,reviewSchedule,reviewPlans} from './review-schedule.js';
const fail=code=>{throw new Error(code);};
const markdown=new MarkdownIt();

export function reviewProjection(fields,path=''){
 if(!isReviewDocument(fields.type,path))return {reviewDue:null,reviewStage:null,reviewIssue:null,reviewCount:0,lastSupport:null,lastResult:null,independentReviewCount:0,reviewPlans:[]};
 let plans=[],reviewIssue=null;
 try{plans=reviewPlans(fields);}catch{reviewIssue='review_history_invalid';}
 if(!reviewIssue&&!fields.review_history?.length){try{legacySchedule(fields);}catch{reviewIssue='legacy_schedule_invalid';}}
 let history=[];try{history=historyOf(fields);}catch{}
 const active=history.filter(row=>!row.revertedAt&&row.kind!=='continuation'),last=active.at(-1),next=plans[0];
 return {reviewDue:next?.nextReview??null,reviewStage:next?.stage??null,reviewIssue,reviewCount:active.length,lastSupport:last?last.support??'unknown':null,
  lastResult:['done','missed','unchecked'].includes(last?.result)?last.result:null,
  independentReviewCount:active.filter(row=>row.result==='done'&&row.support==='independent').length,reviewPlans:plans};
}
function headingFor(content,input){
 const {fields,body}=parseMarkdown(content);
 if(!isReviewDocument(fields.type,input.path))fail('review_card_required');
 const heading=input.heading??'';
 if(typeof heading!=='string'||heading.includes('\n'))fail('review_heading_invalid');
 if(isCardType(fields.type)){if(heading)fail('review_heading_invalid');return '';}
 if(!heading.trim())fail('review_heading_required');
 // A renamed/deleted diary section must not strand its historical schedule.
 if(input.followUp===null&&reviewPlans(fields).some(plan=>plan.heading===heading))return heading;
 const tokens=markdown.parse(body,{}),matches=tokens.filter((token,i)=>token.type==='heading_open'&&tokens[i+1]?.content===heading);
 if(matches.length!==1)fail(matches.length?'review_heading_ambiguous':'review_heading_not_found');
 return heading;
}
const samePlan=(a,b)=>JSON.stringify(a===undefined?undefined:validateFollowUp(a))===JSON.stringify(b===undefined?undefined:validateFollowUp(b));
/** Native message + component identity makes student confirmations retryable. */
export function recordedProposal(content,input){
 if(input.source===undefined)return null;
 const source=input.source;
 if(!source||typeof source!=='object'||Array.isArray(source)||Object.keys(source).some(key=>!['messageId','index'].includes(key))||typeof source.messageId!=='string'||!source.messageId.trim()||source.messageId.length>200||!Number.isSafeInteger(source.index)||source.index<0)fail('review_source_invalid');
 const row=historyOf(parseMarkdown(content).fields).find(row=>row.source?.messageId===source.messageId&&row.source.index===source.index);
 if(!row)return null;if(row.revertedAt)fail('review_proposal_reverted');
 if(['keyStep','result','support','note'].some(key=>row[key]!==input[key])||(row.heading??'')!==(input.heading??'')||!samePlan(row.followUp,input.followUp))fail('review_proposal_conflict');
 return row;
}
export function recordedSchedule(content,input){
 if(input.requestId===undefined)return null;
 if(typeof input.requestId!=='string'||!input.requestId.trim()||input.requestId.length>300)fail('review_source_invalid');
 const row=historyOf(parseMarkdown(content).fields).find(row=>row.kind==='continuation'&&row.requestId===input.requestId);
 if(!row)return null;if(row.revertedAt)fail('review_proposal_reverted');
 if((row.heading??'')!==(input.heading??'')||!samePlan(row.followUp,input.followUp))fail('review_proposal_conflict');return row;
}
function appendRecord(content,input,date,kind){
 const {fields}=parseMarkdown(content),heading=headingFor(content,input),history=historyOf(fields),day=civilDay(date);
 reviewPlans(fields);
 if(history.some(row=>!row.revertedAt&&row.day>day))fail('review_day_regression');
 const entry={id:randomUUID(),at:date.toISOString(),day,scheduleVersion:3,kind,...heading?{heading}:{}};
 if(!history.length)entry.baseline=reviewSchedule(fields);
 if(kind==='observation')Object.assign(entry,{keyStep:input.keyStep,result:input.result,support:input.support,note:input.note,...input.source?{source:{...input.source}}:{}});
 if(input.requestId!==undefined)entry.requestId=input.requestId;
 if(Object.hasOwn(input,'followUp'))entry.followUp=validateFollowUp(input.followUp);
 const next=[...history,entry];reviewPlans({...fields,review_history:next});
 return patchFields(content,{review_history:next});
}
export function recordReviewContent(content,input,date=new Date()){
 if(recordedProposal(content,input))return content;
 if(!['done','missed','unchecked'].includes(input.result))fail('review_result_invalid');
 if(!['independent','hint','explanation','unknown'].includes(input.support))fail('review_support_invalid');
 if(typeof input.keyStep!=='string'||input.keyStep.length>200||(input.result!=='unchecked'&&!input.keyStep.trim()))fail('review_key_step_required');
 if(typeof input.note!=='string'||!input.note.trim())fail('review_note_required');
 return appendRecord(content,input,date,'observation');
}
/** Schedule/clear a continuation without inventing another learning result. */
export function scheduleReviewContent(content,input,date=new Date()){
 if(!Object.hasOwn(input,'followUp'))fail('review_followup_required');
 if(recordedSchedule(content,input))return content;
 return appendRecord(content,input,date,'continuation');
}
export function undoReviewContent(content,date=new Date(),expectedRecordId,path=''){
 const {fields}=parseMarkdown(content),history=historyOf(fields),row=history.findLast(row=>!row.revertedAt);
 if(!isReviewDocument(fields.type,path))fail('review_card_required');
 if(!row)fail('review_undo_unavailable');if(expectedRecordId!==undefined&&row.id!==expectedRecordId)fail('review_record_conflict');
 row.revertedAt=date.toISOString();return patchFields(content,{review_history:history});
}
