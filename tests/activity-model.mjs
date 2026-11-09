import { setTimeout as delay } from 'node:timers/promises';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
export const inject = ['llm'];
function* text(body) {
  yield { type: 'block-start', index: 0, blockType: 'text' };
  yield { type: 'text-delta', index: 0, text: body };
  yield { type: 'block-end', index: 0, block: { type: 'text', text: body } };
  yield { type: 'finish', reason: { kind: 'stop' } };
}
function* tool(name, args, id) {
  const block = { type: 'tool-call', id, name, arguments: JSON.stringify(args) };
  yield { type: 'block-start', index: 0, blockType: 'tool-call' };
  yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: block.arguments };
  yield { type: 'block-end', index: 0, block };
  yield { type: 'finish', reason: { kind: 'tool-calls' } };
}
/** Deterministic tools through the real native loop; no external model or credentials. */
export function apply(ctx) {
  const steps = new Map();
  class ActivityFixture extends LlmAdapter {
    providerInfo(provider) { return { id: provider, name: '活动回归夹具' }; }
    async listModels(provider) { return [{ provider, id: 'fixed-response', name: '活动固定输出' }]; }
    async resolveModel(provider, model) { return { provider, id: model, name: '活动固定输出', context: { contextWindow: 128000 }, defaultMaxTokens: 4096, inputModalities: ['text'], systemPromptUpdate: 'in-history' }; }
    async *stream(options) {
      if (options.purpose) { yield* text('活动浮窗验证'); return; }
      const step = steps.get(options.sessionId) ?? 0; steps.set(options.sessionId, step + 1);
      const users=JSON.stringify(options.messages.filter(message=>message.role==='user'));
      const child = users.includes('ACTIVITY_CHILD')&&!users.includes('ACTIVITY_PARENT');
      if (users.includes('AD_HOC_SESSION')) {
        yield* text('AD_HOC_READY：临时散打会话，不关联备课本。');
        return;
      }
      if (users.includes('LESSON_PLAN_RELOAD_CHECK')) {
        const latestLessonSnapshot = options.messages
          .filter(message => message.role === 'user' && ['notara-context-update','runtime-context'].includes(message.source?.kind))
          .flatMap(message => message.source.sections ?? [])
          .filter(section => section.name === 'notara-current-lesson-plan').at(-1)?.text ?? '';
        let parsed = null;
        try { parsed = JSON.parse(latestLessonSnapshot.trim().split('\n').at(-1) ?? 'null'); } catch {}
        const ok = parsed?.path === '备课/第一课-奇异值几何直觉.md'
          && parsed?.counts?.completed === 1
          && parsed?.counts?.total === 2
          && parsed?.nextTask?.content === '独立验证正交方向保持正交';
        yield* text(ok ? 'LESSON_PLAN_RELOAD_CONTEXT_OK' : 'LESSON_PLAN_RELOAD_CONTEXT_MISSING');
        return;
      }
      if (users.includes('LESSON_PLAN_CLASSROOM')) {
        if (step === 0) {
          yield* tool('write', {
            file_path: '备课/第一课-奇异值几何直觉.md',
            content: [
              '---',
              'type: lesson',
              'status: ready',
              '---',
              '# 第一课：奇异值几何直觉',
              '- [ ] 观察单位圆映射为椭圆',
              '- [ ] 独立验证正交方向保持正交',
              '<details data-notara="teacher">',
              '<summary>教师参考</summary>',
              '',
              '- [ ] 教师私密备忘不入清单',
              '</details>',
              '',
            ].join('\n'),
          }, 'lesson-write');
          return;
        }
        if (step === 1) {
          yield* tool('lesson_plan', { action: 'bind', path: '备课/第一课-奇异值几何直觉.md' }, 'lesson-bind');
          return;
        }
        if (step === 2) {
          const lastToolMsg = options.messages.filter(m => m.role === 'tool').at(-1);
          const rawText = typeof lastToolMsg?.content === 'string'
            ? lastToolMsg.content
            : lastToolMsg?.content?.find(part => part.type === 'text')?.text ?? '{}';
          const parsed = JSON.parse(rawText);
          const first = parsed.tasks[0];
          yield* tool('lesson_plan', {
            action: 'set_current',
            line: first.line,
            expectedText: first.expectedText,
            expectedRevision: parsed.revision,
          }, 'lesson-set-current');
          return;
        }
        yield* text('LESSON_PLAN_READY：已关联本课清单并定位第 1 步。');
        return;
      }
      if (child) {
        if (step === 0) { yield* tool('read', { file_path: '卡片/特征值分解的局限与正交基旋转拉伸问题.md', limit: 10 }, 'child-read'); return; }
        await delay(1200, undefined, { signal: options.signal });
        yield* text('ACTIVITY_CHILD_FINISHED：已核对转置步骤。'); return;
      }
      if (step === 0) yield* tool('read', { file_path: '卡片/特征值分解的局限与正交基旋转拉伸问题.md', limit: 12 }, 'parent-read');
      else if (step === 1) yield* tool('write', { file_path: '活动试用/课堂小结.md', content: '# 课堂小结\n\n这是活动界面的确定性工具回归。\n' }, 'parent-write');
      else if (step === 2) yield* tool('subagent', { preset: 'worker-general', description: '核验转置步骤', prompt: 'ACTIVITY_CHILD：独立读取卡片并核对转置步骤。', run_in_background: true }, 'parent-worker');
      else if (step === 3) yield* tool('read', { file_path: '不存在-回归.md' }, 'parent-failed-read');
      else { await delay(500, undefined, { signal: options.signal }); yield* text('ACTIVITY_PARENT_FINISHED：活动回归完成。[课堂小结](活动试用/课堂小结.md)'); }
    }
  }
  ctx.llm.registerAdapter(['notara-integration-fixture'], new ActivityFixture());
}
