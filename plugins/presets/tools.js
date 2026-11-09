import { defineTool } from '@deepseek-ai/dsh-tools';
import { registerCanvasTool } from './canvas-tool.js';
import { registerDrawingTool } from './drawing-tool.js';
import { registerLessonTool } from './lesson-tool.js';
import { registerSummaryTool } from './summary-tool.js';
import { registerFollowUpTool } from './followup-tool.js';
import { roleById, ROLES } from './catalog.js';
import { blindTask } from './isolation.js';
import { handoffOptions,prepareHandoff,childHandoffText } from './handoff-context.js';
import {assertHandoffPrompt,restoreHandoffRetry,imageRetryError} from './handoff-retry.js';
import { markAdjacentAgentSendMessageTool } from '@deepseek-ai/dsh-subagent/internal';

export const name = 'notara-delegation-tool';
export const inject = ['tools', 'subagents', 'agentPresets'];

function allowedTargetKinds(parentKind) {
  if (parentKind === 'coordinator') return ['teacher', 'organizer'];
  if (parentKind === 'organizer') return ['worker'];
  if (parentKind === 'teacher') return ['teacher', 'organizer', 'worker', 'companion', 'blind'];
  return [];
}

export function buildDelegation(parentId, args) {
  handoffOptions(args);
  const parent = roleById(parentId);
  if (parent.kind === 'coordinator' && args.run_in_background === true) throw new Error('Background delegation is disabled for notara-coordinator');
  const target = roleById(args.preset);
  if (!allowedTargetKinds(parent.kind).includes(target.kind)) {
    throw new Error(`Delegation from ${parent.id} to ${target.id} is not allowed`);
  }
  if (typeof args.description !== 'string' || !args.description.trim() || args.description.length > 240) throw new TypeError('description must contain 1–240 characters');
  if (target.kind === 'blind') {
    if (args.routePath !== undefined) throw new TypeError('Blind delegation rejects routePath');
    if (args.prompt !== undefined) throw new TypeError('Blind delegation rejects generic prompt/context; use problem and studentExplanation');
    return { target, prompt: blindTask({ problem: args.problem, studentExplanation: args.studentExplanation }) };
  }
  if (args.problem !== undefined || args.studentExplanation !== undefined) throw new TypeError('Blind fields require companion-deepseek-blind');
  assertHandoffPrompt(args.prompt);
  return { target, prompt: args.prompt };
}

export function apply(ctx, { preset }) {
  const parentRole = roleById(preset);
  registerSendMessage(ctx, preset);
  if(['teacher','coordinator'].includes(parentRole.kind))ctx.inject(['notaraVault','workspaceRegistry'],runtimeCtx=>{registerFollowUpTool(runtimeCtx,preset);});
  if (['teacher', 'coordinator', 'organizer'].includes(parentRole.kind)) ctx.inject(['notaraSummaryDeliveries'], runtimeCtx => { registerSummaryTool(runtimeCtx, preset); });
  if(['teacher','coordinator'].includes(parentRole.kind))ctx.inject(['notaraVault','workspaceRegistry'],runtimeCtx=>{registerCanvasTool(runtimeCtx,preset);registerDrawingTool(runtimeCtx,preset);if(parentRole.kind==='teacher')registerLessonTool(runtimeCtx,preset);});
  if (!['teacher', 'coordinator', 'organizer'].includes(parentRole.kind)) return;
  if(['teacher', 'organizer'].includes(parentRole.kind))ctx.tools.register(defineTool({
    name:'interrupt_agent',description:'请求中断当前会话名下正在运行的原生子任务，保留历史以便排查或继续。仅在用户要求停止或任务确需中止时使用；普通后台等待不需要中断。不能用 job_kill 停止子会话。',
    parameters:{agent_id:{type:'string',required:true}},
    output:{schema:{type:'object',additionalProperties:false,properties:{requested:{type:'boolean',required:true}}},render:()=>[{type:'text',text:'已请求中断；完成状态以原生会话通知为准。'}]},
    execute(args,exec){if(!exec.agent||ctx.agentPresets.composedPreset(exec.agent.ctx)!==preset)throw new Error('需要当前会话身份');exec.signal.throwIfAborted();ctx.subagents.interrupt(args.agent_id,{kind:'ancestor',agent:exec.agent});return {requested:true};},
  }));
  const backgroundEnabled = ['teacher', 'organizer'].includes(parentRole.kind);
  const targetKinds = allowedTargetKinds(parentRole.kind);
  const targets = ROLES.filter(role => targetKinds.includes(role.kind));
  const targetSummary = targets.map(role => `${role.id}（${role.name}：${role.description.replace(/。$/, '')}）`).join('；');
  ctx.tools.register(defineTool({
    name: 'subagent',
    description: `委派到指定角色，不继承当前对话历史。可选 preset：${targetSummary}。notara-teacher 与 companion-* 是面向学生的可继续会话（立即返回创建回执，不能当作同步备课工作员，只有创建成功才可请学生进入，正文 @伙伴 不会启动）；独立老师或首页可调用 notara-material-organizer 发起独立资料整理，内部子课堂应将整批整理范围交直接父老师发起。内部幕后协助使用 worker-*（无写入与再委派权限，单课备课仅用 worker-general 调研与 worker-review 审核）：当前轮需使用结果时省略 run_in_background（或设为 false）前台等待完整草案返回；run_in_background:true 仅返回后台启动回执，完成结果稍后经内部通知送达。切勿把“已创建子会话”当成已收到备课稿、文件已保存、完课或掌握。companion-deepseek-blind（盲测）仅传 problem 与 studentExplanation（及必要不含解析的原题图 parentImages），禁止传入答案、参考理解、routePath 或通用 prompt。`,
    parameters: {
      preset: { type: 'string', enum: targets.map(role => role.id), required: true },
      description: { type: 'string', required: true },
      prompt: { type: 'string', description: '首次委派的完整独立交接单：本次目标、资料定位、相关学情与未知边界；保留影响任务的完整学生原话、实际作答、已给的具体帮助和明确限制，不复制整段课堂。不能先发占位正文再补任务。图片重试用 retryOf 时省略，系统复用原文。盲测禁止传入。' },
      routePath: { type: 'string', description: '本任务明确所属的活跃 type: route 文件相对路径；已读取核实后才填写，不按修改时间猜测。没有关联可省略，盲测禁止。' },
      parentImages: { type: 'array', items: {type:'string'}, description: '本任务必要的图片引用：填写 read_image 可读的学习集图片路径或当前附件的只读路径；当前附件的唯一文件名也可用。系统核对后把实际图片附给接收者，不只传地址，不接受URL/base64。盲同学只能选择当前会话已有且不含解析的原题图。' },
      retryOf: {type:'string',description:'图片交接失败回执给出的原调用引用，例如 event:24。重试时保留 preset、description，提供更正后的 parentImages，省略 prompt/routePath 等原内容；系统从原生记录恢复完整交接。不能借重试换任务或删掉必要图片。'},
      problem: { type: 'string', description: '仅盲测：不含解析的原始题面。' },
      studentExplanation: { type: 'string', description: '仅盲测：学生本次真实讲解。' },
      ...backgroundEnabled ? { run_in_background: { type: 'boolean' } } : {},
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        kind: { type: 'string', enum: ['foreground', 'background', 'topic', 'continuable'], required: true },
        id: { type: 'string', required: true },
        preset: { type: 'string' },
        title: { type: 'string' },
        stopReason: { type: 'string' }, output: { type: 'array', items: { type: 'json' } },
      } },
      render: (_args, value) => [{ type: 'text', text: value.kind === 'topic' ? (value.preset === 'notara-material-organizer' ? `已新建独立资料整理会话「${value.title}」并发送交接消息，可从现有会话列表查看；本回执仅代表已交接，不代表文件已保存或整理完成。会话标识：${value.id}` : `已新建普通对话「${value.title}」并发送交接消息，可从现有会话列表继续；本回执不代表完课。会话标识：${value.id}`) : value.kind === 'background' ? `已后台启动内部子任务「${value.title}」（${value.preset ?? 'worker'}）。会话标识：${value.id}。当前仅代表已启动，尚未返回备课或核验产物；完成结果将由原生通知送达。` : value.kind === 'continuable' ? `已创建原生子会话「${value.title}」。会话标识：${value.id}。可继续发消息；本回执仅代表入口已就绪，尚不代表任务完成。` : JSON.stringify(value) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const parent = exec.agent;
      if (!parent || ctx.agentPresets.composedPreset(parent.ctx) !== preset) throw new Error('Delegation requires the matching live Notara parent preset');
      const retryKey=args.retryOf;
      args=restoreHandoffRetry(parent,args);
      const { target, prompt } = buildDelegation(preset, args);
      try {
      if (target.kind === 'organizer' || (target.kind === 'teacher' && parentRole.kind === 'coordinator')) {
        if (parent.session.header.origin === 'subagent') throw new Error('独立资料整理或专题会话须从主会话发起；请将资料范围与需求交给直接父老师代为创建。');
        const topics = ctx.get('notaraTopics');
        if (!topics) throw new Error('新对话服务暂时不可用，请重试');
        return await topics.start(parent, { ...args, preset: target.id }, retryKey??exec.callId, exec.signal,exec);
      }
      const prepared=await prepareHandoff(ctx,parent,args,exec.signal,exec);
      const request = { parent, agentPreset: target.id, prompt: [{ type: 'text', text: target.kind==='blind'?prompt:childHandoffText(parent.id,prompt,target,prepared) },...prepared.images], maxDepth: 2 };
      const interactive = ['teacher','companion'].includes(target.kind);
      const background = args.run_in_background === true;
      const run = await ctx.subagents.startActivation({provider:'spawn',label:args.description,request,signal:exec.signal,delivery:interactive || background ? 'parent' : 'caller'});
      if (interactive || background) return {kind:interactive?'continuable':'background',id:run.childId,preset:target.id,title:args.description};
      let cleanup;
      const dispose=()=>cleanup??=run.dispose();
      const cancel=()=>{void dispose().catch(()=>{});};
      exec.signal.addEventListener('abort',cancel,{once:true});if(exec.signal.aborted)cancel();
      const [result]=await Promise.allSettled([run.result]);
      exec.signal.removeEventListener('abort',cancel);
      const [disposal]=await Promise.allSettled([dispose()]);
      if(result.status==='rejected'&&disposal.status==='rejected')throw new AggregateError([result.reason,disposal.reason],'子任务与清理均失败');
      if(result.status==='rejected')throw result.reason;
      if(disposal.status==='rejected')throw disposal.reason;
      const value = result.value;
        // Native runs resolve failures as terminal values, not just rejections.
        // Match dsh-tool-subagent's foreground failure axis and partial text.
        if (value.stopReason !== 'completed') {
          const headline = { aborted: 'subagent run was cancelled', error: 'subagent run failed', 'max-tokens': 'subagent run hit its token limit before finishing', refusal: 'subagent declined the task' }[value.stopReason] ?? `subagent run ended abnormally (${String(value.stopReason)})`;
          const diagnostic = value.diagnostic === undefined ? '' : `\nDiagnostic: ${value.diagnostic}`;
          const partial = value.output.filter(block => block.type === 'text').map(block => block.text).join('');
          throw new Error(headline + diagnostic + (partial ? `\nPartial output before the run ended:\n${partial}` : ''));
        }
      return { kind: 'foreground', id: run.childId, preset: target.id, stopReason: value.stopReason, output: value.output };
      } catch(error) { throw imageRetryError(error,exec.callId,args,parent); }
    },
  }));
}

function registerSendMessage(ctx, preset) {
  const definition=defineTool({
    name:'send_message',description:'按需给相邻会话发消息。原生子智能体可联系直接父会话或子会话；普通工作会话与首页可沿创建关系或已保存交付回执中的精确会话对双向联系，不能仅因同属一个学习集就互发。纠错请说明具体原文定位、疑点或更正及依据，让原会话复核并补充。收到来信若决定回复，必须用此工具发给发送者；当前窗口的普通回复不会送达。归档或用户已停止的普通会话不能被来信恢复。告知无需自动致谢或循环回信；已投递不表示对方已回答、已更正或任务完成。',
    parameters:{agent_id:{type:'string',required:true,description:'使用创建回执、交接来源或交付回执中宿主返回的 senderSessionId / recipientSessionId，不猜测其他会话身份。'},message:{type:'string',required:true,description:'要发送的内容，按需要说明进展、问题或补充信息。'}},
    output:{schema:{type:'object',additionalProperties:false,properties:{messageId:{type:'string',required:true}}},render:()=>[{type:'text',text:'消息已投递。'}]},
    async execute(args,exec){
      const sender=exec.agent;
      if(!sender||ctx.agentPresets.composedPreset(sender.ctx)!==preset)throw new Error('需要当前会话身份');
      if(!args.message.trim()||args.message.length>12000)throw new Error('消息须为1–12000字');
      const target=ctx.get('agents')?.get(args.agent_id);
      const snapshot=target?{session:target.session.header,events:target.session.snapshotEvents()}:await ctx.get('sessionQuery')?.readSession(args.agent_id);
      const targetPreset=snapshot?.events.filter(e=>e.type==='agent-preset/selected').at(-1)?.data.agentPreset??snapshot?.session.agentPreset;
      if(targetPreset==='companion-deepseek-blind')throw new Error('盲测不接受通用追加上下文；重新提交原题和学生本次讲解。');
      const topics=ctx.get('notaraTopics');
      if(sender.session.header.origin!=='subagent'&&snapshot?.session.origin!=='subagent'){
        if(!topics)throw new Error('普通会话通信服务不可用');
        return topics.send(sender,args.agent_id,args.message,exec.callId,exec.signal);
      }
      return {messageId:await ctx.subagents.sendMessage(sender,args.agent_id,[{type:'text',text:args.message}],{signal:exec.signal})};
    },
  });
  // In rc.4 this marker requests worker-style mandatory first-turn delivery
  // guidance. Interactive peers retain the same native send/settlement APIs,
  // but decide with the student whether there is anything to send back.
  ctx.tools.register(roleById(preset).kind==='companion'?definition:markAdjacentAgentSendMessageTool(definition));
}
