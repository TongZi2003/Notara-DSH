import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { boardComponents, validateBoardAnswer, boardAnswerMessage, splitBoardBody, hasInteractiveBlocks } from '../src/domain/board-components.js';
import { sanitizeBoardHtml, parseHtmlComponent, sanitizeCssStyle } from '../src/domain/board-html.js';
import { compileExpression } from '../src/domain/math-expression.js';
import { projectGraph, createSimulation, nodeAppearance, readGraph } from '../src/graph.js';
import { createAnswerStore, answerKey } from '../src/answer-store.js';
import { appendAnswer } from '../src/composer.js';
import {studentMarkdown} from '../src/domain/student-markdown.js';
import {htmlIdentity} from '../src/domain/board-html.js';

const component = (type, body) => boardComponents('```' + type + '\n' + body + '\n```')[0];
test('real RemoteResult envelopes are unwrapped; failed or bare DTOs do not masquerade as success', async () => {
  const graph = { nodes: [], edges: [] };
  assert.deepEqual(await readGraph({ graph: async input => { assert.deepEqual(input, {}); return { ok: true, value: graph }; } }), graph);
  await assert.rejects(readGraph({ graph: async () => ({ ok: false, error: { message: 'private detail' } }) }));
  await assert.rejects(readGraph({ graph: async () => graph }));
});
test('retired choice/blank fences are read-only and preserve following component identities', () => {
  const review = '```notara-review\n' + JSON.stringify({targetPath:'卡片/条件.md',keyStep:'判断条件',result:'done',support:'hint',note:'已提示'}) + '\n```';
  const old = '```choice\n问题\n- 甲\n- 乙\n```\n\n```blank\n{{ 条件 }}\n```';
  const source = old + '\n\n' + review;
  const parsed = splitBoardBody(source);
  assert.deepEqual(parsed.segments.filter(s => s.kind === 'retired').map(s => [s.type,s.index]), [['choice',0],['blank',1]]);
  assert.equal(parsed.segments[0].text, old.split('\n\n')[0]);
  assert.equal(boardComponents(source).length,1);
  assert.equal(boardComponents(source)[0].index,2);
  assert.equal(hasInteractiveBlocks(source),true);
  assert.equal(component('choice','问题\n- 甲\n- 乙'),undefined);
  assert.equal(component('blank','{{ 条件 }}'),undefined);
  assert.throws(()=>validateBoardAnswer(undefined,{pick:[0]}),/board_component_missing/);
});
test('order group validation remains available', () => {
  const o = component('order', 'prompt: 归类\ngroups: 可行 | 不可行\n- 甲\n- 乙'); assert.equal(o.error, undefined);
  assert.throws(() => validateBoardAnswer(o, { groups: [[0], [0]] }));
  assert.deepEqual(validateBoardAnswer(o, { groups: [[1], [0]] }), { groups: [[1], [0]] });
});
test('retired code headings cannot hide the next review proposal',()=>{
  const source='```blank\n## 提示\n{{ 条件 }}\n```\n\n```notara-review\n{}\n```\n\n## 参考理解\nSECRET\n\n## 学生理解\n实际表达';
  const visible=studentMarkdown(source);
  assert.ok(visible.startsWith('```blank\n## 提示\n{{ 条件 }}\n```'));
  assert.equal(boardComponents(visible)[0].index,1);
  assert.doesNotMatch(visible,/SECRET/);
  assert.match(visible,/实际表达/);
});
test('display-only HTML keeps its historical step/panel fingerprint inputs',()=>{
  const spec=parseHtmlComponent('<button data-step="1">步骤一</button><div data-panel="1">内容</div>');
  assert.equal(htmlIdentity(spec),['html',spec.stem,'single','optional',spec.html].join('\u0000'));
});
test('answer locator cannot cut a formula or consume the actual answer', () => {
  const formula = '$' + 'x+'.repeat(35) + 'y$';
  const c = component('order', formula + '\n- $x^2$\n- $y^2$');
  const answer=validateBoardAnswer(c,{order:[1,0]});
  const message=boardAnswerMessage({sectionTitle:formula,blockTitle:formula,component:c,answer});
  assert.equal(message,'〔白板｜排序与归类 · 第 1 项〕\n\n我的顺序：1. $y^2$ 2. $x^2$');
});
test('review proposals are recognized, bounded and never fall back to raw protocol', () => {
  const value = { targetPath: '卡片/等和线.md', keyStep: '由 D 在 BC 上得到 $x+y=1$', result: 'done', support: 'hint', note: '刚听过讲解' };
  const valid = component('notara-review', JSON.stringify(value));
  assert.equal(valid.error, undefined);
  assert.deepEqual(valid.spec, value);
  assert.equal(valid.answerable, false);
  const followUp={question:'自己找出比较点',afterDays:6,reason:'稍后迁移'};
  const diary={...value,targetPath:'日记/今天.md',heading:'单调性讨论',followUp,note:'实况'.repeat(2500)};
  assert.deepEqual(component('notara-review',JSON.stringify(diary)).spec,diary);
  assert.equal(component('notara-review',JSON.stringify({...value,followUp:null})).spec.followUp,null);
  assert.ok(component('notara-review',JSON.stringify({...value,followUp:{...followUp,afterDays:-1}})).error);
  for (const bad of ['{', JSON.stringify({ ...value, targetPath: '../secret.md' }), JSON.stringify({ ...value, support: 'mastered' }), JSON.stringify({ ...value, keyStep: 'a'.repeat(201) })]) {
    assert.ok(component('notara-review', bad).error);
  }
  const partial = splitBoardBody('前文\n```notara-review\n{"targetPath":');
  assert.ok(partial.open);
  assert.doesNotMatch(JSON.stringify(partial.segments), /targetPath/);
  assert.equal(hasInteractiveBlocks('```text\n```notara-review\n{}\n```\n```'), false);
});
test('all showcase Canvas blocks parse with their real format', () => {
  const root = new URL('../../../showcase-examples/', import.meta.url); let count = 0;
  for (const dir of readdirSync(root)) for (const file of readdirSync(new URL(`${dir}/白板/`, root))) {
    const canvas = JSON.parse(readFileSync(new URL(`${dir}/白板/${file}`, root), 'utf8'));
    for (const node of canvas.nodes) if (node.type === 'text') for (const c of boardComponents(node.text)) { assert.equal(c.error, undefined, `${dir}/${node.id}: ${JSON.stringify(c.error)}`); count++; }
  }
  assert.equal(count, 5); // Two frames, two flows and one order; old questions are prose.
});
test('frames prediction text and identity survive parsing, invalid gates rejected', () => {
  const c = component('frames', 'title: 推演\nframe 现在\n甲\npredict: 下一步？\nframe 以后\n乙');
  assert.equal(c.error, undefined); assert.equal(c.spec.frames[1].predict, true); assert.equal(c.spec.frames[1].predictionPrompt, '下一步？');
  assert.throws(() => validateBoardAnswer(c, { frame: 0, text: '猜测' }));
  const answer = validateBoardAnswer(c, { frame: 1, unsure: true }); assert.match(boardAnswerMessage({ blockTitle: '', component: c, answer }), /预测不出来/);
});
test('legal indented frames fences never fall through to Markdown with future text', () => {
  const lines = ['```frames', 'title 推演', 'frame 开始', '当前条件', 'predict: 下一步？', 'frame 答案帧', 'HIDDEN_FUTURE_42', '```'];
  for (const indent of [1, 2, 3]) {
    const source = lines.map(line => ' '.repeat(indent) + line).join('\n');
    const parsed = splitBoardBody(source), components = boardComponents(source);
    assert.equal(hasInteractiveBlocks(source), true);
    assert.equal(components.length, 1, `${indent} spaces`); assert.equal(components[0].error, undefined);
    assert.equal(parsed.segments.some(s => s.kind === 'markdown' && s.text.includes('HIDDEN_FUTURE_42')), false);
  }
});
test('known malformed or unclosed interactive fences fail closed; matching length/marker are required', () => {
  for (const mark of ['```', '````', '~~~']) {
    const source = `${mark}frames\nframe 起点\n条件\npredict\nframe 以后\nFUTURE\n${mark}`;
    assert.equal(hasInteractiveBlocks(source), true); assert.equal(boardComponents(source)[0].error, undefined);
  }
  const malformed = ' ```frames extra-info\n frame 开始\n 条件\n predict\n frame 后续\n FUTURE\n ```';
  assert.equal(hasInteractiveBlocks(malformed), true); assert.ok(boardComponents(malformed)[0].error);
  assert.equal(splitBoardBody(malformed).segments.some(s => s.kind === 'markdown' && s.text.includes('FUTURE')), false);
  const unclosed = '   ````frames\nframe 起点\n条件\npredict\nframe 以后\nFUTURE\n```';
  assert.equal(hasInteractiveBlocks(unclosed), true); assert.ok(splitBoardBody(unclosed).open);
  assert.equal(splitBoardBody(unclosed).segments.some(s => s.kind === 'markdown' && s.text.includes('FUTURE')), false);
});
test('math compiler evaluates allowed expressions and rejects property access and scripts', () => {
  assert.equal(compileExpression('2x^2 + sin(pi/2)', ['x']).evaluate({ x: 3 }), 19);
  for (const expr of ['globalThis.alert(1)', 'x.constructor', 'fetch(1)', 'this', 'x=2', '1;throw 2', '('.repeat(400)]) assert.throws(() => compileExpression(expr, ['x']), expr);
});
test('HTML sanitizer strips scripts, external CSS/SVG requests and answer defaults', () => {
  const html = sanitizeBoardHtml('<script>alert(1)</script><iframe src="x"></iframe><div onclick="x()" style="background:url(//bad);position:fixed">安全<input data-blank="推导" value="答案"><button data-choice="A" aria-checked="true">甲</button><svg><path fill="url(//bad/x)" d="M0 0L2 2"/></svg></div>');
  assert.doesNotMatch(html, /script|iframe|onclick|\/\/bad|position:fixed|答案|aria-checked/);
  assert.doesNotMatch(html, /<input|data-blank|data-option|data-choice/);
});
test('HTML CSS resource functions including quoted image-set are rejected', () => {
  for (const declaration of ['background-image:image-set("https://css-fixture.invalid/pixel" 1x)', 'background-image:-webkit-image-set("https://css-fixture.invalid/pixel" 1x)', 'background:cross-fade(url(x),red,20%)', 'list-style-image:image-set("//css-fixture.invalid/pixel" 1x)', '--image:image-set("https://css-fixture.invalid/pixel" 1x)', 'cursor:url(x),auto', 'background-image:var(--external-image)', 'fill:paint(external)']) assert.equal(sanitizeCssStyle(declaration), '', declaration);
  assert.match(sanitizeCssStyle('display:grid;gap:8px;background:linear-gradient(90deg,#fff,#eee);color:rgb(10 20 30)'), /display:grid/);
});
test('HTML math shares delimiter boundaries and leaves code literal',()=>{
  const html=sanitizeBoardHtml('<div>$$x+\ny$$\n\n公式后正文</div><pre><code>$$a+\nb$$</code></pre>');
  assert.match(html,/katex/);assert.match(html,/公式后正文/);
  assert.match(html,/<pre><code>\$\$a\+\nb\$\$<\/code><\/pre>/);
  assert.equal((html.match(/<annotation/g)??[]).length,1);
});
test('HTML keeps panels but removes retired inputs, choices and answer metadata', () => {
  const spec = parseHtmlComponent('<div data-multiple="true"><input data-blank="条件"><button data-choice="A">甲</button><button data-choice="B">乙</button><button data-step="1">第一步</button><div data-panel="1">过程</div><span data-answer="secret">文字</span></div>');
  assert.equal(spec.multiple, undefined); assert.equal(spec.options, undefined); assert.match(spec.html, /data-panel="1"/); assert.doesNotMatch(spec.html, /secret|data-answer|<input|data-(?:blank|choice|option|multiple)/);
  const c=component('html','<div>{{ 条件 }}<svg><text>{{ 数值 }}</text></svg></div>');
  assert.equal(c.answerable,false); assert.match(c.spec.html,/\{\{ 条件 \}\}/);
  assert.throws(()=>validateBoardAnswer(c,{fills:['答案']}),/board_component_missing/);
});
test('solid links win undirected pair, one hop and tag intersection filters', () => {
  const data = { nodes: ['a', 'b', 'c', 'd'].map((path, i) => ({ path, type:'card', tags: i < 2 ? ['甲', '乙'] : ['甲'] })), edges: [{ source: 'a', target: 'b', style: 'dashed' }, { source: 'b', target: 'a', style: 'solid' }, { source: 'b', target: 'c', style: 'solid' }, { source: 'c', target: 'd', style: 'solid' }] };
  const graph = projectGraph(data, 'a', ['甲', '乙']); assert.deepEqual(graph.nodes.map(n => n.path), ['a', 'b']); assert.equal(graph.edges.length, 1); assert.equal(graph.edges[0].style, 'solid');
  assert.deepEqual(projectGraph(data, null, ['甲', '乙']).nodes.map(node => node.path), ['a', 'b']);
  assert.equal(nodeAppearance({ lastSupport: 'independent', reviewStatus: 'done' }).independent, false);
  assert.equal(nodeAppearance({ independentReviewCount: 1, reviewStatus: 'due' }).independent, true);
  assert.equal(nodeAppearance({ independentReviewCount: 0 }).independent, false);
});
test('multiple centers union their neighborhoods within the common-tag scope', () => {
  const data = { nodes: ['a','b','c','d','e'].map(path => ({ path, type:'card', tags: path === 'c' ? ['甲'] : ['甲','乙'] })), edges: [{ source:'a',target:'b' },{ source:'b',target:'c' },{ source:'c',target:'d' },{ source:'d',target:'e' }] };
  assert.deepEqual(projectGraph(data, ['a','e'], [], 0).nodes.map(n => n.path), ['a','e']);
  assert.deepEqual(projectGraph(data, ['a','e'], [], 1).nodes.map(n => n.path), ['a','b','d','e']);
  assert.equal(projectGraph(data, ['a','e'], [], 2).nodes.length, 5);
  const intersection = projectGraph(data, ['a','e'], ['甲','乙'], 2);
  assert.deepEqual(intersection.nodes.map(n => n.path), ['a','b','d','e']); assert.equal(intersection.edges.length, 2);
  assert.equal(projectGraph(data, ['missing'], [], 1).nodes.length, 0);
  assert.equal(projectGraph(data, [], ['不存在']).nodes.length, 0);
  // A filtered-out intermediary still defines distance in the original graph.
  assert.deepEqual(projectGraph(data, ['b'], ['甲','乙'], 2).nodes.map(n => n.path), ['a','b','d']);
  assert.equal(projectGraph(data,[],['甲','乙'],1,'any').nodes.length,5);
  assert.equal(projectGraph(data,['a'],['甲','乙'],1,'any').nodes.length,2);
  assert.equal(projectGraph(data,[],[],1,'any').nodes.length,5);
});
test('world-space pinned positions survive filtering and viewport changes', () => {
  const live = createSimulation({ nodes: [{ path: 'a' }], edges: [] }, () => {}, 300, 580, new Map([['a', { x:-300, y:900, fx:-300, fy:900 }]]));
  live.simulation.stop(); live.simulation.tick(2); assert.equal(live.nodes[0].x,-300); assert.equal(live.nodes[0].y,900);
});
test('force simulation moves nodes and keeps pinned coordinates without mutating RPC objects', () => {
  const graph = { nodes: [{ path: 'a' }, { path: 'b' }], edges: [{ source: 'a', target: 'b', style: 'solid' }] };
  const live = createSimulation(graph); live.simulation.stop(); live.nodes[0].fx = 100; live.nodes[0].fy = 120; live.simulation.tick(50);
  assert.equal(live.nodes[0].x, 100); assert.equal(live.nodes[0].y, 120); assert.ok(Number.isFinite(live.nodes[1].x)); assert.equal(graph.nodes[0].x, undefined); assert.equal(graph.edges[0].source, 'a');
});
test('graph initial pose is centered before any asynchronous simulation tick', () => {
  const graph = { nodes: Array.from({ length: 20 }, (_, i) => ({ path: `${i}.md` })), edges: [] };
  const live = createSimulation(graph); live.simulation.stop();
  assert.ok(live.nodes.every(n => n.x > 250 && n.x < 710 && n.y > 100 && n.y < 480));
  assert.ok(Math.abs(live.nodes.reduce((sum, n) => sum + n.x, 0) / live.nodes.length - 480) < 25);
});
test('shared answer store isolates node, content fingerprint and classroom; bounded persistence', () => {
  const storage = new Map(), adapter = { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) };
  const store = createAnswerStore({ storage: adapter, limit: 2 }), key = answerKey({ scope: 's1', nodeId: 'n', fingerprint: 'f1' }); let notifications = 0;
  const stop = store.subscribe(key, () => notifications++); store.set(key, { fills: ['甲'] }); assert.deepEqual(store.get(key), { fills: ['甲'] }); assert.equal(notifications, 1); stop();
  assert.equal(store.get(answerKey({ scope: 's2', nodeId: 'n', fingerprint: 'f1' })), null); assert.equal(store.get(answerKey({ scope: 's1', nodeId: 'n', fingerprint: 'f2' })), null);
  assert.deepEqual(createAnswerStore({ storage: adapter }).get(key), { fills: ['甲'] }); store.set('two', {}); store.set('three', {}); assert.equal(storage.size, 2);
});
test('native composer append preserves chip coordinates, rejects stale session and does not submit', () => {
  let request, selected;
  const scope = { bail(_self, name, input) { assert.equal(name, 'slash/input-insert-text'); request = input; return true; } };
  const ctx = { sessions: { list: { getSnapshot: () => ({ byId: { s: { id: 's', retainedBy: { mainView: 1 } } } }) }, scope: () => scope }, conversation: { blocks: { storeFor: () => ({ getSnapshot: () => null }) }, input: { for: () => ({ state: { getSnapshot: () => ({ phase: 'plain', draft: '已有【引用】', occurrences: [{ length: 4 }], draftRev: 4 }) } }) } }, layout: { selectPanel: id => { selected = id; } } };
  appendAnswer(ctx, 's', '我的作答'); assert.equal(request.text, '\n\n我的作答'); assert.equal(request.span.start, 3); assert.equal(request.span.end, 3); assert.equal(selected, null); assert.throws(() => appendAnswer(ctx, 'other', '不要插入'));
  ctx.sessions.list.getSnapshot = () => ({ byId: { s: { id: 's', retainedBy: { mainView: 1 }, subagent: { address: { mode: 'one-shot' } } } } });
  request = undefined;
  assert.throws(() => appendAnswer(ctx, 's', '一次性记录不可作答'), /不支持继续作答/);
  assert.equal(request, undefined);
});
test('an embedded native child card writes to its own draft, never its parent or another classroom',()=>{
  let target,request;
  const rows={parent:{id:'parent',retainedBy:{mainView:1}},child:{id:'child',retainedBy:{sidebarChat:1},subagent:{address:{parentSessionId:'parent',childSessionId:'child',mode:'continuable'}}}};
  const ctx={sessions:{list:{getSnapshot:()=>({byId:rows})},scope:id=>{target=id;return {bail:(_scope,_event,value)=>{request=value;return true;}};}},conversation:{blocks:{storeFor:()=>({getSnapshot:()=>null})},input:{for:()=>({state:{getSnapshot:()=>({phase:'plain',draft:'',occurrences:[],draftRev:1})}})}},layout:{selectPanel:()=>{}}};
  appendAnswer(ctx,'child','子课作答');assert.equal(target,'child');assert.equal(request.text,'子课作答');
  rows.nested={id:'nested',retainedBy:{sidebarChat:1},subagent:{address:{parentSessionId:'child',childSessionId:'nested',mode:'continuable'}}};
  appendAnswer(ctx,'nested','嵌套作答');assert.equal(target,'nested');assert.equal(request.text,'嵌套作答');
  rows.child.subagent.address.parentSessionId='nested';assert.throws(()=>appendAnswer(ctx,'nested','循环关系'),/切换/);
  rows.child.subagent.address.parentSessionId='other';assert.throws(()=>appendAnswer(ctx,'child','不能串课'),/切换/);
  assert.throws(()=>appendAnswer(ctx,'nested','不能跨课堂'),/切换/);
  rows.child.subagent.address.parentSessionId='parent';rows.child.subagent.address.mode='one-shot';assert.throws(()=>appendAnswer(ctx,'child','不能续写'),/不支持/);
});
