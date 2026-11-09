import test from 'node:test';
import assert from 'node:assert/strict';
import {fromMarkdown} from 'mdast-util-from-markdown';
import {math} from 'micromark-extension-math';
import {mathFromMarkdown} from 'mdast-util-math';
import {notaraParseMath} from '../src/domain/markdown-math.js';
import {parseStructure} from '../../vault-views/src/markdown-structure.js';
import {formulaSourceRange} from '../../vault-views/src/live-preview-model.js';

const parse=source=>notaraParseMath(fromMarkdown,source,{mdastExtensions:[mathFromMarkdown()]},math());
const walk=node=>[node,...(node.children??[]).flatMap(walk)];
test('same-line and multiline display delimiters preserve the formula and following prose',()=>{
  for(const raw of ['$$x+y$$','$$x+\ny$$','$$\nx+\ny\n$$','$$x+\ny\n$$','$$\nx+\ny$$','$$x+\ny$$  ','$$$x+\ny$$$','$$\n\\frac{1}{2}\n\n+\\sqrt{x}\n$$','$$x+\r\ny$$','\\[x+\ny\\]']){
    const source=raw+'\n\n后续正文 **保留**。\n\n- 另一段';
    for(const parser of [parse,parseStructure]){
      const tree=parser(source),formulas=walk(tree).filter(n=>n.type==='math');
      assert.equal(formulas.length,1,raw);
      const formula=formulas[0],range=formulaSourceRange(source,formula.position.start.offset,formula.position.end.offset,true);
      assert.equal(formula.position.start.offset,0);
      assert.equal(formula.position.end.offset,raw.length);
      assert.equal(range.raw,raw); assert.equal(range.value,formula.value);
      assert.equal(formula.meta,null);
      assert.equal(tree.children[1].type,'paragraph');
      assert.match(JSON.stringify(tree.children[1]),/后续正文/);
      assert.equal(tree.children[2].type,'list');
    }
  }
});
test('unclosed blocks never consume the rest of the document as math',()=>{
  for(const source of ['$$x\n\n后续正文','$$\nx\n\n后续正文','$$$x\n\n后续正文','\\[x\n\n后续正文','> $$x\n\n普通正文\n$$']){
    assert.equal(walk(parse(source)).filter(n=>n.type==='math').length,0,source);
    assert.match(JSON.stringify(parse(source)),/正文/);
  }
});
test('Markdown containers, code and escaped delimiters retain their boundaries',()=>{
  const source='> $$x+\n> y$$\n\n尾文\n\n```text\n$$a+\nb$$\n```\n\n`$z$` 与 \\$x\\$';
  const nodes=walk(parse(source));
  assert.equal(nodes.filter(n=>n.type==='math').length,1);
  assert.equal(nodes.find(n=>n.type==='math').value,'x+\ny');
  assert.equal(nodes.find(n=>n.type==='code').value,'$$a+\nb$$');
  assert.equal(nodes.find(n=>n.type==='inlineCode').value,'$z$');
  assert.equal(nodes.filter(n=>n.type==='inlineMath').length,0);
  const inline=walk(parse('比较 $x^2$ 与 \\(y^2\\)，`\\(z\\)` 是代码。'));
  assert.deepEqual(inline.filter(n=>n.type==='inlineMath').map(n=>n.value),['x^2','y^2']);
});
test('a closer followed by prose cannot capture the next formula',()=>{
  const tree=parse('$$a\nb$$ 后面的正文\n\n$$c$$\n\n尾文'),nodes=walk(tree);
  assert.deepEqual(nodes.filter(n=>n.type==='math').map(n=>n.value),['c']);
  assert.ok(nodes.some(n=>n.type==='text'&&n.value.includes('后面的正文')));
  assert.equal(tree.children.at(-1).children[0].value,'尾文');
});
test('unclosed candidates restore document-level list and quote parsing',()=>{
  for(const opening of ['$$未闭合','\\[未闭合']){
    const source=opening+'\n\n> 引用\n\n- 列表项\n\n尾文';
    assert.deepEqual(parse(source).children.map(n=>n.type),['paragraph','blockquote','list','paragraph']);
  }
  const many=Array.from({length:20},(_,i)=>'$$未闭合'+i).join('\n\n')+'\n\n> 引用\n\n- 列表项';
  const tree=parse(many);
  assert.equal(tree.children.at(-2).type,'blockquote');assert.equal(tree.children.at(-1).type,'list');
});
test('a display candidate cannot take its closer from a subsequent code fence',()=>{
  for(const fence of ['```tex','~~~tex'])for(const opening of ['$$open','\\[open']){
    const source=opening+'\n\n'+fence+'\n'+(opening.startsWith('$$')?'$$':'\\]');
    const tree=parse(source);
    assert.equal(walk(tree).filter(n=>n.type==='math').length,0);
    assert.equal(tree.children.at(-1).type,'code');
    assert.equal(tree.children.at(-1).value,opening.startsWith('$$')?'$$':'\\]');
  }
});
test('editor ranges keep formula first and last lines when they share delimiters',()=>{
  for(const [raw,value] of [['$$first\nlast$$','first\nlast'],['$$\nfirst\nlast$$','first\nlast'],['$$first\nlast\n$$','first\nlast'],['$$$first\nlast$$$  ','first\nlast']]){
    const prefix='汉字🙂\n',source=prefix+raw+'\n正文';
    const range=formulaSourceRange(source,prefix.length,prefix.length+raw.length,true);
    assert.equal(range.value,value);assert.equal(source.slice(range.contentFrom,range.contentTo),value);
    const replacement='u+\nv',edited=source.slice(0,range.contentFrom)+replacement+source.slice(range.contentTo);
    assert.equal(edited.slice(0,range.contentFrom),source.slice(0,range.contentFrom));
    assert.equal(edited.slice(range.contentFrom+replacement.length),source.slice(range.contentTo));
  }
});
