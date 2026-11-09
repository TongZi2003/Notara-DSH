import {writeFile,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {LlmAdapter} from '@deepseek-ai/dsh-llm';
export const inject=['llm'];
function* answer(text){yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text};yield {type:'block-end',index:0,block:{type:'text',text}};yield {type:'finish',reason:{kind:'stop'}};}
function* call(id,name,args){const block={type:'tool-call',id,name,arguments:JSON.stringify(args)};yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'tool-call-delta',index:0,id,name,argumentsDelta:block.arguments};yield {type:'block-end',index:0,block};yield {type:'finish',reason:{kind:'tool-calls'}};}
export function apply(ctx){
  const phases=new Map();
  class Fixture extends LlmAdapter {
    providerInfo(provider){return {id:provider,name:'通信回归'};}
    async listModels(provider){return [{provider,id:'fixed-response',name:'通信回归'}];}
    async resolveModel(provider,model){return {provider,id:model,name:'通信回归',context:{contextWindow:128000},defaultMaxTokens:4096,inputModalities:['text'],systemPromptUpdate:'in-history'};}
    async *stream(options){
      if(options.purpose){yield*answer('通信验证');return;}
      await appendFile(join(process.env.DSH_HOME,'communication-requests.jsonl'),JSON.stringify({sessionId:options.sessionId,messages:options.messages})+'\n');
      const input=options.messages.findLast(m=>['user','agent-message','notara-topic-handoff','subagent-settled'].includes(m.source?.kind));
      const text=input?.content.filter(b=>b.type==='text').map(b=>b.text).join('')??'';
      const key=options.sessionId+input?.id,phase=phases.get(key)??0;phases.set(key,phase+1);
      const history=JSON.stringify(options.messages);
      const topic=options.sessionId.startsWith('notara-topic-');

      // Continuable child notara-teacher sub-classroom binding its own lesson plan
      if(history.includes('SUBCLASS_REMEDIAL_HANDOFF')&&!topic){
        const childPhase=phases.get(`${options.sessionId}:init`)??0;
        phases.set(`${options.sessionId}:init`,childPhase+1);
        if(childPhase===0){
          yield*call('subclass-bind','lesson_plan',{action:'bind',path:'备课/商法则补救小课.md'});
          return;
        }
        await writeFile(join(process.env.DSH_HOME,'subclass-ready.json'),JSON.stringify({childSessionId:options.sessionId}));
        yield*answer('SUBCLASS_TEACHER_READY：请无提示写出 (u/v) 求导的分子符号。');
        return;
      }

      // Stage 5 post-lesson closure & route update scenario
      if(history.includes('CLOSURE_CASE')||history.includes('CLOSURE_CLASSROOM_HANDOFF')||history.includes('CLOSURE_DELIVERY')){
        if(!topic&&input?.source?.kind==='user'){
          if(!phase){
            yield*call('closure-create','subagent',{
              preset:'notara-teacher',
              description:'极值点偏移课堂',
              prompt:'CLOSURE_CLASSROOM_HANDOFF：请围绕备课/极值点偏移第一课.md 开展教学。',
            });
            return;
          }
          yield*answer('极值点偏移课堂已建立，可从左侧进入课堂。');
          return;
        }
        if(topic&&input?.source?.kind==='notara-topic-handoff'){
          yield*answer('欢迎进入极值点偏移第一课，我们先从对称差构造函数设元开始。');
          return;
        }
        if(topic&&input?.source?.kind==='subagent-settled'){
          yield*answer('补救子课堂已准备就绪，你可以进入作答。');
          return;
        }
        if(topic&&text.includes('开启商法则补救子课堂')){
          if(!phase){
            yield*call('spawn-subclass','subagent',{
              preset:'notara-teacher',
              description:'商法则补救小课',
              prompt:'SUBCLASS_REMEDIAL_HANDOFF：请关联 备课/商法则补救小课.md 并发起无提示符号复测。',
            });
            return;
          }
          yield*answer('已开启商法则补救子课堂。');
          return;
        }
        if(topic&&text.includes('先想一下商法则')){
          // Mid-lesson pause waiting on student: must NOT report to coordinator!
          yield*answer('好的，你先独立推导商法则分子符号，想好随时发我。');
          return;
        }
        if(topic&&text.includes('今天先下课')){
          if(phase===0){
            yield*call('teacher-read-lesson','read',{file_path:'备课/极值点偏移第一课.md'});
            return;
          }
          if(phase===1){
            const summarySection=[
              '</details>',
              '',
              '## 本节总结与下次续接',
              '- 学生独立完成：对称差构造函数设元',
              '- 提示后完成：商法则分子求导（独立作答时分子负号出错）',
              '- 尚未检查与暴露缺口：商法则分子符号独立检验、含参讨论尚未检查',
              '- 下次起点建议：先无提示复测商法则分子符号，再进入含参讨论',
            ].join('\n');
            yield*call('teacher-save-summary','edit',{
              file_path:'备课/极值点偏移第一课.md',
              old_string:'</details>',
              new_string:summarySection,
            });
            return;
          }
          if(phase===2){
            yield*call('teacher-verify-summary','read',{file_path:'备课/极值点偏移第一课.md'});
            return;
          }
          if(phase===3){
            const handoff=options.messages.find(m=>m.source?.kind==='notara-topic-handoff');
            yield*call('teacher-deliver-summary','send_message',{
              agent_id:handoff.source.senderSessionId,
              message:'CLOSURE_DELIVERY：本课结束。已保存总结 [[备课/极值点偏移第一课.md#本节总结与下次续接]]；另附未落盘草稿 [[备课/不存在的伪造总结.md]] 供核验。',
            });
            return;
          }
          yield*answer('本节总结已保存至 [[备课/极值点偏移第一课.md|极值点偏移第一课]]，也可查看 [[路线/导数突破路线.md|导数突破路线]]。');
          return;
        }
        if(!topic&&input?.source?.kind==='agent-message'&&text.includes('CLOSURE_DELIVERY')){
          if(phase===0){
            yield*call('coord-verify-real','read',{file_path:'备课/极值点偏移第一课.md'});
            return;
          }
          if(phase===1){
            yield*call('coord-verify-fake','read',{file_path:'备课/不存在的伪造总结.md'});
            return;
          }
          if(phase===2){
            yield*call('coord-read-profile-init','read',{file_path:'00-学习画像与偏好.md'});
            return;
          }
          if(phase===3){
            const profile=[
              '---',
              'type: learner-profile',
              'title: 学习画像与偏好',
              '---',
              '# 学习画像与偏好',
              '',
              '- 已证实表现：对称差构造函数设元可独立写出。',
              '- 当前暴露卡点：商法则分子求导仍依赖提示，负号易反（依据：[[备课/极值点偏移第一课.md#本节总结与下次续接]]）。',
            ].join('\n');
            yield*call('coord-update-profile','write',{file_path:'00-学习画像与偏好.md',content:profile});
            return;
          }
          if(phase===4){
            yield*call('coord-read-route-init','read',{file_path:'路线/导数突破路线.md'});
            return;
          }
          if(phase===5){
            const updatedRoute=[
              '---',
              'type: route',
              'title: 导数突破路线',
              'status: active',
              'lessons:',
              '  - 备课/极值点偏移第一课.md',
              '---',
              '# 导数突破路线',
              '',
              '## 里程碑',
              '- [x] 里程碑 1：极值点偏移对称构造与求导校验 ^ms1',
              '  - 关联课堂：[[备课/极值点偏移第一课]]',
              '  - 校验依据：无提示独立完成对称差函数求导与符号判别',
              '  - 已有证据：[[备课/极值点偏移第一课#本节总结与下次续接|第一课课后总结]]（设元独立完成，商法则提示后完成）',
              '  - 待补内容：商法则分子符号尚未无提示独立通过',
              '',
              '## 下一步行动',
              '- [x] 当前下一步：进入 [[备课/极值点偏移第一课]] 完成首轮训练',
              '- [ ] 当前下一步：围绕 [[备课/极值点偏移第一课]] 无提示复测商法则分子符号',
            ].join('\n');
            yield*call('coord-update-route','write',{file_path:'路线/导数突破路线.md',content:updatedRoute});
            return;
          }
          if(phase===6){
            yield*call('coord-readback-route','read',{file_path:'路线/导数突破路线.md'});
            return;
          }
          await writeFile(join(process.env.DSH_HOME,'closure-finished.json'),JSON.stringify({ok:true}));
          yield*answer('CLOSURE_COORDINATOR_INTERNAL_DONE');
          return;
        }
      }

      if(!topic&&input?.source?.kind==='user'){
        if(!phase){yield*call('create','subagent',{preset:'notara-teacher',description:'通信专题',prompt:'通信测试课堂，开始正常教学。'});return;}
        yield*answer('专题已准备好。');return;
      }
      if(!topic&&input?.source?.kind==='agent-message'){
        if(!phase){yield*call('peer-reply','send_message',{agent_id:input.source.senderSessionId,message:'内部备课问题：请核对下一课答案。'});return;}
        yield*answer('HOME_PRIVATE_PREPARATION');return;
      }
      if(topic&&input?.source?.kind==='agent-message'){
        if(!phase){yield*call('private-read','read',{file_path:'PRIVATE_TOOL_FILE.md'});return;}
        yield*answer('TEACHER_PRIVATE_ANSWER_42');
        await writeFile(join(process.env.DSH_HOME,'communication-finished.json'),JSON.stringify({topicId:options.sessionId}));return;
      }
      if(topic&&text.includes('把发现告诉首页')){
        if(!phase){const handoff=options.messages.find(m=>m.source?.kind==='notara-topic-handoff');yield*call('tell-home','send_message',{agent_id:handoff.source.senderSessionId,message:'课堂发现，请讨论下一课。'});return;}
        yield*answer('已把这条发现发给首页。');return;
      }
      yield*answer(text.includes('学生继续')?'STUDENT_VISIBLE_FOLLOWUP':'STUDENT_VISIBLE_LESSON');
    }
  }
  ctx.llm.registerAdapter(['notara-integration-fixture'],new Fixture());
}
