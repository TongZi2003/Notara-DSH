// Only presentation state belongs here. Graph data, candidates and session
// identity remain owned by their existing stores.
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const strings=value=>Array.isArray(value)&&value.every(item=>typeof item==='string');
const point=value=>object(value)&&Number.isFinite(value.x)&&Number.isFinite(value.y);
const camera=value=>point(value)&&Number.isFinite(value.scale)&&value.scale>0;
function fields(value) {
  const state={};
  if(!object(value))return state;
  if(['sources','knowledge','all','center'].includes(value.organization))state.organization=value.organization;
  for(const key of ['search','sourceId','focusPath','selectedPath','scope'])if(typeof value[key]==='string'||value[key]===null)state[key]=value[key];
  if(['all','established','potential'].includes(value.relationFilter))state.relationFilter=value.relationFilter;
  if(['auto','all','none'].includes(value.labelMode))state.labelMode=value.labelMode;
  const f=value.filters;
  if(object(f)&&strings(f.centers)&&strings(f.tags)&&Number.isInteger(f.hops)&&typeof f.type==='string'&&['any','all'].includes(f.tagMatch))state.filters={centers:f.centers,tags:f.tags,hops:f.hops,type:f.type,tagMatch:f.tagMatch};
  if(camera(value.view))state.view={...value.view};
  for(const key of ['width','height'])if(Number.isFinite(value[key]))state[key]=value[key];
  if(object(value.previewReturn)&&typeof value.previewReturn.key==='string'&&camera(value.previewReturn.view)){
    const p=value.previewReturn;state.previewReturn={key:p.key,view:p.view,scope:p.scope};if(p.organization!==undefined)state.previewReturn.organization=p.organization;
  }
  return state;
}
export function encodeGraphState(state, cameraRevision) {
  const value=fields(state);
  value.centerHistory=(state.centerHistory??[]).map(fields);
  value.positions=[...(state.positions??new Map())];
  value.centerOrigins=[...(state.centerOrigins??new Map())];
  // Return frames often share a large layout identity. Store each exact string
  // once rather than duplicating the graph description for every back step.
  const scopes=[];
  const json=JSON.stringify(value,(key,item)=>{
    if(key!=='scope'||typeof item!=='string')return item;
    let index=scopes.indexOf(item);if(index<0){index=scopes.length;scopes.push(item);}return {scopeIndex:index};
  });
  return JSON.stringify({version:1,cameraRevision,scopes,value:JSON.parse(json)});
}
export function decodeGraphState(text) {
  try {
    const saved=JSON.parse(text);
    if(saved?.version!==1||!Array.isArray(saved.scopes)||!object(saved.value))return {};
    const value=JSON.parse(JSON.stringify(saved.value),(key,item)=>key==='scope'&&object(item)?saved.scopes[item.scopeIndex]:item);
    const state=fields(value);
    state.centerHistory=Array.isArray(value.centerHistory)?value.centerHistory.map(fields).filter(item=>item.filters&&item.organization):[];
    for(const name of ['positions','centerOrigins'])state[name]=new Map((Array.isArray(value[name])?value[name]:[]).filter(row=>Array.isArray(row)&&typeof row[0]==='string'&&point(row[1])));
    return state;
  } catch { return {}; }
}
export function createGraphStateStore(storage) {
  const states=new Map(),entries=new WeakMap(),dirty=new Map();let timer;
  const flush=()=>{
    clearTimeout(timer);timer=undefined;
    for(const [state,kind]of dirty){const entry=entries.get(state);if(!entry){dirty.delete(state);continue;}
      try{
        if(kind==='camera'&&entry.saved)storage?.setItem(entry.key+':camera',JSON.stringify({version:1,cameraRevision:entry.revision,view:state.view}));
        else {const revision=entry.revision+1;storage?.setItem(entry.key,encodeGraphState(state,revision));entry.revision=revision;entry.saved=true;}
        dirty.delete(state);
      }catch{/* Retain the dirty state for the next interaction; no retry loop. */}
    }
  };
  const changed=(state,kind='all',defer=false)=>{
    if(!entries.has(state))return;
    dirty.set(state,dirty.get(state)==='all'||kind!=='camera'?'all':'camera');clearTimeout(timer);timer=defer?undefined:setTimeout(flush,200);
  };
  const get=(id,root)=>{
    const durable=typeof id==='string'&&typeof root==='string'&&root.length>0;
    const key=durable?'notara.graph.view.v1:'+JSON.stringify([id,root.replace(/\\/g,'/').replace(/\/$/,'')]):JSON.stringify(['memory',id??null,typeof id]);
    if(!states.has(key)){
      let state={},revision=0,saved=false;
      if(durable)try{
        const raw=storage?.getItem(key);state=decodeGraphState(raw);saved=!!state.filters;
        revision=JSON.parse(raw)?.cameraRevision??0;
        const pose=JSON.parse(storage?.getItem(key+':camera')??'null');
        if(saved&&pose?.version===1&&pose.cameraRevision===revision&&camera(pose.view))state.view=pose.view;
      }catch{}
      states.set(key,state);if(durable){entries.set(state,{key,revision,saved});if(!saved)dirty.set(state,'all');}
    }
    return states.get(key);
  };
  return {get,changed,flush};
}
