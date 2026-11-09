import test from 'node:test';
import assert from 'node:assert/strict';
import {documentStatus} from '../src/document-feedback.js';
test('successful save receipts leave the toolbar; unsaved edits and errors remain',()=>{
 for(const message of ['已保存','已保存，仍有新修改','草稿已另存，已载入文件版本']){
  assert.equal(documentStatus({message},false),'');assert.equal(documentStatus({message},true),'未保存');
 }
 for(const message of ['保存失败，草稿已保留，请重试','文件已在其他地方更新，草稿已保留','已恢复未保存草稿','新板书已同步，未保存修改已保留'])assert.equal(documentStatus({message},true),message);
 assert.equal(documentStatus({saving:true,message:'已保存'},true),'正在保存…');
});
