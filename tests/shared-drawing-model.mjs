import {LlmAdapter} from '@deepseek-ai/dsh-llm';
export const inject=['llm'];
export function apply(ctx){
  class DrawingFixture extends LlmAdapter{
    providerInfo(provider){return {id:provider,name:'共绘测试'};}
    async listModels(provider){return [{provider,id:'fixed-response',name:'共绘测试'}];}
    async resolveModel(provider,model){return {provider,id:model,name:'共绘测试',context:{contextWindow:128000},defaultMaxTokens:1024,inputModalities:['text','image'],systemPromptUpdate:'in-history'};}
    async *stream(options){
      const text=JSON.stringify(options.messages??[]),images=(text.match(/"type":"image"/g)??[]).length;
      const body=options.purpose?'共绘测试课堂':images?'已收到画布快照图片和版本说明。':'我们开始共绘。';
      yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:body};yield {type:'block-end',index:0,block:{type:'text',text:body}};yield {type:'finish',reason:{kind:'stop'}};
    }
  }
  ctx.llm.registerAdapter(['notara-integration-fixture'],new DrawingFixture());
}
