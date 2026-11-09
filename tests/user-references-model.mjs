import {appendFile} from 'node:fs/promises';
import {watch,existsSync} from 'node:fs';
import {join} from 'node:path';
import {LlmAdapter} from '@deepseek-ai/dsh-llm';
export const inject=['llm'];
export function apply(ctx){
  class Fixture extends LlmAdapter{
    providerInfo(provider){return {id:provider,name:'引用显示夹具'};}
    async listModels(provider){return [{provider,id:'fixed-response',name:'引用协议夹具'}];}
    async resolveModel(provider,id){return {provider,id,name:'引用协议夹具',context:{contextWindow:128000},defaultMaxTokens:4096,inputModalities:['text'],systemPromptUpdate:'in-history'};}
    async *stream(options){
      if(!options.purpose)await appendFile(join(process.env.DSH_HOME,'reference-requests.jsonl'),JSON.stringify({id:options.sessionId,messages:options.messages})+'\n');
      const last=options.messages.filter(row=>row.role==='user').at(-1),hold=!options.purpose&&JSON.stringify(last).includes('HOLD_REFERENCE_QUEUE');
      const text=options.purpose?'引用显示验证':hold?'队列测试正在等待释放。':'请求已收悉。';
      yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text};
      if(hold)await new Promise((resolve,reject)=>{
        const release=join(process.env.DSH_HOME,'release-reference-queue');let watcher;
        const cleanup=()=>{watcher?.close();options.signal?.removeEventListener('abort',abort);};
        const abort=()=>{cleanup();reject(options.signal.reason);};
        watcher=watch(process.env.DSH_HOME,()=>{if(existsSync(release)){cleanup();resolve();}});
        options.signal?.addEventListener('abort',abort,{once:true});
        if(existsSync(release)){cleanup();resolve();}else if(options.signal?.aborted)abort();
      });
      yield {type:'block-end',index:0,block:{type:'text',text}};yield {type:'finish',reason:{kind:'stop'}};
    }
  }
  ctx.llm.registerAdapter(['notara-integration-fixture'],new Fixture());
}
