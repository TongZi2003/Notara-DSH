import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewQuestions,questionDraft} from '../src/review-questions.js';
import {defaultLibraryBase} from '../../vault-sqlite/bases.js';
const doc={path:'日记/学习.md',title:'今天的讨论',revision:'v1',type:'diary',reviewDue:'2026-11-07',frontmatter:{},reviewPlans:[
 {heading:'编程',question:'不运行，怎样判断最后一次循环取到几？',nextReview:'2026-11-07',reason:'内部安排依据'},
 {heading:'化学',question:'换一种溶液后条件还成立吗？',nextReview:'2026-11-06'},
 {heading:'以后',question:'不应提前出现的问题',nextReview:'2026-11-20'},
]};
test('existing due view presents concrete current questions and respects per-section dates',()=>{
 const questions=reviewQuestions(doc,{config:defaultLibraryBase(),index:2,today:'2026-11-07'});
 assert.deepEqual(questions.map(q=>q.heading),['化学','编程']);
 assert.equal(doc.reviewPlans.length,3);
 const limited=defaultLibraryBase();limited.views[2].limit=1;assert.equal(reviewQuestions(doc,{config:limited,index:2,today:'2026-11-07'}).length,2);
 assert.deepEqual(reviewQuestions({...doc,reviewPlans:[{nextReview:'2026-11-07',stage:1}]},{config:defaultLibraryBase(),index:2,today:'2026-11-07'}),[],'old dates do not invent a question');
});
test('custom date constraints apply to each diary topic rather than the earliest document date',()=>{
 const config=defaultLibraryBase();config.views[2].filters='date(notara.reviewDue) > today()';
 assert.deepEqual(reviewQuestions(doc,{config,index:2,today:'2026-11-07'}).map(q=>q.heading),['以后']);
});
test('draft carries the selected question and exact document/heading, not internal judgment or the whole file',()=>{
 const {text,reference}=questionDraft(doc,doc.reviewPlans[0]);
 assert.match(text,/不运行，怎样判断最后一次循环取到几/);assert.equal(reference.path,doc.path);assert.match(text,/编程/);
 assert.doesNotMatch(text,/内部安排依据|化学|不应提前出现|独立掌握/);
});
