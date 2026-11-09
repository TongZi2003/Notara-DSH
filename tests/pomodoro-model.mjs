import {appendFile} from 'node:fs/promises';import {join} from 'node:path';
import {LlmAdapter} from '@deepseek-ai/dsh-llm';
export const inject=['llm','schedule'];
export function apply(ctx){
  const original=ctx.schedule.create.bind(ctx.schedule);
  // Test-only acceleration. Production always uses real classroom minutes.
  ctx.schedule.create=(sessionId,request,...rest)=>original(sessionId,request.title.startsWith('课堂番茄钟')?{...request,at:new Date(Date.now()+2500).toISOString()}:request,...rest);
  ctx.effect(()=>()=>{ctx.schedule.create=original;});
  class Fixture extends LlmAdapter{
    providerInfo(provider){return {id:provider,name:'时钟验证'};}
    async listModels(provider){return [{provider,id:'fixed-response',name:'时钟验证'}];}
    async resolveModel(provider,id){return {provider,id,name:'时钟验证',context:{contextWindow:128000},defaultMaxTokens:4096,inputModalities:['text'],systemPromptUpdate:'in-history'};}
    async *stream(options){
      if(!options.purpose)await appendFile(join(process.env.DSH_HOME,'pomodoro-requests.jsonl'),JSON.stringify({id:options.sessionId,messages:options.messages})+'\n');
      const content=JSON.stringify(options.messages),text=options.purpose?(content.includes('课堂B')?'课堂B':'课堂A'):content.includes('notara-pomodoro:v1')?'课堂节奏已调整，请按当前进度继续。':'老师已经收到消息。';
      yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text};yield {type:'block-end',index:0,block:{type:'text',text}};yield {type:'finish',reason:{kind:'stop'}};
    }
  }
  ctx.llm.registerAdapter(['notara-integration-fixture'],new Fixture());
}
