import {appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {LlmAdapter} from '@deepseek-ai/dsh-llm';
export const inject=['llm'];
export function apply(ctx){
  class FixtureAdapter extends LlmAdapter {
    providerInfo(provider){return {id:provider,name:'技能显示测试'};}
    async listModels(provider){return [{provider,id:'fixed-response',name:'技能显示测试'}];}
    async resolveModel(provider,id){return {provider,id,name:'技能显示测试',context:{contextWindow:128000},defaultMaxTokens:4096,inputModalities:['text'],systemPromptUpdate:'in-history'};}
    async *stream(options){
      options.signal?.throwIfAborted();
      await appendFile(join(process.env.DSH_HOME,'skill-display-requests.jsonl'),JSON.stringify({purpose:options.purpose,messages:options.messages})+'\n');
      const text=options.purpose?'技能显示测试':'技能引用测试完成。';
      yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text};yield {type:'block-end',index:0,block:{type:'text',text}};yield {type:'finish',reason:{kind:'stop'}};
    }
  }
  ctx.llm.registerAdapter(['notara-integration-fixture'],new FixtureAdapter());
}
