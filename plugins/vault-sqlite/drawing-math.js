/** Portable metadata; the mathematical parser lives in graph-and-blocks. */
export const isMathElement = element => Boolean(element?.customData?.notaraMath);
export function validateMathData(data) {
  if (!data || data.version !== 1 || typeof data.source !== 'string' || !data.source.trim() || data.source.length > 12000) throw Error('drawing_math_invalid');
  for (const [field, limit] of [['values',6],['drags',40]]) {
    const entries = Object.entries(data[field] ?? {});
    if (entries.length > limit) throw Error('drawing_math_state_invalid');
    for (const [name,value] of entries) {
      if (!/^[\p{L}][\p{L}\d_]*'?$/u.test(name)) throw Error('drawing_math_name_invalid');
      const numbers = field === 'drags' ? [value?.x,value?.y] : [value];
      if(field==='drags'&&value?.position!==undefined)numbers.push(value.position);
      if (!numbers.every(n => Number.isFinite(n) && Math.abs(n) <= 1e7)) throw Error('drawing_math_state_invalid');
    }
  }
  if (data.camera && (!['yaw','pitch','zoom'].every(k=>Number.isFinite(data.camera[k])) || data.camera.zoom < .35 || data.camera.zoom > 3 || Math.abs(data.camera.pitch)>1.35)) throw Error('drawing_math_camera_invalid');
  return data;
}
export function mathSourceElement(element) {
  if (!isMathElement(element)||element.type!=='image') return element;
  const {fileId,status,scale,crop,...source}=element;
  const customData={...source.customData};
  if(crop||scale?.some(v=>v!==1))customData.notaraMathView={scale:scale??[1,1],crop:crop??null};else delete customData.notaraMathView;
  return {...source,customData,type:'embeddable',link:null};
}
export const isMathRenderFile = id => id.startsWith('notara-math-render-');
