import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createSkillPresentation} from '../plugins/bundle/skill-presentation.js';

test('skill display metadata is complete, concise and separate from model instructions',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../prompts/manifest.json',import.meta.url)));
  assert.equal(manifest.skills.filter(s=>s.userInvocable!==false).length,13);
  for(const skill of manifest.skills){
    assert.match(skill.title,/[\u4e00-\u9fff]/);assert.ok(skill.summary.length>0&&skill.summary.length<=36);
    assert.doesNotMatch(skill.summary,/notara-|type:|加载|时使用/);
    assert.notEqual(skill.summary,skill.description);
  }
});

test('Chinese skill faces preserve original identity, catalog and third-party fallback',async()=>{
  const faces={'notara-error-analysis':{title:'错因分析',summary:'结合草稿和回忆，找出卡点与改进办法。'}};
  const ui=createSkillPresentation(faces),catalog=[{name:'notara-error-analysis',description:'模型加载条件',modelInvocable:true},{name:'my-skill',description:'自定义说明',modelInvocable:false}],before=structuredClone(catalog);
  assert.deepEqual(ui.candidates(catalog,'仅用户'),[{name:'notara-error-analysis',label:'错因分析',notaraSkill:true,description:faces['notara-error-analysis'].summary},{name:'my-skill',description:'仅用户 · 自定义说明'}]);
  assert.deepEqual(catalog,before);
  const picked=ui.pick({name:'notara-error-analysis'});
  assert.deepEqual(picked,{insert:{source:'skill',ref:'/notara-error-analysis',label:'错因分析',clipboardText:'/notara-error-analysis'}});
  assert.equal(await ui.codec.serialize(picked.insert.ref),'/notara-error-analysis');assert.equal(ui.codec.clipboardText(picked.insert.ref),'/notara-error-analysis');
  assert.deepEqual(ui.pick({name:'my-skill'}),{text:'/my-skill '});
  assert.equal(ui.label('notara-error-analysis'),'错因分析');assert.equal(ui.referenceLabel('my-skill'),'/my-skill');
});
