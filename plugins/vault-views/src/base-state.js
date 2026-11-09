import { DEFAULT_BASE_PATH, DEFAULT_BASE_COLUMNS, defaultLibraryBase, parseBase, serializeBase, evaluateBase, filtersToBase, sortForBase,learningReviewBase,isReviewView } from '@oh-my-student/plugin-vault-sqlite/bases';
import { callVault, queryInput } from './logic.js';

export const emptyBaseFilters = () => ({ q:'', tags:[], tagMatch:'all', type:'', sourcePath:'', reviewStatus:'', minReviews:'', sort:'' });
// Presentation defaults only: do not rewrite user-owned .base files on opening.
export function baseColumns(view, {grouped = true,review = view?.notara?.preset==='review'} = {}) {
  let columns = view?.order || DEFAULT_BASE_COLUMNS;
  if (JSON.stringify(columns) === JSON.stringify(DEFAULT_BASE_COLUMNS)) {
    if(review)return ['file.name'];
    columns = columns.filter(key => key !== 'notara.reviewCount' && (key !== 'notara.reviewDue' || view?.notara?.preset === 'review'));
  }
  return grouped ? columns.filter(key => !['note.type','notara.type'].includes(key) || !['note.type','notara.type'].includes(view?.groupBy?.property)) : columns;
}
export function baseQuery(path, view, filters, offset = 0, limit = 100) {
  const query = queryInput({ ...filters, offset, limit }, 'table');
  if (!filters.sort) delete query.sort;
  return { ...query, base:{path,view} };
}
export async function loadBase(remote, path) {
  let created=false;
  if (path === DEFAULT_BASE_PATH) {
    const files = await callVault(remote, 'query', { type:'base', limit:10000 });
    if (!files.documents.some(doc => doc.path === path)) {
      // CAS never replaces a pre-existing file, including an invalid/unindexed one.
      try { await callVault(remote, 'save', { path, content:serializeBase(defaultLibraryBase()), expectedRevision:null }); created=true; }
      catch { /* Read below reports failures without replacing a pre-existing file. */ }
    }
  }
  const record=await callVault(remote, 'read', {path});
  const config=path===DEFAULT_BASE_PATH?learningReviewBase(parseBase(record.content)):parseBase(record.content);
  if(config.views?.some(view=>view.type==='graph')) {
    config.views.forEach(view=>{if(view.type==='graph')view.type='table';});
    config.views.forEach((_,index)=>evaluateBase(config,[],index));
    const content=serializeBase(config), saved=await callVault(remote,'save',{path,content,expectedRevision:record.revision});
    return {...record,...saved,content,needsTreeRefresh:true};
  }
  const content=serializeBase(config);
  return content===record.content&&!created?record:{...record,content,...created?{needsTreeRefresh:true}:{}};
}
export function updatedBase(record, index, { name, layout, order, groupBy, filters, append, clearFilters = false, sort, cardPreview, initialView }) {
  const config = parseBase(record.content), source = append && initialView ? initialView : config.views[index];
  if (!name.trim() || name.trim().length > 60) throw new Error('视图名称需要 1–60 个字');
  if (config.views.some((view, i) => (append || i !== index) && view.name === name.trim())) throw new Error('已有同名视图，请换个名称');
  const view = { ...structuredClone(source), name:name.trim(), type:layout, order:[...order] };
  if (append && view.notara) delete view.notara.preset;
  if (clearFilters) { delete view.filters; if(view.notara) { delete view.notara.search; delete view.notara.sourcePath; delete view.notara.scope; } }
  const tests = [...(view.filters ? [view.filters] : []), ...filtersToBase(filters)];
  if (tests.length) view.filters = {and:tests};
  const search = [view.notara?.search, filters.q?.trim()].filter(Boolean).join(' ');
  if (search) view.notara = {...view.notara,search};
  if (filters.sourcePath) view.notara = {...view.notara,sourcePath:filters.sourcePath};
  if (cardPreview === true) view.notara = {...view.notara,cardPreview:true};
  else if (cardPreview === false && view.notara) delete view.notara.cardPreview;
  if (view.notara && !Object.keys(view.notara).length) delete view.notara;
  if (filters.sort) view.sort = sortForBase(filters.sort);
  if (sort) view.sort = sort;
  if (groupBy) view.groupBy = {property:groupBy, direction:'ASC'}; else delete view.groupBy;
  const target = append ? config.views.length : index;
  if (append) config.views.push(view); else config.views[index] = view;
  evaluateBase(config, [], target);
  return {content:serializeBase(config), index:target};
}
function singleViewFilter(view) {
  if (typeof view?.filters === 'string') return view.filters.trim();
  if (Array.isArray(view?.filters?.and) && view.filters.and.length === 1 && typeof view.filters.and[0] === 'string' && !view?.notara?.search) {
    return view.filters.and[0].trim();
  }
  return null;
}
function isUnfilteredView(view) {
  if (!view || view.notara?.search || view.notara?.sourcePath || view.notara?.scope) return false;
  if (!view.filters) return true;
  return Array.isArray(view.filters?.and) && view.filters.and.length === 0;
}
export function presetIndex(config, preset) {
  if (!Array.isArray(config?.views)) return -1;
  const index=config.views.findIndex(view=>view.notara?.preset === preset);
  if(index >= 0) return index;
  // Older default files and user-saved type views keep their filter identity without synthetic preset tags.
  if(preset === 'guides') return config.views.findIndex(view=>{const clause=singleViewFilter(view); return clause === 'notara.isGuide == true' || clause === 'notara.type == "guide"' || clause === 'note.type == "guide"' || clause === 'notara.type == "plan"' || clause === 'note.type == "plan"';});
  if(preset === 'routes') return config.views.findIndex(view=>{const clause=singleViewFilter(view); return clause === 'notara.type == "route"' || clause === 'note.type == "route"';});
  if(preset === 'lessons') return config.views.findIndex(view=>{const clause=singleViewFilter(view); return clause === 'notara.type == "lesson"' || clause === 'note.type == "lesson"';});
  if(preset === 'review') return config.views.findIndex(isReviewView);
  if(preset === 'all') return config.views.findIndex(isUnfilteredView);
  return -1;
}

export function baseViewLabel(view){
  return view?.name==='导读资料'&&presetIndex({views:[view]},'guides')===0?'学习计划':view?.name||'未命名视图';
}
