import React,{useLayoutEffect,useRef,useState} from 'react';
import {projectGraph} from '../src/graph.js';
import {sourceGroups,sourceStudyGraph} from '../src/source-graph.js';
import {createGraphRenderer} from '../src/graph-renderer.js';
import {installGraphGestures} from '../src/graph-gestures.js';
import {graphLabelLines} from '../src/graph-layout.js';

// Renderer regression for the public, complete sourceStudyGraph API. The
// learner UI deliberately no longer mounts all these examples by default.
export function CompleteSourceFixture({data}){
  const [entered,setEntered]=useState(false),[selected,setSelected]=useState(null),svg=useRef(null),renderer=useRef(null);
  const graph=projectGraph(data),group=sourceGroups(graph)[0],study=sourceStudyGraph(graph,group),width=innerWidth-56;
  useLayoutEffect(()=>{
    if(!entered)return;
    let view={x:0,y:0,scale:1};const drawing=createGraphRenderer(svg.current,new Map(),view);renderer.current=drawing;
    const setView=value=>{view=value;drawing.setView(value);};
    drawing.setSize(width,580);drawing.setGraph(study);setView(drawing.fit());
    const gestures=installGraphGestures(svg.current,{getView:()=>view,setView,getNode:drawing.getNode,onDrag:drawing.drag});
    return()=>{gestures.dispose();drawing.dispose();};
  },[entered,data]);
  useLayoutEffect(()=>renderer.current?.refreshLabels(),[selected]);
  return <section className="nv-block-graph">{!entered?<button onClick={()=>setEntered(true)}>展开{group.title}，{group.nodes.length}张卡片</button>:<div className="nv-graph-canvas-wrap">
    <svg ref={svg} className="nv-block-graph-canvas" viewBox={`0 0 ${width} 580`}><g>
      {[...(study.branches??[]),...study.edges].map((edge,i)=><line key={i} data-graph-edge="true" data-relation-kind={edge.kind} markerEnd={edge.kind==='prerequisite'?'url(#arrow)':undefined} className={'nv-block-edge nv-block-edge-'+edge.style}/>)}
      {study.nodes.map(node=><g key={node.path} data-graph-node={node.path} className={'nv-block-node'+(selected===node.path?' nv-block-selected':'')} tabIndex="0" onClick={()=>setSelected(node.path)}><circle className="nv-block-node-focus" r="12"/><circle r="7"/><text>{graphLabelLines(node.title).map((line,i)=><tspan key={i} x="18" y={i*16}>{line}</tspan>)}</text><title>{node.title}</title></g>)}
    </g></svg>{selected&&<aside aria-label="选中节点" className="nv-graph-node-detail">{study.nodes.find(node=>node.path===selected)?.title}</aside>}
  </div>}</section>;
}
