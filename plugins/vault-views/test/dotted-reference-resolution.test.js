import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveFileLocator} from '../src/logic.js';
test('click and embed resolver share exact attachment first, dotted note fallback and intact locators',async()=>{
 const locator={path:'卡片/ln1.1',subpath:'#证明',range:[0,12],revision:'v1',workspaceId:'one'};
 const calls=[],remote={query:async input=>{calls.push(input);return {ok:true,value:{documents:[{path:'卡片/ln1.1.md'}]}};}};
 assert.deepEqual(await resolveFileLocator(remote,locator),{...locator,path:locator.path+'.md'});
 assert.deepEqual(calls,[{paths:['卡片/ln1.1','卡片/ln1.1.md'],limit:2}]);
 const both={query:async()=>({documents:[{path:'model.123.md'},{path:'model.123'}]})};
 assert.equal((await resolveFileLocator(both,{path:'model.123'})).path,'model.123');
 assert.equal((await resolveFileLocator({query:async()=>({documents:[]})},locator)).path,locator.path);
 const pdf={path:'书.1.pdf',page:77,rect:[0,0,1,1]};assert.equal(await resolveFileLocator({query(){throw Error('must not read catalog');}},pdf),pdf);
 await assert.rejects(()=>resolveFileLocator(remote,{path:'../bad1.1'}));
});
