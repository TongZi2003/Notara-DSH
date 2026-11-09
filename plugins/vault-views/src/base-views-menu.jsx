import React,{useState} from 'react';
import {Modal} from '@deepseek-ai/dsh-client-ui-primitives';

export function BaseViewsManager({config,write,onClose,onPick}) {
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[drag,setDrag]=useState(null);
  const change=async transform=>{setBusy(true);setError('');try{await write(transform);}catch(error){setError(error.message);}finally{setBusy(false);}};
  const move=(from,to)=>{if(from===to)return;void change(config=>{const item=config.views.splice(from,1)[0];config.views.splice(to,0,item);});};
  const rename=(index,name)=>{name=name.trim();if(name===config.views[index].name)return;if(!name||config.views.some((view,i)=>i!==index&&view.name===name)){setError('名称不能为空或重复');return;}void change(config=>{config.views[index].name=name;});};
  return <Modal open headless title="管理视图" backdropBlur={false} onClose={()=>!busy&&onClose()} className="nv-filter-dialog nv-base-manager"><header><h2>管理视图</h2><button onClick={onClose} disabled={busy} aria-label="关闭管理视图">×</button></header><div className="nv-filter-body"><p className="nv-filter-help">拖动调整顺序。移除视图不会删除资料文件。</p><div className="nv-base-view-list">{config.views.map((view,index)=><div className="nv-base-view-row" key={`${index}:${view.name}`} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();if(drag!==null)move(drag,index);setDrag(null);}}>
    <button className="nv-base-drag-handle" draggable={!busy} aria-label={`拖动视图 ${view.name}`} onDragStart={event=>{setDrag(index);event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',view.name);}} onDragEnd={()=>setDrag(null)}>⠿</button>
    <input aria-label={`重命名视图 ${view.name}`} defaultValue={view.name} disabled={busy} maxLength={60} onBlur={event=>rename(index,event.target.value)} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();}} />
    <button title="打开视图" aria-label={`打开视图 ${view.name}`} onClick={()=>{onPick(index);onClose();}}>↗</button><button title="上移" aria-label={`上移视图 ${view.name}`} disabled={!index||busy} onClick={()=>move(index,index-1)}>↑</button><button title="下移" aria-label={`下移视图 ${view.name}`} disabled={index===config.views.length-1||busy} onClick={()=>move(index,index+1)}>↓</button>
    <button title="复制" aria-label={`复制视图 ${view.name}`} disabled={busy} onClick={()=>change(config=>{const copy=structuredClone(config.views[index]);let number=1,name=`${copy.name} 副本`;while(config.views.some(item=>item.name===name))name=`${copy.name} 副本 ${++number}`;copy.name=name;if(copy.notara)delete copy.notara.preset;config.views.splice(index+1,0,copy);})}>复制</button>
    <button title="移除视图" aria-label={`移除视图 ${view.name}`} disabled={config.views.length===1||busy} onClick={()=>change(config=>{config.views.splice(index,1);})}>×</button>
  </div>)}</div>{error&&<p role="alert">{error}</p>}</div><footer><span role="status">{busy?'正在保存…':'更改自动保存'}</span><button onClick={onClose} disabled={busy}>完成</button></footer></Modal>;
}
