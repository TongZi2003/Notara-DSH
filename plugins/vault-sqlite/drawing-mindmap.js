import {makeDrawingElements,sameDrawingElement,validateDrawing} from './drawing-sync.js';

// Native Excalidraw shapes are the document; this metadata only records the tree.
// Independently implemented for the DSH host, without the Obsidian script runtime.
const meta=e=>e?.customData?.notaraMindmap;
const edge=e=>e?.customData?.notaraMindmapEdge;
const label=text=>{const s=String(text??'').trim();if(!s||s.length>200||/[\r\n\u0000-\u001f]/.test(s))throw Error('节点名称需要 1–200 个字，且不能换行。');return s;};
const visible=e=>!e.isDeleted&&!e.customData?.notaraMindmapHidden;
export const visibleMindmapElements=elements=>elements.filter(visible);
export function mindmapNode(doc,id){const e=doc.elements.find(e=>e.id===id&&!e.isDeleted);return meta(e)?.version===1?e:e?.containerId?doc.elements.find(n=>n.id===e.containerId&&!n.isDeleted&&meta(n)?.version===1)??null:null;}
function tree(doc,id){
  const nodes=new Map(doc.elements.filter(e=>!e.isDeleted&&meta(e)?.version===1).map(e=>[e.id,e]));
  let root=nodes.get(id);if(!root)throw Error('请先选择一个思维导图节点。');
  const seen=new Set();while(meta(root).parent){if(seen.has(root.id))throw Error('导图关系有循环，请先撤销最近的结构修改。');seen.add(root.id);root=nodes.get(meta(root).parent);if(!root)throw Error('父节点已删除，请先撤销或重新导入大纲。');}
  const children=id=>[...nodes.values()].filter(n=>meta(n).parent===id).sort((a,b)=>(meta(a).order??0)-(meta(b).order??0)||a.id.localeCompare(b.id));
  const all=[];const walk=(n,depth=0)=>{if(depth>30||all.length>=200||all.includes(n.id))throw Error('导图最多支持 200 个节点、30 层。');all.push(n.id);for(const c of children(n.id))walk(c,depth+1);};walk(root);
  return {root,nodes,children,ids:new Set(all)};
}
function title(doc,node){return doc.elements.find(e=>!e.isDeleted&&e.containerId===node.id&&e.type==='text')?.originalText??'未命名';}
export function mindmapTitle(doc,id){const n=mindmapNode(doc,id);return n?title(doc,n):'';}
export function mindmapOutline(doc,id){const t=tree(doc,id),lines=[];const visit=(n,depth)=>{lines.push('  '.repeat(depth)+'- '+title(doc,n));for(const c of t.children(n.id))visit(c,depth+1);};visit(t.nodes.get(id),0);return lines.join('\n');}
function parseOutline(source){
  if(typeof source!=='string'||source.length>50000)throw Error('大纲过长，请分成几张导图。');
  const rows=[],stack=[];let unit;
  for(const raw of source.split(/\r?\n/).filter(l=>l.trim())){
    const line=raw.replace(/\t/g,'  '),match=/^( *)(?:[-*+] |\d+\. )(.+)$/.exec(line);
    if(!match)throw Error('请使用缩进列表，每个节点以“- ”开头。');
    const indent=match[1].length;if(indent&&unit===undefined)unit=indent;
    const depth=indent/(unit??2);if(!Number.isInteger(depth)||depth>30||depth>stack.length||(!rows.length&&depth!==0)||(rows.length&&depth===0))throw Error('大纲需要一个根节点，子节点逐层缩进。');
    // Accept two or four spaces, but not an initial unexplained six-space jump.
    if(unit!==undefined&&![2,4].includes(unit))throw Error('请使用两个或四个空格缩进一层。');
    rows.push({text:label(match[2]),parent:depth?stack[depth-1]:null});stack[depth]=rows.length-1;stack.length=depth+1;
    if(rows.length>200)throw Error('导图最多支持 200 个节点。');
  }
  if(!rows.length)throw Error('先输入导图主题。');return rows;
}
function nativeNode(text,parent,order,x,y,id){
  text=label(text);const chars=[...text],lines=[];for(let i=0;i<chars.length;i+=14)lines.push(chars.slice(i,i+14).join(''));
  const width=Math.max(160,Math.min(290,chars.length*18+36)),height=Math.max(54,lines.length*25+24);
  const shape=makeDrawingElements([{kind:'rectangle',x,y,width,height}],id)[0],textElement=makeDrawingElements([{kind:'text',x:x+12,y:y+12,text:lines.join('\n'),fontSize:18,width:width-24,height:height-24}],id)[0];
  Object.assign(shape,{backgroundColor:parent?'#f8fafc':'#e8edf8',strokeColor:'#697d9d',roughness:0,strokeWidth:1.5,roundness:{type:3},customData:{notaraMindmap:{version:1,parent,order,collapsed:false,pinned:false}},boundElements:[{id:textElement.id,type:'text'}]});
  Object.assign(textElement,{originalText:text,containerId:shape.id,textAlign:'center',verticalAlign:'middle',autoResize:true,strokeColor:'#243247'});
  const result=[shape,textElement];
  if(parent){const a=makeDrawingElements([{kind:'arrow',x,y,points:[[0,0],[100,0]]}],id)[0];Object.assign(a,{strokeColor:'#8b9bb4',strokeWidth:1.5,roughness:0,endArrowhead:null,startBinding:{elementId:parent,focus:0,gap:8},endBinding:{elementId:shape.id,focus:0,gap:8},customData:{notaraMindmapEdge:true}});result.push(a);}
  return result;
}
function update(doc,elements){const before=new Map(doc.elements.map(e=>[e.id,e]));return validateDrawing({...doc,elements:elements.map(e=>{const old=before.get(e.id);return old&&!sameDrawingElement(old,e)?{...e,version:(old.version??1)+1,versionNonce:Math.floor(Math.random()*2147483647),updated:Date.now()}:e;})});}
function restoreVisibility(elements){return elements.map(e=>{const hidden=e.customData?.notaraMindmapHidden;if(!hidden)return e;const {notaraMindmapHidden,...customData}=e.customData;return {...e,opacity:hidden.opacity,locked:hidden.locked,customData};});}
function refresh(elements){
  elements=restoreVisibility(elements);const map=new Map(elements.filter(e=>!e.isDeleted).map(e=>[e.id,e]));
  const hidden=new Set();for(const n of map.values())if(meta(n)){const seen=new Set([n.id]);let p=map.get(meta(n).parent);while(p){if(seen.has(p.id))throw Error('导图关系有循环。');seen.add(p.id);if(meta(p)?.collapsed){hidden.add(n.id);break;}p=map.get(meta(p)?.parent);}}
  for(const e of map.values())if(e.containerId&&hidden.has(e.containerId)||edge(e)&&(hidden.has(e.startBinding?.elementId)||hidden.has(e.endBinding?.elementId)))hidden.add(e.id);
  return elements.map(e=>{
    let n=e;
    if(!e.isDeleted&&meta(e))n={...e,boundElements:[...(e.boundElements??[]).filter(b=>map.has(b.id)&&!edge(map.get(b.id))),...elements.filter(a=>!a.isDeleted&&edge(a)&&[a.startBinding?.elementId,a.endBinding?.elementId].includes(e.id)).map(a=>({id:a.id,type:'arrow'}))]};
    if(hidden.has(e.id)&&!e.isDeleted)n={...n,opacity:0,locked:true,customData:{...n.customData,notaraMindmapHidden:{opacity:n.opacity,locked:n.locked}}};return n;
  });
}
/** Native Delete (including when the controls are closed) retains surviving
 * descendants as independent roots. Hidden content must never become trapped. */
export function repairMindmap(doc){
  if(!doc.elements.some(e=>meta(e)))return doc;
  const live=new Set(doc.elements.filter(e=>!e.isDeleted).map(e=>e.id));let elements=structuredClone(doc.elements);
  for(const e of elements){
    if(edge(e)&&e.isDeleted&&e.customData.notaraMindmapOrphanedEdge&&live.has(e.startBinding?.elementId)&&live.has(e.endBinding?.elementId)){e.isDeleted=false;delete e.customData.notaraMindmapOrphanedEdge;live.add(e.id);}
    if(e.isDeleted)continue;
    if(meta(e)?.orphanedParent&&live.has(meta(e).orphanedParent)){const {orphanedParent,...rest}=meta(e);e.customData.notaraMindmap={...rest,parent:orphanedParent};}
    if(meta(e)?.parent&&!live.has(meta(e).parent))e.customData.notaraMindmap={...meta(e),orphanedParent:meta(e).parent,parent:null};
    if(edge(e)&&(!live.has(e.startBinding?.elementId)||!live.has(e.endBinding?.elementId))){e.isDeleted=true;e.customData.notaraMindmapOrphanedEdge=true;live.delete(e.id);}
    else{if(e.startBinding&&!live.has(e.startBinding.elementId))e.startBinding=null;if(e.endBinding&&!live.has(e.endBinding.elementId))e.endBinding=null;}
    if(e.containerId&&!live.has(e.containerId))e.containerId=null;
  }
  for(const e of elements)if(e.boundElements)e.boundElements=e.boundElements.filter(b=>live.has(b.id));
  return update(doc,refresh(elements));
}
function arrange(doc,id){
  const t=tree(doc,id),elements=restoreVisibility(doc.elements),map=new Map(elements.map(e=>[e.id,e]));
  const height=n=>meta(n).collapsed?n.height:Math.max(n.height,t.children(n.id).reduce((h,c,i)=>h+height(c)+(i?32:0),0));
  const outsiders=elements.filter(e=>!e.isDeleted&&!e.customData?.notaraMindmapHidden&&!t.ids.has(e.id)&&!t.ids.has(e.containerId)&&!edge(e)&&!['line','arrow','freedraw'].includes(e.type));
  const placed=[...outsiders,...[...t.ids].map(k=>map.get(k)).filter(n=>meta(n).pinned||n.id===t.root.id)];
  const collide=(a,b)=>a.x<b.x+b.width+24&&a.x+a.width+24>b.x&&a.y<b.y+b.height+24&&a.y+a.height+24>b.y;
  const place=(n,x,cy)=>{let target=map.get(n.id);if(n.id!==t.root.id&&!meta(n).pinned){target={...target,x,y:cy-target.height/2};for(let i=0;i<1000;i++){const obstacle=placed.find(o=>o.id!==target.id&&collide(target,o));if(!obstacle)break;target.y=obstacle.y+obstacle.height+32;}map.set(n.id,target);placed.push(target);}
    if(meta(n).collapsed)return;const children=t.children(n.id),total=children.reduce((s,c,i)=>s+height(c)+(i?32:0),0);let cursor=target.y+target.height/2-total/2;for(const child of children){place(child,target.x+target.width+100,cursor+height(child)/2);cursor+=height(child)+32;}
  };place(t.root,t.root.x,t.root.y+t.root.height/2);
  return elements.map(e=>{
    if(t.ids.has(e.id))return map.get(e.id);
    if(e.containerId&&t.ids.has(e.containerId)){const old=t.nodes.get(e.containerId),n=map.get(e.containerId);return {...e,x:e.x+n.x-old.x,y:e.y+n.y-old.y};}
    if(edge(e)&&!e.isDeleted&&t.ids.has(e.endBinding?.elementId)){const a=map.get(e.startBinding.elementId),b=map.get(e.endBinding.elementId);if(!a||!b)return e;const x=a.x+a.width+8,y=a.y+a.height/2,dx=b.x-8-x,dy=b.y+b.height/2-y;return {...e,x,y,width:Math.abs(dx),height:Math.abs(dy),points:[[0,0],[dx/2,0],[dx/2,dy],[dx,dy]]};}return e;
  });
}
export function createMindmap(doc,outline,{x=0,y=0,id=()=>crypto.randomUUID()}={}){
  if(!Number.isFinite(x)||!Number.isFinite(y))throw Error('导图位置无效。');const rows=parseOutline(outline),created=[],ids=[];
  rows.forEach((row,i)=>{const group=nativeNode(row.text,row.parent===null?null:ids[row.parent],i,x,y,id);ids.push(group[0].id);created.push(...group);});
  const next={...doc,elements:[...doc.elements,...created]};return {doc:update(doc,refresh(arrange(next,ids[0]))),nodeId:ids[0]};
}
export function editMindmap(doc,nodeId,action){
  const node=mindmapNode(doc,nodeId);if(!node)throw Error('所选节点已删除，请重新选择。');const t=tree(doc,node.id);let elements=structuredClone(doc.elements),selected=node.id,layout=false;
  const get=id=>elements.find(e=>e.id===id),setMeta=(id,patch)=>{const e=get(id);e.customData={...e.customData,notaraMindmap:{...meta(e),...patch}};};
  if(action.type==='child'||action.type==='sibling'){
    if(t.ids.size>=200)throw Error('导图最多支持 200 个节点。');const parent=action.type==='child'?node.id:meta(node).parent;if(!parent)throw Error('根节点没有同级节点，请新建导图。');
    const order=action.type==='child'?Math.max(-1,...t.children(parent).map(n=>meta(n).order))+1:meta(node).order+0.5;
    const newNodes=nativeNode(action.text??'新分支',parent,order,node.x,node.y,action.id??(()=>crypto.randomUUID()));elements.push(...newNodes);selected=newNodes[0].id;setMeta(parent,{collapsed:false});layout=true;
  }else if(action.type==='rename'){
    const text=label(action.text),n=get(node.id),txt=elements.find(e=>!e.isDeleted&&e.containerId===node.id&&e.type==='text');if(!txt)throw Error('节点文字已删除。');
    const chars=[...text],lines=[];for(let i=0;i<chars.length;i+=14)lines.push(chars.slice(i,i+14).join(''));n.width=Math.max(160,Math.min(290,chars.length*18+36));n.height=Math.max(54,lines.length*25+24);Object.assign(txt,{text:lines.join('\n'),originalText:text,width:n.width-24,height:n.height-24,x:n.x+12,y:n.y+12});
  }else if(action.type==='fold'){setMeta(node.id,{collapsed:!meta(node).collapsed});
  }else if(action.type==='pin'){setMeta(node.id,{pinned:!meta(node).pinned});
  }else if(action.type==='layout'){layout=true;
  }else if(action.type==='remove'){
    const remove=new Set();const visit=n=>{remove.add(n.id);for(const c of t.children(n.id))visit(c);};visit(node);
    for(const e of elements)if(remove.has(e.id)||remove.has(e.containerId)||edge(e)&&(remove.has(e.startBinding?.elementId)||remove.has(e.endBinding?.elementId)))e.isDeleted=true;
    selected=meta(node).parent??null;
    for(const e of elements)if(!e.isDeleted&&e.boundElements)e.boundElements=e.boundElements.filter(b=>!get(b.id)?.isDeleted);
  }else throw Error('未知导图操作。');
  if(layout)elements=arrange({...doc,elements},t.root.id);
  return {doc:repairMindmap(update(doc,refresh(elements.map(e=>{
    if(e.isDeleted)return e;const alive=id=>elements.some(n=>n.id===id&&!n.isDeleted);return {...e,...(e.startBinding&&!alive(e.startBinding.elementId)?{startBinding:null}:{}),...(e.endBinding&&!alive(e.endBinding.elementId)?{endBinding:null}:{})};})))),nodeId:selected};
}
