import React from 'react';
import {cardTags} from './card-presentation.js';

export function DocumentTags({document,selected=[],onTag,onOpen}) {
  return <span className="nv-vault-tags">{cardTags(document).map(tag=><span className="nv-entity-tag" key={tag.value}>
    {onTag?<button type="button" className="nv-vault-tag" aria-label={`${tag.target?'筛选知识标签':'筛选标签'} ${tag.label}`} aria-pressed={selected.includes(tag.value)} onClick={()=>onTag(tag.value)}>{tag.label}</button>:<span className="nv-vault-tag">{tag.label}</span>}
    {tag.target&&onOpen&&<button type="button" className="nv-vault-tag" aria-label={`打开知识实体 ${tag.label}`} title={`打开${tag.label}`} onClick={()=>onOpen({path:tag.target})}>↗</button>}
  </span>)}</span>;
}
