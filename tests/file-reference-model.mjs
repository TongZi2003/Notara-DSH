import { LlmAdapter } from '@deepseek-ai/dsh-llm';
export const inject = ['llm'];
export function apply(ctx) {
  class FileReferenceFixture extends LlmAdapter {
    providerInfo(provider) { return { id: provider, name: '文件引用夹具' }; }
    async listModels(provider) { return [{provider,id:'fixed-response',name:'固定文件引用'}]; }
    async resolveModel(provider, model) { return { provider, id: model, name: '固定文件引用', context: { contextWindow: 128000 }, defaultMaxTokens: 4096, inputModalities: ['text'], systemPromptUpdate: 'in-history' }; }
    async *stream(options) {
      const text = options.purpose ? '代码文件引用验证' : '代码已经写好了：[[代码/阶段0/lesson01_train_loop.py|训练脚本]]。也可以看[[代码/阶段0/lesson01_train_loop.py#L2|代码第二行]]。\n\n结果：[[结果.json|运行结果]]；说明：[[说明 文档.txt|说明文本]]。\n\n学习笔记：[[实验笔记.md|实验笔记]]。';
      yield {type:'block-start',index:0,blockType:'text'};
      yield {type:'text-delta',index:0,text};
      yield {type:'block-end',index:0,block:{type:'text',text}};
      yield {type:'finish',reason:{kind:'stop'}};
    }
  }
  ctx.llm.registerAdapter(['notara-integration-fixture'], new FileReferenceFixture());
}
