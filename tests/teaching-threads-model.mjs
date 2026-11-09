import {appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {LlmAdapter} from '@deepseek-ai/dsh-llm';
export const inject=['llm'];
function* answer(text){yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text};yield {type:'block-end',index:0,block:{type:'text',text}};yield {type:'finish',reason:{kind:'stop'}};}
function* call(id,name,args){const block={type:'tool-call',id,name,arguments:JSON.stringify(args)};yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'tool-call-delta',index:0,id,name,argumentsDelta:block.arguments};yield {type:'block-end',index:0,block};yield {type:'finish',reason:{kind:'tool-calls'}};}
export function apply(ctx){
  const stages=new Map();
  class Fixture extends LlmAdapter{
    providerInfo(provider){return {id:provider,name:'独立会话夹具'};}
    async listModels(provider){return [{provider,id:'fixed-response',name:'固定课堂'}];}
    async resolveModel(provider,model){return {provider,id:model,name:'固定课堂',context:{contextWindow:128000},defaultMaxTokens:4096,inputModalities:['text'],systemPromptUpdate:'in-history'};}
    async *stream(options){
      if(options.purpose){yield*answer('会话隔离实验');return;}
      await appendFile(join(process.env.DSH_HOME,'teaching-requests.jsonl'),JSON.stringify({id:options.sessionId,messages:options.messages})+'\n');
      const history=JSON.stringify(options.messages),last=options.messages.at(-1);
      const lastInput=options.messages.findLast(m=>['user','agent-message','notara-topic-handoff','subagent-settled'].includes(m.source?.kind));
      const stepKey=`${options.sessionId}:${lastInput?.id??'init'}`;
      const step=stages.get(stepKey)||0;

      const isOrganizerSession=options.messages.some(m=>m.source?.kind==='notara-topic-handoff'&&JSON.stringify(m.content).includes('ORGANIZER_HANDOFF'));

      // Stage 1 standalone material organizer flow
      if(isOrganizerSession){
        stages.set(stepKey,step+1);
        if(lastInput?.source?.kind==='subagent-settled'){
          const cardContent=[
            '---',
            'type: concept',
            'title: 导数符号与单调性',
            'tags:',
            '  - 微积分/导数',
            '---',
            '# 导数符号与单调性',
            '',
            '## 核心命题与适用条件',
            '- 在区间 $I$ 上若 $f\'(x)>0$，则 $f(x)$ 严格递增；驻点 $f\'(x_0)=0$ 不足以推出极值（如 $f(x)=x^3$）。',
          ].join('\n');
          if(step===0){yield*call('org-write-card','write',{file_path:'卡片/导数符号与单调性.md',content:cardContent});return;}
          if(step===1){yield*call('org-read-card','read',{file_path:'卡片/导数符号与单调性.md'});return;}
          if(step===2){
            const handoff=options.messages.find(m=>m.source?.kind==='notara-topic-handoff');
            yield*call('org-report-home','send_message',{agent_id:handoff.source.senderSessionId,message:'资料整理完成：已建立 [[卡片/导数符号与单调性.md]]，未启动测验。'});
            return;
          }
          yield*answer('## 整理清单\n- 新建概念卡：[[卡片/导数符号与单调性.md|导数符号与单调性]]（含驻点反例核对）\n\n本次仅完成资料整理，暂不出题。');
          return;
        }
        if(step===0){
          yield*call('org-worker','subagent',{
            preset:'worker-problem',
            description:'核对驻点反例',
            prompt:'WORKER_PROBLEM_CHECK：请核对 f(x)=x^3 在 x=0 导数为零但严格递增。',
            run_in_background:true,
          });
          return;
        }
        yield*answer('正在后台核对反例并整理卡片…');
        return;
      }

      if(history.includes('WORKER_PROBLEM_CHECK')){
        yield*answer('WORKER_PROBLEM_RAW_TRIGGER：f(x)=x^3 在 R 上严格递增，x=0 为驻点而非极值点。');
        return;
      }

      if(history.includes('ORGANIZER_CASE')){
        stages.set(stepKey,step+1);
        if(lastInput?.source?.kind==='agent-message'){
          yield*answer('ORGANIZER_HOME_INTERNAL_ACK');
          return;
        }
        if(step===0){
          yield*call('coord-read-profile-init','read',{file_path:'00-学习画像与偏好.md'});
          return;
        }
        if(step===1){
          const profile=[
            '---',
            'type: learner-profile',
            'title: 学习画像与偏好',
            '---',
            '# 学习画像与偏好',
            '',
            '- 当前节奏偏好：先整理课堂笔记，暂不出题测验。',
          ].join('\n');
          yield*call('coord-write-profile','write',{file_path:'00-学习画像与偏好.md',content:profile});
          return;
        }
        if(step===2){
          yield*call('coord-read-profile','read',{file_path:'00-学习画像与偏好.md'});
          return;
        }
        if(step===3){
          yield*call('create-organizer','subagent',{
            preset:'notara-material-organizer',
            description:'导数笔记整理',
            prompt:'ORGANIZER_HANDOFF：请整理函数单调性与导数符号课堂笔记，返回整理清单，不要启动提问。',
          });
          return;
        }
        yield*answer('资料整理会话已创建，可从会话列表查看整理清单。');
        return;
      }

      if(options.sessionId.startsWith('notara-topic-')){
        if(lastInput?.source?.kind==='subagent-settled'){yield*answer('两个讨论的子课堂已就绪。');return;}
        if(history.includes('请拆开讨论')&&!history.includes('两个讨论已创建')){
          const stage=stages.get(options.sessionId)||0;stages.set(options.sessionId,stage+1);
          if(stage<2){yield*call('child-'+stage,'subagent',{preset:'notara-teacher',description:stage?'学习率':'梯度累积',prompt:(stage?'B_OVERVIEW':'A_OVERVIEW')+'。前置：KNOWS_PYTHON'});return;}
          yield*answer('两个讨论已创建，可以分别继续。');return;
        }
        yield*answer('这间课堂可以独立继续。');return;
      }
      if(history.includes('A_OVERVIEW')||history.includes('B_OVERVIEW')){
        if(!history.includes('A_STUDENT_ANSWER'))await new Promise(resolve=>setTimeout(resolve,180));
        yield*answer(history.includes('A_STUDENT_ANSWER')?'这条回答留在梯度讨论中。':['我们围绕这个问题继续。','```flow','direction right','A[条件] --> B[?]','B --> C[结论]','```'].join('\n'));return;
      }
      if(last?.role==='tool'||history.includes('已新建普通对话')){yield*answer('专题对话已创建，可从会话列表继续。');return;}
      yield*call('create-topic','subagent',{preset:'notara-teacher',description:'训练循环专题',prompt:'TOPIC_OVERVIEW：学习训练循环。前置是Python基础，不预设PyTorch经验。'});
    }
  }
  ctx.llm.registerAdapter(['notara-integration-fixture'],new Fixture());
}
