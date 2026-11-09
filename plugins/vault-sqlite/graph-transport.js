import {relationIdentity} from './knowledge-relations.js';

// Opt-in wire representation only. The client restores the same edge IDs,
// endpoints, contexts, descriptions and declarations before any projection.
// Heavy node documents remain available through query({paths}) and read().
export function encodeCompactGraph(graph){
  const strings=[],index=new Map();
  const ref=value=>{if(value===undefined)return -1;if(!index.has(value)){index.set(value,strings.length);strings.push(value);}return index.get(value);};
  const edges=graph.edges.map(edge=>{
    const row=[ref(edge.source),ref(edge.target),ref(edge.kind),ref(edge.style),edge.knowledge,ref(edge.context),ref(edge.sectionKind),ref(edge.description),edge.declarations.map(d=>[ref(d.path),ref(d.sectionKind),ref(d.description),ref(d.style)])];
    const canonical=relationIdentity(edge.kind,edge.source,edge.target,edge.context).id;
    if(edge.id!==canonical)row.push(edge.id);
    return row;
  });
  return {wireVersion:1,relationsVersion:graph.relationsVersion,nodes:graph.nodes,strings,edges};
}
export function decodeCompactGraph(graph){
  if(graph.wireVersion!==1)return graph;
  const text=i=>i===-1?undefined:graph.strings[i];
  const edges=graph.edges.map(row=>{
    const source=text(row[0]),target=text(row[1]),kind=text(row[2]),context=text(row[5]);
    return {id:row.length>9?row[9]:relationIdentity(kind,source,target,context).id,kind,source,target,context,style:text(row[3]),knowledge:row[4],sectionKind:text(row[6]),description:text(row[7]),declarations:row[8].map(d=>({path:text(d[0]),sectionKind:text(d[1]),description:text(d[2]),style:text(d[3])}))};
  });
  return {relationsVersion:graph.relationsVersion,nodes:graph.nodes,edges};
}
export function copyCompactGraph(graph){
  return {...graph,strings:[...graph.strings],nodes:graph.nodes.map(n=>({...n,tags:[...n.tags],knowledgeTags:n.knowledgeTags.map(t=>({...t})),unresolvedKnowledgeTags:n.unresolvedKnowledgeTags.map(t=>({...t})),sourcePaths:[...n.sourcePaths]})),edges:graph.edges.map(row=>{const next=[...row];next[8]=row[8].map(d=>[...d]);return next;})};
}
