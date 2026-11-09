import test from 'node:test';
import assert from 'node:assert/strict';
import {selectionModifier,listSelectionGesture,selectCandidates} from '../src/selection-interaction.js';
test('primary modifiers toggle, Shift follows visible order, combined modifiers add a range',()=>{
 const order=['c','b','a','d'];
 assert.equal(selectionModifier({ctrlKey:true}),true);assert.equal(selectionModifier({metaKey:true}),true);
 assert.equal(listSelectionGesture({button:2,ctrlKey:true}),false);
 assert.equal(listSelectionGesture({button:0}),false);
 assert.deepEqual(selectCandidates(['b'],order,'b',null,{ctrlKey:true}),{paths:[],anchor:'b'});
 assert.deepEqual(selectCandidates([],order,'a',null,{metaKey:true}),{paths:['a'],anchor:'a'});
 assert.deepEqual(selectCandidates(['d'],order,'c','a',{shiftKey:true}),{paths:['c','b','a'],anchor:'a'});
 assert.deepEqual(selectCandidates(['d'],order,'c','a',{shiftKey:true,ctrlKey:true}),{paths:['d','c','b','a'],anchor:'a'});
 assert.deepEqual(selectCandidates([],order,'b','gone',{shiftKey:true}),{paths:['b'],anchor:'b'});
 assert.throws(()=>selectCandidates([],Array.from({length:13},(_,i)=>String(i)),'12','0',{shiftKey:true}),/最多带入 12/);
});
