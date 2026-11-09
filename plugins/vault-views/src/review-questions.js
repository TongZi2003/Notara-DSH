import {reviewPlansForView} from '@oh-my-student/plugin-vault-sqlite/bases';

export function reviewQuestions(document,{config,index,today}){
 if(Array.isArray(document.viewReviewPlans))return document.viewReviewPlans.filter(plan=>typeof plan.question==='string'&&plan.question.trim());
 return reviewPlansForView(config,document,index,{today}).filter(plan=>typeof plan.question==='string'&&plan.question.trim());
}
export function questionDraft(document,plan){
 return {reference:{path:document.path,title:document.title,revision:document.revision},text:`我想接着研究：${plan.question}${plan.heading?`\n\n接着「${plan.heading}」这一节讨论。`:''}`};
}
export function reviewQuestionHeight(questions,width,measure){
 if(!questions.length)return 72;
 return questions.reduce((height,plan)=>height+Math.max(1,plan.question.split('\n').reduce((lines,line)=>lines+Math.max(1,Math.ceil(measure(line)*1.35/Math.max(80,width-30))),0))*25+30,0)+28+Math.max(0,questions.length-1)*31;
}
