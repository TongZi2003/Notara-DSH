import {defineTool} from '@deepseek-ai/dsh-tools';

export function registerFollowUpTool(ctx,preset){
 ctx.tools.register(defineTool({
  name:'learning_followup',
  description:'读取或安排“下次可以继续”。先把真实学习经过写入已有卡片或日记；本工具只保存具体续接内容与时间，不确认学生作答、不宣告掌握。read 只传 action/path，返回该文件各主题的当前安排和 revision；plan 自主选择 afterDays（0表示今天），写明 question 与 reason；clear 表示该回访已无需安排，普通仅记笔记无需调用。日记的 plan/clear 必须指定唯一 heading，各小节分别排期。日期、工作区与记录身份由宿主绑定；旧排期保留到显式调整。due 列出当前学习集到期候选供长期教师统筹，不自动开启课堂。',
  parameters:{
   action:{type:'string',enum:['read','due','plan','clear'],required:true},
   path:{type:'string',description:'read/plan/clear：当前学习集内已存在的卡片或日记.md路径。'},
   heading:{type:'string',description:'仅日记的 plan/clear 必填，不带#。plan 使用已保存且唯一的实际标题；clear 使用 read 返回的安排标题，原小节改名或删除后仍可取消。read/due 不填；卡片省略。'},
   expectedRevision:{type:'string',description:'plan/clear必填，来自最近 learning_followup read 的 revision；冲突后重读并重新判断，不盲目覆盖。'},
   question:{type:'string',description:'plan必填：下次可继续的具体问题或动作，不是笼统的复习卡片。'},
   afterDays:{type:'integer',description:'plan必填：结合实际学情选择几天后回来，非负整数，不套固定梯度。'},
   reason:{type:'string',description:'plan必填：本次安排的简短实际依据。'},
   offset:{type:'integer',description:'仅due：返回有更多候选时从下一偏移继续读取。'},
  },
  output:{schema:{type:'object',additionalProperties:false,properties:{result:{type:'string',required:true}}},render:(_args,value)=>[{type:'text',text:value.result}]},
  async execute(args,exec){
   const allowed={read:['action','path'],due:['action','offset'],plan:['action','path','heading','expectedRevision','question','afterDays','reason'],clear:['action','path','heading','expectedRevision']};
   const check=()=>{exec.signal.throwIfAborted();if(!exec.agent||!['notara-teacher','notara-coordinator'].includes(preset)||ctx.agentPresets.composedPreset(exec.agent.ctx)!==preset)throw Error('followup_role_required: 需要真实老师会话');};
   check();if(!allowed[args.action]||Object.keys(args).some(key=>args[key]!==undefined&&!allowed[args.action].includes(key)))throw Error('followup_action_fields: 请只填写当前动作的参数');
   const workspace=await ctx.workspaceRegistry.resolveByPath(exec.agent.session.header.cwd);check();if(!workspace)throw Error('followup_workspace_required');
   const vault=ctx.notaraVault,workspaceId=workspace.id;
   if(args.action==='due'){const result=await vault.query({workspaceId,reviewStatus:'due',sort:'due',limit:100,offset:args.offset??0});check();return {result:JSON.stringify(result)};}
   if(typeof args.path!=='string'||!args.path.endsWith('.md'))throw Error('followup_path_required: 请指定真实的卡片或日记.md');
   const [{parseMarkdown},{reviewPlans}]=await Promise.all([import('@oh-my-student/plugin-vault-sqlite/frontmatter'),import('@oh-my-student/plugin-vault-sqlite/review-schedule')]);
   const snapshot=async()=>{const doc=await vault.read({workspaceId,path:args.path});check();const fields=parseMarkdown(doc.content).fields;return {path:doc.path,revision:doc.revision,plans:reviewPlans(fields)};};
   if(args.action==='read')return {result:JSON.stringify(await snapshot())};
   if(typeof args.expectedRevision!=='string'||!args.expectedRevision)throw Error('followup_revision_required: 先 learning_followup read 获取 revision');
   try{
    await vault.scheduleReview({workspaceId,path:args.path,...args.heading?{heading:args.heading}:{},expectedRevision:args.expectedRevision,requestId:`${exec.agent.id}:${exec.callId}`,followUp:args.action==='clear'?null:{afterDays:args.afterDays,question:args.question,reason:args.reason}});check();
    return {result:JSON.stringify({...await snapshot(),saved:true})};
   }catch(error){
    if(error.message==='vault_revision_conflict')throw Error('vault_revision_conflict: 文件已变化，请 learning_followup read 后核对新内容，再决定是否改期');
    if(/review_heading/.test(error.message))throw Error(`${error.message}: 日记需要唯一、已保存的真实标题；卡片不填heading`);
    throw error;
   }
  }
 }));
}
