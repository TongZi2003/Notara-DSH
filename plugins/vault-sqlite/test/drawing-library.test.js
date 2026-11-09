import test from 'node:test';
import assert from 'node:assert/strict';
import {drawingLibrary,createLibraryDrawing,searchDrawingLibrary} from '../drawing-library.js';
import {validateDrawing,drawingBounds} from '../drawing-sync.js';
test('all pinned ExcaliMath assets persist complete scenes with independent identities',()=>{
  assert.equal(drawingLibrary.length,77);const seen=new Set();let images=0;
  for(const item of drawingLibrary)for(let copy=0;copy<2;copy++){
    const scene=createLibraryDrawing(item.id);validateDrawing({type:'excalidraw',...scene});
    for(const id of [...scene.elements.map(e=>e.id),...new Set(scene.elements.flatMap(e=>e.groupIds)),...Object.keys(scene.files)]){assert.ok(!seen.has(id));seen.add(id);}
    for(const e of scene.elements){assert.equal(e.strokeStyle,'solid');if(e.points)assert.deepEqual(e.points[0],[0,0]);if(e.fileId){assert.ok(scene.files[e.fileId]?.dataURL.startsWith('data:image/svg+xml,'));images++;}}
  }
  assert.equal(images,16);assert.equal(searchDrawingLibrary('三角形').length,3);assert.equal(searchDrawingLibrary('triangle').length,3);
  assert.throws(()=>createLibraryDrawing('missing'),/drawing_library_unknown/);
  const axes=drawingLibrary.find(i=>i.english==='Scatter Plot Axes'),scene=createLibraryDrawing(axes.id);
  axes.shape.elements.forEach((e,i)=>{if(e.endArrowhead===null)assert.equal(scene.elements[i].endArrowhead,null);});
});
test('linear bounds use signed points and rotate about the actual bounding center',()=>{
  const line={x:100,y:80,width:100,height:80,points:[[0,0],[100,0],[0,-80]],angle:0};
  assert.deepEqual(drawingBounds([line]),{x:100,y:0,width:100,height:80});
  const rotated=drawingBounds([{...line,angle:Math.PI/2}]);assert.ok(Math.abs(rotated.x-110)<1e-8);assert.ok(Math.abs(rotated.y+10)<1e-8);assert.ok(Math.abs(rotated.width-80)<1e-8);assert.ok(Math.abs(rotated.height-100)<1e-8);
});
