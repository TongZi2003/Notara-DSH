import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationMarkdown } from '../src/conversation-markdown-model.js';

test('classroom references render in chat and fold titles without exposing their wire syntax', () => {
  for (const token of ['[[session:topic-123|均值不等式]]', '[均值不等式](session:topic-123)']) {
    const result = conversationMarkdown(`继续：${token}`);
    assert.equal(result.special, true);
    assert.equal(result.sessionLinks, true);
    assert.equal(result.nodes[0].text, '继续：[均值不等式](<__notara_session__/topic-123>)');
  }
  const result = conversationMarkdown('<details><summary>回到 [[session:topic-123|原课堂]]，查看 [[笔记.md|笔记]]</summary>正文</details>');
  assert.equal(result.nodes[0].summary, '回到 [原课堂](<__notara_session__/topic-123>)，查看 [笔记](<%E7%AC%94%E8%AE%B0.md>)');
  for (const text of ['`[[session:topic-123|示例]]`', '```md\n[[session:topic-123|示例]]\n```', '$\\text{[[session:topic-123|示例]]}$', '\\[[session:topic-123|示例]]', '![[session:topic-123|嵌入]]', '[[session:../bad|无效]]', '[[session:topic-123|未完成']) {
    assert.equal(conversationMarkdown(text).nodes[0].text, text);
  }
});

test('math tables split cells outside complete formulas, preserving all TeX verbatim', () => {
  for (const formula of [String.raw`$|\mathbf a\pm\mathbf b|^2$`, String.raw`$\|a\|$`, String.raw`$\text{a|b}$`, String.raw`$\begin{array}{c|c}a&b\end{array}$`]) {
    const text = `前文\n\n| 时间 | 干什么 | 产出 |\n| --- | :---: | ---: |\n| 前15分钟 | 以 ${formula} 为母公式 | 一张关系图 |\n\n后文`;
    const result = conversationMarkdown(text), table = result.nodes.find(n => n.kind === 'table');
    assert.equal(result.special, true);
    assert.deepEqual(table.headers, ['时间', '干什么', '产出']);
    assert.deepEqual(table.rows, [['前15分钟', `以 ${formula} 为母公式`, '一张关系图']]);
    assert.deepEqual(table.align, [null, 'center', 'right']);
    assert.match(result.nodes.at(-1).text, /后文/);
  }
});
test('math-table recognition leaves code, ordinary pipes and incomplete formulas alone', () => {
  const table = '| A | B |\n| --- | --- |\n| 甲 | $|a|$ |';
  for (const text of ['```md\n' + table + '\n```', '~~~\n' + table, '````md\n' + table + '\n````', '| A | B |\n| --- | --- |\n| 甲 | `$|a|$` |', '| A | B |\n| --- | --- |\n| 甲 | $|a| |', String.raw`\$|a|\$`, 'a | b']) {
    const result = conversationMarkdown(text);
    assert.equal(result.special, false, text);
    assert.equal(result.nodes[0].text, text);
  }
  const ordinary = '| A | B |\n| --- | --- |\n| 甲 | a\\|b |';
  assert.equal(conversationMarkdown(ordinary).nodes[0].text, ordinary);
});
test('math tables respect block boundaries, reference definitions and GFM code pipes', () => {
  for (const block of ['## 后文 | 附注', '- 后文 | 附注', '> 后文 | 附注']) {
    const result = conversationMarkdown('| A | B |\n| --- | --- |\n| $|x|$ | 值 |\n' + block);
    assert.equal(result.nodes[0].rows.length, 1);
    assert.match(result.nodes.at(-1).text, /后文 \| 附注/);
  }
  const result = conversationMarkdown('| A | B |\n| --- | --- |\n| $|x|$ [来源][ref] | `a\\|b` |\n\n[ref]: https://example.com/source');
  assert.match(result.nodes[0].definitions, /\[ref\]: https:\/\/example.com\/source/);
  assert.equal(result.nodes[0].rows[0][1], '`a|b`');
});

test('code and data file references render like note references and retain anchors', () => {
  for (const path of ['代码/阶段0/lesson01_train_loop.py', '结果.json', '说明 文档.txt', '包.zip']) {
    const result = conversationMarkdown(`代码已经写好了：[[${path}|打开文件]]`);
    assert.equal(result.special, true);
    assert.equal(result.nodes[0].text, `代码已经写好了：[打开文件](<${encodeURIComponent(path).replaceAll('%2F','/')}>)`);
  }
  assert.match(conversationMarkdown('[[讲义.pdf#page=2|讲义]]').nodes[0].text, /pdf%23page%3D2/);
  assert.match(conversationMarkdown('[[笔记.md#原理|原理]]').nodes[0].text, /md%23/);
  assert.equal(conversationMarkdown('[[train.py#L2|第二行]]').nodes[0].text, '[第二行](<train.py#L2>)');
});

test('folds source lists and converts local aliased links without rendering arbitrary HTML', () => {
  const result = conversationMarkdown('正文。\n\n<details onclick="notRun()"><summary>已经落盘的文件（这轮先不用读）</summary>\n\n- [[画像.md|学习画像]]\n- [[模板/实验.md|实验模板]]\n\n</details>\n\n后文。');
  assert.equal(result.special, true);
  assert.equal(result.nodes[1].kind, 'details');
  assert.equal(result.nodes[1].summary, '已经落盘的文件（这轮先不用读）');
  assert.match(result.nodes[1].children[0].text, /\[学习画像\]\(<%E7%94%BB%E5%83%8F\.md>\)/);
  assert.doesNotMatch(JSON.stringify(result.nodes), /onclick|notRun/);
  assert.match(result.nodes.at(-1).text, /后文/);
});
test('does not promote code, math, escaped examples or unsafe wiki targets', () => {
  const text = '`<details> [[代码.md]]`\n\n```html\n<details><summary>示例</summary>[[示例.md]]</details>\n```\n\n$\\text{<details>}$\n\n\\(<details>\\)\n\n\\<details>\n\n[[../private.md]]';
  const result = conversationMarkdown(text);
  assert.equal(result.special, false);
  assert.equal(result.nodes[0].text, text);
});
test('nested folds protect code inside their HTML boundary and retain global question indexes', () => {
  const choice = '```choice\n问题\n- 甲\n- 乙\n```';
  const text = choice + '\n\n<details><summary>外层</summary>\n' + choice + '\n\n```text\n<details>代码示例</details>\n```\n<details><summary>内层</summary>[[笔记]]</details>\n</details>\n\n' + choice;
  const result = conversationMarkdown(text), outer = result.nodes[1];
  assert.equal(outer.kind, 'details');
  assert.equal(outer.children.filter(node => node.kind === 'details').length, 1);
  assert.match(outer.children[0].text, /<details>代码示例<\/details>/);
  assert.equal(result.nodes[0].componentOffset, 0);
  assert.equal(outer.children[0].componentOffset, 1);
  assert.equal(result.nodes.at(-1).componentOffset, 2);
});
test('a streaming open fold retains its body without exposing its structural tags', () => {
  const partial = conversationMarkdown('前文\n\n<details><summary>来源</summary>\n\n- [[资料.md]]');
  assert.equal(partial.nodes[1].summary, '来源');
  assert.equal(partial.nodes[1].children.length, 1);
  assert.doesNotMatch(JSON.stringify(partial.nodes), /<details>|<summary>/);
});
test('raw HTML wrappers cannot split a future frame out of its component gate', () => {
  const text = '<div>\n```frames\nframe 当前\n条件\npredict\nframe 后续\n<details><summary>展开</summary>FUTURE_SECRET</details>\n```\n</div>';
  const result = conversationMarkdown(text);
  assert.equal(result.special, false);
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].text, text);
});
test('interactive summary contents move behind the same prediction gate and keep indexes', () => {
  const text = '<details><summary>\n```frames\nframe 当前\n条件\npredict\nframe 后续\nFUTURE_SECRET\n```\n</summary>正文</details>\n\n```choice\n问题\n- 甲\n- 乙\n```';
  const result = conversationMarkdown(text);
  assert.equal(result.nodes[0].summary, '互动内容');
  assert.equal(result.nodes[0].children[0].componentOffset, 0);
  assert.equal(result.nodes.at(-1).componentOffset, 1);
  assert.doesNotMatch(result.nodes[0].summary, /FUTURE_SECRET/);
});
test('a closing summary tag inside inline code does not close the title', () => {
  const result = conversationMarkdown('<details><summary>标签示例 `</summary>` 不应结束标题</summary>正文</details>');
  assert.equal(result.nodes[0].summary, '标签示例 `</summary>` 不应结束标题');
  assert.equal(result.nodes[0].children[0].text, '正文');
});
