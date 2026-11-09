import {APPEARANCE_TOKENS,appearanceCss,normalizeAppearance} from './appearance-tokens.js';

export const APPEARANCE_KEY='notara.appearance.v1';
export function installAppearance({theme,win=window,doc=document}) {
  let initial='claude';try{initial=normalizeAppearance(win.localStorage?.getItem(APPEARANCE_KEY));}catch{}
  let snapshot={style:initial,storageError:false},disposed=false,releaseTokens;
  const listeners=new Set(), previous=doc.body?.getAttribute('data-notara-theme');
  const style=doc.body?doc.createElement('style'):null;
  if(style){style.dataset.plugin='@oh-my-student/plugin-vault-views';style.dataset.notaraAppearance='';doc.head.append(style);}
  const apply=value=>{
    if(disposed)return;
    releaseTokens=theme?.overrideTokens('notara.appearance',APPEARANCE_TOKENS[value]);
    if(style){style.textContent=appearanceCss(value);doc.body.setAttribute('data-notara-theme',value);}
  };
  const select=(value,persist=true)=>{
    if(disposed)return;value=normalizeAppearance(value);let storageError=false;
    if(persist)try{win.localStorage.setItem(APPEARANCE_KEY,value);}catch{storageError=true;}
    if(snapshot.style!==value)apply(value);
    snapshot={style:value,storageError};listeners.forEach(listener=>listener());
  };
  const storage=event=>{if(event.key===APPEARANCE_KEY)select(event.newValue,false);};
  win.addEventListener('storage',storage);apply(initial);
  return {getSnapshot:()=>snapshot,subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},select,
    dispose(){if(disposed)return;disposed=true;win.removeEventListener('storage',storage);releaseTokens?.();style?.remove();if(doc.body?.getAttribute('data-notara-theme')===snapshot.style){if(previous==null)doc.body.removeAttribute('data-notara-theme');else doc.body.setAttribute('data-notara-theme',previous);}listeners.clear();}
  };
}
