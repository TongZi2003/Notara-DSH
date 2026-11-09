import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {patchDshSkills} from '../plugins/bundle/skill-adapter.mjs';

test('native skill presentation patch is reversible, idempotent and validates both targets before writing',async()=>{
  const root=await mkdtemp(join(tmpdir(),'notara-skill-ui-')),directory=join(root,'dsh-client-ui-skill');
  try{
    for(const name of ['dsh-client-ui-skill','dsh-client-ui-input-trigger']){
      await mkdir(join(root,name,'lib'),{recursive:true});await writeFile(join(root,name,'package.json'),JSON.stringify({version:'0.2.1-rc.4'}));
      await writeFile(join(root,name,'lib/client.js'),await readFile(new URL(`../node_modules/@deepseek-ai/${name}/lib/client.js`,import.meta.url)));
    }
    await patchDshSkills({directory,restore:true});const file=join(directory,'lib/client.js'),trigger=join(root,'dsh-client-ui-input-trigger/lib/client.js');
    const original=await readFile(file,'utf8'),originalTrigger=await readFile(trigger,'utf8');
    await patchDshSkills({directory});const next=await readFile(file,'utf8');
    assert.match(next,/notaraSkills.candidates\(skills/);assert.match(next,/codec: notaraSkills.codec/);assert.match(next,/notaraSkills.referenceLabel\(node.data.name\)/);
    assert.equal((await patchDshSkills({directory,check:true})).skill.current,true);
    await patchDshSkills({directory});assert.equal(await readFile(file,'utf8'),next);
    await writeFile(trigger,originalTrigger+'\n// unexpected');await assert.rejects(patchDshSkills({directory,restore:true}),/integrity/);assert.equal(await readFile(file,'utf8'),next);
    await writeFile(trigger,originalTrigger);await patchDshSkills({directory,restore:true});assert.equal(await readFile(file,'utf8'),original);assert.equal(await readFile(trigger,'utf8'),originalTrigger);
    await writeFile(join(directory,'package.json'),JSON.stringify({version:'0.2.2'}));await assert.rejects(patchDshSkills({directory}),/only supports/);
  }finally{await rm(root,{recursive:true,force:true});}
});
