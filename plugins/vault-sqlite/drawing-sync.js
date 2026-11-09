import {parseDrawingDocument} from './drawing-files.js';
import {isMathElement,validateMathData} from './drawing-math.js';

const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
export const drawingEqual=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const semantic=element=>element&&Object.fromEntries(Object.entries(element).filter(([key])=>!['version','versionNonce','updated','index'].includes(key)));
export const sameDrawingElement=(a,b)=>drawingEqual(semantic(a),semantic(b));
export const drawingChangedIds=(a,b)=>{
  const common=new Set(a.elements.map(e=>e.id).filter(id=>b.elements.some(e=>e.id===id))),before=a.elements.filter(e=>common.has(e.id)).map(e=>e.id),after=b.elements.filter(e=>common.has(e.id)).map(e=>e.id);
  return [...new Set([...a.elements,...b.elements].map(e=>e.id))].filter(id=>!sameDrawingElement(a.elements.find(e=>e.id===id),b.elements.find(e=>e.id===id))||common.has(id)&&before.indexOf(id)!==after.indexOf(id));
};

/** Apply only actual native edits onto the file snapshot that produced the
 * rendered scene. Renderer defaults/metrics are not concurrent teacher edits. */
export function applyDrawingNativeDelta(source,before,after){
  const next=structuredClone(source),changed=new Set(drawingChangedIds(before,after));
  for(const id of changed){
    const index=next.elements.findIndex(e=>e.id===id),value=after.elements.find(e=>e.id===id);
    if(value){if(index<0)next.elements.push(structuredClone(value));else next.elements[index]=structuredClone(value);}
    else if(index>=0)next.elements[index]={...next.elements[index],isDeleted:true,version:(next.elements[index].version??1)+1};
  }
  const order=after.elements.map(e=>e.id),map=new Map(next.elements.map(e=>[e.id,e]));
  for(const [i,e] of source.elements.entries())if(!order.includes(e.id)){
    const previous=source.elements.slice(0,i).reverse().find(n=>order.includes(n.id)),following=source.elements.slice(i+1).find(n=>order.includes(n.id));
    order.splice(previous?order.indexOf(previous.id)+1:following?order.indexOf(following.id):order.length,0,e.id);
  }
  next.elements=order.filter(id=>map.has(id)).map(id=>map.get(id));
  for(const field of ['files','appState']){
    next[field]={...next[field]};
    for(const key of new Set([...Object.keys(before[field]??{}),...Object.keys(after[field]??{})]))if(!drawingEqual(before[field]?.[key],after[field]?.[key])){
      if(after[field]?.[key]===undefined)delete next[field][key];else next[field][key]=structuredClone(after[field][key]);
    }
  }
  return next;
}

export function validateDrawing(doc){
  parseDrawingDocument(JSON.stringify(doc));
  if(doc.elements.filter(e=>!e.isDeleted&&isMathElement(e)).length>20)throw Error('drawing_math_limit');
  const ids=new Set();
  for(const e of doc.elements){
    if(isMathElement(e))validateMathData(e.customData.notaraMath);
    if(ids.has(e.id))throw Error('drawing_duplicate_id');ids.add(e.id);
    if(!['x','y','width','height','angle'].every(k=>Number.isFinite(e[k])&&Math.abs(e[k])<=1e7)||e.width<0||e.height<0)throw Error('drawing_geometry_invalid');
    if(e.points&&(!Array.isArray(e.points)||e.points.length>100000||e.points.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v)||Math.abs(v)>1e7))))throw Error('drawing_points_invalid');
  }
  for(const e of doc.elements){
    if(e.isDeleted)continue;
    for(const id of [e.containerId,e.frameId,e.startBinding?.elementId,e.endBinding?.elementId,...(e.boundElements??[]).map(b=>b.id)].filter(Boolean))if(!doc.elements.some(n=>n.id===id&&!n.isDeleted))throw Error('drawing_binding_missing');
    if(e.type==='image'&&e.fileId&&!doc.files?.[e.fileId])throw Error('drawing_image_missing');
  }
  return doc;
}

function mergeMap(base={},local={},remote={},equal=drawingEqual,conflicts){
  const entries=[];
  for(const id of new Set([...Object.keys(local),...Object.keys(remote),...Object.keys(base)])){
    const b=base[id],l=local[id],r=remote[id];
    let value;if(equal(l,r)||equal(b,r))value=l;else if(equal(b,l))value=r;else if(conflicts){conflicts.push(id);value=l;}else return null;
    if(value!==undefined)entries.push([id,value]);
  }
  return Object.fromEntries(entries);
}
export function mergeDrawingDocuments(base,local,remote,conflicts){
  try{
    const map=els=>Object.fromEntries(els.map(e=>[e.id,e]));
    const elements=mergeMap(map(base.elements),map(local.elements),map(remote.elements),sameDrawingElement,conflicts);
    const files=mergeMap(base.files,local.files,remote.files,drawingEqual,conflicts),appState=mergeMap(base.appState,local.appState,remote.appState,drawingEqual,conflicts);
    const rest=doc=>Object.fromEntries(Object.entries(doc).filter(([k])=>!['elements','files','appState'].includes(k)));
    const top=mergeMap(rest(base),rest(local),rest(remote),drawingEqual,conflicts);
    if(!elements||!files||!appState||!top)return null;
    // Preserve deleted elements for stable IDs, undo and stale-update rejection.
    const common=new Set(base.elements.map(e=>e.id).filter(id=>local.elements.some(e=>e.id===id)&&remote.elements.some(e=>e.id===id)));
    const ordered=doc=>doc.elements.filter(e=>common.has(e.id)).map(e=>e.id),b=ordered(base),l=ordered(local),r=ordered(remote);
    const localReordered=!drawingEqual(b,l),remoteReordered=!drawingEqual(b,r);
    if(localReordered&&remoteReordered&&!drawingEqual(l,r)){if(!conflicts)return null;conflicts.push('element-order');}
    const primary=localReordered?local:remote,secondary=localReordered?remote:local;
    const order=primary.elements.map(e=>e.id);
    for(const [i,e] of secondary.elements.entries())if(!order.includes(e.id)){
      const before=secondary.elements.slice(0,i).reverse().find(n=>order.includes(n.id));
      const after=secondary.elements.slice(i+1).find(n=>order.includes(n.id));
      order.splice(before?order.indexOf(before.id)+1:after?order.indexOf(after.id):order.length,0,e.id);
    }
    return validateDrawing({...top,elements:order.filter(id=>elements[id]).map(id=>elements[id]),files,appState});
  }catch{return null;}
}

export function drawingBounds(elements){
  if(!elements.length)return {x:0,y:0,width:0,height:0};
  const points=elements.flatMap(e=>{
    const local=e.points?.length?e.points:[[0,0],[e.width,e.height]],xs=local.map(p=>p[0]),ys=local.map(p=>p[1]);
    const left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys),cx=(left+right)/2,cy=(top+bottom)/2,c=Math.cos(e.angle||0),s=Math.sin(e.angle||0);
    return [[left,top],[right,top],[left,bottom],[right,bottom]].map(([x,y])=>({x:e.x+cx+(x-cx)*c-(y-cy)*s,y:e.y+cy+(x-cx)*s+(y-cy)*c}));
  });
  const x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y));return {x,y,width:Math.max(...points.map(p=>p.x))-x,height:Math.max(...points.map(p=>p.y))-y};
}
export function drawingSelection(elements,selectedIds){
  const ids=new Set(selectedIds);
  for(const e of elements)if(ids.has(e.id)){
    if(e.type==='frame')for(const child of elements)if(child.frameId===e.id)ids.add(child.id);
    for(const bound of e.boundElements??[])if(bound.type==='text')ids.add(bound.id);
  }
  return elements.filter(e=>!e.isDeleted&&(!selectedIds.length||ids.has(e.id)));
}

/** Native JSON elements generated by the host. IDs/nonces are never model inputs. */
export function makeDrawingElements(shapes,idFor){
  if(!Array.isArray(shapes)||!shapes.length||shapes.length>100)throw Error('drawing_shapes_invalid');
  return shapes.map((shape,i)=>{
    const {kind,x,y}=shape;
    if(!['rectangle','ellipse','diamond','text','line','arrow','math'].includes(kind)||![x,y].every(Number.isFinite))throw Error('drawing_shape_invalid');
    const e={id:idFor(i),type:kind,x,y,width:shape.width??160,height:shape.height??100,angle:0,strokeColor:shape.color??'#1e1e1e',backgroundColor:'transparent',fillStyle:'solid',strokeWidth:2,strokeStyle:'solid',roughness:1,opacity:100,groupIds:[],frameId:null,roundness:null,seed:Math.floor(Math.random()*2147483647),version:1,versionNonce:Math.floor(Math.random()*2147483647),isDeleted:false,boundElements:null,updated:Date.now(),link:null,locked:false};
    if(!/^#[\da-f]{6}$/i.test(e.strokeColor))throw Error('drawing_color_invalid');
    if(kind==='math')Object.assign(e,{type:'embeddable',width:shape.width??760,height:shape.height??520,customData:{notaraMath:validateMathData(shape.math)}});
    if(kind==='text'){
      if(typeof shape.text!=='string'||!shape.text.length||shape.text.length>8000)throw Error('drawing_text_invalid');
      const fontSize=shape.fontSize??20;if(!Number.isFinite(fontSize)||fontSize<8||fontSize>96)throw Error('drawing_font_invalid');
      Object.assign(e,{text:shape.text,originalText:shape.text,fontSize,fontFamily:5,textAlign:'left',verticalAlign:'top',containerId:null,autoResize:true,lineHeight:1.25,width:shape.width??Math.max(20,...shape.text.split('\n').map(t=>[...t].reduce((sum,c)=>sum+(c.charCodeAt(0)>255?1:.6),0)*fontSize)),height:shape.height??shape.text.split('\n').length*fontSize*1.25});
    }
    if(kind==='line'||kind==='arrow'){
      if(!Array.isArray(shape.points)||shape.points.length<2||shape.points.length>2048||shape.points.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v))))throw Error('drawing_points_invalid');
      const xs=shape.points.map(p=>p[0]),ys=shape.points.map(p=>p[1]),minX=Math.min(...xs),minY=Math.min(...ys);
      Object.assign(e,{x:x+minX,y:y+minY,width:Math.max(...xs)-minX,height:Math.max(...ys)-minY,points:shape.points.map(([a,b])=>[a-minX,b-minY]),lastCommittedPoint:null,startBinding:null,endBinding:null,startArrowhead:null,endArrowhead:kind==='arrow'?'arrow':null,...(kind==='arrow'?{elbowed:false}:{})});
    }
    return e;
  });
}
