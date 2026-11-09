import React,{useEffect,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Modal} from '@deepseek-ai/dsh-client-ui-primitives';
import {FigureCanvas,SpaceFigureCanvas} from '@oh-my-student/plugin-graph-and-blocks/geometry-engine';
import {mathDefinition,MATH_EXAMPLES} from '@oh-my-student/plugin-graph-and-blocks/drawing-math';
import {isMathElement} from '@oh-my-student/plugin-vault-sqlite/drawing-math';

const mathStyle=`.nv-math-surface{background:#fff;color:#25262a;--dsw-alias-brand-primary:#426ad2;--dsw-alias-label-primary:#25262a;--dsw-alias-label-secondary:#707782;--dsw-alias-bg-layer-2:#edf2ff;--claude-clay:#426ad2}.nv-math-surface .nv-block-figure-board{width:100%;height:100%;position:relative;overflow:hidden;touch-action:none}.nv-math-surface .nv-block-figure,.nv-math-surface .nv-block-space-figure{width:100%;height:100%}.nv-math-surface svg{display:block;width:100%;height:100%;max-height:none;stroke:#426ad2;stroke-width:1.5}.nv-math-surface text{fill:#25262a;stroke:none;font-family:sans-serif;font-size:14px}.nv-math-surface .nv-block-space-face{fill:#edf2ff;fill-opacity:.6}.nv-math-surface .nv-block-space-edge,.nv-math-surface .nv-block-space-vector,.nv-math-surface .nv-block-space-surface{fill:none;stroke:#426ad2}.nv-math-surface .nv-block-space-point{fill:#426ad2}.nv-math-surface .nv-block-space-grid{opacity:.15}.nv-math-surface .nv-block-space-axis{opacity:.5}.nv-math-surface .nv-block-space-dashed{stroke-dasharray:5 4}.nv-math-surface .nv-block-space-controls{display:none}`;
export function MathSurface({data,onChange,onReady}){
  const {spec}=useMemo(()=>mathDefinition(data.source,data),[data.source]);
  const changeDrag=(name,point)=>onChange?.(previous=>({...previous,drags:{...previous.drags,[name]:point}}));
  const initializeDrag=(name,point)=>onChange?.(previous=>({...previous,drags:{...previous.drags,[name]:point}}),{initial:true});
  return <div className="nv-math-surface" style={{width:'100%',height:'100%'}}><style>{mathStyle}</style>{spec.space
    ?<SpaceFigureCanvas key={data.source} spec={spec} values={data.values} camera={data.camera} onCamera={(camera,meta)=>onChange?.(previous=>({...previous,camera}),meta)} navigationActive={Boolean(onChange)} onReady={onReady}/>
    :<FigureCanvas spec={spec} specKey={data.source} values={data.values} dragPositions={data.drags} onDrags={changeDrag} onDragState={initializeDrag} onReady={onReady}/>}</div>;
}

const cache=new Map();let queue=Promise.resolve();
/** A derived native image lets ink stay above the math plot. Definitions, not
 * pixels, are persisted. Offscreen renderers are bounded and always disposed. */
export function mathRender(data){
  const key=JSON.stringify(mathDefinition(data.source,data).data);
  if(cache.has(key))return cache.get(key);
  const result=queue.then(()=>new Promise((resolve,reject)=>{
    const host=document.createElement('div');host.style.cssText='position:fixed;left:-10000px;top:0;width:760px;height:520px;pointer-events:none';document.body.append(host);
    const root=createRoot(host);let finished=false;
    const finish=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);queueMicrotask(()=>{root.unmount();host.remove();});error?reject(error):resolve(value);};
    const timer=setTimeout(()=>finish(Error('数学图渲染超时')),10000);
    const ready=error=>{if(error)return finish(error);queueMicrotask(async()=>{try{
      const source=host.querySelector('svg');if(!source)throw Error('数学图尚未就绪');
      const svg=source.cloneNode(true),original=[source,...source.querySelectorAll('*')],copies=[svg,...svg.querySelectorAll('*')];
      original.forEach((node,i)=>{const style=getComputedStyle(node);for(const p of ['fill','stroke','stroke-width','stroke-dasharray','fill-opacity','stroke-opacity','opacity','font-size','font-family','font-weight','text-anchor'])copies[i].style.setProperty(p,style.getPropertyValue(p));});
      svg.setAttribute('xmlns','http://www.w3.org/2000/svg');svg.setAttribute('width','760');svg.setAttribute('height','520');
      const xml=new XMLSerializer().serializeToString(svg),bytes=new TextEncoder().encode(xml);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
      const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));const id='notara-math-render-'+[...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('');
      finish(null,{id,mimeType:'image/svg+xml',dataURL:'data:image/svg+xml;base64,'+btoa(binary),created:0,lastRetrieved:0});
    }catch(e){finish(e);}});};
    root.render(<MathSurface data={data} onReady={ready}/>);
  }));
  queue=result.catch(()=>{});cache.set(key,result);if(cache.size>32)cache.delete(cache.keys().next().value);result.catch(()=>cache.delete(key));return result;
}
export async function prepareMathScene(doc){
  if(doc.elements.filter(e=>!e.isDeleted&&isMathElement(e)).length>20)throw Error('数学图过多，请拆分白板');
  const files={...doc.files},elements=[];
  for(const element of doc.elements){
    if(!isMathElement(element)||element.isDeleted){elements.push(element);continue;}
    const file=await mathRender(element.customData.notaraMath);files[file.id]=file;
    elements.push({...element,type:'image',fileId:file.id,status:'saved',scale:element.customData.notaraMathView?.scale??[1,1],crop:element.customData.notaraMathView?.crop??null,link:null});
  }
  return {...doc,elements,files};
}

export function MathDrawingDialog({initial,onApply,onClose}){
  const [source,setSource]=useState(initial?.source??MATH_EXAMPLES['函数']),[data,setData]=useState(()=>mathDefinition(initial?.source??MATH_EXAMPLES['函数'],initial).data),[showSource,setShowSource]=useState(false),[error,setError]=useState(''),[applyError,setApplyError]=useState(''),[saving,setSaving]=useState(false);
  const alive=useRef(true);useEffect(()=>()=>{alive.current=false;},[]);
  const definition=useMemo(()=>mathDefinition(data.source,data),[data]);
  const changeSource=(text,reset=false)=>{setSource(text);try{
    const next=mathDefinition(text),values=Object.fromEntries(next.spec.params.map(p=>[p.name,Number.isFinite(data.values[p.name])&&data.values[p.name]>=p.min&&data.values[p.name]<=p.max?data.values[p.name]:p.value]));
    setData(reset?next.data:mathDefinition(text,{...data,values}).data);setError('');
  }catch(e){setError(e.message);}};
  return <Modal open onClose={()=>{if(!saving)onClose();}} title={initial?'编辑数学图':'插入数学图'} closeLabel="关闭数学图" className="nv-math-dialog">
    <div className="nv-math-options">{Object.keys(MATH_EXAMPLES).map(name=><button key={name} disabled={saving} onClick={()=>changeSource(MATH_EXAMPLES[name],true)}>{name}</button>)}<button onClick={()=>setShowSource(!showSource)} aria-expanded={showSource}>修改定义</button></div>
    {showSource&&<textarea aria-label="数学图定义" value={source} onChange={e=>changeSource(e.target.value)} spellCheck={false} rows={8}/>}
    {(error||applyError)&&<p role="alert">{error||applyError}</p>}
    <div className="nv-math-live"><MathSurface data={data} onChange={setData}/></div>
    <div className="nv-math-parameters">{definition.spec.params.map(p=><label key={p.name}>{p.name} = {data.values[p.name]}<input type="range" aria-label={`参数 ${p.name}`} min={p.min} max={p.max} step={p.step} value={data.values[p.name]} onChange={e=>setData({...data,values:{...data.values,[p.name]:Number(e.target.value)}})}/></label>)}</div>
    <footer><span>{definition.spec.space?'拖动旋转，滚轮缩放。':'拖动自由点或调整参数。'}应用后可以继续手写批注。</span><button disabled={saving||Boolean(error)} onClick={async()=>{setSaving(true);setApplyError('');try{await onApply(data);if(alive.current)onClose();}catch(e){if(alive.current){setApplyError(e.message);setSaving(false);}}}}>{saving?'正在应用…':'应用到白板'}</button></footer>
  </Modal>;
}
