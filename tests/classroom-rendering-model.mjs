import { LlmAdapter } from '@deepseek-ai/dsh-llm';
export const inject = ['llm'];
export const reviewPath = '卡片/等和线与三点共线.md';
export const blankSource = String.raw`把所有向量落到基底 $\{\overrightarrow{AB},\overrightarrow{AC}\}$ 上：
$\overrightarrow{BC} = $ {{ 用 \overrightarrow{AB}、\overrightarrow{AC} 表示，注意方向 }}
$\overrightarrow{AD}\cdot\overrightarrow{BC} = $ {{ 把 x\overrightarrow{AB}+y\overrightarrow{AC} 乘进去，写成含 x、y 的式子 }}`;
export const tableSource = String.raw`| 时间 | 干什么 | 产出 |
| --- | --- | --- |
| 前15分钟 | 以 $|\mathbf a\pm\mathbf b|^2$ 为母公式 | 一张关系图 |
| 验证 | $\begin{array}{c|c}a&b\end{array}$ 与 $\text{a|b}$ | 完整保留 |`;
export const displayFormula = String.raw`$$\begin{aligned}
x+y&=1\\
x-y&=0\end{aligned}$$`;
export const afterFormula = '公式结束后的正文必须保持独立。';
const body = [displayFormula, afterFormula, tableSource, '```blank', blankSource, '```', '```notara-review', JSON.stringify({ targetPath: reviewPath, keyStep: '由 D 在 BC 上得到 $x+y=1$', result: 'done', support: 'hint', note: '课堂题1第一问答对；刚听过讲解，support 建议 hint，最终由学生确认。' }), '```'].join('\n\n');
export function apply(ctx) {
  class RenderingFixture extends LlmAdapter {
    providerInfo(provider) { return { id: provider, name: '课堂渲染回归' }; }
    async listModels(provider) { return [{ provider, id: 'fixed-response', name: '固定课堂输出' }]; }
    async resolveModel(provider, id) { return { provider, id, name: '固定课堂输出', context: { contextWindow: 128000 }, defaultMaxTokens: 4096, inputModalities: ['text'], systemPromptUpdate: 'in-history' }; }
    async *stream(options) {
      const noteOnly = JSON.stringify(options.messages).includes('NOTE_ONLY');
      const text = options.purpose ? '课堂渲染验证' : noteOnly ? '```notara-review\n' + JSON.stringify({ targetPath: reviewPath, keyStep: '', result: 'unchecked', support: 'unknown', note: '这次先记笔记。' }) + '\n```' : body;
      yield { type: 'block-start', index: 0, blockType: 'text' };
      for (let offset = 0; offset < text.length; offset += 29) {
        options.signal?.throwIfAborted();
        yield { type: 'text-delta', index: 0, text: text.slice(offset, offset + 29) };
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  ctx.llm.registerAdapter(['notara-integration-fixture'], new RenderingFixture());
}
