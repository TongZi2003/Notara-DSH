import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resource } from '../resources.js';
import { parseFigure } from '../../graph-and-blocks/src/domain/board-figure.js';
import { compileExpression } from '../../graph-and-blocks/src/domain/math-expression.js';
import { validateBoardComponents } from '../../graph-and-blocks/src/domain/board-components.js';
import { parseCanvasDocument } from '../../vault-sqlite/drawing-files.js';

test('shipped teaching diagrams use the real grammar and model the stated mathematics', async () => {
  const skill=resource('pi-skills-built/notara-quest-tutor/SKILL.md');
  const canonical=await readFile(new URL('../../../prompts/skills/quest-tutor.md',import.meta.url),'utf8');
  assert.equal(skill.slice(skill.indexOf('# 单题研讨')),canonical);
  assert.match(skill,/references\/drawing\.md/);
  const drawing=resource('role-skills/teacher/notara-quest-tutor/references/drawing.md');
  assert.equal(drawing,await readFile(new URL('../../../prompts/references/drawing.md',import.meta.url),'utf8'));
  const diagrams=[...drawing.matchAll(/^```figure\n([\s\S]*?)^```\s*$/gm)].map(match=>parseFigure(match[1]));
  assert.equal(diagrams.length,3);
  const [secant,triangle,circle]=diagrams;
  assert.ok(circle.objects.some(o=>o.kind==='circumcircle'));assert.ok(circle.objects.some(o=>o.kind==='tangent'));assert.ok(circle.objects.some(o=>o.kind==='glider'));
  for(const diagram of diagrams) assert.equal(diagram.ask,null,'demonstrations do not demand student answers');
  const b=secant.objects.find(o=>o.name==='B'), curve=secant.objects.find(o=>o.name==='f');
  const x=compileExpression(b.x,['h']),y=compileExpression(b.y,['h']),f=compileExpression(curve.expr,['x']);
  const tangent=compileExpression(secant.objects.find(o=>o.name==='g').expr,['x']);
  assert.equal(tangent.evaluate({x:1}),1);
  assert.equal(tangent.evaluate({x:2})-tangent.evaluate({x:1}),2);
  for(const h of [.1,.5,1,2]){
    const bx=x.evaluate({h}),by=y.evaluate({h});
    assert.ok(Math.abs(by-f.evaluate({x:bx}))<1e-10,'B stays on the curve');
    assert.ok(Math.abs((by-1)/(bx-1)-(2+h))<1e-10,'secant slope agrees with the algebra');
  }
  assert.equal(triangle.objects.find(o=>o.name==='M').kind,'midpoint');
  assert.ok(triangle.objects.some(o=>o.kind==='segment'));
  const json=[...drawing.matchAll(/^```json\n([\s\S]*?)^```\s*$/gm)];
  assert.equal(json.length,1);
  const canvas=parseCanvasDocument(json[0][1]);
  const ids=new Set(canvas.nodes.map(n=>n.id));
  for(const edge of canvas.edges)assert.ok(ids.has(edge.fromNode)&&ids.has(edge.toNode));
  const components=canvas.nodes.flatMap(node=>validateBoardComponents(node.text));
  assert.equal(components.length,1); assert.equal(components[0].type,'figure');
});
