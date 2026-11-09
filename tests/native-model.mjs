import { LlmAdapter } from '@deepseek-ai/dsh-llm';

export const inject = ['llm'];
export const PROVIDER = 'notara-integration-fixture';
export const MODEL = 'fixed-response';
export const fixtureResponse = [
  '这是确定性集成测试输出，不是教学效果证据。',
  '```flow', 'direction right', 'A[条件] --> B[?]', 'B --> C[结论]', '```',
  '```frames', 'title: 预测门', 'frame 当前', '当前条件', 'predict: 接下来会怎样？',
  'frame 后续', 'NATIVE_FUTURE_SECRET', '```',
].join('\n');

/** Test-only adapter: no credentials, no network, no tools and no product export. */
export function apply(ctx) {
  class FixtureAdapter extends LlmAdapter {
    providerInfo(provider) { return { id: provider, name: '确定性集成夹具' }; }
    async listModels(provider) { return [{ provider, id: MODEL, name: '固定测试输出' }]; }
    async resolveModel(provider, model) {
      return { provider, id: model, name: '固定测试输出', context: { contextWindow: 128000 }, defaultMaxTokens: 4096, inputModalities: ['text'], systemPromptUpdate: 'in-history' };
    }
    async *stream(options) {
      options.signal?.throwIfAborted();
      const body = options.purpose ? '集成测试会话' : fixtureResponse;
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: body };
      yield { type: 'block-end', index: 0, block: { type: 'text', text: body } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  ctx.llm.registerAdapter([PROVIDER], new FixtureAdapter());
}
