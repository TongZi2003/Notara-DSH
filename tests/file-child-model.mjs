import { LlmAdapter } from '@deepseek-ai/dsh-llm';
export const inject=['llm'];
function* text(value){yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:value};yield {type:'block-end',index:0,block:{type:'text',text:value}};yield {type:'finish',reason:{kind:'stop'}};}
export function apply(ctx){
  const steps=new Map();
  class Fixture extends LlmAdapter {
    providerInfo(provider){return {id:provider,name:'子课堂文件夹具'};}
    async listModels(provider){return [{provider,id:'fixed-response',name:'固定子课堂'}];}
    async resolveModel(provider,model){return {provider,id:model,name:'固定子课堂',context:{contextWindow:128000},defaultMaxTokens:4096,inputModalities:['text'],systemPromptUpdate:'in-history'};}
    async *stream(options){
      if(options.purpose){yield*text('文件引用课堂');return;}
      if(options.messages.some(message=>message.role==='user'&&JSON.stringify(message).includes('FILE_CHILD_FIXTURE'))){yield*text('文件已就绪：[[train.py|课堂代码]]；[[课堂笔记.md|课堂笔记]]。');return;}
      const step=steps.get(options.sessionId)||0;steps.set(options.sessionId,step+1);
      if(step===0){
        const block={type:'tool-call',id:'open-file-child',name:'subagent',arguments:JSON.stringify({preset:'notara-teacher',description:'文件引用课堂',prompt:'FILE_CHILD_FIXTURE：展示现有文件引用。'})};
        yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'tool-call-delta',index:0,id:block.id,name:block.name,argumentsDelta:block.arguments};yield {type:'block-end',index:0,block};yield {type:'finish',reason:{kind:'tool-calls'}};
      }else yield*text('文件引用课堂已打开。');
    }
  }
  ctx.llm.registerAdapter(['notara-integration-fixture'],new Fixture());
}
