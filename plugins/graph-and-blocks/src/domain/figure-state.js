import {splitBoardBody,readComponent} from './board-components.js';
import {studentMarkdown} from './student-markdown.js';
import {mathDefinition} from './drawing-math.js';
export const figureStateKey=c=>`${c.index}:${c.fingerprint}`;
export function canvasFigures(text){return splitBoardBody(studentMarkdown(String(text??'').slice(0,120000))).segments.filter(s=>s.kind==='component'&&s.type==='figure').map(readComponent).filter(c=>!c.error&&!c.spec.ask);}
const sequence=figures=>figures.map(figureStateKey).join('|');
export function canvasFigureState(node){return node.notaraFigureSequence===sequence(canvasFigures(node.text))?node.notaraFigures??{}:{};}
export function updateCanvasFigureNode(node,key,patch){
  const figures=canvasFigures(node.text),component=figures.find(c=>figureStateKey(c)===key);if(!component)throw Error('canvas_figure_changed');
  const stored=canvasFigureState(node),previous=stored[key]??{},data=mathDefinition(component.source,{...previous,...patch,values:{...previous.values,...patch.values},drags:{...previous.drags,...patch.drags}}).data;
  const {values,drags,camera}=data,state={values,drags,...(camera?{camera}:{})};
  if(JSON.stringify(previous)===JSON.stringify(state))return node;
  const active=new Set(figures.map(figureStateKey));return {...node,notaraFigureSequence:sequence(figures),notaraFigures:{...Object.fromEntries(Object.entries(stored).filter(([k])=>active.has(k))),[key]:state}};
}
