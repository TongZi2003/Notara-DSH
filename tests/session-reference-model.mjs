import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
export const inject = ['llm'];
export function apply(ctx) {
  class Fixture extends LlmAdapter {
    providerInfo(provider) { return { id: provider, name: '课堂引用夹具' }; }
    async listModels(provider) { return [{ provider, id: 'fixed-response', name: '固定引用输出' }]; }
    async resolveModel(provider, model) { return { provider, id: model, name: '固定引用输出', context: { contextWindow: 128000 }, defaultMaxTokens: 4096, inputModalities: ['text'], systemPromptUpdate: 'in-history' }; }
    async *stream(options) {
      const target = await readFile(join(process.env.DSH_HOME, 'reference-target.txt'), 'utf8').catch(() => null);
      const text = options.purpose ? (target ? '引用入口' : '均值不等式原课堂') : !target ? '原课堂内容：继续讨论均值不等式。' : [
        `继续 [[session:${target}|均值不等式课堂]]。`,
        `也可以 [回到原课堂](session:${target})。`,
        `<details><summary>课堂 [[session:${target}|课堂入口]] 与 [[笔记.md|资料入口]]</summary>折叠里的正文。</details>`,
        '相关文件：[[笔记.md|查看笔记]]。',
        '![本课示意](示意.svg)',
        '失效入口：[[session:missing-class|旧课堂]]。',
        '`[[session:code-example|代码示例保留]]`',
      ].join('\n\n');
      yield { type: 'block-start', index: 0, blockType: 'text' };
      for (let i = 0; i < text.length; i += 17) yield { type: 'text-delta', index: 0, text: text.slice(i, i + 17) };
      yield { type: 'block-end', index: 0, block: { type: 'text', text } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  ctx.llm.registerAdapter(['notara-integration-fixture'], new Fixture());
}
