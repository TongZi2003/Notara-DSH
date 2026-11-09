import {LlmAdapter} from '@deepseek-ai/dsh-llm';
export const inject=['llm'];
export function apply(ctx){
  const counts=new Map();
  class Fixture extends LlmAdapter{
    providerInfo(provider){return {id:provider,name:'数学共绘协议验证'};}
    async listModels(provider){return [{provider,id:'fixed-response',name:'数学共绘协议验证'}];}
    async resolveModel(provider,model){return {provider,id:model,name:'数学共绘协议验证',context:{contextWindow:128000},defaultMaxTokens:2048,inputModalities:['text','image'],systemPromptUpdate:'in-history'};}
    async *stream(options){
      if(!options.purpose){const count=counts.get(options.sessionId)??0;counts.set(options.sessionId,count+1);if(count===0){const block={type:'tool-call',id:'show-math-board',name:'excalidraw',arguments:JSON.stringify({action:'show',path:'数学共绘.excalidraw'})};yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'tool-call-delta',index:0,id:block.id,name:block.name,argumentsDelta:block.arguments};yield {type:'block-end',index:0,block};yield {type:'finish',reason:{kind:'tool-calls'}};return;}}
      const text=options.purpose?'数学共绘验证':'先观察这张图，再动手调整。\n\n```drawing\nshow-math-board\n```\n\n这是固定协议验证，不代表真实教学效果。';
      yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text};yield {type:'block-end',index:0,block:{type:'text',text}};yield {type:'finish',reason:{kind:'stop'}};
    }
  }
  ctx.llm.registerAdapter(['notara-integration-fixture'],new Fixture());
}
