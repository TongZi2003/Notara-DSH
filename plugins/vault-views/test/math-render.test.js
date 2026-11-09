import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { guideSections } from '../src/logic.js';

const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/markdown.jsx', import.meta.url))], bundle: true, write: false, platform: 'node', format: 'cjs', conditions: ['production'], loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' }, external: ['react', 'react/*'], alias: { '@deepseek-ai/dsh-client-ui-primitives': fileURLToPath(new URL('../../../tests/fixtures/modal.jsx', import.meta.url)) }, logLevel: 'silent' });
const module = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: createRequire(import.meta.url), console, TextDecoder, TextEncoder, URL });
const { MarkdownBody, MarkdownReader } = module.exports;
function render(content) {
  const chunks = [];
  const html = renderToStaticMarkup(React.createElement(MarkdownBody, { content, renderMarkdown: text => { chunks.push(text); return React.createElement('pre', null, text); } }));
  return { html, chunks };
}
test('mature Markdown math/code parsing protects literal fold syntax', () => {
  for (const text of [String.raw`$$\text{<details>} + x$$`, '`<details>`', '```html\n<details>\n```']) {
    const result = render(text);
    assert.equal(result.html.includes('<details>'), false);
    assert.deepEqual(result.chunks, [text]);
  }
});
test('closed custom fold defers its native Markdown children', () => {
  const math = '$$\n\\frac{1}{2}\n\n+x\n$$';
  const result = render(`<details>\n<summary>公式</summary>\n\n${math}\n\n</details>`);
  assert.equal(result.html.match(/<details>/g).length, 1);
  assert.deepEqual(result.chunks, ['公式'], 'only the title is rendered before opening');
  assert.match(result.html,/<summary>[\s\S]*公式[\s\S]*<\/summary>/);
  // Expanded multiline math is covered by browser.test.js's fold probe.
});
test('fold titles use the supplied Markdown renderer without truncating links or math', () => {
  const title = '回看 [[卡片/定义.md|定义]] 与 **结论** $x>0$ ' + '条件'.repeat(180);
  const result = render(`<details><summary>${title}</summary>答案仍需展开</details>`);
  assert.deepEqual(result.chunks, [title]);
  assert.doesNotMatch(result.html, /答案仍需展开/);
});
test('fallback fold titles render links and emphasis; automatic teacher-reference folds remain closed', () => {
  const html = renderToStaticMarkup(React.createElement(MarkdownBody, { content: '<details>\n<summary>回看 [[卡片/定义.md|定义]] 与 **结论**</summary>\n隐藏答案\n</details>' }));
  assert.match(html, /<button[^>]*>定义<\/button>/);
  assert.match(html, /<strong>结论<\/strong>/);
  assert.doesNotMatch(html, /\[\[|隐藏答案/);
  const chunks = [];
  renderToStaticMarkup(React.createElement(MarkdownReader, { content: '## 教师参考\n隐藏答案', renderMarkdown: text => { chunks.push(text); return text; } }));
  assert.deepEqual(chunks, ['教师参考']);
});
test('guide list dedenting preserves code examples instead of turning them into formulas', () => {
  const sections = guideSections('# 导读\n- [ ] 原样观察\n\n      $$x^2$$\n');
  assert.match(sections[0].tasks[0].displayText, /\n    \$\$x\^2\$\$/);
});
