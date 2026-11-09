import {LlmAdapter} from '@deepseek-ai/dsh-llm';
import {access,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
export const inject=['llm'];

// Each stage pauses until the browser has checked this exact streaming frame.
// Signals live only in the isolated harness's DSH_HOME, never the learning set.
export const chunks=[
  '流式开头 $x^2$ 与 \\(y+1\\)。\n\n第一阶段正文仍在生成。\n\n',
  '$$\\begin{aligned}\na&=1\\\\\n\nb&=2\\\\\n\nc&=3',
  '\\end{aligned}\n$',
  '$\n\n闭合之后继续正文。未完成命令 $\\fra',
  'c{1}{2}$。\n\n行内代码 `$literal$`。\n\n```tex\n$$code_formula$$\n\n$also_code$\n',
  '```\n\n最后正文仍在生成。',
];
export const response=chunks.join('');

export function apply(ctx){
  class StreamingMathFixture extends LlmAdapter{
    providerInfo(provider){return {id:provider,name:'流式数学回归'};}
    async listModels(provider){return [{provider,id:'fixed-response',name:'固定流式公式'}];}
    async resolveModel(provider,id){return {provider,id,name:'固定流式公式',context:{contextWindow:128000},defaultMaxTokens:4096,inputModalities:['text'],systemPromptUpdate:'in-history'};}
    async *stream(options){
      const checkHistory=!options.purpose&&JSON.stringify(options.messages.filter(message=>message.role==='user')).includes('核对保存的流式原文');
      if(checkHistory){
        const exact=options.messages.filter(message=>message.role==='assistant').some(message=>message.content.filter(block=>block.type==='text').map(block=>block.text).join('')===response);
        await writeFile(join(process.env.DSH_HOME,'streaming-math-history.json'),JSON.stringify({exact}));
      }
      const finalText=options.purpose?'流式公式验证':checkHistory?'原文已核对。':response;
      yield {type:'block-start',index:0,blockType:'text'};
      if(options.purpose||checkHistory)yield {type:'text-delta',index:0,text:finalText};
      else for(let stage=0;stage<chunks.length;stage++){
        options.signal?.throwIfAborted();
        yield {type:'text-delta',index:0,text:chunks[stage]};
        await writeFile(join(process.env.DSH_HOME,`streaming-math-ready-${stage}`),'ready');
        const deadline=Date.now()+30000;
        while(!await access(join(process.env.DSH_HOME,`streaming-math-next-${stage}`)).then(()=>true,()=>false)){
          if(Date.now()>deadline)throw new Error('Streaming math browser did not release stage '+stage);
          await delay(25,undefined,{signal:options.signal});
        }
      }
      yield {type:'block-end',index:0,block:{type:'text',text:finalText}};
      yield {type:'finish',reason:{kind:'stop'}};
    }
  }
  ctx.llm.registerAdapter(['notara-integration-fixture'],new StreamingMathFixture());
}
