import { roleById } from './catalog.js';
import { readReviewContext } from './review-context.js';
import { readLearningContext } from './learning-context.js';
import { readWhiteboardContexts } from './whiteboard-context.js';

export const name = 'notara-preset-prompt';
export const inject = ['systemPrompt'];

function runtimeContract(role) {
  if (role.kind === 'blind') return '';
  const lines = [
    '\n\n## 当前 DSH 工具合同',
    '文件工具使用实际公布的 schema（文件路径参数名为 file_path）。学生从阅读器带入 PDF 时，页码/选区通过原生图片附件提供并保留来源定位与版本；只根据实际收到的图片说明该页或选区内容。当前原生 read 不支持 PDF page/rect 图像读取参数；只有定位文字、没有图片时，不得声称已查看原页。',
  ];
  if (['teacher', 'coordinator'].includes(role.kind)) {
    lines.push('工具列表提供 ask_user_question 时，仅用于模糊疑问、学习目标、范围或偏好的简短澄清（纯文本问题与选项，不替学生预选，空答案或取消不等于同意）；数学推导、练习作答与费曼讲解留在对话正文，不放进确认框。被父智能体持有的子会话不能调用原生提问。');
    lines.push('学生通过 / 命令启用白板教学后，宿主绑定本会话 .canvas 文件并提供 notara-whiteboard Skill，按其持续组织板书；仅查阅 Skill 或读取 references/drawing.md 不等于已启用白板。');
  }
  if (['teacher', 'coordinator', 'organizer'].includes(role.kind)) {
    lines.push('专题、资料整理会话与子会话均复用原生可恢复会话。source 为 agent-message 的来信由其他会话发出，决定回答时必须调用 send_message 发给消息中标明的发送者，当前窗口正文不会送达；告知类消息无需自动回复，发送失败不得声称已送达。subagent-settled 仅表示子任务本轮运行结束，不代表完课或学生已掌握；没有 classroom(complete) 或 notara.classroom-result.v1 事件。');
  }
  if (role.kind === 'companion') {
    lines.push('同学交流由学生发起。老师交接的材料和进度只作背景，你在当前同学会话直接与学生提问、回应和探索，问完留给学生接话；普通告知和完成通知无需回复或逐轮向老师回报。学生想带回结论或确有会话协调事项时，再用 send_message 联系真实发起会话，不能用本地正文冒充已送达。你不能再次委派，也不提供 write/edit；需要保存的新认识交老师按实际贡献记录。');
  }
  if (role.kind === 'worker') {
    lines.push('当前角色不能再次委派，也不提供 write/edit；需要保存的内容必须在最终回复中作为完整可核查草案（或准确的已存在文件定位）交还发起任务的老师或整理会话，不能只回“完成了”。');
  }
  if (['teacher', 'coordinator', 'worker'].includes(role.kind)) {
    lines.push('Bash 返回 background/promoted 与 jobId 时，用本会话的 job_output({job_id:jobId,wait:true}) 读取增量结果，按实际状态与退出码判断是否完成；仅需停止该脚本时用 job_kill。内部工作员收齐本任务脚本结果后再交付，父会话不能代读其 Job；智能体会话与 Bash Job 身份不混用。');
  }
  return lines.join('\n');
}

async function readLessonBindingsContext(ctx, { agent, scope, signal }) {
  const target = agent ?? scope;
  if (!target || (agent && scope && scope !== agent) || !target.session?.header?.cwd) return null;
  const vault = ctx.get('notaraVault'), registry = ctx.get('workspaceRegistry');
  if (!vault?.lessonBindings || !registry?.resolveByPath) return null;
  try {
    signal?.throwIfAborted();
    const workspace = await registry.resolveByPath(target.session.header.cwd);
    signal?.throwIfAborted();
    if (!workspace?.id) return null;
    const { bindings = [] } = await vault.lessonBindings({ workspaceId: workspace.id }) ?? {};
    signal?.throwIfAborted();
    if (!Array.isArray(bindings) || bindings.length === 0) return null;
    const rows = bindings.slice(0, 12).map(item => JSON.stringify({
      sessionId: item.sessionId,
      path: item.path,
      title: item.title,
      missing: Boolean(item.missing),
      progressLabel: item.progressLabel ?? '',
      currentTask: item.currentTask?.content ?? null,
      nextTask: item.nextTask?.content ?? null,
      updatedAt: item.updatedAt,
    }));
    return {
      name: 'notara-lesson-bindings',
      interpolate: false,
      text: '当前学习集内活跃课堂与备课本（type: lesson）只读关联快照，仅供首页续接已有课堂（send_message(agent_id:sessionId,...)）或核对路线进展使用；首页不提供 lesson_plan 工具，也不代替课堂老师修改本课任务。\n' + rows.join('\n'),
    };
  } catch (error) {
    signal?.throwIfAborted();
    return null;
  }
}

async function readTeacherLessonPlanContext(ctx, { agent, scope, signal }) {
  const target = agent ?? scope;
  if (!target || (agent && scope && scope !== agent) || !target.session?.header?.cwd) return null;
  const vault = ctx.get('notaraVault'), registry = ctx.get('workspaceRegistry');
  if (!vault?.lessonPlan || !registry?.resolveByPath) return null;
  try {
    signal?.throwIfAborted();
    const workspace = await registry.resolveByPath(target.session.header.cwd);
    signal?.throwIfAborted();
    if (!workspace?.id) return null;
    const result = await vault.lessonPlan({ workspaceId: workspace.id, sessionId: target.id });
    signal?.throwIfAborted();
    if (!result?.bound) return null;
    const snapshot = {
      path: result.path,
      missing: Boolean(result.missing),
      title: result.plan?.title ?? result.path,
      revision: result.plan?.revision ?? null,
      progressLabel: result.plan?.progressLabel ?? '',
      counts: result.plan?.counts ?? null,
      currentTask: result.plan?.currentTask ? { line: result.plan.currentTask.line, content: result.plan.currentTask.content, expectedText: result.plan.currentTask.expectedText } : null,
      nextTask: result.plan?.nextTask ? { line: result.plan.nextTask.line, content: result.plan.nextTask.content, expectedText: result.plan.nextTask.expectedText } : null,
      staleCurrentTask: Boolean(result.plan?.staleCurrentTask),
    };
    return {
      name: 'notara-current-lesson-plan',
      interpolate: false,
      text: '当前课堂已关联备课本（type: lesson）只读快照（含右上角面板手动关联或勾选后的最新状态）。修改任务状态前若文件可能变更请先调用 lesson_plan({action:"read"}) 或 read 核对最新行号与 revision；清单勾选仅表示课堂环节进度，不代表学生已掌握。\n' + JSON.stringify(snapshot),
    };
  } catch (error) {
    signal?.throwIfAborted();
    return null;
  }
}

export function apply(ctx, { preset }) {
  const role = roleById(preset);
  ctx.systemPrompt.section({
    name: 'deployment:persona-prefix',
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
    text: role.prompt + runtimeContract(role),
    interpolate: false,
    complete: true,
  });
  if (role.kind === 'blind') {
    ctx.systemPrompt.suppressRuntimeContext();
    // rc.4 refreshes required contexts again at request admission. Override
    // this provider in the blind scope so suppression also survives refresh.
    ctx.systemPrompt.context({name:'working-directory:current',order:ctx.systemPrompt.getContextOrder('WORKING_DIRECTORY'),required:false,text:'',interpolate:false});
  }
}

/** Collect at native request admission; dynamic background is appended once,
 * not folded into a mutable full runtime snapshot. */
export async function collectRuntimeContexts(ctx,agent,signal) {
  const role=roleById(ctx.agentPresets.composedPreset(agent.ctx));
  const context={agent,scope:agent,signal},service=ctx.get('notaraTopics');
    const origin=service&&agent?.id?await service.origin(agent.id):null;
    const receipt=['teacher','coordinator'].includes(role.kind)?await readReviewContext(ctx,context):null;
    const learning=['teacher','coordinator'].includes(role.kind)?await readLearningContext(ctx,context):null;
    const bindings=role.kind==='coordinator'?await readLessonBindingsContext(ctx,context):null;
    const currentLesson=role.kind==='teacher'?await readTeacherLessonPlanContext(ctx,context):null;
    const whiteboard=['teacher','coordinator'].includes(role.kind)?await readWhiteboardContexts(ctx,agent,role.kind,signal):[];
    let summaryReceipts=null;
    if(['teacher','coordinator','organizer'].includes(role.kind)&&agent?.id&&ctx.get('notaraSummaryDeliveries')){
      try{summaryReceipts=await ctx.get('notaraSummaryDeliveries').context(agent);}
      catch{context.signal?.throwIfAborted();summaryReceipts={name:'notara-summary-receipts',text:'课后交付回执暂不可读，请稍后用 lesson_summary read 核实；不能把消息送达当成已全部处理。'};}
    }
    const originHint=role.kind==='organizer'
      ? `本整理会话由会话 ${origin} 发起。保存并回读日记整理报告后用 lesson_summary 交付，由宿主解析首页归属；若直接发起方是另一老师，可用 send_message 回交实际清单。`
      : `本对话由会话 ${origin} 发起。交接背景不是学生发言；普通等待无需汇报，任务收口先保存并回读报告。普通工作会话用 lesson_summary，由宿主绑定首页；内部子课堂交给直接父老师汇总。`;
    return [
      {name:'notara-conversation-origin',text:origin?originHint:''},
      ...(learning?[learning]:[]),
      ...whiteboard,
      ...[['notara-review-confirmations',receipt],['notara-lesson-bindings',bindings],['notara-current-lesson-plan',currentLesson],['notara-summary-receipts',summaryReceipts]].map(([name,item])=>item??{name,text:''}),
    ];
}
