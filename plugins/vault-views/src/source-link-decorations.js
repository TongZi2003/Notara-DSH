import {StateField} from '@codemirror/state';
import {Decoration,EditorView,WidgetType} from '@codemirror/view';
import {livePreviewBlocks} from './live-preview-model.js';

class SourceLink extends WidgetType {
  constructor(row,open){super();this.row=row;this.open=open;}
  eq(other){return this.row.path===other.row.path&&this.row.title===other.row.title&&this.open===other.open;}
  toDOM(){
    const button=document.createElement('button');button.type='button';button.className='nv-source-text-link';button.textContent='↗';
    button.setAttribute('aria-label',`打开来源卡片：${this.row.title}`);button.title=this.row.title;button.contentEditable='false';
    button.addEventListener('mousedown',event=>event.preventDefault());
    button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();this.open?.({path:this.row.path});});
    return button;
  }
  ignoreEvent(){return true;}
}

export function sourceLinkDecorations(rows,open,preview){
  return StateField.define({
    create(state){
      const ranges=[],model=preview?livePreviewBlocks(state.doc.toString()):null;
      for(const row of rows){
        const [from,to]=row.reference.range;
        if(from<0||from>=to||to>state.doc.length)continue;
        // A collapsed answer/source fold must not gain visible outside markers.
        if(model&&(from<model.bodyStart||model.blocks.some(block=>block.type==='fold'&&from<block.to&&to>block.from)))continue;
        ranges.push(Decoration.mark({class:'nv-source-text-highlight'}).range(from,to));
        const block=model?.blocks.find(block=>!block.inline&&to>block.from&&to<=block.to);
        ranges.push(Decoration.widget({widget:new SourceLink(row,open),side:1}).range(block?.to??to));
      }
      return Decoration.set(ranges,true);
    },
    // Changed text has no confirmed source coordinates until it is saved/read again.
    update(value,transaction){return transaction.docChanged?Decoration.none:value;},
    provide:field=>EditorView.decorations.from(field),
  });
}
