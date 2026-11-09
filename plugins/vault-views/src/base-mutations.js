import { parseBase, serializeBase, evaluateBase, basePropertyName } from '@oh-my-student/plugin-vault-sqlite/bases';
import { callVault } from './logic.js';

/** One configuration write queue per mounted Base. Never overwrite outside edits. */
export function createBaseWriter(remote, getRecord, onSaved, onError) {
  let queue=Promise.resolve(), latest=null;
  return transform => {
    const run=queue.catch(()=>{}).then(async()=>{
      const record=getRecord();
      if(!record) throw new Error('资料库尚未就绪');
      if(!latest || latest.path !== record.path || latest.revision !== record.revision) latest=record;
      const config=parseBase(latest.content); transform(config);
      config.views.forEach((_,index)=>evaluateBase(config,[],index));
      const content=serializeBase(config);
      if(content === latest.content) return latest;
      const saved=await callVault(remote,'save',{path:latest.path,content,expectedRevision:latest.revision});
      latest={...latest,...saved,content}; onSaved(latest); return latest;
    });
    queue=run; run.catch(onError); return run;
  };
}

export function propertyKey(property) {
  if(property.startsWith('file.') || property.startsWith('formula.') || property.startsWith('notara.')) return null;
  try {const key=basePropertyName(property);return /^[\p{L}_][\p{L}\p{N}_-]{0,100}$/u.test(key) && !['__proto__','prototype','constructor'].includes(key) ? key : null;}catch{return null;}
}
export function propertyInput(text, previous) {
  if (typeof previous === 'boolean') {if(![true,false,'true','false','是','否','1','0',''].includes(text))throw new Error('请输入是或否');return [true,'true','是','1'].includes(text);}
  if (typeof previous === 'number') { if(text === '') return null; const value=Number(text); if(!Number.isFinite(value)) throw new Error('请输入有效数字'); return value; }
  if (Array.isArray(previous)) return [...new Set(String(text).split(/[,，\n]/).map(value=>value.trim().replace(/^#/, '')).filter(Boolean))];
  return text === '' ? null : String(text);
}

const draftCaches=new Map();
export function gridDraftCache(workspaceId,path) {const key=JSON.stringify([workspaceId,path]);if(!draftCaches.has(key))draftCaches.set(key,new Map());return draftCaches.get(key);}
export function gridDraftState(cache,key,rows) {
  if(cache.has(key))return cache.get(key);
  let value={rows,busy:false,failure:null,notice:'',history:[],future:[]};const listeners=new Set();
  const store={getSnapshot:()=>value,subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},set(field,update){value={...value,[field]:typeof update==='function'?update(value[field]):update};listeners.forEach(listener=>listener());},saving:{current:false},revisions:{current:new Map()}};
  cache.set(key,store);return store;
}
