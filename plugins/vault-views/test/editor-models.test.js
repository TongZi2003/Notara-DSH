import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasToFlow, flowToCanvas, duplicateCanvasSelection, checkedCanvasChange } from '../src/canvas-model.js';
import { prepareRichSource, finishRichSource } from '../src/rich-source.js';
import { parseReference } from '../src/logic.js';

test('Canvas adapter preserves unknown fields, source locators and edge endpoints while moving/resizing', () => {
  const source = { custom: { owner: 'fixture' }, nodes: [{ id: 'a', type: 'file', file: '讲义.pdf', subpath: '#page=2', x: 0, y: 30, width: 100, height: 200, custom: true }, { id: 'b', type: 'text', text: '保持文字', x: 300, y: 30, width: 100, height: 100 }], edges: [{ id: 'edge', fromNode: 'a', toNode: 'b', fromSide: 'right', toSide: 'left', fromEnd: 'arrow', toEnd: 'none', color: '4', label: '关联', custom: 123 }] };
  const flow = canvasToFlow(source); flow.nodes[0].position.x = 40; flow.nodes[0].width = 160;
  const updated = flowToCanvas(source, flow.nodes, flow.edges);
  assert.deepEqual(updated.custom, source.custom); assert.deepEqual(updated.edges, source.edges);
  assert.deepEqual(updated.nodes[0], { ...source.nodes[0], x: 40, width: 160 });
  const duplicated = duplicateCanvasSelection(source, ['a', 'b']);
  assert.equal(duplicated.nodes.length, 4); assert.equal(duplicated.edges.length, 2);
  assert.equal(duplicated.edges[1].fromNode, duplicated.nodes[2].id); assert.equal(duplicated.edges[1].toNode, duplicated.nodes[3].id);
  assert.equal(duplicated.nodes[2].subpath, '#page=2'); assert.equal(duplicated.edges[1].custom, 123);
});
test('rich-source protects component, fold, embed and wikilink syntax without interpreting code examples', () => {
  const component = '````choice extra\r\nprompt: 测试\r\n- [ ] 一\r\n````';
  const fold = '<details><summary>参考</summary>\r\n\r\n$$x^2$$\r\n\r\n</details>';
  const source = `---\r\ncustom: "保留" # 注释\r\n---\r\n# 标题\r\n\r\n[[笔记#定义|别名]]\r\n\r\n${component}\r\n\r\n${fold}\r\n\r\n![[手绘.excalidraw]]\r\n\r\n\`[[仅代码]]\`\r\n`;
  const prepared = prepareRichSource(source);
  const raw = [...prepared.capsules.values()].map(v => v.raw);
  for (const expected of [component, fold, '[[笔记#定义|别名]]', '![[手绘.excalidraw]]']) assert.ok(raw.includes(expected));
  assert.ok(prepared.source.includes('`[[仅代码]]`'));
  assert.equal(finishRichSource('# 新标题\n', prepared), '---\r\ncustom: "保留" # 注释\r\n---\r\n# 新标题\r\n');
  assert.deepEqual(parseReference('[[笔记#定义|别名]]'), { path: '笔记.md', subpath: '#定义', label: '别名' });
});
test('over-limit paste is rejected before replacing a valid Canvas draft', () => {
  const source = { nodes: Array.from({ length: 1001 }, (_, i) => ({ id: String(i), type: 'text', text: '节点', x: 0, y: 0, width: 200, height: 100 })), edges: [] };
  assert.equal(checkedCanvasChange(source), source);
  const duplicated = duplicateCanvasSelection(source, source.nodes.map(node => node.id));
  assert.throws(() => checkedCanvasChange(duplicated), /此次修改未应用/);
  assert.equal(source.nodes.length, 1001);
});
