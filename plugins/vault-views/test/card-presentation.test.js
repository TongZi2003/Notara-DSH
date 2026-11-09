import test from 'node:test';
import assert from 'node:assert/strict';
import { cardFields, hasCardValue } from '../src/card-presentation.js';
import * as presentation from '../src/card-presentation.js';
import {TYPE_LABELS} from '../src/logic.js';

test('entity tag labels retain canonical target identity across aliases, separately from ordinary tags',()=>{
  assert.equal(typeof presentation.cardTags,'function');
  const doc={tags:['[[卡片/实体.md|别名]]','别名','[[卡片/实体.md|另一称呼]]'],knowledgeTags:[
    {raw:'[[卡片/实体.md|别名]]',target:'卡片/实体.md',label:'别名'},
    {raw:'[[卡片/实体.md|另一称呼]]',target:'卡片/实体.md',label:'另一称呼'},
  ]};
  assert.deepEqual(presentation.cardTags(doc),[
    {value:'[[卡片/实体.md]]',label:'别名',target:'卡片/实体.md'},
    {value:'别名',label:'别名'},
  ]);
  assert.equal(TYPE_LABELS.exercise,'具体例子');
});

test('card fields hide missing values but preserve meaningful zero and false', () => {
  for (const value of [undefined,null,'','  ',[],[' ',null]]) assert.equal(hasCardValue(value),false);
  for (const value of [0,false,'0',[false],['有效']]) assert.equal(hasCardValue(value),true);
  const doc={type:'concept',tags:[],properties:{'notara.reviewCount':0,'notara.reviewDue':null,'note.learned':false,'note.summary':'简介','note.empty':' '}};
  assert.deepEqual(cardFields(doc,['file.name','note.tags','notara.type','notara.reviewCount','notara.reviewDue','note.learned','note.summary','note.empty']),['notara.type','notara.reviewCount','note.learned']);
});
test('ordinary documents do not display learning review fields or duplicate summaries', () => {
  const doc={type:'file',tags:['代码'],properties:{'notara.reviewCount':0,'notara.reviewDue':'2026-10-27','file.ext':'py'}};
  assert.deepEqual(cardFields(doc,['note.title','note["summary"]','note.tags','notara.type','notara.reviewCount','notara.reviewDue','file.ext']),['note.tags','notara.type','file.ext']);
});
