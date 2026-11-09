import {z} from 'zod';
import {defineDomain,domainTable} from '@deepseek-ai/dsh-storage-domain';
import {safeRelativePath} from './vault-path.js';
import {parseCanvasDocument} from './drawing-files.js';

const fail=code=>{throw new Error(code);};
const missing=error=>error.code==='ENOENT'||error.message==='vault_not_found';
const spec=defineDomain({name:'notara_whiteboard_bindings',version:1,invalidRecords:'backup-and-skip',tables:{bindings:domainTable(z.object({root:z.string(),path:z.string(),enabled:z.boolean()}))}});
function acceptsPreset(preset,header,events){
 if(header.origin==='subagent')return preset==='notara-teacher'&&events.filter(e=>e.type==='subagent/descriptor').at(-1)?.data?.mode==='continuable';
 return preset===undefined||['notara-teacher','notara-coordinator'].includes(preset);
}

export function createWhiteboardBindingsService(ctx,{resolveSession}){
 let domain,opening,closed=false;const pending=new Map();
 async function table(){
  if(closed)fail('vault_closed');
  if(!domain){const storage=ctx.get('storageDomain');if(!storage)fail('whiteboard_storage_unavailable');
   opening??=storage.open(spec).then(value=>domain=value).finally(()=>{opening=null;});await opening;
  }
  if(closed)fail('vault_closed');return domain.table('bindings');
 }
 const verify=(input,write=false)=>resolveSession(input.workspaceId,input.sessionId,{acceptsPreset,requireMutationEligibility:write});
 function projected(input,record,verified){
  const {entry,eligible}=verified;
  if(!record||record.root!==entry.root)return {sessionId:input.sessionId,eligible,bound:false,enabled:false,path:null,missing:false,revision:null};
  let revision=null,absent=false,invalid=false;
  try{const file=entry.store.read({path:record.path});revision=file.revision;parseCanvasDocument(file.content);}catch(error){if(missing(error))absent=true;else invalid=true;}
  return {sessionId:input.sessionId,eligible,bound:true,enabled:record.enabled,path:record.path,missing:absent,invalid,revision};
 }
 async function whiteboard(input={}){
  const verified=await verify(input);if(!verified.classroomRole)return {sessionId:input.sessionId,eligible:false,bound:false,enabled:false,path:null,missing:false,revision:null};
  return projected(input,(await table()).get(input.sessionId),verified);
 }
 async function set(input){
  if(typeof input.enabled!=='boolean')fail('whiteboard_enabled_required');
  const verified=await verify(input,true),{entry}=verified,t=await table(),old=t.get(input.sessionId),previous=old?.root===entry.root?old:null;
  let path=previous?.path;
  if(input.enabled){
   if(input.path!==undefined){path=safeRelativePath(input.path);if(!path.endsWith('.canvas'))fail('whiteboard_path_required');}
   if(path){try{parseCanvasDocument(entry.store.read({path}).content);}catch(error){if(missing(error))fail('whiteboard_missing');throw error;}}
   else{
    // CAS protects a simultaneous activation in another classroom. Never
    // overwrite an existing board, including a student's unbound file.
    for(let n=1;;n++){
     path=`白板/课堂白板${n===1?'':` ${n}`}.canvas`;
     try{entry.store.read({path});continue;}catch(error){if(!missing(error))throw error;}
     try{entry.store.save({path,content:'{\n  "nodes": [],\n  "edges": []\n}\n',expectedRevision:null});break;}catch(error){if(error.message!=='vault_revision_conflict')throw error;}
    }
   }
  }else if(input.path!==undefined)fail('whiteboard_disable_keeps_binding');
  if(path)await t.put(input.sessionId,{root:entry.root,path,enabled:input.enabled});
  return projected(input,path?{root:entry.root,path,enabled:input.enabled}:null,verified);
 }
 function serialized(input,operation){
  const result=(pending.get(input.sessionId)??Promise.resolve()).then(()=>operation(input));
  const settled=result.then(()=>{},()=>{}).finally(()=>{if(pending.get(input.sessionId)===settled)pending.delete(input.sessionId);});pending.set(input.sessionId,settled);return result;
 }
 return {whiteboard,setWhiteboard:(input={})=>serialized(input,set),
 // In-process teacher tool entry, not an additional remote/model tool. Queue
 // commits with enable/disable so an acknowledged stop precedes later writes.
 saveCanvas:(input={})=>serialized(input,async({workspaceId,sessionId,signal,...request})=>{
  signal?.throwIfAborted();
  const verified=await verify({workspaceId,sessionId},true),record=(await table()).get(sessionId);
  if(record?.root===verified.entry.root&&record.path===request.path){
   if(!record.enabled)fail('whiteboard_disabled');
   const state=projected({sessionId},record,verified);if(state.missing)fail('whiteboard_missing');if(state.invalid)fail('whiteboard_invalid');
  }
  parseCanvasDocument(request.content);
  signal?.throwIfAborted();
  return verified.entry.store.save(request);
 }),async close(){closed=true;await Promise.allSettled([...pending.values()]);if(opening)await opening.catch(()=>{});await domain?.close();}};
}
