import test from 'node:test';
import assert from 'node:assert/strict';
import {ROLES,presetDefinitions} from '../index.js';
import {allowedTools} from '../policy.js';
import {resource} from '../resources.js';

test('Bash registration and execution policy agree for teachers and all five workers only',()=>{
  const expected=new Set(['notara-coordinator','notara-teacher','worker-problem','worker-review','worker-exercise','worker-general','worker-lesson']);
  const definitions=presetDefinitions();
  for(const role of ROLES){
    const registered=definitions.find(item=>item.id===role.id).plugins.some(plugin=>plugin.name==='@deepseek-ai/dsh-tool-bash');
    assert.equal(registered,expected.has(role.id),role.id+' registration');
    assert.equal(allowedTools(role).includes('bash'),expected.has(role.id),role.id+' policy');
    assert.equal(definitions.find(item=>item.id===role.id).plugins.some(plugin=>plugin.name==='@deepseek-ai/dsh-tool-jobs'),expected.has(role.id),role.id+' jobs registration');
    for(const name of ['job_output','job_list','job_kill'])assert.equal(allowedTools(role).includes(name),expected.has(role.id),role.id+' '+name);
  }
});

test('new Bash roles describe actual computation without changing task ownership or write tools',()=>{
  for(const path of ['coordinator.md','workers/general.md','workers/lesson.md'])assert.match(resource(path),/`bash`/,path);
  assert.doesNotMatch(resource('workers/general.md'),/没有\s*`bash`|需要计算或运行验证的结论明确交主老师或核验员处理/);
  for(const id of ['worker-general','worker-lesson']){
    const allowed=allowedTools(ROLES.find(role=>role.id===id));
    for(const tool of ['write','edit','subagent'])assert.ok(!allowed.includes(tool),id+' '+tool);
  }
});
