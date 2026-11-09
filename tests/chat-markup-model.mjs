import { LlmAdapter } from '@deepseek-ai/dsh-llm';
export const inject = ['llm'];
const body = [
  '先看一个小例子，长度平方是 $x^Tx$。',
  '<details><summary>已经落盘的文件（这轮先不用读）</summary>', '',
  '- [[卡片/特征值分解的局限与正交基旋转拉伸问题.md|转置卡片]]',
  '- [[模板/知识点模板.md|知识点模板]]', '', '</details>', '',
  '```choice', 'prompt: 你此刻的真实顾虑，最接近哪一条？',
  '- 想快点跑起来看见东西', '- 担心自己的基础不足', '```',
  '', '<div>', '```frames', 'frame 当前', '先预测再查看', 'predict', 'frame 后续', '<details><summary>展开</summary>HTML_FUTURE_SECRET</details>', '```', '</div>',
  '', '<details><summary>', '```frames', 'frame 当前', '先写自己的判断', 'predict', 'frame 后续', 'SUMMARY_FUTURE_SECRET', '```', '</summary>补充内容</details>',
].join('\n');
export function apply(ctx) {
  class ChatMarkupFixture extends LlmAdapter {
    providerInfo(provider) { return { id: provider, name: '对话排版夹具' }; }
    async listModels(provider) { return [{ provider, id: 'fixed-response', name: '固定排版输出' }]; }
    async resolveModel(provider, model) { return { provider, id: model, name: '固定排版输出', context: { contextWindow: 128000 }, defaultMaxTokens: 4096, inputModalities: ['text'], systemPromptUpdate: 'in-history' }; }
    async *stream(options) {
      const text = options.purpose ? '排版与自由作答验证' : body;
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text };
      yield { type: 'block-end', index: 0, block: { type: 'text', text } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  ctx.llm.registerAdapter(['notara-integration-fixture'], new ChatMarkupFixture());
}
