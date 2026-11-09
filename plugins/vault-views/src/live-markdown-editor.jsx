import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { basicSetup } from 'codemirror';
import { EditorState, StateField, StateEffect, Compartment, Transaction, Prec, Text, Annotation } from '@codemirror/state';
import { EditorView, Decoration, WidgetType, keymap } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { undo, undoDepth } from '@codemirror/commands';
import { livePreviewBlocks, minimalSourceChange, selectionTouchesBlock, formulaSourceRange, formulaSourceEdit, rangeSelected } from './live-preview-model.js';
import {sourceLinkDecorations} from './source-link-decorations.js';

const focusPreview = StateEffect.define(), composing = StateEffect.define();
const formulaInput = Annotation.define();
const isHtmlBreak = block => block.type==='html'&&/^(?:\s*<br\s*\/?\s*>\s*)+$/i.test(block.text);
const theme = EditorView.theme({
  '&': { color:'var(--dsw-alias-label-primary)',backgroundColor:'transparent',minHeight:'400px' },
  '&.cm-focused': { outline:'none' },
  '.cm-scroller': { fontFamily:'var(--claude-font-mono)',fontSize:'14px',lineHeight:'1.8',overflow:'visible' },
  '.cm-content': { padding:'8px 0 60px',caretColor:'var(--claude-clay)' },
  '.cm-line': { padding:'0 4px' },
  '.cm-gutters': { backgroundColor:'transparent',color:'var(--dsw-alias-label-tertiary)',border:'none' },
  '.cm-activeLineGutter,.cm-activeLine': { backgroundColor:'transparent' },
  '.cm-cursor': { borderLeftColor:'var(--claude-clay)' },
  '&.cm-focused .cm-selectionBackground,.cm-selectionBackground,::selection': { backgroundColor:'var(--claude-clay-soft)' },
  '.cm-panels,.cm-tooltip': { backgroundColor:'var(--dsw-alias-bg-layer-1)',color:'var(--dsw-alias-label-primary)' },
});

export function LiveMarkdownEditor({value,onChange,onSave,onActions,onSelection,sourceRevision,sourceLinks=[],onOpenSource,focusRequest,focusRange,renderContent,preview}) {
  const host=useRef(null), editor=useRef(null), callbacks=useRef(null), syncing=useRef(false), alive=useRef(false);
  const selectionRevision=useRef(sourceRevision);
  const sourceSlot=useRef(new Compartment());
  const previewSlot=useRef(new Compartment()), attributes=useRef(new Compartment()), separator=useRef(new Compartment());
  const extension=useRef(null), [portals,setPortals]=useState(new Map());
  const formulaTarget=useRef(null), [formula,setFormula]=useState(null), formulaPanel=useRef(null);
  const [notice,setNotice]=useState('');
  const closeFormula=()=>{formulaTarget.current=null;setFormula(null);};
  callbacks.current={onChange,onSave,onActions,onSelection,renderContent,onOpenSource};
  useEffect(()=>{
    alive.current=true; const owner=Symbol('live-markdown'); let lastUndo;
    const pendingImages=new Map();
    const portal=(id,item)=>queueMicrotask(()=>{if(alive.current)setPortals(previous=>{const next=new Map(previous);if(item)next.set(id,item);else next.delete(id);return next;});});
    const openFormula=(view,from,to,display,dom)=>{
      const target=formulaSourceRange(view.state.doc.toString(),from,to,display);if(!target){view.dispatch({selection:{anchor:from,head:to},effects:focusPreview.of(true)});view.focus();return;}
      const rect=dom.getBoundingClientRect(),width=Math.min(420,window.innerWidth-24);
      const positioned={...target,left:Math.max(12,Math.min(rect.left,window.innerWidth-width-12)),top:Math.max(12,Math.min(rect.bottom+8,window.innerHeight-310)),width};
      formulaTarget.current=positioned;setFormula(positioned);
    };
    class InlineWidget extends WidgetType {
      constructor(span,definitions=''){super();this.span=span;this.definitions=definitions;}
      get lineBreaks(){return this.span.type==='htmlBreak'?1:0;}
      eq(other){return this.span.from===other.span.from&&this.span.text===other.span.text&&this.span.type===other.span.type&&this.span.label===other.span.label&&this.definitions===other.definitions;}
      updateDOM(dom,view,previous){if(this.span.type!==previous.span.type||this.definitions!==previous.definitions)return false;if(this.span.type==='task'){const input=dom.querySelector('input');input.checked=Boolean(this.span.value);input.setAttribute('aria-label',`完成任务：${this.span.label}`);}else if(this.span.text!==previous.span.text)return false;dom.dataset.sourceFrom=String(this.span.from);dom.dataset.sourceTo=String(this.span.to);return true;}
      toDOM(view){
        const dom=document.createElement('span'),math=['inlineMath','math'].includes(this.span.type),display=this.span.type==='math'||Boolean(this.span.display);dom.className=math?'nv-live-inline-math':'nv-live-inline-reference';if(display)dom.classList.add('nv-live-display-math');dom.contentEditable='false';dom.dataset.sourceFrom=String(this.span.from);dom.dataset.sourceTo=String(this.span.to);
        if(this.span.type==='htmlBreak'){dom.className='nv-live-line-break';dom.append(document.createElement('br'));return dom;}
        if(['bullet','entity'].includes(this.span.type)){dom.className='nv-live-inline-literal';dom.textContent=this.span.value;return dom;}
        if(this.span.type==='task'){
          dom.className='nv-live-task';const input=document.createElement('input');input.type='checkbox';input.checked=Boolean(this.span.value);input.setAttribute('aria-label',`完成任务：${this.span.label}`);input.addEventListener('mousedown',event=>event.stopPropagation());input.addEventListener('change',()=>{const from=Number(dom.dataset.sourceFrom);view.dispatch({changes:{from:from+1,to:from+2,insert:input.checked?'x':' '},annotations:Transaction.userEvent.of('input')});});dom.append(input);return dom;
        }
        if(math){dom.setAttribute('role','button');dom.tabIndex=0;dom.setAttribute('aria-label','编辑公式');dom.title='点击编辑这个公式';
          const open=event=>{event.preventDefault();event.stopPropagation();openFormula(view,Number(dom.dataset.sourceFrom),Number(dom.dataset.sourceTo),display,dom);};
          dom.addEventListener('mousedown',event=>{if(event.button===0)open(event);});dom.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' ')open(event);});
        }
        const id=crypto.randomUUID();dom.dataset.portalId=id;
        const observer=new ResizeObserver(()=>{if(alive.current)view.requestMeasure();});observer.observe(dom);dom._nvObserver=observer;
        const mathSource=this.span.type==='math'?{value:this.span.value,display:true}:math&&formulaSourceRange(view.state.doc.toString(),this.span.from,this.span.to,display);
        portal(id,{dom,text:mathSource?(mathSource.display?`$$\n${mathSource.value}\n$$`:`$${mathSource.value}$`):this.span.text+(this.definitions?'\n\n'+this.definitions:''),scope:id,inline:true});return dom;
      }
      ignoreEvent(){return true;}
      destroy(dom){dom._nvObserver?.disconnect();if(dom.dataset.portalId)portal(dom.dataset.portalId,null);}
    }
    class PreviewWidget extends WidgetType {
      constructor(block,definitions){super();this.block=block;this.definitions=definitions;}
      eq(other){return this.block.from===other.block.from&&this.sameContent(other);}
      sameContent(other){return this.block.text===other.block.text&&this.block.type===other.block.type&&this.definitions===other.definitions;}
      updateDOM(dom,view,previous){if(!this.sameContent(previous))return false;dom.dataset.sourceFrom=String(this.block.from);return true;}
      get estimatedHeight(){return this.block.type==='heading'?42:Math.min(360,Math.max(28,this.block.text.split('\n').length*26));}
      toDOM(view){
        const dom=document.createElement('div'), content=document.createElement('div');
        dom.className='nv-live-preview-block';dom.dataset.kind=this.block.type;dom.dataset.sourceFrom=String(this.block.from);dom.contentEditable='false';
        content.className='nv-live-preview-content';dom.append(content);
        const id=crypto.randomUUID();dom.dataset.portalId=id;
        const activate=event=>{
          if(event.button>0||event.shiftKey)return;
          if(this.block.type==='html'&&/^(?:\s*<br\s*\/?>\s*)+$/i.test(this.block.text))return;
          const explicit=event.target.closest('.nv-live-edit-block');
          const control=event.target.closest('button,a,input,textarea,select,summary,[role="button"],[contenteditable="true"]');
          if(!explicit&&control&&dom.contains(control))return;
          const from=Number(dom.dataset.sourceFrom), text=this.block.text;
          if(this.block.type==='math') {event.preventDefault();event.stopPropagation();openFormula(view,from,from+text.trimEnd().length,true,dom);return;}
          let offset=0;
          // Map the clicked text node back to its literal source when possible.
          // Formula/component chrome deliberately falls back to the block start.
          const caret=document.caretPositionFromPoint?.(event.clientX,event.clientY), range=!caret&&document.caretRangeFromPoint?.(event.clientX,event.clientY);
          const node=caret?.offsetNode||range?.startContainer, local=caret?.offset??range?.startOffset;
          if(!explicit&&node?.nodeType===3&&content.contains(node)&&!node.parentElement?.closest('.katex,svg')){
            const needle=node.textContent, index=text.indexOf(needle);
            if(index>=0)offset=index+Math.min(local,needle.length);
          }
          event.preventDefault();event.stopPropagation();
          const anchor=Math.min(view.state.doc.length,from+offset);
          view.dispatch({selection:{anchor},effects:focusPreview.of(true)});view.focus();
        };
        dom.addEventListener('mousedown',activate);
        if((['math','code','html','fold'].includes(this.block.type)&&!/^(?:\s*<br\s*\/?>\s*)+$/i.test(this.block.text))||this.block.text.includes('![[')){
          const edit=document.createElement('button');edit.type='button';edit.className='nv-live-edit-block';edit.textContent='编辑';edit.setAttribute('aria-label','编辑这一段');edit.title='编辑这一段 Markdown';
          edit.addEventListener('click',event=>{event.preventDefault();if(event.detail===0){const from=Number(dom.dataset.sourceFrom);if(this.block.type==='math')openFormula(view,from,from+this.block.text.trimEnd().length,true,dom);else{view.dispatch({selection:{anchor:from},effects:focusPreview.of(true)});view.focus();}}});dom.append(edit);
        }
        const observer=new ResizeObserver(()=>{if(alive.current)view.requestMeasure();});observer.observe(dom);dom._nvObserver=observer;
        portal(id,{dom:content,text:this.block.text+(this.definitions?'\n\n'+this.definitions:''),scope:id,lineBreak:this.block.type==='html'&&/^(?:\s*<br\s*\/?>\s*)+$/i.test(this.block.text)});
        return dom;
      }
      ignoreEvent(){return true;}
      destroy(dom){dom._nvObserver?.disconnect();portal(dom.dataset.portalId,null);}
    }
    const decorate=(state,model,focused)=>{
      const ranges=[],atomic=[];
      const active=model.blocks.map(block=>block.inline||block.type==='math'&&!formulaSourceRange(state.doc.toString(),block.from,block.from+block.text.trimEnd().length,true)||focused&&(block.type==='math'||isHtmlBreak(block)?rangeSelected(block,state.selection.ranges):selectionTouchesBlock(block,state.selection.ranges)));
      // Properties have a separate editor. Source mode still exposes exact YAML.
      if(model.bodyStart&&!(focused&&selectionTouchesBlock({from:0,to:model.bodyStart},state.selection.ranges)))ranges.push(Decoration.replace({block:true,inclusiveEnd:!active[0]}).range(0,model.bodyStart));
      for(const [index,block] of model.blocks.entries()){
        if(block.to<=block.from)continue;
        if(block.inline){
          for(let pos=state.doc.lineAt(block.from).from;pos<block.to;){const line=state.doc.lineAt(pos),heading=block.type==='heading'&&pos===block.from;ranges.push(Decoration.line({class:'nv-live-text'+(!line.text.trim()?' nv-live-gap':'')+(heading?` nv-live-heading-${block.depth}`:''),...(heading?{attributes:{role:'heading','aria-level':String(block.depth)}}:{})}).range(line.from));if(line.to===state.doc.length)break;pos=line.to+1;}
          for(const span of block.spans){
            const selected=focused&&rangeSelected(span,state.selection.ranges);
            if(block.spans.some(other=>other!==span&&['inlineMath','math','reference','link','linkReference','inlineCode'].includes(other.type)&&other.from<=span.from&&other.to>=span.to&&!rangeSelected(other,state.selection.ranges)))continue;
            if(span.type==='escape'||span.type==='syntax'||span.type==='taskAnchor'){
              if(!selected)ranges.push(Decoration.replace({}).range(span.from,span.to));
              continue;
            }
            if(['inlineMath','math','reference','link','linkReference','task','bullet','entity','htmlBreak'].includes(span.type)){
              if(selected)continue;
              const replacement=Decoration.replace({widget:new InlineWidget(span,span.type==='linkReference'?model.definitions:'')}).range(span.from,span.to);ranges.push(replacement);atomic.push(replacement);
            }else if(['strong','emphasis','delete','inlineCode'].includes(span.type)){
              if(span.type==='inlineCode'){
                const marker=/^`+/.exec(span.text)?.[0].length||1;
                ranges.push(Decoration.mark({class:'nv-live-code'}).range(span.from+marker,span.to-marker));
                if(!selected){ranges.push(Decoration.replace({}).range(span.from,span.from+marker),Decoration.replace({}).range(span.to-marker,span.to));}
              }else{
                ranges.push(Decoration.mark({class:`nv-live-${span.type}`}).range(span.contentFrom,span.contentTo));
                if(!selected){if(span.contentFrom>span.from)ranges.push(Decoration.replace({}).range(span.from,span.contentFrom));if(span.to>span.contentTo)ranges.push(Decoration.replace({}).range(span.contentTo,span.to));}
              }
            }
          }
        }else if(active[index]){
          for(let pos=state.doc.lineAt(block.from).from;pos<=block.to;){const line=state.doc.lineAt(pos);ranges.push(Decoration.line({class:'nv-live-source'+(block.type==='heading'?` nv-live-heading-${block.depth}`:'')}).range(line.from));if(line.to===state.doc.length)break;pos=line.to+1;}
        } else {const replacement=Decoration.replace({widget:new PreviewWidget(block,model.definitions),block:true,inclusiveStart:!active[index-1],inclusiveEnd:!active[index+1]}).range(block.from,block.to);ranges.push(replacement);if(block.type==='math'||isHtmlBreak(block))atomic.push(replacement);}
      }
      return {decorations:Decoration.set(ranges,true),atomic:Decoration.set(atomic,true)};
    };
    const field=StateField.define({
      create(state){const model=livePreviewBlocks(state.doc.toString());return {model,focused:false,composing:false,...decorate(state,model,false)};},
      update(previous,tr){
        let focused=previous.focused,ime=previous.composing;
        for(const effect of tr.effects){if(effect.is(focusPreview))focused=effect.value;if(effect.is(composing))ime=effect.value;}
        if(!tr.docChanged&&!tr.selection&&!tr.effects.some(effect=>effect.is(focusPreview)||effect.is(composing)))return previous;
        const model=tr.docChanged||previous.composing&&!ime?livePreviewBlocks(tr.state.doc.toString()):previous.model;
        return {model,focused,composing:ime,...(ime?{decorations:previous.decorations.map(tr.changes),atomic:previous.atomic.map(tr.changes)}:decorate(tr.state,model,focused))};
      },
      provide:field=>EditorView.decorations.from(field,value=>value.decorations),
    });
    extension.current=[field,syntaxHighlighting(HighlightStyle.define([{tag:tags.heading,fontWeight:'600',textDecoration:'none'},{tag:tags.strong,fontWeight:'600'},{tag:tags.emphasis,fontStyle:'italic'},{tag:[tags.meta,tags.escape,tags.processingInstruction],color:'inherit'}])),EditorView.atomicRanges.of(view=>view.state.field(field).atomic),EditorView.focusChangeEffect.of((state,focused)=>focusPreview.of(focused)),EditorView.domEventHandlers({
      compositionstart:(_,view)=>{view.dispatch({effects:composing.of(true)});},
      compositionend:(_,view)=>{queueMicrotask(()=>{if(alive.current)view.dispatch({effects:composing.of(false)});});},
    })];
    const publish=view=>{const canUndo=undoDepth(view.state)>0;if(canUndo===lastUndo)return;lastUndo=canUndo;callbacks.current.onActions?.(owner,{canUndo,undo:()=>{if(!alive.current)return false;view.focus();return undo(view);}});};
    const previousStyles=new Set(document.querySelectorAll('style'));
    const view=new EditorView({parent:host.current,state:EditorState.create({doc:value,selection:{anchor:livePreviewBlocks(value.replace(/\r\n/g,'\n')).bodyStart},extensions:[basicSetup,markdown(),theme,EditorView.lineWrapping,
      EditorView.domEventHandlers({paste:(event,view)=>{
        const files=Array.from(event.clipboardData?.files||[]);if(!files.length)return false;
        const images=files.filter(file=>/^image\/(png|jpeg|webp|gif)$/.test(file.type)&&file.size<=2*1024*1024);
        event.preventDefault();setNotice(images.length===files.length?'':'请粘贴 2 MB 以内的 PNG、JPEG、WebP 或 GIF 图片。');
        for(const file of images){
          const id=Symbol('image-paste'),reader=new FileReader();pendingImages.set(id,view.state.selection.main.to);
          reader.onload=()=>{const pos=pendingImages.get(id);pendingImages.delete(id);if(!alive.current||pos==null)return;const alt=file.name.replace(/[\[\]\r\n]/g,'');const text=`\n\n![${alt}](${reader.result})\n\n`;view.dispatch({changes:{from:pos,insert:Text.of(text.split('\n'))},annotations:Transaction.userEvent.of('input.paste')});};
          reader.onerror=()=>{pendingImages.delete(id);if(alive.current)setNotice('图片未能读取，请重试。');};reader.readAsDataURL(file);
        }return true;
      }}),
      separator.current.of(EditorState.lineSeparator.of(value.includes('\r\n')?'\r\n':'\n')),
      attributes.current.of(EditorView.contentAttributes.of({'aria-label':preview?'Markdown 实时预览编辑器':'Markdown 正文编辑器'})),
      previewSlot.current.of(preview?extension.current:[]),
      sourceSlot.current.of([]),
      Prec.highest(keymap.of([{key:'Mod-s',run:()=>{callbacks.current.onSave?.();return true;}}])),
      EditorView.updateListener.of(update=>{
        publish(update.view);
        if(!syncing.current&&(update.selectionSet||update.docChanged)){const {from,to}=update.state.selection.main;callbacks.current.onSelection?.(from===to?null:{range:[from,to]});}
        if(update.docChanged)for(const [id,pos] of pendingImages)pendingImages.set(id,update.changes.mapPos(pos,1));
        const target=formulaTarget.current;
        if(target&&update.docChanged){
          let overlaps=false;update.changes.iterChangedRanges((from,to)=>{if(from<target.to&&to>target.from)overlaps=true;});
          if(overlaps&&!update.transactions.some(tr=>tr.annotation(formulaInput))){formulaTarget.current=null;queueMicrotask(()=>{if(alive.current)setFormula(null);});}
          else{
            const fresh=formulaSourceRange(update.state.doc.toString(),update.changes.mapPos(target.from,-1),update.changes.mapPos(target.to,1),target.display);
            const mapped=fresh?{...target,...fresh}:null;
            formulaTarget.current=mapped;queueMicrotask(()=>{if(alive.current&&formulaTarget.current===mapped)setFormula(mapped);});
          }
        }
        if(update.docChanged&&!syncing.current)callbacks.current.onChange?.(update.state.sliceDoc());
      }),
    ]})});
    for(const style of document.querySelectorAll('style'))if(!previousStyles.has(style)&&!style.dataset.plugin)style.dataset.plugin='@oh-my-student/plugin-vault-views';
    editor.current=view;publish(view);
    return ()=>{alive.current=false;callbacks.current.onActions?.(owner,null);editor.current=null;view.destroy();};
  },[]);
  useEffect(()=>{
    const view=editor.current;if(!view)return;
    closeFormula();
    const bodyStart=livePreviewBlocks(view.state.doc.toString()).bodyStart;
    view.dispatch({effects:[previewSlot.current.reconfigure(preview?extension.current:[]),attributes.current.reconfigure(EditorView.contentAttributes.of({'aria-label':preview?'Markdown 实时预览编辑器':'Markdown 正文编辑器'}))],...(preview&&view.state.selection.main.head<bodyStart?{selection:{anchor:bodyStart}}:{})});
    if(preview)view.dispatch({effects:focusPreview.of(view.hasFocus)});
  },[preview]);
  useEffect(()=>{
    const view=editor.current;if(!view||view.state.sliceDoc()===value)return;
    const change=minimalSourceChange(view.state.doc.toString(),value.replace(/\r\n/g,'\n'));
    syncing.current=true;
    try{view.dispatch({...(change?{changes:{...change,insert:Text.of(change.insert.split('\n'))}}:{}),effects:separator.current.reconfigure(EditorState.lineSeparator.of(value.includes('\r\n')?'\r\n':'\n')),annotations:Transaction.addToHistory.of(false)});}finally{syncing.current=false;}
  },[value]);
  useEffect(()=>{
    const view=editor.current;if(!view)return;
    view.dispatch({effects:sourceSlot.current.reconfigure(sourceLinkDecorations(sourceLinks,locator=>callbacks.current.onOpenSource?.(locator),preview))});
  },[JSON.stringify(sourceLinks),preview]);
  useEffect(()=>{
    if(selectionRevision.current===sourceRevision)return;
    selectionRevision.current=sourceRevision;
    const view=editor.current;if(!view)return;
    syncing.current=true;
    try{view.dispatch({selection:{anchor:view.state.selection.main.head}});}finally{syncing.current=false;}
    callbacks.current.onSelection?.(null);
  },[sourceRevision]);
  useEffect(()=>{
    const view=editor.current;if(!view||!focusRange)return;
    const [from,to]=focusRange;if(from<0||to>view.state.doc.length||from>=to)return;
    view.dispatch({selection:{anchor:from,head:to},effects:EditorView.scrollIntoView(from,{y:'center'})});view.focus();
  },[JSON.stringify(focusRange),focusRequest]);
  useEffect(()=>{
    if(!formula)return;
    const outside=event=>{if(!formulaPanel.current?.contains(event.target))closeFormula();};
    const scroll=event=>{if(!formulaPanel.current?.contains(event.target))closeFormula();};
    document.addEventListener('pointerdown',outside,true);window.addEventListener('scroll',scroll,true);window.addEventListener('resize',closeFormula);
    return()=>{document.removeEventListener('pointerdown',outside,true);window.removeEventListener('scroll',scroll,true);window.removeEventListener('resize',closeFormula);};
  },[Boolean(formula)]);
  const editFormula=value=>{
    const target=formulaTarget.current,view=editor.current;if(!target||!view)return;
    if(view.state.doc.sliceString(target.from,target.to)!==target.raw){closeFormula();return;}
    const edit=formulaSourceEdit(target,value);
    view.dispatch({changes:{...edit,insert:Text.of(edit.insert.split('\n'))},annotations:formulaInput.of(true)});
  };
  return <div className={`nv-live-markdown${preview?' nv-live-markdown-preview':''}`}>{notice&&<p role="status">{notice}</p>}<div ref={host}/>{[...portals].map(([id,item])=>createPortal(item.lineBreak?<br/>:callbacks.current.renderContent(item.text,`live:${item.scope}`),item.dom,id))}
    {formula&&createPortal(<div ref={formulaPanel} role="dialog" aria-label="编辑公式" className="nv-live-formula-popover" style={{left:formula.left,top:formula.top,width:formula.width}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();closeFormula();editor.current?.focus();}else if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='s'){event.preventDefault();callbacks.current.onSave?.();}}}>
      <header><span>公式</span><button type="button" aria-label="完成公式编辑" onClick={()=>{closeFormula();editor.current?.focus();}}>完成</button></header>
      <textarea autoFocus aria-label="公式源码" value={formula.value} onChange={event=>editFormula(event.target.value)} spellCheck={false}/>
      <div className="nv-live-formula-result" aria-label="公式预览">{callbacks.current.renderContent(formula.display?`$$\n${formula.value}\n$$`:`$${formula.value}$`,'formula-preview')}</div>
    </div>,document.body)}
  </div>;
}
