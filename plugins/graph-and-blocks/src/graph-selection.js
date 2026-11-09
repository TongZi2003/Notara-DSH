import { isCardType } from '@oh-my-student/plugin-vault-sqlite/review-contract';
import { isOriginalSource } from './graph.js';

export const GRAPH_SELECTION_LIMIT = 12;
export const GRAPH_TYPES = [['all','学习内容与原始资料'],['cards','全部卡片'],['concept','概念卡'],['method','方法卡'],['exercise','具体例子'],['source','来源'],['file','其他文件']];
export function createGraphSelectionStore(initial = []) {
  let value=initial;const listeners=new Set();
  return {getSnapshot:()=>value,subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},set:next=>{
    const resolved=typeof next==='function'?next(value):next;
    if(value.length===resolved.length&&value.every((path,index)=>path===resolved[index]))return;
    value=resolved;for(const listener of listeners)listener();
  }};
}
export function graphCandidates(nodes, type = 'all', search = '', centers = []) {
  const q=search.trim().toLocaleLowerCase(),keep=new Set(centers);
  return nodes.filter(node => (keep.has(node.path) || type==='all' || (type==='cards' ? isCardType(node.type) : type==='source' ? isOriginalSource(node) : node.type===type)) && (!q || `${node.title} ${node.path}`.toLocaleLowerCase().includes(q)));
}
export function nodesInBox(nodes, box, view) {
  return nodes.filter(node=>{
    const x=node.x*view.scale+view.x,y=node.y*view.scale+view.y;
    return x>=box.x&&x<=box.x+box.width&&y>=box.y&&y<=box.y+box.height;
  }).map(node=>node.path);
}
export function mergeSelection(current, additions) {
  const next=[...new Set([...current,...additions])];
  if(next.length>GRAPH_SELECTION_LIMIT)throw new Error(`最多选择 ${GRAPH_SELECTION_LIMIT} 份资料，请缩小范围或逐个选择。`);
  return next;
}
