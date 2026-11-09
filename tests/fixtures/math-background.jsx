import {mathRender} from '../../plugins/vault-views/src/math-drawing.jsx';
import {mathDefinition,MATH_EXAMPLES} from '../../plugins/graph-and-blocks/src/domain/drawing-math.js';
window.renderWithoutAnimationFrames=async()=>{
  const original=window.requestAnimationFrame;window.requestAnimationFrame=()=>42;
  try{return await mathRender(mathDefinition(MATH_EXAMPLES['圆与切线']).data);}finally{window.requestAnimationFrame=original;}
};
