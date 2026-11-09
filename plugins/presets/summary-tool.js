import { defineTool } from '@deepseek-ai/dsh-tools';

export function registerSummaryTool(ctx, preset) {
  const sender = ['notara-teacher', 'notara-material-organizer'].includes(preset);
  const description = sender
    ? '学习工作交付（发送侧）：探索讨论、备课/组卷、授课和资料整理真正收口后，先在已保存的 type: lesson 或 type: diary 真实章节写好报告并 read 回读，再调用 deliver；宿主追加当日日记索引并按绑定通知首页（暂无首页时持久保存日记索引与待回传回执，不伪造已送达），同稿去重，修订原报告后沿原 path/heading 重新 deliver（不用 retry 冒充新版）。read 列出本会话交付回执，retry 重试未完成投递。纯备课与纯整理不虚构学生表现；普通等待不是下课；内部子课堂用 send_message 交直接父老师汇总。交付或 complete 回执不代表学生已掌握。'
    : '学习工作交付（长期教师接收侧）：收到交付通知或续接未完成回执时，先调用 read 读取源报告、最新 version 与处理进展，独立核对影响后续教学的关键结论与错因，再用 decide 选择确需维护的 targets（profile / route，无需改变长期文档时传 targets:[] 并写明 note；已选未完成项不能取消，后续可补选）。发现疑点或讲错时用 send_message 联系 read 返回的 senderSessionId 交原会话复核纠错。已选目标更新并 read 回读取得最新 revision（保留精确 sourceLocator）后调用 acknowledge，失败保留已成项。complete 仅表示所选画像/路线已处理，不代表纠错补充完成或学生掌握。';
  ctx.tools.register(defineTool({
    name: 'lesson_summary',
    description,
    parameters: {
      action: { type: 'string', enum: sender ? ['deliver', 'read', 'retry'] : ['read', 'decide', 'acknowledge', 'retry'], required: true },
      path: { type: 'string', description: sender ? 'deliver 必填：当前学习集已保存、Frontmatter 为 type: lesson 或 type: diary 的 .md 路径。' : 'read 加 deliveryId 时可选要回读的画像/路线 .md；acknowledge 的 updated 或有目标文件的 unchanged 必填刚回读的实际目标路径。' },
      ...(sender ? {
        heading: { type: 'string', description: '仅 deliver：总结所在的唯一真实 Markdown 标题，不含 #。默认“本节总结与下次续接”；日记填写本节实际标题（如纯备课填“备课交付”）。' },
        kind: { type: 'string', enum: ['lesson', 'preparation', 'question', 'materials'], description: '仅 deliver：训练授课（lesson）、纯备课/组卷（preparation）、轻量问答/探索讨论（question）或资料整理（materials）。省略时首次老师默认 lesson、整理员默认 materials。' },
        summary: { type: 'string', description: '仅 deliver：可选的简短结果摘要，最多1000字符；写入当日日记索引供首页先看，完整依据仍在 path/heading 报告中。' },
      } : {}),
      deliveryId: { type: 'string', description: '从通知或 read 返回的交付标识中选择，不自行编造。read 不传时列本会话回执；decide / acknowledge / retry 必填。' },
      ...(!sender ? {
        version: { type: 'integer', description: 'decide / acknowledge 必填：最近 read 返回的报告版本整数；不能确认修订前的旧版本。' },
        targets: { type: 'array', items: { type: 'string', enum: ['profile', 'route'] }, description: '仅 decide 必填：确需处理的文档类型，不重复；无需改变长期文档传 [] 并以 note 说明保持原安排。已选未完成项不能取消，后续可补选。' },
        target: { type: 'string', enum: ['profile', 'route'], description: '仅 acknowledge 必填：分别登记 profile 或 route。' },
        outcome: { type: 'string', enum: ['updated', 'unchanged', 'retryable', 'blocked'], description: '仅 acknowledge 必填：updated 须传 path/expectedRevision 且目标正文含本次 sourceLocator；unchanged 须说明依据（无该类文档且无需新建时可省 path）；retryable/blocked 只写 note 原因，不传 path/expectedRevision。' },
        expectedRevision: { type: 'string', description: '仅 updated 或有目标文件的 unchanged：用 read({deliveryId,path}) 回读得到的 document.revision。' },
        note: { type: 'string', description: 'decide / acknowledge 必填（1–2000字）：下一步判断、文档处理依据或失败原因。' },
      } : {}),
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: { result: { type: 'string', required: true } } }, render: (_args, value) => [{ type: 'text', text: value.result }] },
    async execute(args, exec) {
      if (!exec.agent || ctx.agentPresets.composedPreset(exec.agent.ctx) !== preset) throw new Error('summary_actor_unavailable: 需要当前真实角色身份');
      const allowed = { deliver: ['action', 'path', 'heading', 'kind', 'summary'], read: ['action', 'deliveryId', 'path'], decide: ['action', 'deliveryId', 'version', 'targets', 'note'], acknowledge: ['action', 'deliveryId', 'version', 'target', 'outcome', 'path', 'expectedRevision', 'note'], retry: ['action', 'deliveryId'] };
      if (!allowed[args.action] || Object.keys(args).some(key => args[key] !== undefined && !allowed[args.action].includes(key))) throw new Error('summary_action_fields: 参数混入其他动作，请按所选 action 的合同调用');
      if (sender ? ['decide', 'acknowledge'].includes(args.action) : args.action === 'deliver') throw new Error('summary_role_forbidden: 当前角色不能执行此动作');
      if (['decide', 'acknowledge', 'retry'].includes(args.action) && (typeof args.deliveryId !== 'string' || !args.deliveryId)) throw new Error('summary_delivery_required: 请先 read 选择真实交付');
      if (args.action === 'read' && args.path !== undefined && !args.deliveryId) throw new Error('summary_delivery_required: 回读目标文档须指定对应 deliveryId');
      exec.signal.throwIfAborted();
      const service = ctx.get('notaraSummaryDeliveries');
      if (!service) throw new Error('summary_service_unavailable: 交付服务尚未就绪，请保留已保存的总结稍后重试');
      if (!sender && args.action === 'read') await service.rememberHome(exec.agent);
      return { result: JSON.stringify(await service[args.action](exec.agent, args, exec.callId)) };
    },
  }));
}
