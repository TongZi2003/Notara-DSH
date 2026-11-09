import React,{useRef} from 'react';
import { FigureCanvas, SpaceFigureCanvas } from './geometry-engine.jsx';
export function Figure({ spec, values, onValues, point, onPoint, fingerprint,drags,camera,onExplore }) {
  const initialized=useRef({key:fingerprint,drags:{}});if(initialized.current.key!==fingerprint)initialized.current={key:fingerprint,drags:{}};
  const explore=patch=>onExplore?.({...patch,drags:{...initialized.current.drags,...drags,...patch.drags}});
  return <div className="nv-block-figure">
    {spec.space ? <SpaceFigureCanvas spec={spec} values={values} camera={camera} onCamera={(value,meta)=>{if(!meta?.initial)explore({camera:value});}} navigationActive /> : <FigureCanvas spec={spec} specKey={fingerprint} values={values} dragPositions={drags} answer={{ mode: spec.ask?.kind ?? 'explore', point, onPoint }} onDragState={(name,p)=>{initialized.current.drags[name]=p;}} onDrags={(name, p) => { if (spec.ask?.target === name) onPoint?.({x:p.x,y:p.y});if(onExplore)explore({drags:{[name]:p}}); }} />}
    {spec.params.map(p => <label key={p.name}>{p.name} = {values[p.name]}<input aria-label={`参数 ${p.name}`} type="range" min={p.min} max={p.max} step={p.step} value={values[p.name]} onChange={e => {const next={ ...values, [p.name]: Number(e.target.value) };if(onExplore)explore({values:next});else onValues(next);}} /></label>)}
  </div>;
}
