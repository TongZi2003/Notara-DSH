import {LlmAdapter} from '@deepseek-ai/dsh-llm';
import {PLANAR_SOURCE} from '../plugins/graph-and-blocks/test/planar-source.js';
export const inject=['llm'];
export function apply(ctx){
  const counts=new Map();
  class Fixture extends LlmAdapter{
    providerInfo(provider){return {id:provider,name:'几何构图协议验证'};}
    async listModels(provider){return [{provider,id:'fixed-response',name:'几何构图协议验证'}];}
    async resolveModel(provider,model){return {provider,id:model,name:'几何构图协议验证',context:{contextWindow:128000},defaultMaxTokens:2048,inputModalities:['text','image'],systemPromptUpdate:'in-history'};}
    async *stream(options){
      if(!options.purpose){const count=counts.get(options.sessionId)??0;counts.set(options.sessionId,count+1);if(count===0){
        const block={type:'tool-call',id:'draw-geometry',name:'excalidraw',arguments:JSON.stringify({action:'draw',path:'几何联动.excalidraw',expectedRevision:null,title:'三角形与圆',shapes:[{kind:'math',x:0,y:0,source:PLANAR_SOURCE}]})};
        yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'tool-call-delta',index:0,id:block.id,name:block.name,argumentsDelta:block.arguments};yield {type:'block-end',index:0,block};yield {type:'finish',reason:{kind:'tool-calls'}};return;
      }}
      const text=options.purpose?'几何联动验证':'拖动顶点，观察几何关系。\n\n```drawing\ndraw-geometry\n```\n\n这是固定协议验证，不代表真实教学效果。';
      yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text};yield {type:'block-end',index:0,block:{type:'text',text}};yield {type:'finish',reason:{kind:'stop'}};
    }
  }
  ctx.llm.registerAdapter(['notara-integration-fixture'],new Fixture());
}
