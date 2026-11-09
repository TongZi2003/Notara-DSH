import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import JXG from 'jsxgraph';
import {FigureCanvas} from '../../plugins/graph-and-blocks/src/geometry-engine.jsx';
import {mathDefinition} from '../../plugins/graph-and-blocks/src/domain/drawing-math.js';
import {PLANAR_SOURCE} from '../../plugins/graph-and-blocks/test/planar-source.js';
import {Figure} from '../../plugins/graph-and-blocks/src/figure.jsx';
import {parseFigure} from '../../plugins/graph-and-blocks/src/domain/board-figure.js';
const DEGENERATE='view x -4..4 y -4..4\nparam r = 0 in 0..3 step 1\npoint O = (0, 0)\ncircle c = center O radius r\nglider P = (3, 0) on c\ntangent tP = c at P';
const QUESTION='view x -4..4 y -4..4\npoint O = (0, 0)\ncircle c = center O radius 2\nglider P = (2, 0) on c\nask drag P "把点拖到圆的上方"';
const CHAIN='view x -4..4 y -4..4\npoint A = (0, 0)\npoint B = (2, 0)\npoint C = (1, 1)\nline L0 = A B\n'+Array.from({length:32},(_,i)=>`parallel L${i+1} = L${i} through C`).join('\n');
const root=createRoot(document.getElementById('root'));
function App(){
  const [data,setData]=useState(()=>mathDefinition(PLANAR_SOURCE,JSON.parse(localStorage.getItem('math')??'{}')).data),[epoch,setEpoch]=useState(0);
  const [question,setQuestion]=useState(false),[answer,setAnswer]=useState();
  const change=(name,p)=>setData(prev=>({...prev,drags:{...prev.drags,[name]:p}}));
  window.longChain=()=>{setQuestion(false);setData(mathDefinition(CHAIN).data);setEpoch(n=>n+1);};
  window.resetWhileLoading=()=>{flushSync(()=>{setQuestion(false);setData(mathDefinition(PLANAR_SOURCE,{drags:{C:{x:3,y:3}}}).data);setEpoch(n=>n+1);});flushSync(()=>setData(mathDefinition(PLANAR_SOURCE).data));};
  window.figureData=data;window.geometryBoard=()=>Object.values(JXG.boards).find(b=>b.containerObj?.isConnected);
  return <main><button onClick={()=>{localStorage.setItem('math',JSON.stringify(data));setEpoch(n=>n+1);}}>保存并重建</button><button onClick={()=>{setData(mathDefinition(DEGENERATE,{drags:{P:{x:0,y:3,position:.25}}}).data);setEpoch(n=>n+1);}}>退化圆</button><button onClick={()=>{window.answers=[];setQuestion(true);}}>拖点作答</button>{data.values.r!==undefined&&<input aria-label="半径" type="range" min="0" max="3" step="1" value={data.values.r} onChange={e=>setData(d=>({...d,values:{r:Number(e.target.value)}}))}/>}<div style={{width:800,height:600}}>{question?<Figure spec={parseFigure(QUESTION)} values={{}} fingerprint="question" point={answer} onPoint={p=>{window.answers.push(p);setAnswer(p);}}/>:<FigureCanvas key={epoch} spec={mathDefinition(data.source,data).spec} specKey={data.source} values={data.values} dragPositions={data.drags} onDrags={change} onDragState={change}/>}</div></main>;
}
root.render(<App/>);
