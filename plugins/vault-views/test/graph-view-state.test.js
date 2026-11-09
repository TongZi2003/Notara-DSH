import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeGraphState,decodeGraphState,createGraphStateStore} from '../src/graph-view-state.js';
const filters={centers:['方法1.1.md'],tags:['数学'],hops:1,type:'all',tagMatch:'all'};
test('graph reload retains presentation maps and return history, not selection or graph data',()=>{
 const scope='layout identity';
 const state={organization:'center',sourceId:null,focusPath:'方法1.1.md',filters,search:'',relationFilter:'potential',labelMode:'all',view:{x:31,y:42,scale:1.2},positions:new Map([['方法1.1.md',{x:10,y:20,fx:10,fy:20}]]),centerOrigins:new Map([['center',{x:30,y:40}]]),centerHistory:[{organization:'all',filters,scope,view:{x:0,y:0,scale:1},previewReturn:{key:'book',scope,view:{x:1,y:2,scale:1}}}],selectionStore:{get:()=>{},secret:'do not persist'},nodes:['do not persist']};
 const encoded=encodeGraphState(state),result=decodeGraphState(encoded);
 assert.deepEqual(result.positions,state.positions);assert.deepEqual(result.centerOrigins,state.centerOrigins);
 assert.deepEqual(result.filters,filters);assert.deepEqual(result.centerHistory,state.centerHistory);
 assert.equal(result.focusPath,state.focusPath);assert.equal(result.relationFilter,'potential');assert.deepEqual(result.view,state.view);
 assert.ok(!encoded.includes('do not persist'));assert.equal(JSON.parse(encoded).scopes.length,1);
});
test('graph states are isolated by native workspace and root; unavailable or damaged storage is harmless',()=>{
 const saved=new Map(),storage={getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)};
 const first=createGraphStateStore(storage);Object.assign(first.get('A','/vault/one'),{organization:'knowledge',filters});first.flush();
 const reload=createGraphStateStore(storage);
 assert.equal(reload.get('A','/vault/one/').organization,'knowledge');
 assert.deepEqual(reload.get('B','/vault/one'),{});assert.deepEqual(reload.get('A','/vault/two'),{});
 assert.notEqual(reload.get(undefined),reload.get(null));
 assert.deepEqual(decodeGraphState('{'),{});assert.deepEqual(decodeGraphState('{"version":7}'),{});
 const broken=createGraphStateStore({getItem(){throw Error();},setItem(){throw Error();}});assert.deepEqual(broken.get('A','/vault'),{});broken.flush();
});

test('camera-only saves do not rewrite layout/history or unrelated workspaces',async()=>{
 const saved=new Map(),writes=[],storage={getItem:k=>saved.get(k),setItem:(k,v)=>{writes.push({key:k,size:v.length});saved.set(k,v);}};
 const store=createGraphStateStore(storage),a=store.get('A','/one'),b=store.get('B','/two');
 for(const state of [a,b])Object.assign(state,{organization:'center',filters,view:{x:0,y:0,scale:1},positions:new Map([['方法1.1.md',{x:1,y:2}]]),centerHistory:[{organization:'all',filters,scope:'large layout '.repeat(10000)}]});
 store.flush();writes.length=0;a.view={x:20,y:30,scale:2};store.changed(a,'camera');await new Promise(r=>setTimeout(r,260));
 assert.equal(writes.length,1);assert.ok(writes[0].size<1000,'small camera update must not encode the full graph description');
 const restored=createGraphStateStore(storage).get('A','/one');assert.deepEqual(restored.view,a.view);assert.deepEqual(restored.positions,a.positions);assert.deepEqual(restored.centerHistory,a.centerHistory);
 a.organization='knowledge';a.view={x:0,y:0,scale:.5};store.changed(a);store.flush();
 assert.deepEqual(createGraphStateStore(storage).get('A','/one').view,a.view,'older camera patch cannot override a new view');
});

test('slow active gestures keep dirty geometry in memory until idle or page-hide flush',async()=>{
 const writes=[],storage={getItem:()=>null,setItem:(key,value)=>writes.push({key,value})};const store=createGraphStateStore(storage),state=store.get('A','/one');
 Object.assign(state,{organization:'all',filters,view:{x:0,y:0,scale:1},positions:new Map()});store.flush();writes.length=0;
 state.positions.set('A',{x:4,y:8});store.changed(state,'layout',true);await new Promise(r=>setTimeout(r,260));assert.equal(writes.length,0);
 store.changed(state,'camera');await new Promise(r=>setTimeout(r,260));assert.equal(writes.length,1);assert.ok(!writes[0].key.endsWith(':camera'),'idle flush includes dirty positions, not only the camera');
 state.positions.set('A',{x:7,y:8});store.changed(state,'layout',true);store.flush();assert.equal(writes.length,2,'page hide does not lose an in-progress drag');
});
