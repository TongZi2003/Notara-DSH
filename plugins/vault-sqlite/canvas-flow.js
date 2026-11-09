import { parseCanvasDocument } from './drawing-files.js';
import {safeRelativePath} from './vault-path.js';
import {mathElementSubpath} from './math-reference.js';

export const CANVAS_GAP=28;
export const overlaps=(a,b,gap=0)=>a.x<b.x+b.width+gap&&a.x+a.width+gap>b.x&&a.y<b.y+b.height+gap&&a.y+a.height+gap>b.y;
const contains=(a,b)=>a.x<=b.x&&a.y<=b.y&&a.x+a.width>=b.x+b.width&&a.y+a.height>=b.y+b.height;
const copy=doc=>structuredClone(doc);
const managed=node=>node.notaraFlow?.version===1;
const movable=node=>managed(node)&&!node.notaraFlow.pinned;
const valid=doc=>parseCanvasDocument(JSON.stringify(doc));

// Only the requested nodes move. Existing manual geometry is an obstacle,
// except an enclosing group: membership is containment, not a collision.
export function settleCanvas(doc,ids,{reanchor=false}={}){
  const next=copy(doc),selected=new Set(ids);
  const obstacles=next.nodes.filter(n=>!selected.has(n.id));
  for(const node of next.nodes.filter(n=>selected.has(n.id))){
    const anchor=next.nodes.find(n=>n.id===node.notaraFlow?.after);
    if(anchor){
      const y=anchor.y+(node.notaraFlow.placement==='beside'?0:anchor.height+CANVAS_GAP);
      if(reanchor){node.x=anchor.x+(node.notaraFlow.placement==='beside'?anchor.width+CANVAS_GAP:0);node.y=y;}
      else node.y=Math.max(node.y,y);
    }
    let collision;
    while((collision=obstacles.find(n=>!(n.type==='group'&&contains(n,node))&&overlaps(node,n,CANVAS_GAP))))node.y=collision.y+collision.height+CANVAS_GAP;
    obstacles.push(node);
  }
  return valid(next);
}

export function appendCanvasBlock(doc,{id,title,body,file,mathElementId,after,placement='below',size='normal',operationId}){
  if(typeof id!=='string'||!id||doc.nodes.some(n=>n.id===id))throw Error('canvas_id_invalid');
  if(file!==undefined){safeRelativePath(file);if(body!==undefined)throw Error('canvas_content_invalid: file 与 body 不能同时提供');title??=file.split('/').at(-1);}
  if(mathElementId!==undefined&&(!file?.endsWith('.excalidraw')))throw Error('canvas_math_reference_invalid: 数学对象必须引用 .excalidraw 文件');
  if(typeof title!=='string'||!title.trim()||title.length>160||/[\r\n]/.test(title)||file===undefined&&(typeof body!=='string'||body.length>96000))throw Error('canvas_content_invalid');
  if(!['below','beside'].includes(placement)||!['normal','wide'].includes(size))throw Error('canvas_placement_invalid');
  const anchor=after?doc.nodes.find(n=>n.id===after):doc.nodes.find(n=>n.id===doc.notaraCanvas?.lastNodeId)??doc.nodes.filter(n=>n.type!=='group').at(-1);
  if(after&&!anchor)throw Error('canvas_anchor_missing');
  const node={id,...(file?{type:'file',file,...(mathElementId!==undefined?{subpath:mathElementSubpath(mathElementId)}:{})}:{type:'text',text:`# ${title.trim()}\n\n${body}`}),x:anchor?.x??0,y:anchor?anchor.y+anchor.height+CANVAS_GAP:0,width:size==='wide'?768:480,height:file?420:260,
    notaraFlow:{version:1,after:anchor?.id??null,placement,pinned:false,autoHeight:!file,...(operationId?{operationId}:{})}};
  const next={...doc,nodes:[...doc.nodes,node],notaraCanvas:{...doc.notaraCanvas,version:1,lastNodeId:id}};
  return settleCanvas(next,[id],{reanchor:true});
}

export function growCanvasBlock(doc,id,height){
  const index=doc.nodes.findIndex(n=>n.id===id),node=doc.nodes[index];
  if(!node||!movable(node)||node.notaraFlow.autoHeight===false||!Number.isFinite(height)||height<=node.height+1)return doc;
  const next=copy(doc);next.nodes[index].height=Math.ceil(Math.min(height,100000));
  return settleCanvas(next,next.nodes.slice(index).filter(movable).map(n=>n.id));
}

export function updateCanvasBlock(doc,{nodeId,title,body}){
  const index=doc.nodes.findIndex(n=>n.id===nodeId),node=doc.nodes[index];
  if(!node||node.type!=='text')throw Error('canvas_node_missing');
  if(typeof body!=='string'||body.length>96000||typeof title!=='string'||!title.trim()||title.length>160||/[\r\n]/.test(title))throw Error('canvas_content_invalid');
  const next=copy(doc);next.nodes[index]={...node,text:`# ${title.trim()}\n\n${body}`};
  return valid(next);
}

const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
function mergeValue(base,local,remote){
  if(equal(local,remote)||equal(base,remote))return {ok:true,value:local};
  if(equal(base,local))return {ok:true,value:remote};
  if(object(base)&&object(local)&&object(remote)){
    const value={};
    for(const key of new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)])){
      const merged=mergeValue(base[key],local[key],remote[key]);if(!merged.ok)return merged;
      if(merged.value!==undefined)value[key]=merged.value;
    }
    return {ok:true,value};
  }
  return {ok:false};
}
function mergeEntities(base,local,remote){
  const result=[],b=new Map(base.map(n=>[n.id,n])),l=new Map(local.map(n=>[n.id,n])),r=new Map(remote.map(n=>[n.id,n]));
  for(const id of new Set([...local.map(n=>n.id),...remote.map(n=>n.id)])){
    const merged=mergeValue(b.get(id),l.get(id),r.get(id));if(!merged.ok)return null;
    if(merged.value)result.push(merged.value);
  }
  return result;
}

/** Three-way merge: distinct edits combine; competing edits/deletions conflict.
 * Incoming additions are placed again against the student's current geometry. */
export function mergeCanvasDocuments(base,local,remote){
  try{
    const {nodes:bn,edges:be,...bt}=base,{nodes:ln,edges:le,...lt}=local,{nodes:rn,edges:re,...rt}=remote;
    const top=mergeValue(bt,lt,rt),nodes=mergeEntities(bn,ln,rn),edges=mergeEntities(be,le,re);
    if(!top.ok||!nodes||!edges)return null;
    const ids=new Set(nodes.map(n=>n.id));if(edges.some(e=>!ids.has(e.fromNode)||!ids.has(e.toNode)))return null;
    const added=nodes.filter(n=>!bn.some(b=>b.id===n.id)&&!ln.some(l=>l.id===n.id)&&movable(n)).map(n=>n.id);
    if(nodes.some(n=>added.includes(n.id)&&n.notaraFlow.after&&!ids.has(n.notaraFlow.after)))return null;
    return settleCanvas({...top.value,nodes,edges},added,{reanchor:true});
  }catch{return null;}
}
