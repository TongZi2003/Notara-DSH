import {isCardType} from '@oh-my-student/plugin-vault-sqlite/review-contract';
import {isOriginalSource} from './graph.js';
export const sharedSourceCount=nodes=>nodes.filter(node=>new Set(Array.isArray(node.sourcePaths)?node.sourcePaths:[]).size>1).length;
export function graphEdgeKind(edge,nodes){
  if(['prerequisite','example','association','reference','source'].includes(edge.kind))return edge.kind;
  const a=nodes.get(edge.source),b=nodes.get(edge.target);
  const provenance=(card,source)=>isOriginalSource(source)&&Array.isArray(card?.sourcePaths)&&card.sourcePaths.includes(source.path);
  if(provenance(a,b)||provenance(b,a))return 'source';
  if(typeof edge.knowledge==='boolean')return edge.knowledge?'knowledge':'reference';
  return isCardType(a?.type)&&isCardType(b?.type)&&!isOriginalSource(a)&&!isOriginalSource(b)?'knowledge':'reference';
}
export const isLearningRelation=kind=>['knowledge','prerequisite','example','association'].includes(kind);
/** Filter learning relations without interpreting provenance or support as evidence. */
export function graphRelationVisible(edge,kind,filter='all'){
  if(filter!=='established'&&filter!=='potential')return true;
  if(edge.organization||kind==='source')return true;
  return isLearningRelation(kind)&&edge.style===(filter==='established'?'solid':'dashed');
}
/** Source membership is navigation, never evidence of understanding. Groups
 * reference existing paths; they do not create cards or synthetic graph edges. */
export function sourceGroups(data, visibleNodes = data?.nodes ?? []) {
  const originals=new Map((data?.nodes??[]).filter(isOriginalSource).map(node=>[node.path,node]));
  const groups=new Map(),unassigned=[],outside=[];
  const group=path=>{
    if(!groups.has(path)){const source=originals.get(path);groups.set(path,{id:JSON.stringify(['source',path]),path,title:source.title||path,nodes:[]});}
    return groups.get(path);
  };
  for(const node of visibleNodes){
    if(originals.has(node.path)){group(node.path);continue;}
    if(!isCardType(node.type))continue;
    const recorded=[...new Set(Array.isArray(node.sourcePaths)?node.sourcePaths:[])],sources=recorded.filter(path=>originals.has(path));
    if(!sources.length)(recorded.length?outside:unassigned).push(node);
    else for(const path of sources)group(path).nodes.push(node);
  }
  const result=[...groups.values()].sort((a,b)=>a.title.localeCompare(b.title,'zh-CN')||a.path.localeCompare(b.path));
  if(unassigned.length)result.push({id:'unassigned',path:null,title:'未关联原始资料',nodes:unassigned});
  if(outside.length)result.push({id:'outside',path:null,title:'来源不在当前范围',nodes:outside});
  return result;
}

export function crossSourceEdges(graph,selectedPath){
  if(!selectedPath)return [];
  const nodes=new Map(graph.nodes.map(node=>[node.path,node]));
  return graph.edges.filter(edge=>{
    if(edge.source!==selectedPath&&edge.target!==selectedPath)return false;
    const a=nodes.get(edge.source),b=nodes.get(edge.target);
    if(!isCardType(a?.type)||!isCardType(b?.type))return false;
    const left=new Set(a.sourcePaths??[]),right=new Set(b.sourcePaths??[]);
    return left.size>0&&right.size>0&&![...left].some(path=>right.has(path));
  });
}

export function graphForSource(graph,group){
  if(!group)return {nodes:[],edges:[]};
  const paths=new Set(group.nodes.map(node=>node.path));
  if(group.path)paths.add(group.path);
  return {...(graph.relationsVersion===2?{relationsVersion:2}:{}),nodes:graph.nodes.filter(node=>paths.has(node.path)),edges:graph.edges.filter(edge=>paths.has(edge.source)&&paths.has(edge.target))};
}

/** Collapse only layout cycles; every declaration and route stays on its edge. */
function dependencyGroups(paths,edges){
  const next=new Map([...paths].map(path=>[path,[]]));
  for(const edge of edges)if(edge.kind==='prerequisite'&&paths.has(edge.source)&&paths.has(edge.target))next.get(edge.source).push(edge.target);
  const index=new Map(),low=new Map(),stack=[],active=new Set(),groups=[];let cursor=0;
  const visit=path=>{
    index.set(path,cursor);low.set(path,cursor++);stack.push(path);active.add(path);
    for(const target of next.get(path)){if(!index.has(target)){visit(target);low.set(path,Math.min(low.get(path),low.get(target)));}else if(active.has(target))low.set(path,Math.min(low.get(path),index.get(target)));}
    if(low.get(path)===index.get(path)){const members=[];let member;do{member=stack.pop();active.delete(member);members.push(member);}while(member!==path);groups.push(members.sort());}
  };
  for(const path of [...paths].sort())if(!index.has(path))visit(path);
  const byPath=new Map(groups.flatMap((members,i)=>members.map(path=>[path,i]))),ranks=new Map();
  const incoming=new Map(groups.map((_,i)=>[i,[]]));
  for(const edge of edges)if(edge.kind==='prerequisite'&&byPath.has(edge.source)&&byPath.has(edge.target)&&byPath.get(edge.source)!==byPath.get(edge.target))incoming.get(byPath.get(edge.target)).push(byPath.get(edge.source));
  const rank=i=>{if(ranks.has(i))return ranks.get(i);let value=0;for(const parent of incoming.get(i))value=Math.max(value,rank(parent)+1);ranks.set(i,value);return value;};
  return new Map(groups.flatMap((members,i)=>members.map(path=>[path,{dependencyGroup:JSON.stringify(members),dependencyMembers:members,dependencyRank:rank(i),dependencyCycle:members.length>1||next.get(path).includes(path)}])));
}

/** A source's reading structure. Branches are presentation links, separate from
 * the recorded knowledge edges; they never create provenance or learning facts. */
export function sourceStudyGraph(graph,group,{display='complete'}={}){
  const local=graphForSource(graph,group),nodes=new Map(graph.nodes.map(node=>[node.path,node]));
  const root=nodes.get(group?.path);
  if(!root||!isOriginalSource(root))return local;
  const isTopic=node=>node&&!isOriginalSource(node)&&['concept','method'].includes(node.type);
  const contents=new Set(local.nodes.filter(node=>node.path!==root.path&&!isTopic(node)).map(node=>node.path));
  const topics=new Set(local.nodes.filter(isTopic).map(node=>node.path));
  const parents=new Map([...contents].map(path=>[path,new Set()]));
  for(const edge of graph.edges){
    if(graph.relationsVersion===2?edge.kind!=='example':graphEdgeKind(edge,nodes)!=='knowledge')continue;
    for(const [topic,content] of [[edge.source,edge.target],[edge.target,edge.source]])if(isTopic(nodes.get(topic))&&contents.has(content)){
      topics.add(topic);parents.get(content).add(topic);
    }
  }
  if(graph.relationsVersion===2){
    // Only local entities and local examples' tag targets seed one hop. A
    // neighbor must not recursively import the rest of the learning set.
    const seeds=new Set(topics);
    for(const edge of graph.edges)if(edge.kind==='prerequisite'&&isTopic(nodes.get(edge.source))&&isTopic(nodes.get(edge.target))&&(seeds.has(edge.source)||seeds.has(edge.target))){topics.add(edge.source);topics.add(edge.target);}
  }
  if(!topics.size)return local;
  const paths=new Set([root.path,...topics,...contents]);
  const edges=graph.edges.filter(edge=>{
    if(!paths.has(edge.source)||!paths.has(edge.target))return false;
    if(graph.relationsVersion===2)return true;
    if(edge.source!==root.path&&edge.target!==root.path)return true;
    const target=edge.source===root.path?edge.target:edge.source;
    // Knowledge parents organize placement; they do not replace provenance.
    return contents.has(target);
  });
  const rootNeighbors=new Set(),rootSources=new Set();
  for(const edge of edges)if(edge.source===root.path||edge.target===root.path){const path=edge.source===root.path?edge.target:edge.source;rootNeighbors.add(path);if(edge.kind==='source')rootSources.add(path);}
  const branches=[...topics].filter(target=>graph.relationsVersion!==2||nodes.get(target).sourcePaths?.includes(root.path)&&!rootSources.has(target)).map(target=>({source:root.path,target,style:'dashed',organization:true}));
  for(const path of contents)if(!parents.get(path).size&&!rootNeighbors.has(path))branches.push({source:root.path,target:path,style:'dashed',organization:true});
  const dependencies=graph.relationsVersion===2?dependencyGroups(topics,edges):new Map();
  const study={...(graph.relationsVersion===2?{relationsVersion:2}:{}),layout:'source-hierarchy',sourcePath:root.path,branches,edges,nodes:graph.nodes.filter(node=>paths.has(node.path)).map(node=>({
    ...node,sourceLayer:node.path===root.path?'source':topics.has(node.path)?'knowledge':'content',
    ...dependencies.get(node.path),
    sourceParents:node.path===root.path?[]:topics.has(node.path)?graph.relationsVersion!==2||node.sourcePaths?.includes(root.path)?[root.path]:[]:parents.get(node.path).size?[...parents.get(node.path)].sort():[root.path],
    ...(node.path===root.path?{center:true}:{}),
  }))};
  return display==='backbone'?sourceStudyBackbone(study):study;
}
export function sourceStudyBackbone(study){
  if(study.layout!=='source-hierarchy')return study;
  const topics=new Set(study.nodes.filter(node=>node.sourceLayer==='knowledge').map(node=>node.path));
  // Explicit display projection only. The complete public graph, provenance,
  // example identities and evidence styles remain available to every caller.
  return {...study,presentation:'backbone',branches:[],nodes:study.nodes.filter(node=>topics.has(node.path)),edges:study.edges.filter(edge=>edge.kind==='prerequisite'&&topics.has(edge.source)&&topics.has(edge.target))};
}

/** A shared example occurs once per list, using only recorded case relations. */
export function sourceExamples(graph,topicPath){
  const nodes=new Map(graph.nodes.map(node=>[node.path,node])),paths=new Set();
  if(!['concept','method'].includes(nodes.get(topicPath)?.type))return [];
  for(const edge of graph.edges){
    if(graph.relationsVersion===2?edge.kind!=='example':graphEdgeKind(edge,nodes)!=='knowledge')continue;
    const path=edge.source===topicPath?edge.target:edge.target===topicPath?edge.source:null,node=nodes.get(path);
    if(node&&!isOriginalSource(node)&&!['concept','method'].includes(node.type))paths.add(path);
  }
  return [...paths].map(path=>nodes.get(path)).sort((a,b)=>(a.title??a.path).localeCompare(b.title??b.path,'zh-CN',{numeric:true})||a.path.localeCompare(b.path));
}

/** Display-only folding. Sources and knowledge keep their real identities;
 * examples remain in the filtered catalog and are reached through their hub. */
export function sourceOverviewGraph(graph){
  const sources=new Set(graph.nodes.filter(isOriginalSource).map(node=>node.path));
  const nodes=graph.nodes.filter(node=>isOriginalSource(node)||['concept','method'].includes(node.type)||!node.sourcePaths?.some(path=>sources.has(path)));
  const paths=new Set(nodes.map(node=>node.path));
  return {...graph,presentation:'source-overview',layout:'source-clusters',sourceGroups:sourceGroups(graph),nodes,edges:graph.edges.filter(edge=>paths.has(edge.source)&&paths.has(edge.target))};
}

export function knowledgeOverviewGraph(graph){
  const nodes=graph.nodes.filter(node=>['concept','method'].includes(node.type)),paths=new Set(nodes.map(node=>node.path));
  const edges=graph.edges.filter(edge=>paths.has(edge.source)&&paths.has(edge.target));
  const dependencies=dependencyGroups(paths,edges);
  return {...graph,layout:'knowledge',presentation:'knowledge-overview',branches:[],nodes:nodes.map(node=>({...node,...dependencies.get(node.path)})),edges};
}
