import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {atomicWrite} from './math-adapter.mjs';

const require=createRequire(import.meta.url);
const hash=source=>createHash('sha256').update(source).digest('hex');
const changes=[
  ['(0, _deepseek_ai_dsh_client_ui_primitives.rankByName)(skills, query).map((skill) => ({\n\t\t\t\t\t\tname: skill.name,\n\t\t\t\t\t\tdescription: skill.modelInvocable ? skill.description : `${t("menu.userOnly")} · ${skill.description}`\n\t\t\t\t\t}))','(0, _deepseek_ai_dsh_client_ui_primitives.rankByName)(notaraSkills.candidates(skills, t("menu.userOnly")), query)'],
  ['onPick({ candidate }) {\n\t\t\t\t\treturn { text: `/${candidate.name} ` };\n\t\t\t\t}','codec: notaraSkills.codec,\n\t\t\t\tonPick({ candidate }) {\n\t\t\t\t\treturn notaraSkills.pick(candidate);\n\t\t\t\t}'],
  ['label: `/${node.data.name}`,\n\t\t\t\ttitle: raw,','label: notaraSkills.referenceLabel(node.data.name),\n\t\t\t\ttitle: notaraSkills.referenceLabel(node.data.name),'],
  ['model.errorSummary ?? model.name;','model.errorSummary ?? notaraSkills.label(model.name);'],
];
const aliasChange=['item.label !== void 0 && item.label.toLowerCase() !== item.name.toLowerCase() &&','item.notaraSkill !== true && item.label !== void 0 && item.label.toLowerCase() !== item.name.toLowerCase() &&'];
function once(source,from,to){if(source.split(from).length!==2)throw new Error('DSH skill display patch anchor changed');return source.replace(from,()=>to);}
const marker=/\/\/ NOTARA_SKILL_DISPLAY_START ([a-f0-9]{64})\n([\s\S]*?)\/\/ NOTARA_SKILL_DISPLAY_END\n/;

/** Reversible rc.4 UI adaptation. Catalog discovery and skill loading stay native. */
export async function patchDshSkills({directory,check=false,restore=false}={}){
  const skillDir=directory?resolve(directory):resolve(require.resolve('@deepseek-ai/dsh-client-ui-skill/package.json'),'..');
  const triggerDir=resolve(skillDir,'../dsh-client-ui-input-trigger');
  const targets=[{name:'skill',dir:skillDir,expected:'a0acc17b955b1262208613a84b2192868417b6d8b3b8f222e4e9dc480c7ad2f8'},{name:'trigger',dir:triggerDir,expected:'4a9605b0a811354ed49495790b331bf4f5198ff41614920d9d0c488e22a0f2af'}];
  const manifest=JSON.parse(await readFile(new URL('./resources/manifest.json',pathToFileURL(require.resolve('@oh-my-student/plugin-presets/package.json'))),'utf8'));
  const faces=Object.fromEntries(manifest.skills.filter(s=>s.title&&s.summary).map(s=>[`notara-${s.id}`,{title:s.title,summary:s.summary}]));
  const helper=(await readFile(new URL('./skill-presentation.js',import.meta.url),'utf8')).replace('export function createSkillPresentation','function createSkillPresentation');
  const payload=helper+`\nconst notaraSkills=createSkillPresentation(${JSON.stringify(faces)});\n`;
  const results={};
  for(const target of targets){
    const version=JSON.parse(await readFile(resolve(target.dir,'package.json'),'utf8')).version;
    if(version!=='0.2.1-rc.4')throw new Error('DSH skill display only supports the verified 0.2.1-rc.4');
    const file=resolve(target.dir,'lib/client.js'),source=await readFile(file,'utf8');let original=source,patched=false;
    if(target.name==='skill'){
      const installed=source.match(marker);patched=!!installed;
      if(installed){if(hash(installed[2])!==installed[1])throw new Error('DSH skill display policy integrity differs');original=source.replace(marker,'');for(const [from,to] of [...changes].reverse())original=once(original,to,from);}
    }else{patched=source.includes(aliasChange[1]);if(patched)original=once(original,aliasChange[1],aliasChange[0]);}
    if(hash(original)!==target.expected)throw new Error('DSH skill display package integrity differs from the verified npm artifact');
    let next=original;
    if(target.name==='skill'){for(const [from,to] of changes)next=once(next,from,to);next=once(next,'function skillName(',`// NOTARA_SKILL_DISPLAY_START ${hash(payload)}\n${payload}// NOTARA_SKILL_DISPLAY_END\nfunction skillName(`);}
    else next=once(next,...aliasChange);
    Object.assign(target,{file,source,next:restore?original:next});results[target.name]={version,patched,current:source===next};
  }
  if(check)return results;
  for(const target of targets)if(target.source!==target.next)await atomicWrite(pathToFileURL(target.file),target.next);
}
