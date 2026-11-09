import test from 'node:test';
import assert from 'node:assert/strict';
import { livePreviewBlocks, minimalSourceChange, selectionTouchesBlock, formulaSourceRange } from '../src/live-preview-model.js';
import * as previewModel from '../src/live-preview-model.js';
import { EditorState,Text } from '@codemirror/state';

test('nested formula editing keeps quote and list continuation prefixes outside TeX', () => {
  for (const source of ['> $$\n> x+y\n> $$\n', '- [ ] 题干\n  $$x+y$$\n', '- 题干\n  1. 条件\n     $$x+y$$\n']) {
    const span=livePreviewBlocks(source).blocks.flatMap(block=>block.spans).find(span=>span.type==='math');
    const target=formulaSourceRange(source,span.from,span.to,true);
    assert.equal(target.value,'x+y');
    const edit=previewModel.formulaSourceEdit(target,'x+z\nw');
    const updated=source.slice(0,edit.from)+edit.insert+source.slice(edit.to);
    const next=livePreviewBlocks(updated).blocks.flatMap(block=>block.spans).find(span=>span.type==='math');
    assert.ok(next,'an edited container formula remains display math');
    assert.equal(formulaSourceRange(updated,next.from,next.to,true).value,'x+z\nw');
    assert.equal(updated.slice(0,edit.from),source.slice(0,edit.from));
    assert.equal(updated.slice(edit.from+edit.insert.length),source.slice(edit.to));
  }
});

test('live preview hides task metadata at its exact range without changing code examples or task identity', () => {
  const marker = '<!-- notara-task:lt-real -->';
  const source = `- [ ] 比较 $x_1+x_2$ ${marker}\n\n\`${marker}\`\n\n\`\`\`md\n- [ ] 示例 ${marker}\n\`\`\`\n`;
  const model = livePreviewBlocks(source), spans = model.blocks.flatMap(block => block.spans);
  const hidden = spans.filter(span => span.type === 'taskAnchor');
  assert.equal(hidden.length, 1);
  assert.equal(source.slice(hidden[0].from, hidden[0].to), marker);
  assert.equal(spans.find(span => span.type === 'task').label, '比较 $x_1+x_2$');
  assert.equal(source.slice(model.blocks[0].from, model.blocks[0].to), model.blocks[0].text);
});

test('live preview preserves complete math, code, embeds and nested fold units',()=>{
  const source='---\ntitle: 保留 # 注释\n---\n# 标题\n\n正文 $x^2$ [[来源]]。\n\n$$\nA = U\\Sigma V^T\n\nB = 2\n$$\n\n<details>\n<summary>原文</summary>\n\n![[来源]]\n\n<details><summary>内层</summary>\n\n内部\n\n</details>\n</details>\n\n```choice\nprompt: 问题\n- [ ] 选项\n```\n\n## 参考理解\n\n隐藏答案\n\n## 学生理解\n\n自己的理解\n';
  const model=livePreviewBlocks(source);
  assert.equal(source.slice(0,model.bodyStart),'---\ntitle: 保留 # 注释\n---\n');
  for(const block of model.blocks)assert.equal(block.text,source.slice(block.from,block.to));
  assert.equal(model.blocks.filter(block=>block.type==='math').length,1);
  assert.ok(model.blocks.find(block=>block.type==='math').text.includes('\n\nB = 2'));
  assert.equal(model.blocks.filter(block=>block.type==='fold').length,2);
  assert.ok(model.blocks.find(block=>block.text.startsWith('<details>')).text.trimEnd().endsWith('</details>'));
  assert.ok(model.blocks.find(block=>block.text.startsWith('## 参考理解')).text.includes('隐藏答案'));
  assert.ok(!model.blocks.find(block=>block.text.startsWith('## 参考理解')).text.includes('自己的理解'));
  assert.equal(model.blocks.find(block=>block.type==='code').text.trimEnd(),'```choice\nprompt: 问题\n- [ ] 选项\n```');
});
test('code examples do not create false folds and all intersecting selections reveal source',()=>{
  const source='```md\n<details>\n## 参考理解\n```\n\n正文\n';
  assert.deepEqual(livePreviewBlocks(source).blocks.map(block=>block.type),['code','paragraph']);
  const block={from:10,to:20,last:true};
  for(const range of [{from:10,to:10},{from:20,to:20},{from:0,to:30},{from:15,to:16}])assert.equal(selectionTouchesBlock(block,[range]),true);
  assert.equal(selectionTouchesBlock(block,[{from:0,to:5}]),false);
});
test('external synchronization uses a minimal source edit',()=>{
  assert.equal(minimalSourceChange('same','same'),null);
  for(const [before,after] of [['前缀\n正文\n末尾','前缀\n新正文\n末尾'],['','新文'],['旧文','']]){
    const change=minimalSourceChange(before,after);
    assert.equal(before.slice(0,change.from)+change.insert+before.slice(change.to),after);
  }
});
test('nested reference headings never capture content outside a details container',()=>{
  const source='<details>\n<summary>原页</summary>\n\n## 参考理解\n\n原页参考\n\n</details>\n\n外面的学生正文\n';
  const blocks=livePreviewBlocks(source).blocks;
  assert.equal(blocks.length,2);
  assert.equal(blocks[0].type,'fold');
  assert.ok(!blocks[0].text.includes('学生正文'));
  assert.equal(blocks[1].type,'paragraph');
});
test('minimal property synchronization keeps every internal line separate in CRLF documents',()=>{
  const before='---\r\ntitle: 测试\r\n---\r\n正文\r\n';
  const after=before.replace('title: 测试','title: 测试\r\nnew_property: value');
  const state=EditorState.create({doc:before,extensions:[EditorState.lineSeparator.of('\r\n')]}),change=minimalSourceChange(state.doc.toString(),after.replace(/\r\n/g,'\n'));
  const next=state.update({changes:{...change,insert:Text.of(change.insert.split('\n'))}}).state;
  assert.equal(next.sliceDoc(),after);
  assert.equal(next.doc.lines,state.doc.lines+1);
});
test('inline formulas have independent UTF-16 ranges and preserve delimiter whitespace',()=>{
  const source='---\ntitle: 试验\n---\n中😀 **粗 *斜* 体** $ a + b $ 与 $x$，`$not_math$`。';
  const model=livePreviewBlocks(source),block=model.blocks[0],math=block.spans.filter(span=>span.type==='inlineMath');
  assert.equal(block.inline,true);assert.equal(math.length,2);
  const first=formulaSourceRange(source,math[0].from,math[0].to);
  assert.equal(first.value,' a + b ');assert.equal(source.slice(first.from,first.to),'$ a + b $');
  const second=formulaSourceRange(source,math[1].from,math[1].to);
  assert.equal(source.slice(0,second.contentFrom)+'y'+source.slice(second.contentTo),source.replace('$x$','$y$'));
  assert.equal(block.spans.filter(span=>span.type==='strong').length,1);assert.equal(block.spans.filter(span=>span.type==='emphasis').length,1);
});
test('formula editor recognizes supported delimiters without modifying their source',()=>{
  for(const [raw,display,value] of [['$$x$$',false,'x'],['$$\nx\n\ny\n$$',true,'x\n\ny'],['\\(x\\)',false,'x'],['\\[x\\]',true,'x'],['```math\nx\n```',true,'x']]){
    const range=formulaSourceRange(raw,0,raw.length,display);assert.equal(range.value,value);assert.equal(range.raw,raw);
  }
  assert.equal(formulaSourceRange('$$\nx\n',0,5,true),null);
  const blocks=livePreviewBlocks('文字 \\(x\\) 与 $y$。\n\n```math\nz\n```').blocks;
  assert.equal(blocks[0].spans.filter(span=>span.type==='inlineMath').length,2);assert.equal(blocks[1].type,'math');
});
test('CJK punctuation strong syntax matches the native reader without interpreting escaped literal stars',()=>{
  const source='本导读按照**「第一梯度 $x$」**编排，**公式（$y$）**随后继续。';
  const block=livePreviewBlocks(source).blocks[0],strong=block.spans.filter(span=>span.type==='strong');
  assert.equal(strong.length,2);assert.equal(source.slice(strong[0].from,strong[0].to),'**「第一梯度 $x$」**');
  assert.equal(livePreviewBlocks('示例 \\*\\*普通星号\\*\\*').blocks[0].spans.filter(span=>span.type==='strong').length,0);
});
test('GFM marks, task markers, reference links and entities keep exact source ranges',()=>{
  const source='- [ ] 学习 **矩阵**\n- [x] 完成\n\n~~删去~~ &amp; [链接][ref] 和 `**代码**`\n\n标题\n====\n\n[ref]: https://example.com\n';
  const blocks=livePreviewBlocks(source).blocks,spans=blocks.flatMap(block=>block.spans);
  assert.equal(spans.filter(span=>span.type==='task').length,2);assert.equal(spans.filter(span=>span.type==='delete').length,1);assert.equal(spans.filter(span=>span.type==='linkReference').length,1);
  const entity=spans.find(span=>span.type==='entity');assert.equal(entity.value,'&');assert.equal(source.slice(entity.from,entity.to),'&amp;');
  assert.ok(spans.some(span=>span.type==='syntax'&&source.slice(span.from,span.to).includes('====')));
  assert.equal(spans.filter(span=>span.type==='strong').length,1,'code remains literal');
  const table=livePreviewBlocks('| A | B |\n| --- | --- |\n| 1 | 2 |').blocks[0];assert.equal(table.type,'table');assert.equal(table.inline,false);
});
test('HTML line breaks are recognized only outside literal code',()=>{
  const source='前面<br>后面，`<br>` 应原样。\n\n```html\n<br />\n```';
  const blocks=livePreviewBlocks(source).blocks;
  assert.equal(blocks[0].spans.filter(span=>span.type==='htmlBreak').length,1);
  assert.equal(blocks[1].spans.filter(span=>span.type==='htmlBreak').length,0);
});
