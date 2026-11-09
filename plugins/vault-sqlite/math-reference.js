import {isMathElement,validateMathData} from './drawing-math.js';
const validId=id=>typeof id==='string'&&id.length>0&&id.length<=200&&!/[\x00-\x1f]/.test(id);
export function mathElementSubpath(id){if(!validId(id))throw Error('math_reference_invalid');return '#element='+encodeURIComponent(id);}
export function mathElementId(subpath){
  if(!subpath?.startsWith('#element='))return null;
  let id;try{id=decodeURIComponent(subpath.slice(9));}catch{throw Error('math_reference_invalid');}
  if(!validId(id))throw Error('math_reference_invalid');return id;
}
export function drawingMathElement(doc,id){const e=doc.elements?.find(e=>e.id===id&&!e.isDeleted&&isMathElement(e));if(!e)throw Error('math_reference_missing');return e;}
export function updateDrawingMath(doc,id,data,expectedSource){
  const previous=drawingMathElement(doc,id);if(previous.customData.notaraMath.source!==expectedSource)throw Error('math_reference_changed');validateMathData(data);
  if(JSON.stringify(previous.customData.notaraMath)===JSON.stringify(data))return doc;
  return {...doc,elements:doc.elements.map(e=>e.id===id?{...e,customData:{...e.customData,notaraMath:data},version:(e.version??1)+1,versionNonce:Math.floor(Math.random()*2147483647),updated:Date.now()}:e)};
}
