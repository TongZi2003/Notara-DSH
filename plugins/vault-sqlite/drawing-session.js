import {parseDrawingDocument,EMPTY_DRAWING} from './drawing-files.js';
import {mergeDrawingDocuments,drawingChangedIds,validateDrawing} from './drawing-sync.js';

export function createDrawingSession({read,save,now=Date.now}){
  const leases=new Map(),previews=new Map();
  const check=path=>{if(typeof path!=='string'||!path.endsWith('.excalidraw'))throw Error('drawing_path_invalid');};
  const record=path=>{check(path);try{return read({path});}catch(e){if(e.code!=='ENOENT')throw e;return {path,content:EMPTY_DRAWING,revision:null};}};
  const busy=path=>{const found=leases.get(path);if(!found)return [];for(const [id,entry] of found)if(entry.until<=Number(now()))found.delete(id);return [...new Set([...found.values()].flatMap(e=>e.ids))];};
  function drawingActivity({path,clientId,elementIds}){
    check(path);read({path});
    if(typeof clientId!=='string'||clientId.length>120||!Array.isArray(elementIds)||elementIds.length>20000||elementIds.some(id=>typeof id!=='string'||id.length>200))throw Error('drawing_activity_invalid');
    if(!leases.has(path)){if(leases.size>=64)leases.delete(leases.keys().next().value);leases.set(path,new Map());}
    const entries=leases.get(path);if(elementIds.length){if(entries.size>=16&&!entries.has(clientId))throw Error('drawing_too_many_editors');entries.set(clientId,{ids:elementIds,until:Number(now())+6000});}else entries.delete(clientId);
    return {busyIds:busy(path)};
  }
  function drawingCommit({path,base,content,respectActivity=false,operationId,requestHash}){
    check(path);if(typeof base!=='string'||typeof content!=='string'||base.length>8*1024*1024||content.length>8*1024*1024)throw Error('drawing_content_invalid');
    const current=record(path),remote=validateDrawing(parseDrawingDocument(current.content));
    if(operationId&&remote.notaraDrawing?.receipts?.[operationId]){
      if(remote.notaraDrawing.receipts[operationId]!==requestHash)throw Error('drawing_request_conflict');return {...current,alreadyApplied:true};
    }
    const previous=validateDrawing(parseDrawingDocument(base)),local=validateDrawing(parseDrawingDocument(content));
    if(respectActivity&&drawingChangedIds(previous,local).some(id=>busy(path).includes(id)))throw Error('drawing_busy: 学生正在修改这些元素，请稍后重新读取。');
    const merged=mergeDrawingDocuments(previous,local,remote);if(!merged)throw Error('drawing_conflict: 同一元素已有新修改，请重新读取；原画布未覆盖。');
    if(operationId){
      const receipts={...remote.notaraDrawing?.receipts,[operationId]:requestHash};const keys=Object.keys(receipts);for(const key of keys.slice(0,-128))delete receipts[key];
      merged.notaraDrawing={...merged.notaraDrawing,receipts};
    }
    const next=JSON.stringify(merged,null,2)+'\n',result=save({path,content:next,expectedRevision:current.revision});return {...result,content:next};
  }
  function drawingPreview({path,revision,png}){
    const current=record(path);
    if(png!==undefined){
      if(revision!==current.revision)return {accepted:false};
      if(typeof png!=='string'||png.length>4*1024*1024||!/^iVBORw0KGgo[\w+/=]*$/.test(png))throw Error('drawing_preview_invalid');
      if(previews.size>=16&&!previews.has(path))previews.delete(previews.keys().next().value);previews.set(path,{revision,png});
    }
    const preview=previews.get(path);return {revision:current.revision,busyIds:busy(path),...(preview?.revision===current.revision?{png:preview.png}:{}),...(png!==undefined?{accepted:true}:{})};
  }
  return {drawingCommit,drawingActivity,drawingPreview};
}
