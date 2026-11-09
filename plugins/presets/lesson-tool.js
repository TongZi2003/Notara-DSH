import { defineTool } from '@deepseek-ai/dsh-tools';

function summarizePlanResult(result) {
  if (!result?.bound) {
    return {
      bound: false,
      path: null,
      candidates: (result?.candidates ?? []).map(item => ({ path: item.path, title: item.title, revision: item.revision })),
      note: '当前课堂尚未绑定备课本。请先保存并回读 type: lesson 备课本，再调用 bind 关联。',
    };
  }
  if (result.missing || !result.plan) {
    return {
      bound: true,
      missing: true,
      path: result.path,
      candidates: (result.candidates ?? []).map(item => ({ path: item.path, title: item.title, revision: item.revision })),
      note: `原关联备课本「${result.path}」不存在或不再是 type: lesson，请重新选择或绑定已保存的备课本。`,
    };
  }
  const { plan } = result;
  return {
    bound: true,
    path: plan.path,
    title: plan.title,
    revision: plan.revision,
    counts: plan.counts,
    progressLabel: plan.progressLabel,
    currentTask: plan.currentTask ? { line: plan.currentTask.line, content: plan.currentTask.content, expectedText: plan.currentTask.expectedText } : null,
    nextTask: plan.nextTask ? { line: plan.nextTask.line, content: plan.nextTask.content, expectedText: plan.nextTask.expectedText } : null,
    staleCurrentTask: plan.staleCurrentTask,
    tasks: plan.tasks.map(task => ({
      line: task.line,
      status: task.status,
      checked: task.checked,
      content: task.content,
      expectedText: task.expectedText,
      ...(task.ambiguous ? { ambiguous: true } : {}),
    })),
    note: '右上角活动面板中的本课清单与备课 Markdown 同步；清单进度只反映课堂环节，不代表学生已掌握。',
  };
}

function translateLessonError(error) {
  const code = String(error?.message ?? error);
  if (code === 'vault_revision_conflict') return new Error('备课本版本已变化；请先调用 lesson_plan({action:"read"}) 获取最新 revision 与行号后再更新，不要按旧行号盲写。');
  if (code === 'vault_task_conflict') return new Error('目标行不是公开课堂任务或文本已变化；请先调用 lesson_plan({action:"read"}) 核对最新任务行与 expectedText。');
  if (code === 'vault_task_completed') return new Error('该任务已完成勾选，不能再设为进行中；如需重做请先 reopen。');
  if (code === 'vault_lesson_type_required') return new Error('目标文件不是有效的 type: lesson 备课本；请先保存并回读包含 type: lesson 的 Markdown 课稿。');
  if (code === 'vault_not_found') return new Error('目标备课本不存在或尚未保存；请先使用 write 保存并 read 回读后再绑定。');
  if (code === 'vault_lesson_unbound') return new Error('当前课堂尚未绑定该备课本；请先调用 lesson_plan({action:"bind", path}) 关联当前课稿。');
  if (code === 'vault_workspace_mismatch' || code === 'vault_workspace_not_found') return new Error('拒绝跨学习集或无效工作区的备课本关联。');
  if (code === 'vault_session_archived') return new Error('已归档课堂为只读历史记录，不能绑定或修改本课清单。');
  if (code === 'vault_session_role_forbidden' || code === 'vault_session_not_found') return new Error('仅真实专题课堂会话可绑定或更新本课清单。');
  return error;
}

export async function executeLessonPlan(ctx, preset, args, exec) {
  const agent = exec?.agent;
  if (!agent || preset !== 'notara-teacher' || ctx.agentPresets.composedPreset(agent.ctx) !== preset) {
    throw new Error('需要当前专题课堂老师身份');
  }
  const workspace = await ctx.workspaceRegistry.resolveByPath(agent.session.header.cwd);
  if (!workspace) throw new Error('当前课堂未绑定工作区');
  const action = args?.action;
  if (!['read', 'bind', 'unbind', 'set_current', 'clear_current', 'complete', 'reopen'].includes(action)) {
    throw new Error('lesson_plan_action_invalid');
  }
  exec.signal.throwIfAborted();
  const sessionId = agent.id;
  const workspaceId = workspace.id;
  try {
    if (action === 'read') {
      const current = await ctx.notaraVault.lessonPlan({ workspaceId, sessionId });
      if (args?.path && (!current.bound || current.path !== args.path)) {
        const [{ projectLessonPlan }, doc] = await Promise.all([
          import('@oh-my-student/plugin-vault-sqlite/lesson-plan'),
          ctx.notaraVault.read({ workspaceId, path: args.path }),
        ]);
        const preview = projectLessonPlan(doc);
        return {
          ...summarizePlanResult(current),
          inspected: {
            path: preview.path,
            title: preview.title,
            revision: preview.revision,
            counts: preview.counts,
            progressLabel: preview.progressLabel,
            tasks: preview.tasks.map(task => ({ line: task.line, status: task.status, checked: task.checked, content: task.content, expectedText: task.expectedText })),
          },
        };
      }
      return summarizePlanResult(current);
    }
    if (action === 'bind') {
      if (typeof args.path !== 'string' || !/\.md$/i.test(args.path.trim())) {
        throw new Error('请指定当前学习集内已保存的 .md 备课本路径（type: lesson）');
      }
      const bound = await ctx.notaraVault.bindLessonPlan({
        workspaceId,
        sessionId,
        path: args.path,
        ...(typeof args.expectedRevision === 'string' ? { expectedRevision: args.expectedRevision } : {}),
      });
      return summarizePlanResult(bound);
    }
    if (action === 'unbind') {
      const unbound = await ctx.notaraVault.bindLessonPlan({ workspaceId, sessionId, path: null });
      return summarizePlanResult(unbound);
    }
    if (typeof args.expectedRevision !== 'string' || !args.expectedRevision.trim()) {
      throw new Error('更新本课清单须提供最近一次 lesson_plan read/bind 返回的 expectedRevision');
    }
    if (action === 'clear_current') {
      const cleared = await ctx.notaraVault.setCurrentLessonTask({
        workspaceId,
        sessionId,
        ...(typeof args.path === 'string' ? { path: args.path } : {}),
        expectedRevision: args.expectedRevision,
        clear: true,
      });
      return summarizePlanResult(cleared);
    }
    if (!Number.isInteger(args.line) || args.line < 1 || typeof args.expectedText !== 'string' || !args.expectedText.trim()) {
      throw new Error('请提供来自 lesson_plan read/bind 的准确 line 与 expectedText');
    }
    if (action === 'set_current') {
      const updated = await ctx.notaraVault.setCurrentLessonTask({
        workspaceId,
        sessionId,
        ...(typeof args.path === 'string' ? { path: args.path } : {}),
        line: args.line,
        expectedText: args.expectedText,
        expectedRevision: args.expectedRevision,
      });
      return summarizePlanResult(updated);
    }
    const toggled = await ctx.notaraVault.toggleLessonTask({
      workspaceId,
      sessionId,
      ...(typeof args.path === 'string' ? { path: args.path } : {}),
      line: args.line,
      checked: action === 'complete',
      expectedText: args.expectedText,
      expectedRevision: args.expectedRevision,
    });
    return summarizePlanResult(toggled);
  } catch (error) {
    throw translateLessonError(error);
  }
}

export function registerLessonTool(ctx, preset) {
  ctx.tools.register(defineTool({
    name: 'lesson_plan',
    description: '绑定并同步当前课堂右上角活动面板中的本课清单（操作同一份 type: lesson 备课 Markdown，会话与工作区身份由宿主自动绑定）。先保存并 read 回读备课本，再 bind 关联路径；实际进入或切换环节时用 set_current，暂停或转入临时散打时用 clear_current，真正完成该环节后再 complete（重做用 reopen）。不同动作所需字段不同：read 可选 path；bind 必填 path（可选 expectedRevision）；unbind 无需额外字段；clear_current 必填 expectedRevision；set_current、complete、reopen 必填 expectedRevision、line 与 expectedText。版本或行内容冲突时先调用 lesson_plan({action:"read"}) 获取最新 revision 与行号后再更新，失败不得声称状态栏已更新。清单进度不表示学生掌握。',
    parameters: {
      action: { type: 'string', enum: ['read', 'bind', 'unbind', 'set_current', 'clear_current', 'complete', 'reopen'], required: true },
      path: { type: 'string', description: '当前学习集内 type: lesson 备课本的相对路径；bind 必填，read 可选预览指定课稿，其余操作默认使用当前已绑定文件。' },
      expectedRevision: { type: 'string', description: '最近一次 lesson_plan read/bind 返回的 revision；set_current、clear_current、complete、reopen 必填，bind 可选。' },
      line: { type: 'integer', description: '目标公开任务所在行号（1-based，来自 lesson_plan read/bind 返回的 tasks）；仅 set_current、complete、reopen 必填，clear_current 等不填。' },
      expectedText: { type: 'string', description: '目标公开任务的 expectedText（或正文 content）；仅 set_current、complete、reopen 必填，用于校验未误改其他任务。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { result: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.result }],
    },
    async execute(args, exec) {
      return { result: JSON.stringify(await executeLessonPlan(ctx, preset, args, exec)) };
    },
  }));
}
