import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fromMarkdown} from 'mdast-util-from-markdown';
import {gfm} from 'micromark-extension-gfm';
import {gfmFromMarkdown} from 'mdast-util-gfm';
import {math} from 'micromark-extension-math';
import {mathFromMarkdown} from 'mdast-util-math';
import katex from 'katex';
import {patchDshMath,patchDshWebMath} from '../plugins/bundle/math-adapter.mjs';
import {notaraStreamingMathParser} from '../plugins/graph-and-blocks/src/domain/markdown-math.js';

const walk=node=>[node,...(node.children??[]).flatMap(walk)];
const nodes=frame=>[...frame.frozen,...frame.tail].flatMap(({node})=>walk(node));
const formulas=frame=>nodes(frame).filter(n=>n.type==='math'||n.type==='inlineMath');

// Execute the actual patched library's grammar, freeze frontier and parser
// assignment. The installed package is read-only; every patch targets a copy.
async function fixture(run){
  const directory=await mkdtemp(join(tmpdir(),'notara-streaming-math-'));
  try{
    await mkdir(join(directory,'lib'));
    await writeFile(join(directory,'package.json'),JSON.stringify({version:'0.2.1-rc.4'}));
    const path=join(directory,'lib/index.js');
    await writeFile(path,await readFile(new URL('../node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/index.js',import.meta.url)));
    await patchDshMath({directory,restore:true});await patchDshMath({directory});
    const source=await readFile(path,'utf8');
    const incremental=source.split('//#region lib/types/markdown/incremental.js\n')[1].split('//#endregion')[0];
    const helper=source.match(/^\/\/ NOTARA_MATH_START [a-f0-9]{64}\n([\s\S]*?)^\/\/ NOTARA_MATH_END/m)[1];
    const grammar=name=>source.match(new RegExp('function '+name+'\\(text\\) \\{[\\s\\S]*?\\n\\}'))[0];
    const assignment=source.split('var StreamingRenderer = class {')[1].match(/parser = ([^\n]+);/)[1];
    const images=source.split('//#region lib/types/markdown/local-image-syntax.js\n')[1].split('//#endregion')[0];
    const compile=new Function('fromMarkdown','gfm','gfmFromMarkdown','math','mathFromMarkdown','katex',
      'const classifyFileType=()=>"image",cjkFriendlyStrong=()=>({});\n'+images+'\n'+incremental+'\n'+helper+'\n'+grammar('parseGfm')+'\n'+grammar('parseGfmWithMath')+
      '\nreturn {parser:()=>'+assignment+',settled:parseGfmWithMath};');
    await run(compile(fromMarkdown,gfm,gfmFromMarkdown,math,mathFromMarkdown,katex));

    // Execute the actual minified browser grammar/frontier as well, without
    // starting a browser or changing shared dependencies during parallel work.
    const web=join(directory,'web'),dist=join(web,'dist');
    await mkdir(join(dist,'assets'),{recursive:true});
    await writeFile(join(web,'package.json'),JSON.stringify({version:'0.2.1-rc.4'}));
    const webSource=new URL('../node_modules/@deepseek-ai/dsh-web-frontend/dist/',import.meta.url);
    const html=await readFile(new URL('index.html',webSource),'utf8');
    await writeFile(join(dist,'index.html'),html);
    const entries=new Set(['assets/index-BXV-oxvX.js',html.match(/src="\.\/([^\"]+\.js)"/)[1]]);
    for(const entry of entries)await writeFile(join(dist,entry),await readFile(new URL(entry,webSource)));
    await patchDshWebMath({directory:web});
    const patchedHtml=await readFile(join(dist,'index.html'),'utf8');
    const body=await readFile(join(dist,patchedHtml.match(/src="\.\/([^\"]+\.js)"/)[1]),'utf8');
    const webIncremental=body.slice(body.indexOf('const EF=2;'),body.indexOf(';function ew('))+';';
    const webHelper=body.slice(body.indexOf('function notaraMath('),body.indexOf('function qF('));
    const webAssignment=body.split('var vU=class{labels;parser=')[1].split(';generation=')[0];
    const webSettled='function qF(e){return ew(notaraParseMath(s7,e,{extensions:[a7(),tw()],mdastExtensions:[l7(),$b()]},yb()),e)}';
    assert.ok(body.includes(webSettled));
    const webImages=body.slice(body.indexOf('function ew('),body.indexOf('const TF='));
    const compileWeb=new Function('s7','a7','l7','yb','$b','vh',
      'const tw=()=>({}),ou=()=>"image";\n'+webImages+'\n'+webIncremental+'\n'+webHelper+'\n'+webSettled+
      '\nreturn {parser:()=>'+webAssignment+',settled:qF};');
    await run(compileWeb(fromMarkdown,gfm,gfmFromMarkdown,math,mathFromMarkdown,katex));
  }finally{await rm(directory,{recursive:true,force:true});}
}

test('native streaming grammar exposes complete math before the reply finishes',()=>fixture(({parser})=>{
  const stream=parser();
  const source='开头 $x^2$ 与 \\(y+1\\)。\n\n$$\\frac{1}{2}$$\n\n后文仍在生成';
  const frame=stream.update(source);
  assert.deepEqual(formulas(frame).map(n=>n.value),['x^2','y+1','\\frac{1}{2}']);
  for(const node of formulas(frame))assert.match(katex.renderToString(node.value,{throwOnError:true}),/class="katex"/);
  assert.ok(nodes(frame).some(n=>n.type==='text'&&n.value.includes('仍在生成')));
  const image=stream.update(source+'\n\n![本地图](/资料/带 空格.jpg)');
  assert.equal(nodes(image).find(n=>n.type==='image').url,'/资料/带 空格.jpg');
}));

test('pending display math survives blank-line freezing and split TeX delimiters',()=>fixture(({parser,settled})=>{
  for(const [open,close] of [['$$','$$'],['\\[','\\]']]){
    const stream=parser(),prefix='已完成段落。\n\n第二段。\n\n第三段。\n\n';
    const pending=prefix+open+'\\begin{aligned}\na&=1\\\\\n\nb&=2\\\\\n\nc&=3\\end{aligned}\n';
    let frame;
    for(let i=1;i<=pending.length;i++)frame=stream.update(pending.slice(0,i));
    assert.equal(formulas(frame).length,0);
    assert.ok(frame.frozen.every(({key})=>key<prefix.length),'pending opener must not freeze as literal text');
    const first=frame.frozen[0];
    const complete=pending+close+'\n\n后续正文。\n\n第四段。\n\n第五段。';
    for(let i=pending.length+1;i<=complete.length;i++)frame=stream.update(complete.slice(0,i));
    assert.equal(formulas(frame).length,1);
    assert.equal(frame.frozen[0],first,'stable prefix retains its cached nodes');
    assert.deepEqual(formulas(frame).map(n=>n.value),walk(settled(complete)).filter(n=>n.type==='math'||n.type==='inlineMath').map(n=>n.value));
    const shape=({position,data,...node})=>({...node,...(node.children?{children:node.children.map(shape)}:{})});
    assert.deepEqual([...frame.frozen,...frame.tail].map(({node})=>shape(node)),settled(complete).children.map(shape));
  }
}));

test('incomplete commands, inline code and unclosed fences stay literal without swallowing prose',()=>fixture(({parser})=>{
  for(const source of [
    '未完成 $\\frac{a}$ 后续正文',
    '未完成 $$\\begin{aligned}a&=1$$\n\n后续正文',
    '未完成 $\\sqrt{$ 后续正文',
    '未完成 $\\unknown$ 后续正文',
  ]){
    const frame=parser().update(source);
    assert.equal(formulas(frame).length,0,source);
    assert.ok(nodes(frame).some(n=>n.type==='text'&&n.value.includes('后续正文')),source);
  }
  const stream=parser(),source='$$未闭合\n\n后续正文\n\n`$x$`\n\n```tex\n$$y$$\n\n$z$';
  let frame;
  for(let i=1;i<=source.length;i++)frame=stream.update(source.slice(0,i));
  assert.equal(formulas(frame).length,0);
  assert.equal(nodes(frame).find(n=>n.type==='inlineCode').value,'$x$');
  assert.equal(nodes(frame).find(n=>n.type==='code').value,'$$y$$\n\n$z$');
  frame=stream.update(source+'\n```\n\n独立 $w$');
  assert.deepEqual(formulas(frame).map(n=>n.value),['w']);
  for(const source of ['$$open\n\n```tex\ncode\n$$','\\[open\n\n~~~tex\ncode\n\\]']){
    for(const split of [false,true]){
      const parserInstance=parser();
      if(split)for(let i=1;i<source.length;i++)parserInstance.update(source.slice(0,i));
      const codeFrame=parserInstance.update(source);
      assert.equal(formulas(codeFrame).length,0,'a delimiter inside a fence cannot close outside math');
      assert.ok(nodes(codeFrame).some(n=>n.type==='code'&&n.value.includes('code')));
    }
  }
}));

test('stream replacement resets frozen math and final valid formulas equal settled grammar',()=>fixture(({parser,settled})=>{
  const stream=parser();
  stream.update('$old$\n\n一段\n\n二段\n\n三段');
  const source='新回复 $\\frac{1}{2}$\n\n> \\[x+y\\]\n\n```tex\n$x$\n```\n\n末尾 $z$';
  const frame=stream.update(source);
  assert.ok(frame.generation>0);
  assert.deepEqual(formulas(frame).map(n=>n.value),walk(settled(source)).filter(n=>n.type==='math'||n.type==='inlineMath').map(n=>n.value));
  assert.ok(!formulas(frame).some(n=>n.value==='old'));
  assert.equal(stream.update(source),frame,'identical source reuses its frame');
}));

test('only closed candidate values reach TeX validation and unchanged formulas are cached',()=>{
  const calls=[];
  const parse=notaraStreamingMathParser(fromMarkdown,{mdastExtensions:[mathFromMarkdown()]},math(),(value,displayMode)=>{
    calls.push({value,displayMode});return katex.renderToString(value,{displayMode,throwOnError:true});
  });
  for(const source of ['正文 $\\fra','正文 $\\frac{1}{','正文 $\\frac{1}{2'])assert.equal(walk(parse(source)).filter(n=>n.type==='inlineMath').length,0);
  assert.deepEqual(calls,[]);
  for(const suffix of ['',' 继续',' 继续正文',' 继续正文\n\n最后一段'])parse('正文 $\\frac{1}{2}$'+suffix);
  assert.deepEqual(calls,[{value:'\\frac{1}{2}',displayMode:false}]);
  for(const source of ['$\\frac{1}$ 后文 $z$', '$\\frac{1}$ 后文 $z$ 继续']){
    assert.deepEqual(walk(parse(source)).filter(n=>n.type==='inlineMath').map(n=>n.value),['z'],'rejected closer cannot open math across the next formula');
  }
  assert.equal(calls.filter(({value})=>value==='\\frac{1}').length,1,'failed candidates are cached too');
});
