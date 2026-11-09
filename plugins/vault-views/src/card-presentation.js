import { basePropertyName } from '@oh-my-student/plugin-vault-sqlite/bases';
import { isReviewDocument } from '@oh-my-student/plugin-vault-sqlite/review-contract';

export function tagLabel(value) {
  const match=String(value).match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
  return match?(match[2]||match[1].split('/').at(-1).replace(/\.md$/i,'')):String(value);
}
export function cardTags(doc) {
  const resolved=new Map((doc.knowledgeTags??[]).map(tag=>[tag.raw,tag])),seen=new Set();
  return (doc.tags??[]).flatMap(raw=>{
    const tag=resolved.get(raw),item=tag?{value:`[[${tag.target}]]`,label:tag.label,target:tag.target}:{value:raw,label:tagLabel(raw)};
    if(seen.has(item.value))return [];seen.add(item.value);return [item];
  });
}

export function hasCardValue(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasCardValue);
  return typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value);
}

export function cardFields(doc, columns) {
  return columns.filter(key => {
    const name = basePropertyName(key);
    if (['file.name','title','summary'].includes(name)) return false;
    if (!isReviewDocument(doc.type,doc.path) && /^(notara\.(review|last|independent)|review_|next_review$)/.test(name)) return false;
    if (['tags','file.tags'].includes(name)) return hasCardValue(doc.tags);
    if (['type','notara.type'].includes(name)) return hasCardValue(doc.type);
    return hasCardValue(doc.properties?.[key]);
  });
}
