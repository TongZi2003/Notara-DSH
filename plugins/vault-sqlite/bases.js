import { isAlias, isMap, isPair, isScalar, parseDocument, stringify, visit } from 'yaml';
import { matchesKnowledgeTag } from './knowledge-relations.js';
import { safeWorkspaceRelativePath } from './vault-path.js';
// Ported from Notara Desktop packages/vault-core/src/bases.js; no runtime dependency.
const uniqueTags = values => [...new Set((Array.isArray(values) ? values : [values]).filter(value => typeof value === 'string').map(value => value.trim().replace(/^#/, '')).filter(Boolean))];
const matchesTag = (values, tag) => values.some(value => value === tag.replace(/^#/, '') || value.startsWith(tag.replace(/^#/, '') + '/'));

// Native .base YAML is configuration, never JavaScript. This deliberately small
// subset does not implement formulas, nested object access, or plugin views.
const originals = new WeakMap();
const forbidden = new Set(['__proto__', 'prototype', 'constructor', '<<']);
const fileFields = new Set(['name', 'basename', 'path', 'folder', 'ext', 'tags', 'mtime']);
const defaults = ['file.name', 'note.type', 'note.tags'];
const own = (object, key) => object != null && Object.hasOwn(object, key);
const scalar = value => value === null || ['string', 'boolean'].includes(typeof value) || (typeof value === 'number' && Number.isFinite(value));
const map = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function fail(detail, unsupported = false) {
  const error = new Error(`${unsupported ? '暂不支持 Bases' : 'Bases 配置无效'}：${detail}`);
  error.code = unsupported ? 'vault_base_unsupported' : 'vault_base_invalid';
  throw error;
}
const unsupported = detail => fail(detail, true);

function safeData(value, parents = new Set(), depth = 0) {
  if (scalar(value)) return;
  if (!value || typeof value !== 'object' || depth > 64 || parents.has(value)) fail('只允许有限深度的 YAML 标量、列表和属性对象');
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('不允许特殊对象');
  parents.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || forbidden.has(key)) fail('不允许的 YAML 键');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!own(descriptor, 'value')) fail('不允许属性访问器');
    safeData(descriptor.value, parents, depth + 1);
  }
  parents.delete(value);
}

/** Parse safe native YAML, preserving unknown fields. Unchanged serialization
 * returns the exact source (including comments/CRLF); edits retain untouched
 * top-level YAML nodes. Unsupported semantics are checked by evaluateBase. */
export function parseBase(content) {
  if (typeof content !== 'string' || content.length > 2_000_000) fail('需要不超过 2 MB 的 YAML 文本');
  try {
    const document = parseDocument(content, { version: '1.2', schema: 'core', strict: true, uniqueKeys: true, merge: false });
    if (document.errors.length || document.warnings.length) fail(document.errors[0]?.message ?? document.warnings[0].message);
    if (document.contents !== null && !isMap(document.contents)) fail('顶层必须是属性对象');
    visit(document, (_key, node, path) => {
      if (path.length > 64 || isAlias(node) || node?.anchor || node?.tag) fail('不允许 YAML 引用、锚点、显式类型标签或过深嵌套');
      if (isPair(node) && (!isScalar(node.key) || typeof node.key.value !== 'string' || forbidden.has(node.key.value))) fail('不允许复杂键或危险键');
    });
    const config = document.contents === null ? {} : document.toJS({ maxAliasCount: 0 });
    safeData(config);
    originals.set(config, { content, document, snapshot: JSON.parse(JSON.stringify(config)) });
    return config;
  } catch (error) {
    if (error.code === 'vault_base_invalid') throw error;
    fail(`YAML 解析失败：${error.message}`);
  }
}

export function serializeBase(config) {
  if (!map(config)) fail('顶层必须是属性对象');
  safeData(config);
  const original = originals.get(config);
  if (!original) return stringify(config, { aliasDuplicateObjects: false, lineWidth: 0 });
  if (JSON.stringify(config) === JSON.stringify(original.snapshot)) return original.content;
  const document = original.document.clone();
  for (const key of Object.keys(original.snapshot)) if (!own(config, key)) document.delete(key);
  for (const [key, value] of Object.entries(config)) {
    if (JSON.stringify(value) !== JSON.stringify(original.snapshot[key])) document.set(key, JSON.parse(JSON.stringify(value)));
  }
  return document.toString({ lineWidth: 0 });
}

const quoted = /^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/su;
const identifier = /^[\p{L}_][\p{L}\p{N}_-]*$/u;
const referencePrefix = /^(?:note\[(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\]|(?:note|file|notara)\.[\p{L}_][\p{L}\p{N}_-]*|[\p{L}_][\p{L}\p{N}_-]*)/u;

function textLiteral(source) {
  if (!quoted.test(source) || source.match(quoted)[0] !== source) unsupported(`字符串写法 ${source}`);
  let result = '';
  for (let i = 1; i < source.length - 1; i += 1) {
    const character = source[i];
    if (character === '\n' || character === '\r') unsupported('字符串中的换行需要转义');
    if (character !== '\\') { result += character; continue; }
    const escape = source[++i], escapes = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '\\': '\\', '"': '"', "'": "'", '/': '/' };
    if (escape === 'u' && /^[0-9a-f]{4}$/i.test(source.slice(i + 1, i + 5))) {
      result += String.fromCharCode(parseInt(source.slice(i + 1, i + 5), 16)); i += 4;
    } else if (own(escapes, escape)) result += escapes[escape];
    else unsupported(`字符串转义 \\${escape}`);
  }
  return result;
}

function literal(source) {
  if (quoted.test(source)) return textLiteral(source);
  if (source === 'true') return true;
  if (source === 'false') return false;
  if (source === 'null') return null;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(source) && Number.isFinite(Number(source))) return Number(source);
  unsupported(`表达式或标量 ${source}`);
}

function reference(property) {
  if (typeof property !== 'string' || !property.trim()) unsupported('空属性引用');
  if (property.startsWith('notara.')) {
    const key = property.slice(7);
    if (!['type', 'reviewDue', 'reviewCount', 'reviewStage', 'reviewStatus', 'isGuide'].includes(key)) unsupported('计算属性 ' + property);
    return { kind: 'computed', key };
  }
  if (property.startsWith('file.')) {
    const key = property.slice(5);
    if (!fileFields.has(key)) unsupported(`文件属性 ${property}`);
    return { kind: 'file', key };
  }
  let key = property;
  if (property.startsWith('note[') && property.endsWith(']')) key = textLiteral(property.slice(5, -1));
  else if (property.startsWith('note.')) {
    key = property.slice(5);
    if (!identifier.test(key)) unsupported(`属性引用 ${property}`);
  } else if (property.includes('.') || property.startsWith('formula[') || property.startsWith('this[')) unsupported(`属性引用 ${property}`);
  if (!key || forbidden.has(key)) unsupported(`属性引用 ${property}`);
  return { kind: 'note', key };
}

/** UI label/aggregation identity, decoded by the same property reference parser. */
export function basePropertyName(property) {
  const { kind, key } = reference(property);
  return kind === 'file' ? `file.${key}` : kind === 'computed' ? `notara.${key}` : key;
}

function propertyReader(property) {
  const { kind, key } = reference(property);
  return document => {
    let value;
    if (kind === 'file') {
      const path = String(document.path ?? '').replaceAll('\\', '/'), name = path.split('/').pop();
      const dot = name.lastIndexOf('.'), extension = dot > 0 ? name.slice(dot + 1) : '';
      if (key === 'tags') {
        const frontmatter = document.frontmatter ?? {}, tags = frontmatter.tags;
        value = uniqueTags(document.tags ?? tags ?? []);
      } else value = { path, name, ext: extension, basename: dot > 0 ? name.slice(0, dot) : name, folder: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '', mtime: document.mtimeMs ?? null }[key];
    } else if (kind === 'computed') value = document[key] ?? null;
    else value = own(document.frontmatter, key) ? document.frontmatter[key] : null;
    if (scalar(value)) return value;
    if (Array.isArray(value) && value.every(scalar)) return [...value];
    unsupported(`属性 ${property} 的值类型（仅支持标量和标量列表）`);
  };
}

/** Missing note fields are null. File names include the extension; titles are
 * not substituted. Returned lists are copies of original frontmatter values. */
export function basePropertyValue(document, property) {
  return propertyReader(property)(document);
}

/** Generate native .base config; list mode is explicit and never inferred by
 * coercing the value. tags always uses the native hierarchical hasTag method. */
export function baseForProperty(property, value, { list = false } = {}) {
  if (!scalar(value)) fail('属性筛选值必须是字符串、数字、布尔值或 null');
  const target = reference(property), isTag = target.key === 'tags';
  if (isTag && (typeof value !== 'string' || !value.trim())) fail('标签筛选值必须是非空字符串');
  const ref = target.kind === 'file' ? `file.${target.key}` : `note[${JSON.stringify(target.key)}]`;
  const expression = isTag ? `file.hasTag(${JSON.stringify(value)})` : list ? `${ref}.contains(${JSON.stringify(value)})` : `${ref} == ${JSON.stringify(value)}`;
  const column = target.kind === 'note' && ['type', 'tags'].includes(target.key) ? `note.${target.key}` : ref;
  const order = [...new Set([...defaults, column])];
  return { filters: { and: ['file.ext == "md"', expression] }, views: [
    { type: 'table', name: '表格', order: [...order] }, { type: 'cards', name: '卡片', order: [...order] },
  ] };
}


function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0,10) === value ? time : null;
}
function dateOperand(source) {
  const trimmed = source.trim();
  const read = quoted.test(trimmed) ? () => literal(trimmed) : propertyReader(trimmed);
  return document => validDate(read(document));
}
function compare(a, b, operator) {
  if (a === null || b === null || typeof a !== typeof b || !['number','string'].includes(typeof a)) return false;
  if (operator === '<') return a < b;
  if (operator === '<=') return a <= b;
  if (operator === '>') return a > b;
  if (operator === '>=') return a >= b;
  return operator === '==' ? a === b : a !== b;
}

function compileExpression(expression, day, resolveKnowledgeTag) {
  const source = expression.trim();
  const dateComparison = source.match(/^date\((.+)\)\s*(<=|>=|<|>|==|!=)\s*(today\(\)|date\((.+)\))$/s);
  if (dateComparison) {
    const left = dateOperand(dateComparison[1]), right = dateComparison[3] === 'today()' ? () => validDate(day) : dateOperand(dateComparison[4]);
    return document => compare(left(document), right(document), dateComparison[2]);
  }
  const method = source.match(/^file\.(hasTag|inFolder)\((.*)\)$/s);
  if (method) {
    const args = [], input = method[2];
    let rest = input.trim();
    while (rest) {
      const match = rest.match(quoted);
      if (!match) unsupported(`函数参数 ${source}`);
      args.push(textLiteral(match[0]));
      rest = rest.slice(match[0].length).trim();
      if (!rest) break;
      if (!rest.startsWith(',') || !rest.slice(1).trim()) unsupported(`函数参数 ${source}`);
      rest = rest.slice(1).trim();
    }
    if (!args.length || (method[1] === 'inFolder' && args.length !== 1)) unsupported(`函数参数 ${source}`);
    if (method[1] === 'hasTag') return document => args.some(tag => matchesKnowledgeTag(document, tag, resolveKnowledgeTag) || matchesTag(basePropertyValue(document, 'file.tags'), tag));
    const folder = args[0].replaceAll('\\', '/').replace(/\/$/, '');
    if (folder.startsWith('/') || folder.split('/').some(part => ['.', '..'].includes(part))) unsupported(`文件夹 ${folder}`);
    return document => !folder || basePropertyValue(document, 'file.path').startsWith(`${folder}/`);
  }
  const wrapped = source.startsWith('list(');
  const input = wrapped ? source.slice(5).trimStart() : source;
  const property = input.match(referencePrefix)?.[0];
  if (!property) unsupported(`表达式 ${source}`);
  const read = propertyReader(property);
  let remainder = input.slice(property.length).trim();
  if (remainder === '.isEmpty()') return document => {const value=read(document);return value === null || value === '' || Array.isArray(value)&&!value.length;};
  const textMethod=remainder.match(/^\.(startsWith|endsWith)\((.*)\)$/s);
  if(textMethod){const value=literal(textMethod[2].trim());if(typeof value!=='string')unsupported('文本匹配需要字符串');return document=>typeof read(document)==='string'&&read(document)[textMethod[1]](value);}
  if (wrapped) {
    if (!remainder.startsWith(')')) unsupported(`表达式 ${source}`);
    remainder = remainder.slice(1).trim();
  }
  if (wrapped || remainder.startsWith('.contains(')) {
    const tail = remainder.match(/^\.contains\((.*)\)$/s);
    if (!tail) unsupported(`表达式 ${source}`);
    const value = literal(tail[1].trim());
    return document => {
      if (['file.tags', 'note.tags', 'tags'].includes(property) && matchesKnowledgeTag(document, value, resolveKnowledgeTag)) return true;
      const actual = read(document);
      if (wrapped) return (Array.isArray(actual) ? actual : [actual]).some(item => item === value);
      if (actual === null) return false;
      if (typeof actual === 'string' && typeof value === 'string') return actual.includes(value);
      if (!Array.isArray(actual)) unsupported(`属性 ${property} 的 contains（只支持列表；标量可显式使用 list()）`);
      return actual.some(item => item === value);
    };
  }
  const comparison = remainder.match(/^(==|!=|<=|>=|<|>)\s*(.+)$/s);
  if (!comparison) unsupported(`表达式 ${source}`);
  const value = literal(comparison[2].trim());
  const cardTypes = new Set(['card', 'concept', 'method', 'exercise']);
  return document => {
    const actual = read(document);
    if (property === 'notara.type' && ['==', '!='].includes(comparison[1])) {
      if (value === 'card') return comparison[1] === '==' ? cardTypes.has(actual) : !cardTypes.has(actual);
      if (value === 'guide' || value === 'plan') {
        const isGuide = Boolean(document.isGuide) || actual === 'guide' || actual === 'plan';
        return comparison[1] === '==' ? isGuide : !isGuide;
      }
    }
    return ['==','!='].includes(comparison[1]) ? (comparison[1] === '==' ? actual === value : actual !== value) : compare(actual, value, comparison[1]);
  };
}

function compileFilter(filter, day, depth = 0, resolveKnowledgeTag) {
  if (depth > 64) unsupported('筛选嵌套过深');
  if (typeof filter === 'string') return compileExpression(filter, day, resolveKnowledgeTag);
  if (!map(filter) || Object.keys(filter).length !== 1) unsupported('筛选必须是表达式或单个 and/or/not 对象');
  const [operator] = Object.keys(filter), entries = filter[operator];
  if (!['and', 'or', 'not'].includes(operator) || !Array.isArray(entries)) unsupported(`筛选条件 ${operator}`);
  const tests = entries.map(entry => compileFilter(entry, day, depth + 1, resolveKnowledgeTag));
  return document => operator === 'and' ? tests.every(test => test(document)) : operator === 'or' ? tests.some(test => test(document)) : !tests.some(test => test(document));
}

function onlyKeys(value, keys, context) {
  if (!map(value)) fail(`${context} 必须是属性对象`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) unsupported(`${context}.${key}`);
}

/** Rows retain original document identity. properties is the visible ordered
 * list of native property references; view is the selected original view.
 * Sort is [{property, direction: 'ASC'|'DESC'}]; missing values stay last,
 * numeric values sort numerically and path breaks ties deterministically. */
export function evaluateBase(config, documents, viewIndex = 0, { today = new Date().toLocaleDateString('en-CA'), resolveKnowledgeTag } = {}) {
  safeData(config);
  onlyKeys(config, ['filters', 'views', 'properties', 'formulas', 'summaries'], 'base');
  for (const key of ['formulas', 'summaries']) if (own(config, key) && (!map(config[key]) || Object.keys(config[key]).length)) unsupported(key);
  if (!Array.isArray(documents) || !Array.isArray(config.views) || !Number.isInteger(viewIndex) || !config.views[viewIndex]) fail('无效的文档列表或视图索引');
  const view = config.views[viewIndex];
  onlyKeys(view, ['type', 'name', 'order', 'sort', 'filters', 'limit', 'groupBy', 'notara', 'rowHeight', 'columnSize'], 'view');
  if (own(view,'rowHeight') && !['short','medium','tall','extra-tall'].includes(view.rowHeight)) fail('行高无效');
  if (own(view,'columnSize') && (!map(view.columnSize) || Object.values(view.columnSize).some(value => !Number.isFinite(value) || value < 50 || value > 1200))) fail('列宽无效');
  if (own(view, 'notara')) {
    onlyKeys(view.notara, ['search', 'preset', 'cardPreview', 'sourcePath', 'scope'], 'view.notara');
    if (own(view.notara,'scope') && view.notara.scope !== 'sources') fail('资料范围无效');
    if (own(view.notara,'sourcePath')) safeWorkspaceRelativePath(view.notara.sourcePath);
    if (own(view.notara,'cardPreview') && typeof view.notara.cardPreview !== 'boolean') fail('正文预览设置无效');
    if (own(view.notara,'search') && (typeof view.notara.search !== 'string' || view.notara.search.length > 2000)) fail('搜索文本无效');
    if (own(view.notara,'preset') && !['all','guides','routes','lessons','review'].includes(view.notara.preset)) fail('预设视图无效');
  }
  if (own(view, 'groupBy')) {
    onlyKeys(view.groupBy, ['property', 'direction'], 'view.groupBy');
    propertyReader(view.groupBy.property);
    if (!['ASC', 'DESC'].includes(view.groupBy.direction ?? 'ASC')) fail('分组方向无效');
  }
  if (!['table', 'cards', 'graph'].includes(view.type)) unsupported(`视图 ${view.type}`);
  if (own(view, 'name') && typeof view.name !== 'string') fail('视图名称必须是字符串');
  if (own(config, 'properties')) {
    if (!map(config.properties)) fail('properties 必须是属性对象');
    for (const [property, options] of Object.entries(config.properties)) {
      reference(property); onlyKeys(options, ['displayName'], `properties.${property}`);
      if (own(options, 'displayName') && typeof options.displayName !== 'string') unsupported(`属性显示名称 ${property}`);
    }
  }
  const order = own(view, 'order') ? view.order : defaults;
  if (!Array.isArray(order)) fail('view.order 必须是属性名列表');
  const properties = [...new Set(order)], readers = properties.map(propertyReader);
  const tests = [config, view].filter(item => own(item, 'filters')).map(item => compileFilter(item.filters, today, 0, resolveKnowledgeTag));
  if (own(view, 'sort') && !Array.isArray(view.sort)) unsupported('view.sort');
  const sorts = (view.sort ?? []).map(sort => {
    onlyKeys(sort, ['property', 'direction'], 'view.sort');
    const direction = sort.direction ?? 'ASC';
    if (!['ASC', 'DESC'].includes(direction)) unsupported(`排序方向 ${direction}`);
    return { read: propertyReader(sort.property), direction };
  });
  if (own(view, 'limit') && (!Number.isInteger(view.limit) || view.limit < 0)) fail('view.limit 必须是非负整数');
  let rows = documents.filter(document => tests.every(test => test(document)));
  for (const row of rows) for (const read of readers) read(row);
  if (sorts.length) {
    const values = new Map(rows.map(row => [row, sorts.map(sort => sort.read(row))]));
    for (const list of values.values()) if (list.some(Array.isArray)) unsupported('列表属性排序');
    rows.sort((left, right) => {
      for (let i = 0; i < sorts.length; i += 1) {
        const a = values.get(left)[i], b = values.get(right)[i];
        if (a === b) continue;
        if (a === null || b === null) return a === null ? 1 : -1;
        const result = typeof a === typeof b ? (a < b ? -1 : 1) : typeof a < typeof b ? -1 : 1;
        return sorts[i].direction === 'DESC' ? -result : result;
      }
      return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
    });
  }
  if (own(view, 'limit')) rows = rows.slice(0, view.limit);
  return { rows, properties, view };
}

export const DEFAULT_BASE_PATH = '资料库.base';
export function isReviewView(view){
 if(view?.notara?.preset==='review')return true;
 const filter=view?.filters,all=filter?.and;
 const single=typeof filter==='string'?filter.trim():Array.isArray(all)&&all.length===1&&typeof all[0]==='string'&&!view.notara?.search?all[0].trim():null;
 return single==='date(notara.reviewDue) <= today()'||Array.isArray(all)&&all.includes('date(notara.reviewDue) <= today()')&&(all.includes('note.type == "card"')||all.includes('notara.type == "card"'));
}
/** A Base limit counts documents, not the separate topics inside one diary. */
export function reviewPlansForView(config,document,index,options){
 const view={...config.views[index]};delete view.limit;
 const candidates=(document.reviewPlans??[]).map(plan=>({...document,reviewDue:plan.nextReview,reviewStage:plan.stage,reviewStatus:plan.nextReview<=options.today?'due':'scheduled',viewPlan:plan}));
 return evaluateBase({...config,views:[view]},candidates,0,options).rows.map(row=>row.viewPlan);
}
export const DEFAULT_BASE_COLUMNS = ['file.name', 'note.tags', 'notara.type', 'notara.reviewCount', 'notara.reviewDue'];
export const BASE_PROPERTY_LABELS = {
  'file.name':'标题', 'file.path':'位置', 'file.folder':'文件夹', 'file.ext':'格式', 'file.tags':'标签', 'file.mtime':'最近修改',
  'note.title':'标题属性', 'note.summary':'摘要', 'note.tags':'标签', 'notara.type':'类型', 'note.type':'类型属性', 'note.learned':'旧排期标记', 'note.mastery':'旧排期档位', 'note.next_review':'旧排期日期',
  'notara.reviewStage':'旧排期档位', 'notara.reviewCount':'记录次数', 'notara.reviewDue':'下次复习', 'notara.reviewStatus':'复习状态', 'notara.isGuide':'学习计划',
};
export function defaultLibraryBase() {
  return {
    filters: 'file.ext != "base"',
    properties: Object.fromEntries(DEFAULT_BASE_COLUMNS.map(key => [key, {displayName:BASE_PROPERTY_LABELS[key]}])),
    views: [
      { type:'table', name:'全部资料', notara:{preset:'all'}, order:[...DEFAULT_BASE_COLUMNS], sort:[{property:'file.name',direction:'ASC'}] },
      { type:'cards', name:'学习计划', notara:{preset:'guides'}, filters:'notara.isGuide == true', order:[...DEFAULT_BASE_COLUMNS] },
      { type:'cards', name:'待复习', notara:{preset:'review'}, filters:'date(notara.reviewDue) <= today()', order:[...DEFAULT_BASE_COLUMNS], sort:[{property:'notara.reviewDue',direction:'ASC'}] },
    ],
  };
}
/** Project only the exact former built-in predicate; custom filters remain exact. */
export function learningReviewBase(config){
 for(const view of config.views??[])if(view.notara?.preset==='review'&&view.filters?.and?.length===2&&view.filters.and.includes('notara.type == "card"')&&view.filters.and.includes('date(notara.reviewDue) <= today()'))view.filters='date(notara.reviewDue) <= today()';
 return config;
}
/** Stable view-local filters generated by the dialog, never executable JS. */
export function filtersToBase(filters = {}) {
  const tagTests = (filters.tags ?? []).map(tag => 'file.tags.contains(' + JSON.stringify(tag.replace(/^#/, '')) + ')');
  const tests = filters.tagMatch === 'any' && tagTests.length ? [{or:tagTests}] : tagTests;
  if (filters.type) tests.push('notara.type == ' + JSON.stringify(filters.type));
  const statuses = {
    due:'date(notara.reviewDue) <= today()', scheduled:'date(notara.reviewDue) > today()',
    pending:'notara.reviewStatus == "pending"', new:'notara.reviewStatus == "pending"',
    learning:{and:['notara.reviewDue != null', 'notara.reviewStage < 4']}, familiar:'notara.reviewStage >= 4', 'needs-review':'notara.reviewStatus == "needs-review"',
  };
  if (filters.reviewStatus && filters.reviewStatus !== 'all') {
    if (!own(statuses, filters.reviewStatus)) fail('复习筛选无效');
    tests.push(statuses[filters.reviewStatus]);
  }
  if (filters.minReviews !== '' && filters.minReviews != null) tests.push('notara.reviewCount >= ' + Math.max(0, Math.trunc(Number(filters.minReviews) || 0)));
  return tests;
}
export const BASE_SORTS = { title:'file.name', updated:'file.mtime', due:'notara.reviewDue', reviewCount:'notara.reviewCount' };
export function sortForBase(sort) { return sort ? [{property:BASE_SORTS[sort] || sort, direction:['updated','reviewCount'].includes(sort)?'DESC':'ASC'}] : []; }
