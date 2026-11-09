import { forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide, forceX, forceY } from 'd3-force';
import { isCardType } from '@oh-my-student/plugin-vault-sqlite/review-contract';
import {centerLayout,labelMetrics,nodeLabelBounds,labelCollision} from './graph-layout.js';
import {sourceClusterLayout} from './source-cluster-layout.js';
import {sourceHierarchyLayout} from './source-hierarchy-layout.js';
import {decodeCompactGraph} from '@oh-my-student/plugin-vault-sqlite/graph-transport';

export async function readGraph(remote, input = {}) {
  const result = await remote.graph(input);
  if (result?.ok !== true || !Array.isArray(result.value?.nodes) || !Array.isArray(result.value?.edges)) throw new Error('知识联系暂时无法读取');
  return decodeCompactGraph(result.value);
}

// The Host owns provenance. Explicit false (including a legacy guide) and
// auxiliary planning/teaching documents must never masquerade as original
// sources, while standalone projections can still declare true sources.
const AUXILIARY_TYPES = new Set(['route', 'lesson', 'learner-profile', 'guide', 'diary', 'template', 'skill', 'base']);
export const isOriginalSource = node => !AUXILIARY_TYPES.has(node?.type) && (node?.isSource === true || node?.isSource === undefined && ['source', 'pdf'].includes(node?.type));
export const isDefaultGraphNode = node => isCardType(node?.type) || isOriginalSource(node);
export const graphCatalog = data => [...new Map((data?.nodes ?? []).filter(node => typeof node?.path === 'string' && node.path).map(node => [node.path, { ...node, tags: node.tags ?? [] }])).values()];

/** Solid student links cover reference links in either direction. No mastery inference. */
export function matchesTags(nodeTags = [], tags = [], tagMatch = 'all') {
  return !tags.length || tags[tagMatch === 'any' ? 'some' : 'every'](tag => nodeTags.includes(tag));
}
export function graphTags(node) {
  const resolved=new Map((node.knowledgeTags??[]).map(tag=>[tag.raw,tag]));
  return [...new Map((node.tags??[]).map(raw=>{
    const tag=resolved.get(raw);
    const reference=String(raw).match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
    const item=tag?{value:`[[${tag.target}]]`,label:tag.label,target:tag.target}:{value:raw,label:reference?(reference[2]||reference[1].split('/').at(-1).replace(/\.md$/i,'')):raw};
    return [item.value,item];
  })).values()];
}
export function graphEdgeKey(edge) {
  return edge.id??JSON.stringify([edge.kind??'legacy',...(['prerequisite','example'].includes(edge.kind)?[edge.source,edge.target]:[edge.source,edge.target].sort()),edge.context??'']);
}
export function projectGraph(data = {}, focusPaths = [], tags = [], hops = 1, tagMatch = 'all', relations = 'backbone') {
  const centers = new Set(Array.isArray(focusPaths) ? focusPaths : focusPaths ? [focusPaths] : []);
  // Admission precedes traversal and simulation. A hidden diary is neither a
  // layout force nor a bridge into unrelated knowledge; explicit centers alone
  // are admitted from the complete, caller-scoped catalog.
  const nodes = new Map(graphCatalog(data).filter(node => centers.has(node.path) || isDefaultGraphNode(node)).map(node => [node.path, node]));
  const auxiliaryCenter=[...centers].some(path=>nodes.has(path)&&!isDefaultGraphNode(nodes.get(path)));
  const pairs = new Map();
  for (const edge of data?.edges ?? []) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target) || data.relationsVersion!==2&&edge.source === edge.target) continue;
    if(data.relationsVersion===2&&relations!=='all'&&!auxiliaryCenter&&!['prerequisite','example','source'].includes(edge.kind))continue;
    const key = data.relationsVersion===2?graphEdgeKey(edge):JSON.stringify([edge.source, edge.target].sort());
    if (!pairs.has(key) || edge.style === 'solid') pairs.set(key, { ...edge, style: edge.style === 'solid' ? 'solid' : 'dashed' });
  }
  const edges = [...pairs.values()];
  const scope = centers.size ? new Set([...centers].filter(path => nodes.has(path))) : new Set(nodes.keys());
  let frontier = new Set(scope);
  if (centers.size) for (let depth = 0; depth < Math.max(0, Math.min(3, hops)); depth++) {
    const next = new Set();
    for (const edge of edges) {
      if (frontier.has(edge.source) && !scope.has(edge.target)) next.add(edge.target);
      if (frontier.has(edge.target) && !scope.has(edge.source)) next.add(edge.source);
    }
    for (const path of next) scope.add(path);
    frontier = next;
  }
  const visible = new Set([...scope].filter(path => centers.has(path) || matchesTags(graphTags(nodes.get(path)).map(tag=>tag.value),tags,tagMatch)));
  return {
    ...(data.relationsVersion===2?{relationsVersion:2}:{}),
    nodes: [...nodes.values()].filter(node => visible.has(node.path)).map(node => ({ ...node, highlighted: true, center: centers.has(node.path) })),
    edges: edges.filter(edge => visible.has(edge.source) && visible.has(edge.target)),
  };
}

export function nodeAppearance(node) {
  const explicit = {concept:'knowledge',method:'method',exercise:'example',guide:'guide',route:'guide',lesson:'guide'};
  const legacy = !node.type || node.type==='card';
  const kind = Object.hasOwn(explicit,node.type) ? explicit[node.type]
    : legacy && /导读/.test(node.title ?? '') ? 'guide'
    : legacy && /方法/.test(node.title ?? '') ? 'method'
    : legacy && /例题|练习|案例|实验/.test(node.title ?? '') ? 'example' : 'knowledge';
  const independent = Number.isFinite(node.independentReviewCount) && node.independentReviewCount > 0;
  return { kind, independent, radius: kind === 'guide' ? 10 : kind === 'method' ? 9 : 7 };
}

export function graphLayoutPlan(graph,width,height,positions,measurements,origin,cache){
  const centers=graph.nodes.filter(node=>node.center),rootPin=positions.get(graph.sourcePath),centerPin=centers.length===1?positions.get(centers[0].path):null;
  if(!centers.length&&!['source-hierarchy','source-clusters'].includes(graph.layout))return {hierarchyTargets:null,centeredTargets:null,clusterPlan:null};
  const key=cache&&JSON.stringify([graph.layout,graph.presentation,graph.relationsVersion,graph.sourcePath,width,height,origin,rootPin?.fx,rootPin?.fy,centerPin?.fx,centerPin?.fy,
    graph.nodes.map(n=>[n.path,n.title,n.type,isOriginalSource(n),n.sourcePaths,n.center,n.sourceLayer,n.sourceParents,n.dependencyRank,n.dependencyGroup,n.dependencyCycle,labelMetrics(n,measurements.get(n.path))]),
    centers.length?graph.edges.map(e=>[e.source,e.target]):null]);
  let plan=cache?.get(key);
  if(!plan){
    const hierarchyTargets=sourceHierarchyLayout(graph,width,height,measurements,positions,origin);
    const centeredTargets=hierarchyTargets?null:centerLayout(graph,width,height,measurements,positions,origin);
    const clusterPlan=!centeredTargets&&graph.layout==='source-clusters'?sourceClusterLayout(graph,graph.nodes.filter(isOriginalSource),origin??{x:width/2,y:height/2},measurements):null;
    plan={hierarchyTargets,centeredTargets,clusterPlan};
    if(cache){if(cache.size>=8)cache.delete(cache.keys().next().value);cache.set(key,plan);}
  }
  // The renderer adds heading/hover state to clusters; never put those mutable
  // DOM objects into the cached mathematical layout plan.
  const copy=targets=>targets&&new Map([...targets].map(([path,p])=>[path,{...p}]));
  return {hierarchyTargets:copy(plan.hierarchyTargets),centeredTargets:copy(plan.centeredTargets),clusterPlan:plan.clusterPlan&&{targets:copy(plan.clusterPlan.targets),clusters:plan.clusterPlan.clusters.map(c=>({...c}))}};
}

export function createSimulation(graph, onTick = () => {}, width = 960, height = 580, positions = new Map(), measurements = new Map(), origin, layoutCache) {
  const {hierarchyTargets,centeredTargets,clusterPlan}=graphLayoutPlan(graph,width,height,positions,measurements,origin,layoutCache);
  const targets=hierarchyTargets??centeredTargets??clusterPlan?.targets;
  const nodes = graph.nodes.map((node, index) => {
    const p = positions.get(node.path) ?? {};
    if(targets){
      const target=targets.get(node.path),pinned=p.fx!=null||p.fy!=null;
      return {...node,x:target.x,y:target.y,...(pinned?p:{}),layoutTarget:target,labelSide:target.side,labelBounds:target.compact?{left:-17,right:17,top:-17,bottom:17}:nodeLabelBounds(node,labelMetrics(node,measurements.get(node.path)),target.side)};
    }
    // Seed a centered phyllotaxis cloud before the first asynchronous d3 tick.
    // This is an initial pose, not a claim that the force layout has settled.
    const angle = index * Math.PI * (3 - Math.sqrt(5));
    const radius = Math.min(width * .3, height * .3) * Math.sqrt((index + .5) / Math.max(1, graph.nodes.length));
    return { ...node, x: width / 2 + radius * Math.cos(angle), y: height / 2 + radius * Math.sin(angle), ...p };
  });
  const links = [...(graph.branches??[]),...graph.edges].map(edge => ({ ...edge }));
  if(targets){
    const simulation=forceSimulation(nodes).alphaDecay(.08).alphaMin(.015)
      // Real links remain rendered; their density does not pull the layout in.
      .force('links',forceLink(links).id(node=>node.path).strength(0))
      .force('x',forceX(node=>node.layoutTarget.x).strength(.4))
      .force('y',forceY(node=>node.layoutTarget.y).strength(.4))
      .force('labels',clusterPlan?forceCollide(15):labelCollision())
      .on('tick',()=>onTick({nodes,links}));
    return {simulation,nodes,links,hierarchical:Boolean(hierarchyTargets),centered:Boolean(centeredTargets),clustered:Boolean(clusterPlan),clusters:clusterPlan?.clusters??[]};
  }
  const dense=nodes.length>80;
  const simulation = forceSimulation(nodes)
    .alphaDecay(.08).alphaMin(.015)
    .force('charge', forceManyBody().strength(dense?-360/Math.sqrt(nodes.length/80):-360).distanceMax(600))
    .force('links', forceLink(links).id(node => node.path).distance(dense?110:155).strength(.22))
    // World geometry stays independent of viewport size. Reused positions keep
    // their center; a camera fit handles newly visible/narrow containers.
    .force('center', forceCenter(nodes.length?nodes.reduce((n,node)=>n+node.x,0)/nodes.length:width/2,nodes.length?nodes.reduce((n,node)=>n+node.y,0)/nodes.length:height/2))
    .force('collision', forceCollide(dense?24:44))
    .on('tick', () => onTick({ nodes, links }));
  // The knowledge overview is a small hub graph. Settle its initial pose
  // before the first camera fit, rather than drifting out of that viewport.
  if(graph.layout==='knowledge')simulation.stop().tick(160);
  return { simulation, nodes, links };
}
