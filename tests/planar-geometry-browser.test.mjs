import test from 'node:test';import assert from 'node:assert/strict';
import {build} from 'esbuild';import {mkdir,writeFile} from 'node:fs/promises';import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';import {workspaceRoot} from '../scripts/native-runtime.mjs';
import {parseFigure,answerFigure} from '../plugins/graph-and-blocks/src/domain/board-figure.js';

test('native JSXGraph constructions preserve geometric invariants through drag, degeneracy and reload',{timeout:90000},async()=>{
  const out=join(workspaceRoot,'outputs/jsxgraph-20261028');await mkdir(out,{recursive:true});
  await build({entryPoints:[join(workspaceRoot,'tests/fixtures/planar-geometry.jsx')],bundle:true,outfile:join(out,'fixture.js'),format:'iife',platform:'browser',jsx:'automatic',logLevel:'warning'});
  await writeFile(join(out,'fixture.html'),'<!doctype html><html><meta charset="utf-8"><style>body{font:16px sans-serif}.nv-block-figure{position:relative;width:100%;height:100%}.nv-block-figure-board{width:100%;height:100%;position:relative;touch-action:none}.nv-block-figure-note{position:absolute;bottom:0;background:white;padding:8px}</style><div id="root"></div><script src="fixture.js"></script>');
  const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1100,height:850}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const read=()=>page.evaluate(()=>{
    const b=window.geometryBoard(),get=n=>b.select(n),pt=n=>[get(n).X(),get(n).Y()],line=n=>get(n).stdform.slice(0,3),distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
    const O=pt('O'),I=pt('I'),P=pt('P'),c=get('c'),k=get('k'),AB=line('AB'),H=pt('H'),C=pt('C'),p=line('p'),BC=line('BC'),h=line('h'),t=line('tP'),E=pt('E'),CA=line('CA'),bisector=line('b');
    return {circum:['A','B','C'].map(n=>distance(O,pt(n))-c.Radius()),incircle:Math.abs(AB[0]+AB[1]*I[0]+AB[2]*I[1])/Math.hypot(AB[1],AB[2])-k.Radius(),footOn:AB[0]+AB[1]*H[0]+AB[2]*H[1],footPerp:(C[0]-H[0])*(-AB[2])+(C[1]-H[1])*AB[1],parallel:p[1]*BC[2]-p[2]*BC[1],perpendicular:h[1]*AB[1]+h[2]*AB[2],bisector:bisector[0]+bisector[1]*I[0]+bisector[2]*I[1],intersection:[p,CA].map(l=>l[0]+l[1]*E[0]+l[2]*E[1]),circlePoint:distance(O,P)-c.Radius(),tangentAt:t[0]+t[1]*P[0]+t[2]*P[1],tangentNormal:t[1]*(P[1]-O[1])-t[2]*(P[0]-O[0]),gliderPosition:get('P').position,P,C,H,data:window.figureData};
  });
  const assertGeometry=value=>{for(const key of ['circum','incircle','footOn','footPerp','parallel','perpendicular','bisector','intersection','circlePoint','tangentAt','tangentNormal'])for(const n of [value[key]].flat())assert.ok(Number.isFinite(n)&&Math.abs(n)<1e-6,`${key}: ${n}`);};
  const drag=async(name,dx,dy)=>{const id=await page.evaluate(n=>window.geometryBoard().select(n).rendNode.id,name),box=await page.locator(`[id="${id}"]`).boundingBox();assert.ok(box);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+dx,box.y+box.height/2+dy,{steps:10});await page.mouse.up();};
  try{
    await page.goto('file://'+join(out,'fixture.html'));await page.locator('[data-status="ready"]').waitFor();await expect.poll(()=>page.evaluate(()=>window.figureData.drags.P?.position)).not.toBeUndefined();await expect(page.getByRole('status')).toHaveCount(0);const initial=await read();assertGeometry(initial);
    await drag('C',70,-45);await expect.poll(async()=>(await read()).C[0]).not.toBe(initial.C[0]);assertGeometry(await read());assert.ok(Math.abs((await read()).gliderPosition-initial.gliderPosition)<1e-8);
    await drag('P',-50,-40);await expect.poll(async()=>(await read()).gliderPosition).not.toBe(initial.gliderPosition);const moved=await read();assertGeometry(moved);assert.ok(Number.isFinite(moved.data.drags.P.position));
    await page.getByRole('button',{name:'保存并重建'}).click();await page.locator('[data-status="ready"]').waitFor();const rebuilt=await read();assertGeometry(rebuilt);assert.ok(Math.abs(rebuilt.gliderPosition-moved.gliderPosition)<1e-8);
    await page.reload();await page.locator('[data-status="ready"]').waitFor();assertGeometry(await read());assert.ok(Math.abs((await read()).P[0]-moved.P[0])<1e-6);
    await page.evaluate(()=>{const b=window.geometryBoard();b.select('C').moveTo([2,0]);b.fullUpdate();});await expect(page.getByRole('status')).toContainText('当前构形无法确定');
    const foot=await read();assert.ok(Math.hypot(foot.H[0]-foot.C[0],foot.H[1]-foot.C[1])<1e-8,'foot of a point already on a line is itself');
    await page.evaluate(()=>{const b=window.geometryBoard();b.select('C').moveTo([2,4]);b.fullUpdate();});await expect(page.getByRole('status')).toHaveCount(0);assertGeometry(await read());
    await page.screenshot({path:join(out,'geometry-invariants.png')});await writeFile(join(out,'geometry-evidence.json'),JSON.stringify({initial,moved,rebuilt,afterRecovery:await read()},null,2));
    await page.getByRole('button',{name:'退化圆',exact:true}).click();await page.locator('[data-status="ready"]').waitFor();await expect(page.getByRole('status')).toContainText('当前构形无法确定');
    await page.getByRole('slider',{name:'半径'}).press('ArrowRight');await page.getByRole('slider',{name:'半径'}).press('ArrowRight');await expect(page.getByRole('status')).toHaveCount(0);
    const recovered=await page.evaluate(()=>{const p=window.geometryBoard().select('P');return {x:p.X(),y:p.Y(),position:p.position};});assert.ok(Math.abs(recovered.x)<1e-8&&Math.abs(recovered.y-2)<1e-8);assert.equal(recovered.position,.25);
    await page.getByRole('button',{name:'拖点作答',exact:true}).click();await page.locator('[data-status="ready"]').waitFor();assert.deepEqual(await page.evaluate(()=>window.answers),[],'restoring a glider must not answer the exercise');
    await drag('P',-50,-80);await expect.poll(()=>page.evaluate(()=>window.answers.length)).toBeGreaterThan(0);
    const answer=await page.evaluate(()=>window.answers.at(-1));assert.deepEqual(Object.keys(answer).sort(),['x','y']);
    const spec=parseFigure('view x -4..4 y -4..4\npoint O = (0, 0)\ncircle c = center O radius 2\nglider P = (2, 0) on c\nask drag P "移动"');assert.ok(answerFigure(spec,{point:answer},()=>null).point);
    await page.evaluate(()=>window.longChain());await page.locator('[data-status="ready"]').waitFor({timeout:5000});await expect(page.getByRole('status')).toHaveCount(0);
    await expect.poll(()=>page.evaluate(()=>window.geometryBoard()?.select('L32')?.elType),{timeout:5000}).toBe('parallel');
    await page.evaluate(()=>window.resetWhileLoading());await page.locator('[data-status="ready"]').waitFor();
    await expect.poll(()=>page.evaluate(()=>{const p=window.geometryBoard().select('C');return [p.X(),p.Y()];})).toEqual(initial.C);
    assert.deepEqual(errors,[]);
  }catch(error){await page.screenshot({path:join(out,'geometry-failure.png')});await writeFile(join(out,'geometry-failure.json'),JSON.stringify({error:error.message,errors,text:await page.locator('body').innerText(),objects:await page.evaluate(()=>window.geometryBoard()?.objectsList.map(e=>({name:e.name,type:e.elType,stdform:e.stdform})))},null,2));throw error;}finally{await browser.close();}
});
