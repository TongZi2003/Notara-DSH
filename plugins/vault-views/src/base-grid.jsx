import React, {useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import DataGrid, {Row} from 'react-data-grid';
import {listSelectionGesture} from '@oh-my-student/plugin-graph-and-blocks/selection-interaction';
import gridStyles from 'react-data-grid/lib/styles.css';
import {callVault,TYPE_LABELS} from './logic.js';
import {propertyKey,propertyInput,gridDraftState} from './base-mutations.js';
import {parseMarkdown} from '@oh-my-student/plugin-vault-sqlite/frontmatter';
import {propertyType} from './property-control.jsx';
import {notifyVaultChanged} from '@oh-my-student/plugin-vault-sqlite/workspace-client';
import {useSuccessFeedback} from '@oh-my-student/plugin-graph-and-blocks/success-feedback';

const textOf=value=>value==null?'':Array.isArray(value)?value.join(', '):String(value);
function CellEditor({row,column,onRowChange,onClose}) {
  const value=row.values[column.key], type=propertyType(propertyKey(column.key)||'',value);
  return <input autoFocus aria-label={`编辑 ${column.name}`} className="nv-base-grid-input" type={type === 'number'?'number':type === 'date'?'date':'text'} defaultValue={textOf(value)} onChange={event=>onRowChange({...row,values:{...row.values,[column.key]:event.target.value}})} onBlur={()=>onClose(true,false)} onKeyDown={event=>{if(event.key==='Escape')onClose(false);}} />;
}

export function BaseGrid({documents,columns,view,labelOf,cell,remote,selected,selecting=false,onSelect,onChanged,onViewPatch,onOpen,draftCache,stateKey,estimateRowHeight}) {
  const [successToast,showSuccess,clearSuccess]=useSuccessFeedback();
  const sourceRows=()=>documents.map(doc=>({path:doc.path,doc,values:{...doc.properties}}));
  const controller=useMemo(()=>gridDraftState(draftCache,stateKey,sourceRows()),[draftCache,stateKey]);
  const {rows,busy,failure,notice,history,future}=useSyncExternalStore(controller.subscribe,controller.getSnapshot);
  const {setRows,setBusy,setFailure,setNotice,setHistory,setFuture}=useMemo(()=>Object.fromEntries(['rows','busy','failure','notice','history','future'].map(key=>['set'+key[0].toUpperCase()+key.slice(1),value=>controller.set(key,value)])),[controller]);
  const [widths,setWidths]=useState(view.columnSize||{});
  const shell=useRef(null), [viewportWidth,setViewportWidth]=useState(800);
  useEffect(()=>{const observer=new ResizeObserver(entries=>setViewportWidth(entries[0].contentRect.width));if(shell.current)observer.observe(shell.current);return ()=>observer.disconnect();},[]);
  const columnWidths=useMemo(()=>{
    const result={}, flexible=[];let fixed=0;
    for(const key of columns){const explicit=widths[key]||view.columnSize?.[key];if(explicit){result[key]=explicit;fixed+=explicit;}else if(key==='file.name'||key.includes('tags'))flexible.push(key);else{result[key]=130;fixed+=130;}}
    const available=Math.max(0,viewportWidth-fixed-2), minimum=flexible.reduce((sum,key)=>sum+(key==='file.name'?220:200),0), weight=flexible.reduce((sum,key)=>sum+(key==='file.name'?2:1.6),0);
    for(const key of flexible)result[key]=(key==='file.name'?220:200)+Math.max(0,available-minimum)*(key==='file.name'?2:1.6)/(weight||1);
    return result;
  },[columns,widths,view.columnSize,viewportWidth]);
  const textWidth=useMemo(()=>{const context=document.createElement('canvas').getContext('2d');if(context)context.font='11.5px "Anthropic Sans Web Text", "Noto Sans SC", sans-serif';return text=>context?.measureText(String(text)).width||String(text).length*8;},[]);
  const lastRevision=controller.revisions, saving=controller.saving, widthTimer=useRef(null), currentCell=useRef(null), copied=useRef(null);
  useEffect(()=>{if(!saving.current&&!failure){setRows(sourceRows());documents.forEach(doc=>lastRevision.current.set(doc.path,doc.revision));}},[documents]);
  useEffect(()=>()=>clearTimeout(widthTimer.current),[]);
  const submit=async(operations,kind='edit')=>{
    if(saving.current)return; saving.current=true;setBusy(true);setFailure(null);setNotice('');clearSuccess();
    const completed=[];
    try{
      for(const operation of operations){
        let revision=lastRevision.current.get(operation.path)||operation.revision;
        if(kind!=='edit'){
          const current=await callVault(remote,'read',{path:operation.path}), fields=parseMarkdown(current.content).fields;
          if(Object.keys(operation.before).some(key=>JSON.stringify(fields[key])!==JSON.stringify(operation.before[key])))throw Object.assign(new Error('属性已在其他地方修改，未执行撤销。'),{code:'property_history_conflict'});
          revision=current.revision;
        }
        const properties=Object.fromEntries(Object.entries(operation.after).filter(([,value])=>value!==undefined)), unsetProperties=Object.keys(operation.after).filter(key=>operation.after[key]===undefined);
        const saved=await callVault(remote,'save',{path:operation.path,properties,unsetProperties,expectedRevision:revision});
        notifyVaultChanged(remote,{path:operation.path,revision:saved.revision});
        lastRevision.current.set(operation.path,saved.revision);completed.push(operation);
      }
      if(kind==='edit'){setHistory(value=>[...value,operations]);setFuture([]);}
      if(kind==='undo'){setHistory(value=>value.slice(0,-1));setFuture(value=>[...value,operations]);}
      if(kind==='redo'){setFuture(value=>value.slice(0,-1));setHistory(value=>[...value,operations]);}
      showSuccess('已保存属性');onChanged();
    }catch(error){if(completed.length&&kind==='edit')setHistory(value=>[...value,completed]);setFailure({operations:operations.slice(completed.length),kind,message:error.code==='property_history_conflict'?error.message:error.code==='vault_revision_conflict'?'文件已更新，本次属性填写已保留，未覆盖原文件。':'属性未保存，本次填写已保留。'});}
    finally{saving.current=false;setBusy(false);}
  };
  const edits=(nextRows,indices,key)=>{
    const field=propertyKey(key);if(!field || busy || failure)return;
    try{
      const operations=indices.map(index=>{
        const before=rows[index].values[key], after=propertyInput(nextRows[index].values[key],before);
        nextRows[index]={...nextRows[index],values:{...nextRows[index].values,[key]:after}};
        return {path:rows[index].path,revision:rows[index].doc.revision,before:{[field]:rows[index].doc.propertyKeys&&!rows[index].doc.propertyKeys.includes(field)?undefined:before??null},after:{[field]:after}};
      }).filter(operation=>JSON.stringify(operation.before)!==JSON.stringify(operation.after));
      if(!operations.length)return;setRows(nextRows);void submit(operations);
    }catch(error){setNotice(error.message);}
  };
  const undo=()=>{const batch=history.at(-1);if(!batch||busy||failure)return;void submit(batch.map(operation=>({...operation,before:operation.after,after:operation.before})),'undo');};
  const redo=()=>{const batch=future.at(-1);if(!batch||busy||failure)return;void submit(batch.map(operation=>({...operation,before:operation.after,after:operation.before})),'redo');};
  const gridColumns=useMemo(()=>columns.map(key=>({key,name:labelOf(key),width:columnWidths[key],minWidth:80,maxWidth:1000,resizable:true,draggable:true,sortable:!key.includes('tags'),editable:row=>!selecting&&!busy&&!failure&&Boolean(propertyKey(key))&&/\.md$/i.test(row.path),renderEditCell:CellEditor,
      renderCell:({row})=>{
        const value=row.values[key], writable=Boolean(propertyKey(key))&&/\.md$/i.test(row.path);
        if(propertyKey(key)==='tags'||key==='file.tags')return cell(row.doc,key);
        if(writable&&typeof value==='boolean')return <input type="checkbox" aria-label={`编辑 ${labelOf(key)} ${row.doc.title}`} checked={value} disabled={busy||Boolean(failure)} onChange={event=>{const index=rows.findIndex(item=>item.path===row.path),next=[...rows];next[index]={...row,values:{...row.values,[key]:event.target.checked}};edits(next,[index],key);}}/>;
        if(writable&&Array.isArray(value))return <span className="nv-vault-tags">{value.map((item,i)=><span className="nv-vault-tag" key={i} title={String(item)}>{String(item)}</span>)}</span>;
        if(writable)return <span className="nv-base-cell-value" title={textOf(value)}>{propertyKey(key)==='type'?(TYPE_LABELS[value]||textOf(value)||'文档'):textOf(value)||'—'}</span>;
        return cell(row.doc,key);
      }
    })),[columns,view,columnWidths,selecting,rows,busy,failure,cell]);
  const minimumHeight=({short:28,medium:50,tall:76,'extra-tall':108})[view.rowHeight||'short'];
  const rowHeight=row=>{
    let height=minimumHeight;
    for(const key of columns){const values=row.values[key];if(!Array.isArray(values)||!values.length)continue;const available=Math.max(60,columnWidths[key]-18);let lines=1,used=0;for(const value of values){const width=Math.min(160,textWidth(value)+18);if(used&&used+4+width>available){lines++;used=0;}used+=(used?4:0)+width;}height=Math.max(height,lines*22+6);}
    if(columns.includes('file.name'))height=Math.max(height,Math.ceil(textWidth(row.doc.title)*1.2/Math.max(80,columnWidths['file.name']-18))*22+6);
    return Math.max(height,estimateRowHeight?.(row.doc,columnWidths,textWidth)??0);
  };
  const height=rows.reduce((sum,row)=>sum+rowHeight(row),36);
  return <div ref={shell} className="nv-base-grid-shell"><style data-plugin="@oh-my-student/plugin-vault-views">{gridStyles}</style>
    <DataGrid className="nv-base-data-grid" aria-label="资料表格" aria-multiselectable="true" columns={gridColumns} rows={rows} rowKeyGetter={row=>row.path} rowClass={row=>'nv-base-data-row'+(selected.has(row.path)?' is-picked':'')} rowHeight={rowHeight} headerRowHeight={34} style={{height:Math.min(height,640),minHeight:Math.min(height,130)}}
      renderers={{
        renderRow:(key,props)=><Row key={key} {...props} aria-selected={selected.has(props.row.path)} onClickCapture={event=>{
          if((listSelectionGesture(event)||(selecting&&event.button===0))&&!event.target.closest('input,textarea,[contenteditable="true"]')){
            event.preventDefault();event.stopPropagation();onSelect(props.row.doc,event);
          }
        }}/>,
        renderSortStatus:({sortDirection,priority})=>sortDirection?<><svg className="nv-sort-direction" width="12" height="14" viewBox="0 0 12 14" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true"><path d={sortDirection==='ASC'?'M6 12V2m-3 3 3-3 3 3':'M6 2v10m-3-3 3 3 3-3'}/></svg>{priority&&<span>{priority}</span>}</>:null,
      }}
      onRowsChange={(next,{indexes,column})=>edits(next,indexes,column.key)}
      sortColumns={(view.sort||[]).map(rule=>({columnKey:rule.property,direction:rule.direction||'ASC'}))} onSortColumnsChange={sort=>onViewPatch({sort:sort.map(rule=>({property:rule.columnKey,direction:rule.direction}))})}
      onColumnResize={(index,width)=>{const key=gridColumns[index].key;setWidths(value=>({...value,[key]:width}));clearTimeout(widthTimer.current);widthTimer.current=setTimeout(()=>onViewPatch({columnSize:{...view.columnSize,...widths,[key]:width}}),250);}}
      onColumnsReorder={(source,target)=>{const next=columns.filter(key=>key!==source);next.splice(next.indexOf(target),0,source);onViewPatch({order:next});}}
      onSelectedCellChange={args=>{currentCell.current=args;}}
      onCopy={({sourceRow,sourceColumnKey})=>{copied.current={row:sourceRow,key:sourceColumnKey};void navigator.clipboard?.writeText(textOf(sourceRow.values[sourceColumnKey]));}}
      onPaste={({targetRow,targetColumnKey})=>{if(!copied.current||!propertyKey(targetColumnKey))return targetRow;return {...targetRow,values:{...targetRow.values,[targetColumnKey]:copied.current.row.values[copied.current.key]}};}}
      onCellKeyDown={(args,event)=>{if(args.mode==='EDIT')return;if(event.key===' '&&(selecting||listSelectionGesture(event))&&!event.target.closest('input,textarea,[contenteditable="true"]')){event.preventDefault();event.stopPropagation();event.preventGridDefault();onSelect(args.row.doc,event);return;}if(selecting)return;if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'){event.preventDefault();event.preventGridDefault();if(event.shiftKey)redo();else undo();}if(event.key==='Delete'||event.key==='Backspace'){event.preventGridDefault();const key=args.column.key;if(!propertyKey(key))return;const index=rows.findIndex(row=>row.path===args.row.path),next=[...rows];next[index]={...args.row,values:{...args.row.values,[key]:''}};edits(next,[index],key);}}}
    />
    {successToast}{(history.length>0||future.length>0||notice||failure)&&<div className="nv-base-grid-status"><span role="status">{busy?'正在保存…':notice}</span><button disabled={!history.length||busy||Boolean(failure)} onClick={undo}>撤销属性修改</button><button disabled={!future.length||busy||Boolean(failure)} onClick={redo}>重做</button></div>}
    {failure&&<div className="nv-base-grid-conflict" role="alert"><span>{failure.message}</span><button onClick={()=>submit(failure.operations,failure.kind)}>重试保存</button><button onClick={()=>onOpen({path:failure.operations[0]?.path})}>查看文件</button><button onClick={()=>{setFailure(null);setRows(sourceRows());onChanged();}}>放弃本次修改</button></div>}
  </div>;
}
