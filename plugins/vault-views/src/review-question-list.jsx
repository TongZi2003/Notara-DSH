import React from 'react';
import {MarkdownBody} from './markdown.jsx';

export function ReviewQuestionList({document,questions,onQuestion,onOpen,renderMarkdown,busy}){
 if(!questions.length)return <div className="nv-review-question-legacy"><button className="nv-vault-title-link" onClick={()=>onOpen({path:document.path})}>{document.title}</button>{document.reviewDue&&<time dateTime={document.reviewDue}>{document.reviewDue}</time>}</div>;
 return <div className="nv-review-questions">
  {questions.map(plan=><div className="nv-review-question-item" key={plan.heading}>
   <div role="button" tabIndex={busy?-1:0} className="nv-review-question" aria-disabled={busy} onClick={event=>{if(!busy&&!event.target.closest('a,button'))onQuestion(document,plan);}} onKeyDown={event=>{if(event.target===event.currentTarget&&!busy&&['Enter',' '].includes(event.key)){event.preventDefault();onQuestion(document,plan);}}}><MarkdownBody content={plan.question} renderMarkdown={renderMarkdown} onOpen={onOpen}/></div>
   <div className="nv-review-question-meta"><button type="button" onClick={()=>onOpen({path:document.path,...plan.heading?{subpath:'#'+plan.heading}:{}})}>{document.title}{questions.length>1&&plan.heading?` · ${plan.heading}`:''}</button><time dateTime={plan.nextReview}>{plan.nextReview}</time></div>
  </div>)}
 </div>;
}
