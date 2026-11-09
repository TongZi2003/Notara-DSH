import {appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {LlmAdapter} from '@deepseek-ai/dsh-llm';
import {setTimeout as delay} from 'node:timers/promises';
export const inject=['llm'];
function* answer(text){yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text};yield {type:'block-end',index:0,block:{type:'text',text}};yield {type:'finish',reason:{kind:'stop'}};}
function* call(id,args){const block={type:'tool-call',id,name:'subagent',arguments:JSON.stringify(args)};yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'tool-call-delta',index:0,id,name:'subagent',argumentsDelta:block.arguments};yield {type:'block-end',index:0,block};yield {type:'finish',reason:{kind:'tool-calls'}};}
export function apply(ctx){
  const sent=new Set();
  class Fixture extends LlmAdapter{
    providerInfo(provider){return {id:provider,name:'同学邀请协议夹具'};}
    async listModels(provider){return [{provider,id:'fixed-response',name:'确定性同学试用'}];}
    async resolveModel(provider,id){return {provider,id,name:'确定性同学试用',context:{contextWindow:128000},defaultMaxTokens:4096,inputModalities:['text'],systemPromptUpdate:'in-history'};}
    async *stream(options){
      if(options.purpose){yield*answer('同学邀请验证');return;}
      await appendFile(join(process.env.DSH_HOME,'companion-requests.jsonl'),JSON.stringify({id:options.sessionId,messages:options.messages,tools:(options.tools??[]).map(t=>t.name)})+'\n');
      const history=JSON.stringify(options.messages.filter(m=>m.role==='user')),lastUser=JSON.stringify(options.messages.filter(m=>m.role==='user').at(-1));
      if(history.includes('CLASSMATE_QUESTION')){if(lastUser.includes('换个例子')){await delay(900,undefined,{signal:options.signal});await appendFile(join(process.env.DSH_HOME,'companion-reply-complete'),options.sessionId+'\n');}yield*answer(lastUser.includes('换个例子')?'同学继续：例如 $x=2$ 时，斜率为 $4$。':'同学回答：对 $y=x^2$，在 $x=1$ 处的切线斜率为 $2$。');return;}
      if(history.includes('BLIND_STUDENT_WORDS')){yield*answer('大肥鱼追问：你说的“越来越近”，是哪两个量越来越近？');return;}
      if(history.includes('WORKER_NOTE')){yield*answer('核验记录：计算一致。');return;}
      const preset=lastUser.includes('再请核验员')?'worker-problem':/preset=(companion-[a-z-]+)/.exec(lastUser)?.[1],key=options.sessionId+lastUser;
      if(preset&&!sent.has(key)){
        sent.add(key);
        yield*call('invite-'+sent.size,preset==='worker-problem'?{preset,description:'核验计算',prompt:'WORKER_NOTE：核验这个计算。'}:preset.endsWith('-blind')?{preset,description:'不看解析听讲',problem:'原题：求 y=x^2 在 x=1 处的导数。',studentExplanation:'BLIND_STUDENT_WORDS：我想用平均变化率。'}:{preset,description:'一起看切线',prompt:'CLASSMATE_QUESTION：请解释 y=x^2 在 x=1 处的切线斜率，给出自己的思路。'});return;
      }
      yield*answer(preset?'已邀请同学，可从活动中展开会话继续。':'课堂历史中的教师解析：TEACHER_HISTORY_SECRET。');
    }
  }
  ctx.llm.registerAdapter(['notara-integration-fixture'],new Fixture());
}
