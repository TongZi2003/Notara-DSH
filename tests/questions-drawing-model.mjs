import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { resource } from '../plugins/presets/resources.js';
export const inject=['llm'];
const skill=resource('pi-skills-built/notara-quest-tutor/SKILL.md');
export const figure=skill.match(/^```figure\n([\s\S]*?)^```\s*$/m)[0].trim();
export const board=skill.match(/^```json\n([\s\S]*?)^```\s*$/m)[1].trim();
export const boardPath='白板/割线与切线.canvas';
function* text(value){yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:value};yield {type:'block-end',index:0,block:{type:'text',text:value}};yield {type:'finish',reason:{kind:'stop'}};}
function* call(id,name,args){const block={type:'tool-call',id,name,arguments:JSON.stringify(args)};yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'tool-call-delta',index:0,id,name,argumentsDelta:block.arguments};yield {type:'block-end',index:0,block};yield {type:'finish',reason:{kind:'tool-calls'}};}
export function apply(ctx){
  const stages=new Map();
  class Fixture extends LlmAdapter{
    providerInfo(provider){return {id:provider,name:'提问与画图协议夹具'};}
    async listModels(provider){return [{provider,id:'fixed-response',name:'确定性协议测试'}];}
    async resolveModel(provider,model){return {provider,id:model,name:'确定性协议测试',context:{contextWindow:128000},defaultMaxTokens:4096,inputModalities:['text'],systemPromptUpdate:'in-history'};}
    async *stream(options){
      if(options.purpose){yield*text('提问与板书验证');return;}
      const stage=stages.get(options.sessionId)||0; stages.set(options.sessionId,stage+1);
      await appendFile(join(process.env.DSH_HOME,'question-fixture.jsonl'),JSON.stringify({stage,tools:options.tools?.map(t=>t.name),results:options.messages.filter(m=>m.role==='tool')})+'\n');
      if(stage===0){yield*call('confirm-study','ask_user_question',{questions:[{id:'focus',question:'今天先学哪一部分？',options:[{label:'导数'},{label:'向量'}]},{id:'needs',question:'希望保留哪些材料？',multi_select:true,options:[{label:'笔记'},{label:'板书'}]},{id:'time',question:'大概有多少时间？'}]});return;}
      if(stage===1){yield*call('save-board','write',{file_path:boardPath,content:board});return;}
      if(stage===2){yield*call('read-board','read',{file_path:boardPath});return;}
      yield*text('确认已收到。这是确定性协议测试，不代表教学效果。\n\n'+figure+'\n\n割线斜率是 $2+h$。\n\n[['+boardPath+'|本节板书]]');
    }
  }
  ctx.llm.registerAdapter(['notara-integration-fixture'],new Fixture());
}
