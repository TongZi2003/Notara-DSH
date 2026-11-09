import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation} from '../src/graph.js';
import {graphLabelLines,visibleGraphLabels} from '../src/graph-layout.js';

const fixture=()=>({nodes:[{path:'导读.md',title:'均值不等式讲义导读',type:'guide',center:true},...Array.from({length:27},(_,i)=>({path:`题目${i+1}.md`,title:`讲义第${i+1}题：正数约束与不等式恒成立`,type:'exercise'}))],edges:[...Array.from({length:27},(_,i)=>({source:'导读.md',target:`题目${i+1}.md`,style:'dashed'})),...Array.from({length:26},(_,i)=>({source:`题目${i+1}.md`,target:`题目${i+2}.md`,style:i%2?'solid':'dashed'}))]});
test('a dense center stays central, leaves room for complete label boxes, and preserves all real edges',()=>{
  const graph=fixture(),before=structuredClone(graph),cached=new Map(graph.nodes.map(node=>[node.path,{x:10,y:10}]));
  const live=createSimulation(graph,()=>{},960,580,cached);live.simulation.stop();live.simulation.tick(240);
  const center=live.nodes.find(node=>node.center);
  assert.ok(Math.abs(center.x-480)<1&&Math.abs(center.y-290)<1,'explicit center must anchor the layout, not only filter it');
  assert.equal(center.fx,undefined,'automatic centers must not become manual pins');
  for(let i=0;i<live.nodes.length;i++)for(let j=i+1;j<live.nodes.length;j++){
    const a=live.nodes[i],b=live.nodes[j],x=a.labelBounds,y=b.labelBounds;
    assert.ok(x&&y,'layout must include measured/fallback label bounds');
    assert.ok(a.x+x.right<=b.x+y.left||b.x+y.right<=a.x+x.left||a.y+x.bottom<=b.y+y.top||b.y+y.bottom<=a.y+x.top,`overlapping labels: ${a.path} / ${b.path}`);
  }
  assert.equal(live.links.length,graph.edges.length);
  assert.deepEqual(live.links.map(edge=>edge.style),graph.edges.map(edge=>edge.style));
  assert.deepEqual(graph,before);assert.deepEqual(cached.get('题目1.md'),{x:10,y:10});
});
test('manual pins survive center layout and multiple centers stay distinct',()=>{
  const graph=fixture();graph.nodes[10].center=true;
  const live=createSimulation(graph,()=>{},960,580,new Map([['题目1.md',{x:-500,y:400,fx:-500,fy:400}]]));
  live.simulation.stop();live.simulation.tick(200);
  const pinned=live.nodes.find(node=>node.path==='题目1.md');assert.equal(pinned.x,-500);assert.equal(pinned.y,400);
  const roots=live.nodes.filter(node=>node.center);assert.ok(Math.hypot(roots[0].x-roots[1].x,roots[0].y-roots[1].y)>100);
  assert.ok(live.nodes.every(node=>Number.isFinite(node.x)&&Number.isFinite(node.y)));
});
test('a manually pinned center remains the origin for its automatic neighborhood',()=>{
  const live=createSimulation(fixture(),()=>{},960,580,new Map([['导读.md',{x:-600,y:800,fx:-600,fy:800}]]));
  live.simulation.stop();live.simulation.tick(100);
  const others=live.nodes.filter(node=>!node.center),x=others.reduce((sum,node)=>sum+node.x,0)/others.length;
  assert.ok(Math.abs(x+600)<50,'neighbors should surround the pinned center rather than a stale viewport origin');
});
test('title wrapping is bounded without broken code points and respects a supplied text measurement',()=>{
  const text='知识🙂联系与长标题'.repeat(10),lines=graphLabelLines(text,value=>[...value].length*10,100);
  assert.equal(lines.length,2);assert.ok(lines.every(line=>[...line].length<=10));assert.ok(lines[1].endsWith('…'));
  assert.equal(lines.join('').includes('\ufffd'),false);
  assert.deepEqual(graphLabelLines('短标题'),['短标题']);
});
test('labels prioritize the center and sources; zoomed-out ordinary labels return with zoom or explicit attention',()=>{
  const box={left:0,right:100,top:0,bottom:20};
  const items=[{path:'ordinary',priority:0,box},{path:'center',priority:90,box},{path:'source',priority:60,box:{...box,left:200,right:300}},{path:'far',priority:0,box:{...box,left:400,right:500}}];
  assert.deepEqual([...visibleGraphLabels(items,1)],['center','source','far']);
  assert.deepEqual([...visibleGraphLabels(items,.4)],['center','source']);
  assert.ok(visibleGraphLabels([{...items[0],forced:true,priority:100},...items.slice(1)],.4).has('ordinary'));
});
test('a compact cluster label avoids other node circles while explicit attention still reveals it',()=>{
  const item={path:'a',priority:0,box:{left:20,right:140,top:0,bottom:20}},circle={path:'b',box:{left:40,right:60,top:0,bottom:20}};
  assert.equal(visibleGraphLabels([item],1,[circle]).size,0);
  assert.ok(visibleGraphLabels([{...item,forced:true}],1,[circle]).has('a'));
  assert.ok(visibleGraphLabels([item],1,[{...circle,path:'a'}]).has('a'));
});
