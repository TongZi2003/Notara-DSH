import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFigure} from '../src/domain/board-figure.js';
import {mathDefinition} from '../src/domain/drawing-math.js';
import {PLANAR_SOURCE} from './planar-source.js';
test('ten planar constructions compose through typed references and persist constrained drags',()=>{
  const spec=parseFigure(PLANAR_SOURCE);assert.equal(spec.objects.length,20);
  for(const kind of ['circumcenter','circumcircle','incenter','incircle','parallel','perpendicular','foot','bisector','glider','tangent'])assert.ok(spec.objects.some(o=>o.kind===kind),kind);
  const data=mathDefinition(PLANAR_SOURCE,{drags:{P:{x:6,y:3,position:.15},C:{x:2,y:5},H:{x:8,y:8}}}).data;
  assert.equal(data.drags.P.position,.15);assert.deepEqual(data.drags.C,{x:2,y:5});assert.equal(data.drags.H,undefined);
  assert.equal(parseFigure(PLANAR_SOURCE+'\nask drag P "拖动圆上的点"').ask.target,'P');
  assert.throws(()=>mathDefinition(PLANAR_SOURCE,{drags:{P:{x:6,y:3,position:Infinity}}}),/state_invalid/);
  const primed=mathDefinition(PLANAR_SOURCE.replaceAll('glider P ',"glider P' ").replaceAll('at P',"at P'").replaceAll('O P',"O P'"),{drags:{"P'":{x:6,y:3,position:0}}});assert.equal(primed.data.drags["P'"].position,0);
});
test('wrong reference kinds, off-circle tangents, duplicate vertices and spatial misuse reject with line numbers',()=>{
  for(const tail of ['parallel p = A through B','foot H = A on c','tangent tP = c at A','tangent tP = c at Q','glider P = (0, 0) on A','circumcircle c2 = A A B','bisector b2 = A B B','parallel p2 = unknown through B','glider P2 = (fetch(1), 0) on c']){
    const source='point A = (0, 0)\npoint B = (4, 0)\npoint C = (1, 3)\nline AB = A B\ncircle c = center A through B\nglider Q = (1, 0) on AB\n'+tail;
    assert.throws(()=>parseFigure(source),error=>error.name==='FigureError'&&Number.isInteger(error.line),tail);
  }
  assert.throws(()=>parseFigure(PLANAR_SOURCE.replace('view x -3..8 y -3..7','view x -3..8 y -3..7 z -2..2').replaceAll('(0, 0)','(0, 0, 0)').replace('(6, 0)','(6, 0, 0)').replace('(2, 4)','(2, 4, 0)')),/平面/);
  assert.throws(()=>parseFigure(PLANAR_SOURCE.replace('view x -3..8 y -3..7\n','')+'\nview x -3..8 y -3..7 z -2..2'),/平面/);
});
