import { parseDocument } from 'yaml';

export function documentProperties(content) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) return null;
  try {
    const document = parseDocument(match[1]);
    if (document.errors.length) return { error: true, entries: [] };
    const values = document.toJS({ maxAliasCount: 20 });
    if (!values || typeof values !== 'object' || Array.isArray(values)) return { error: true, entries: [] };
    return { entries: Object.entries(values), error: false };
  } catch { return { error: true, entries: [] }; }
}

export const propertyLabels = {
  title: '标题', summary: '摘要', type: '类型', tags: '标签', aliases: '别名', learned: '旧排期标记',
  created: '创建时间', updated: '更新时间', created_at: '创建时间', updated_at: '更新时间',
  author: '作者', source: '来源', topic: '专题', status: '状态',
  review_due: '下次复习', review_interval: '复习间隔', review_count: '复习记录',
};

export function propertyTags(value) {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,，\s]+/) : [];
  return [...new Set(values.filter(item => typeof item === 'string' || typeof item === 'number').map(item => String(item).trim().replace(/^#/, '')).filter(Boolean))];
}
