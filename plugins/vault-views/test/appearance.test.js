import test from 'node:test';
import assert from 'node:assert/strict';
import {installAppearance,APPEARANCE_KEY} from '../src/appearance-store.js';
import {APPEARANCE_TOKENS,appearanceCss} from '../src/appearance-tokens.js';

function fixture(saved) {
  const win=new EventTarget(),values=new Map(saved?[[APPEARANCE_KEY,saved]]:[]),styles=new Set(),attributes=new Map();
  win.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  const doc={body:{getAttribute:key=>attributes.get(key)??null,setAttribute:(key,value)=>attributes.set(key,value),removeAttribute:key=>attributes.delete(key)},head:{append:style=>styles.add(style)},createElement:()=>({dataset:{},remove(){styles.delete(this);}})};
  let layer;const theme={overrideTokens(source,tokens){const current={source,tokens};layer=current;return()=>{if(layer===current)layer=null;};}};
  return {win,doc,styles,values,attributes,theme,layer:()=>layer};
}
test('style switching persists independently from native color scheme and disposes its latest override',()=>{
  const f=fixture(),store=installAppearance(f);assert.equal(store.getSnapshot().style,'claude');assert.equal(f.layer().tokens['--claude-clay'].light,'#b5573a');
  f.doc.body.setAttribute('data-ds-dark-theme','');store.select('obsidian');assert.equal(f.values.get(APPEARANCE_KEY),'obsidian');assert.equal(f.attributes.get('data-ds-dark-theme'),'');assert.equal(f.layer().tokens['--dsw-alias-bg-base'].dark,'#1e1e20');
  store.select('claude');store.select('obsidian');assert.equal(f.styles.size,1);store.dispose();assert.equal(f.layer(),null);assert.equal(f.styles.size,0);assert.equal(f.attributes.has('data-notara-theme'),false);assert.equal(f.values.get(APPEARANCE_KEY),'obsidian');
  const reopened=installAppearance(f);assert.equal(reopened.getSnapshot().style,'obsidian');reopened.dispose();
});
test('storage synchronization and failure preserve a usable selection without clearing preferences',()=>{
  const f=fixture('unknown'),store=installAppearance(f);let changes=0;store.subscribe(()=>changes++);
  f.win.dispatchEvent(Object.assign(new Event('storage'),{key:APPEARANCE_KEY,newValue:'obsidian'}));assert.equal(store.getSnapshot().style,'obsidian');assert.equal(changes,1);
  f.win.localStorage.setItem=()=>{throw Error('blocked');};store.select('claude');assert.equal(store.getSnapshot().storageError,true);assert.equal(f.layer().tokens['--dsw-alias-bg-base'].light,'#faf9f5');
  store.dispose();f.win.dispatchEvent(Object.assign(new Event('storage'),{key:APPEARANCE_KEY,newValue:'obsidian'}));assert.equal(changes,2);
});
test('paper and slate keep distinct dark surfaces and solid readable accents',()=>{
  for(const palette of Object.values(APPEARANCE_TOKENS)){
    assert.equal(new Set(['--dsw-alias-bg-base','--dsw-specific-sidebar-fill','--dsw-alias-bg-layer-1','--dsw-alias-bg-overlay'].map(key=>palette[key].dark)).size,4);
    assert.notEqual(palette['--notara-accent-fill'].dark,palette['--claude-clay'].dark,'button fill is not the pastel link colour');
    assert.ok(palette['--nv-overlay-shadow']?.dark.includes('inset'));
    const strip=palette['--nv-tab-strip-bg'].dark.match(/[a-f\d]{2}/gi).map(v=>parseInt(v,16));
    const content=palette['--dsw-alias-bg-base'].dark.match(/[a-f\d]{2}/gi).map(v=>parseInt(v,16));
    assert.ok(strip.every((channel,i)=>channel<content[i]),'dark tab strip stays behind the content plane');
  }
});
test('both palettes provide paired values and Obsidian text/buttons retain contrast in both schemes',()=>{
  for(const palette of Object.values(APPEARANCE_TOKENS))for(const pair of Object.values(palette)){assert.equal(typeof pair.light,'string');assert.equal(typeof pair.dark,'string');}
  const luminance=hex=>{const channels=hex.match(/[a-f\d]{2}/gi).map(value=>parseInt(value,16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);return .2126*channels[0]+.7152*channels[1]+.0722*channels[2];};
  const contrast=(a,b)=>{const values=[luminance(a),luminance(b)].sort((x,y)=>y-x);return(values[0]+.05)/(values[1]+.05);};
  for(const palette of Object.values(APPEARANCE_TOKENS))for(const scheme of ['light','dark']){
    assert.ok(contrast(palette['--dsw-alias-label-primary'][scheme],palette['--dsw-alias-bg-base'][scheme])>7);
    assert.ok(contrast(palette['--claude-clay'][scheme],palette['--dsw-alias-bg-base'][scheme])>4.5);
    assert.ok(contrast(palette['--notara-on-accent'][scheme],palette['--notara-accent-fill'][scheme])>4.5);
    for(const background of ['--dsw-alias-bg-base','--dsw-specific-sidebar-fill','--dsw-alias-bg-overlay'])assert.ok(contrast(palette['--dsw-alias-label-tertiary'][scheme],palette[background][scheme])>=4.5,background+' '+scheme);
  }
  assert.match(appearanceCss('obsidian'),/data-ds-dark-theme/);assert.equal(appearanceCss('bad'),appearanceCss('claude'));
});
