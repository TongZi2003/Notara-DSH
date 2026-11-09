import test from 'node:test';
import assert from 'node:assert/strict';
import {apply} from '../prompt.js';
import {resource,skillManifest} from '../resources.js';

function teacherPrompt(){let text;apply({systemPrompt:{section:value=>{text=value.text;},getSectionOrder:()=>0},on(){}},{preset:'notara-teacher'});return text;}
test('teacher preserves student-led invitations while the classmate role owns rubber-duck guidance',()=>{
  const text=teacherPrompt();
  assert.doesNotMatch(text,/用于检验是否真正独立掌握/);
  assert.match(text,/未收到学生邀请就不主动调用同学/);
  assert.match(resource('companions/deepseek.md'),/橡皮鸭/);
  assert.match(text,/同学的提问和想法也不记为学生已形成的认识/);
});
test('teacher delegates lesson binding details to the available tutoring skill',()=>{
  const text=teacherPrompt();
  assert.doesNotMatch(text,/实际进入课堂时，先确认已保存/);
  assert.match(text,/notara-quest-tutor/);
  const body=resource('role-skills/teacher/notara-quest-tutor/SKILL.md');
  assert.match(body,/围绕[^。\n]*type: lesson[^。\n]*授课时/);
  assert.match(body,/无需完整备课本/);
});
test('general tutoring loads drawing details only through a bundled relative reference',()=>{
  const body=resource('role-skills/teacher/notara-quest-tutor/SKILL.md');
  assert.match(body,/references\/drawing\.md/);
  assert.doesNotMatch(body,/```figure|circumcircle c =|"nodes":/);
  const declaration=skillManifest.skills.find(s=>s.id==='quest-tutor').resources.find(s=>s.path==='references/drawing.md');
  assert.ok(declaration);
  const reference=resource('role-skills/teacher/notara-quest-tutor/references/drawing.md');
  assert.match(reference,/```figure/);assert.match(reference,/连续 Canvas 板书/);
  assert.match(teacherPrompt(),/references\/drawing\.md/);
});
test('the optional duck invitation in tutoring is explicitly student initiated',()=>{
  const body=resource('role-skills/teacher/notara-quest-tutor/SKILL.md');
  assert.match(body,/学生主动邀请同学后才调用同伴/);
  assert.match(teacherPrompt(),/未收到学生邀请就不主动调用同学/);
});
