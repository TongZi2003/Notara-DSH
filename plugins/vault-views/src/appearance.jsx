import React,{useSyncExternalStore} from 'react';
import {APPEARANCES} from './appearance-tokens.js';

export function AppearanceSettings({store}) {
  const state=useSyncExternalStore(store.subscribe,store.getSnapshot,store.getSnapshot);
  const move=event=>{const directions={ArrowRight:1,ArrowDown:1,ArrowLeft:-1,ArrowUp:-1};if(!(event.key in directions)&&event.key!=='Home'&&event.key!=='End')return;event.preventDefault();const current=APPEARANCES.findIndex(item=>item.id===state.style),index=event.key==='Home'?0:event.key==='End'?APPEARANCES.length-1:(current+directions[event.key]+APPEARANCES.length)%APPEARANCES.length;store.select(APPEARANCES[index].id);event.currentTarget.querySelectorAll('[role="radio"]')[index]?.focus();};
  return <section className="nv-appearance-settings" aria-label="界面风格">
    <div className="nv-appearance-heading"><strong>界面风格</strong><span>浅色与深色沿用外观设置</span></div>
    <div className="nv-appearance-options" role="radiogroup" aria-label="界面风格" onKeyDown={move}>{APPEARANCES.map(item=><button key={item.id} type="button" role="radio" tabIndex={state.style===item.id?0:-1} aria-label={`${item.name} 风格`} aria-checked={state.style===item.id} onClick={()=>store.select(item.id)}>
      <span className="nv-appearance-sample" data-appearance={item.id} aria-hidden="true"><i/><i/><i/></span><span><strong>{item.name}</strong><small>{item.description}</small></span><span className="nv-appearance-check" aria-hidden="true">{state.style===item.id?'✓':''}</span>
    </button>)}</div>
    {state.storageError&&<p role="status">风格已应用，但当前浏览器无法保存偏好。</p>}
  </section>;
}
