import React,{useMemo,useState} from 'react';
import {Modal} from '@deepseek-ai/dsh-client-ui-primitives';
import {BASE_PROPERTY_LABELS,basePropertyName,parseBase,evaluateBase} from '@oh-my-student/plugin-vault-sqlite/bases';
import {FilterSelect} from './filter-options.jsx';

const nameOf=key=>BASE_PROPERTY_LABELS[key]||basePropertyName(key);
export function filterCondition(property,operator,value) {
  if(operator==='empty')return `${property}.isEmpty()`;
  if(operator==='due')return `date(${property}) <= today()`;
  if(['contains','startsWith','endsWith'].includes(operator))return `${property}.${operator}(${JSON.stringify(value)})`;
  return `${property} ${operator} ${JSON.stringify(value)}`;
}
function readCondition(expression) {
  let match=expression.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if(match&&!match[1].startsWith('date(')){try{return {property:match[1].trim(),operator:match[2],value:JSON.parse(match[3])};}catch{}}
  match=expression.match(/^(.+?)\.(contains|startsWith|endsWith)\((.*)\)$/);if(match){try{return {property:match[1],operator:match[2],value:JSON.parse(match[3])};}catch{}}
  match=expression.match(/^(.+?)\.isEmpty\(\)$/);if(match)return {property:match[1],operator:'empty',value:''};
  match=expression.match(/^date\((.+?)\) <= today\(\)$/);if(match)return {property:match[1],operator:'due',value:''};
  return null;
}
function Rule({filter,onChange,onRemove,properties,depth=0}) {
  const condition=typeof filter==='string'?readCondition(filter):null;
  const [advanced,setAdvanced]=useState(typeof filter==='string'&&!condition);
  if(typeof filter==='object'){
    const operator=Object.keys(filter)[0]||'and', entries=filter[operator]||[];
    const patch=(i,value)=>onChange({[operator]:entries.map((item,n)=>n===i?value:item)});
    return <fieldset className="nv-base-filter-group"><legend><select aria-label={`条件组 ${depth+1} 的匹配方式`} value={operator} onChange={event=>onChange({[event.target.value]:entries})}><option value="and">满足全部条件</option><option value="or">满足任一条件</option><option value="not">不满足以下条件</option></select>{onRemove&&<button type="button" aria-label="移除条件组" onClick={onRemove}>×</button>}</legend><div>{entries.map((entry,i)=><Rule key={i} filter={entry} properties={properties} depth={depth+1} onChange={value=>patch(i,value)} onRemove={()=>onChange({[operator]:entries.filter((_,n)=>n!==i)})}/>)}</div><footer><button type="button" onClick={()=>onChange({[operator]:[...entries,'note.type == "card"']})}>＋ 添加条件</button>{depth<6&&<button type="button" onClick={()=>onChange({[operator]:[...entries,{and:[]}]})}>＋ 添加条件组</button>}</footer></fieldset>;
  }
  const set=patch=>{const next={...condition,...patch};onChange(filterCondition(next.property,next.operator,next.value));};
  const options=[...new Set([...properties,...(condition?[condition.property]:[])])];
  return <div className="nv-base-filter-rule">{advanced||!condition?<input aria-label="高级筛选表达式" value={filter} onChange={event=>onChange(event.target.value)} placeholder='note.type == "card"'/>:<><FilterSelect label="筛选属性" value={condition.property} onChange={property=>set({property})} options={options.map(key=>({value:key,label:nameOf(key)}))}/><select aria-label="筛选关系" value={condition.operator} onChange={event=>set({operator:event.target.value})}>{[['==','等于'],['!=','不等于'],['contains','包含'],['startsWith','开头是'],['endsWith','结尾是'],['>','大于'],['>=','大于等于'],['<','小于'],['<=','小于等于'],['empty','为空'],['due','已到期']].map(([key,name])=><option value={key} key={key}>{name}</option>)}</select>{!['empty','due'].includes(condition.operator)&&<><select className="nv-base-value-type" aria-label="筛选值类型" value={typeof condition.value} onChange={event=>set({value:event.target.value==='number'?Number(condition.value)||0:event.target.value==='boolean'?true:event.target.value==='object'?null:String(condition.value??'')})}><option value="string">文本</option><option value="number">数字</option><option value="boolean">开关</option><option value="object">空值</option></select>{typeof condition.value==='boolean'?<select aria-label="筛选值" value={String(condition.value)} onChange={event=>set({value:event.target.value==='true'})}><option value="true">是</option><option value="false">否</option></select>:<input aria-label="筛选值" disabled={condition.value===null} type={typeof condition.value==='number'?'number':'text'} value={condition.value??''} onChange={event=>set({value:typeof condition.value==='number'?Number(event.target.value):event.target.value})}/>}</>}
    </>}<button type="button" title={advanced?'结构化编辑':'高级表达式'} aria-label="切换条件表达式" disabled={advanced&&!condition} onClick={()=>setAdvanced(value=>!value)}>ƒ</button><button type="button" aria-label="移除筛选条件" onClick={onRemove}>×</button></div>;
}
export function BaseFilterDialog({record,index,availableProperties=[],onSave,onClose}) {
  const config=useMemo(()=>parseBase(record.content),[record.content]);
  const asGroup=value=>typeof value==='object'&&value?structuredClone(value):{and:value?[value]:[]};
  const [scope,setScope]=useState('view'), [global,setGlobal]=useState(()=>asGroup(config.filters)),[view,setView]=useState(()=>asGroup(config.views[index].filters)),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const properties=[...new Set([...Object.keys(BASE_PROPERTY_LABELS),...availableProperties.map(item=>item.property)])];
  const apply=async()=>{setBusy(true);setError('');try{const next=parseBase(record.content);next.filters=global;next.views[index].filters=view;evaluateBase(next,[],index);await onSave(global,view);onClose();}catch(error){setError(error.message);}finally{setBusy(false);}};
  return <Modal open headless title="筛选资料" backdropBlur={false} onClose={()=>!busy&&onClose()} className="nv-filter-dialog nv-base-filter-dialog"><header><h2>筛选资料</h2><button aria-label="关闭筛选资料" onClick={onClose} disabled={busy}>×</button></header><div className="nv-filter-body"><div role="tablist" aria-label="筛选范围" className="nv-base-filter-scope">{[['global','所有视图'],['view','当前视图']].map(([key,label])=><button key={key} role="tab" aria-selected={scope===key} onClick={()=>setScope(key)}>{label}</button>)}</div><p className="nv-filter-help">{scope==='global'?'适用于这个资料库的所有视图。':'仅用于当前视图，同时满足所有视图的条件。'}</p><Rule key={scope} filter={scope==='global'?global:view} onChange={scope==='global'?setGlobal:setView} properties={properties}/>{error&&<p role="alert">{error}</p>}</div><footer><button disabled={busy} onClick={()=>scope==='global'?setGlobal({and:[]}):setView({and:[]})}>清空当前条件</button><span/><button disabled={busy} onClick={onClose}>取消</button><button className="nv-filter-apply" disabled={busy} onClick={apply}>{busy?'保存中…':'应用'}</button></footer></Modal>;
}
