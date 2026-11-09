import React from 'react';
import {parseMarkdown} from '@oh-my-student/plugin-vault-sqlite/frontmatter';
import {isReviewDocument} from '@oh-my-student/plugin-vault-sqlite/review-contract';
import {reviewPlans} from '@oh-my-student/plugin-vault-sqlite/review-schedule';
import {MarkdownReader} from './markdown.jsx';

export function followUpMarkdown(record){
 try{
  const {fields}=parseMarkdown(record.content);
  if(!isReviewDocument(fields.type,record.path))return '';
  const plans=reviewPlans(fields).filter(plan=>plan.question);
  if(!plans.length)return '';
  return '### 下次可以继续\n\n'+plans.map(plan=>{
   const [year,month,day]=plan.nextReview.split('-').map(Number);
   const date=`${year===new Date().getFullYear()?'':year+' 年 '}${month} 月 ${day} 日`;
   return `${date}\n\n${plan.question}`;
  }).join('\n\n');
 }catch{return '';}
}

/** An ordinary Markdown projection of the saved appointment, not another editor. */
export function FollowUpText({record,renderMarkdown,onOpen,remote,loadPdf}){
 const content=followUpMarkdown(record);
 return content?<div className="nv-followup-text"><MarkdownReader {...{content,renderMarkdown,onOpen,remote,loadPdf}}/></div>:null;
}
