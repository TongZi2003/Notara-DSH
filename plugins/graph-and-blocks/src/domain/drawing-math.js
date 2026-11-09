import {parseFigure} from './board-figure.js';
import {validateMathData} from '@oh-my-student/plugin-vault-sqlite/drawing-math';
export {PLANAR_CONSTRUCTION_SYNTAX} from './board-figure.js';

export const MATH_EXAMPLES = {
  '函数': 'axes x -2..4 y -2..10\nparam a = 1 in 0.2..2 step 0.1\nfunction f(x) = a*x^2\npoint A = (1, a)',
  '平面几何': 'view x -1..6 y -1..5\npoint A = (0, 0)\npoint B = (4, 0) drag\npoint C = (1, 3) drag\nsegment A B\nsegment B C\nsegment C A\nmidpoint M = B C\nsegment A M',
  '圆与切线': 'view x -2..8 y -3..6\npoint A = (0, 0) drag\npoint B = (6, 0) drag\npoint C = (2, 4) drag\nsegment A B\nsegment B C\nsegment C A\ncircumcenter O = A B C\ncircumcircle c = A B C\nglider P = (6, 3) on c\ntangent tP = c at P\nsegment O P',
  '立体几何': 'view x -1..4 y -1..4 z -1..4\nparam h = 2 in 0.5..3 step 0.1\npoint A = (0, 0, 0)\npoint B = (3, 0, 0)\npoint C = (3, 3, 0)\npoint D = (0, 3, 0)\npoint E = (1.5, 1.5, h)\npyramid P = base A B C D apex E',
};
export function mathDefinition(source, state={}) {
  const spec=parseFigure(source);
  if(spec.ask) throw Error('数学白板只保存图形；作答请在对话中提交。');
  if(!spec.objects.length) throw Error('请至少定义一个图形。');
  const values=Object.fromEntries(spec.params.map(p=>[p.name,state.values?.[p.name]??p.value]));
  for(const p of spec.params)if(!Number.isFinite(values[p.name])||values[p.name]<p.min||values[p.name]>p.max)throw Error(`参数 ${p.name} 超出范围。`);
  const drags=Object.fromEntries(spec.objects.filter(p=>p.drag&&state.drags?.[p.name]).map(p=>{const saved=state.drags[p.name];return [p.name,{x:saved.x,y:saved.y,...(p.kind==='glider'&&saved.position!==undefined?{position:saved.position}:{})}];}));
  const data=validateMathData({version:1,source,values,drags,...(spec.space?{camera:state.camera??{yaw:-.72,pitch:.52,zoom:1}}:{})});
  return {spec,data};
}
