import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { constants, realpathSync, lstatSync, statSync, readdirSync, openSync, closeSync, readSync, readFileSync, writeFileSync, renameSync, unlinkSync, linkSync, mkdirSync, fsyncSync, fstatSync } from 'node:fs';
import { resolve, join, relative, extname, basename, dirname, posix } from 'node:path';
import { watch } from 'chokidar';
import { parseMarkdown, patchFields } from './frontmatter.js';
import { markdownFacts, documentSummary, stripTaskAnchor, isLearningPlan } from './markdown-projection.js';
import { projectRouteDocument, projectHomeRecommendations, projectCardRevisit, extractFollowUpSnippet, extractLineLinks, routeContextReferences } from './route-projection.js';
import { civilDay, isCardType, reviewProjection, recordReviewContent, scheduleReviewContent, undoReviewContent, recordedProposal,recordedSchedule } from './review.js';
import {isReviewDocument} from './review-contract.js';
import { parseCanvasDocument, parseDrawingDocument } from './drawing-files.js';
import { createDrawingSession } from './drawing-session.js';
import { createVaultChanges } from './changes.js';
import { parseBase, evaluateBase, basePropertyValue, sortForBase,learningReviewBase,DEFAULT_BASE_PATH,isReviewView,reviewPlansForView } from './bases.js';
import { IMAGE_MIME, ignoredPart, safeRelativePath, safeWorkspaceRelativePath, isVaultFormat } from './vault-path.js';
import { createRelationResolver, projectKnowledgeTags, isLearningDocument, isKnowledgeEntity, isExampleDocument, relationIdentity, matchesKnowledgeTag } from './knowledge-relations.js';
import { referenceCandidates } from './file-reference.js';
import {encodeCompactGraph,copyCompactGraph} from './graph-transport.js';
export { safeRelativePath } from './vault-path.js';

const fail = code => { throw new Error(code); };
const hash = content => createHash('sha256').update(content).digest('hex');
function cjkTokens(text) {
  const tokens = new Set();
  for (const [run] of text.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu)) {
    const chars = Array.from(run);
    for (let i = 0; i < chars.length; i++) { tokens.add(chars[i]); if (i + 1 < chars.length) tokens.add(chars[i] + chars[i + 1]); }
  }
  return [...tokens].join(' ');
}
function inputObject(input) { if (!input || typeof input !== 'object' || Array.isArray(input)) fail('vault_input_invalid'); return input; }

function parseText(path, content) {
  const extension = extname(path).toLowerCase();
  let fields = {}, body = content;
  if (extension === '.md') ({ fields, body } = parseMarkdown(content));
  if (extension === '.canvas') parseCanvasDocument(content);
  if (extension === '.excalidraw') parseDrawingDocument(content);
  if (extension === '.base') { parseBase(content); body = ''; }
  const title = typeof fields.title === 'string' ? fields.title : body.match(/^#\s+(.+)\r?$/m)?.[1]?.trim() ?? basename(path, extension);
  const tags = Array.isArray(fields.tags) ? fields.tags.filter(tag => typeof tag === 'string') : typeof fields.tags === 'string' ? [fields.tags] : [];
  const type = typeof fields.type === 'string' ? fields.type : fields.template === true ? 'template' : extension === '.base' ? 'base' : extension === '.pdf' ? 'source' : extension === '.canvas' ? 'canvas' : extension === '.excalidraw' ? 'drawing' : IMAGE_MIME[extension] ? 'image' : 'note';
  if (type === 'canvas' || type === 'drawing') body = '';
  const projection = reviewProjection(fields,path), links = [];
  const bodyLine = content.slice(0, content.length - body.length).split('\n').length - 1;
  const facts = extension === '.md' ? markdownFacts(body, bodyLine) : { tasks: [], links: [] };
  for (const link of facts.links) {
    if (link.target.startsWith('/') || link.target.includes('\\')) continue;
    const target = link.relative ? posix.normalize(posix.join(posix.dirname(path), link.target)) : link.target;
    try { safeWorkspaceRelativePath(target); } catch { continue; }
    links.push({ ...link, target, exact: !!link.relative,...(link.reference?{reference:{...link.reference,path:target}}:{}) });
  }
  const guide = isLearningPlan({path,type,title,tags,template:fields.template===true});
  return { fields, title, tags, type, bodyLine, ...projection, tasks: facts.tasks, links,
    guide,
    // Grid previews must not unfold the teacher/reference layer implicitly.
    summary: documentSummary(body), text: body };
}

/** Synchronous SQLite/file core; no RPC read path invokes scan(). Watch is opt-in. */
export function createVaultStore({ root, cachePath = ':memory:', now = () => new Date(), onError = () => {} } = {}) {
  if (typeof root !== 'string' || !root || !root.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(root)) fail('vault_root_invalid');
  root = realpathSync(root);
  if (!statSync(root).isDirectory()) fail('vault_root_invalid');
  if (cachePath !== ':memory:') { cachePath = resolve(cachePath); mkdirSync(dirname(cachePath), { recursive: true }); cachePath = join(realpathSync(dirname(cachePath)), basename(cachePath)); }
  const db = new DatabaseSync(cachePath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS cache_meta (root TEXT NOT NULL, projection_version INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS documents (path TEXT PRIMARY KEY, mtime_ms REAL, size INTEGER, revision TEXT, title TEXT, type TEXT, tags_json TEXT, frontmatter_json TEXT, review_due TEXT, review_count INTEGER, last_support TEXT, summary TEXT, is_guide INTEGER, last_result TEXT, independent_review_count INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS documents_due ON documents(type,review_due);
    CREATE INDEX IF NOT EXISTS documents_guides ON documents(is_guide,mtime_ms DESC);
    CREATE TABLE IF NOT EXISTS links (source_path TEXT, target_path TEXT, section_kind TEXT, edge_style TEXT, target_exact INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS source_regions (source_path TEXT NOT NULL, target_path TEXT NOT NULL, locator_json TEXT NOT NULL, PRIMARY KEY(source_path,target_path,locator_json));
    CREATE INDEX IF NOT EXISTS source_regions_target ON source_regions(target_path);
    CREATE INDEX IF NOT EXISTS links_source ON links(source_path); CREATE INDEX IF NOT EXISTS links_target ON links(target_path);
    CREATE TABLE IF NOT EXISTS knowledge_tags (source_path TEXT NOT NULL, raw TEXT NOT NULL, target_path TEXT NOT NULL, label TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS knowledge_tags_target ON knowledge_tags(target_path,source_path);
    CREATE INDEX IF NOT EXISTS knowledge_tags_source ON knowledge_tags(source_path,raw);
    CREATE TABLE IF NOT EXISTS tasks (path TEXT, line INTEGER, checked INTEGER, text TEXT, hidden INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(path,line));
    CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(path,title,tags,body,cjk,tokenize='unicode61');`);
  const cachedRoot = db.prepare('SELECT root FROM cache_meta LIMIT 1').get()?.root;
  if (cachedRoot && cachedRoot !== root) { db.close(); fail('vault_cache_root_mismatch'); }
  if (!cachedRoot) db.prepare('INSERT INTO cache_meta(root) VALUES(?)').run(root);
  db.function('notara_cjk', { deterministic: true }, cjkTokens);
  // Rebuildable-cache migrations use existing source projections, never reread
  // every Vault file on a read request or invent missing historical evidence.
  const columns = new Set(db.prepare('PRAGMA table_info(documents)').all().map(row => row.name));
  if (!columns.has('last_result')) {
    db.exec(`ALTER TABLE documents ADD COLUMN last_result TEXT;
      ALTER TABLE documents ADD COLUMN independent_review_count INTEGER NOT NULL DEFAULT 0;
      UPDATE documents SET last_result=(SELECT CASE WHEN json_extract(value,'$.result') IN ('done','missed','unchecked') THEN json_extract(value,'$.result') END FROM json_each(json_extract(frontmatter_json,'$.review_history')) WHERE coalesce(json_extract(value,'$.revertedAt'),'')='' ORDER BY key DESC LIMIT 1),
      independent_review_count=(SELECT count(*) FROM json_each(json_extract(frontmatter_json,'$.review_history')) WHERE coalesce(json_extract(value,'$.revertedAt'),'')='' AND json_extract(value,'$.result')='done' AND json_extract(value,'$.support')='independent') WHERE type IN ('card','concept','method','exercise');`);
  }
  if (!db.prepare('PRAGMA table_info(documents_fts)').all().some(row => row.name === 'cjk')) {
    db.exec(`BEGIN;
      ALTER TABLE documents_fts RENAME TO documents_fts_old;
      CREATE VIRTUAL TABLE documents_fts USING fts5(path,title,tags,body,cjk,tokenize='unicode61');
      INSERT INTO documents_fts(rowid,path,title,tags,body,cjk) SELECT d.rowid,f.path,f.title,f.tags,f.body,notara_cjk(f.path||' '||f.title||' '||f.tags||' '||f.body) FROM documents_fts_old f JOIN documents d ON d.path=f.path;
      DROP TABLE documents_fts_old;
      COMMIT;`);
  }
  if (!db.prepare('PRAGMA table_info(cache_meta)').all().some(row => row.name === 'projection_version')) db.exec('ALTER TABLE cache_meta ADD COLUMN projection_version INTEGER NOT NULL DEFAULT 0');
  if (!db.prepare('PRAGMA table_info(links)').all().some(row => row.name === 'target_exact')) db.exec('ALTER TABLE links ADD COLUMN target_exact INTEGER NOT NULL DEFAULT 0');
  for (const name of ['relation_kind','relation_context','relation_description','relation_evidence']) if (!db.prepare('PRAGMA table_info(links)').all().some(row => row.name === name)) db.exec(`ALTER TABLE links ADD COLUMN ${name} TEXT NOT NULL DEFAULT ''`);
  if(!db.prepare('PRAGMA table_info(tasks)').all().some(row=>row.name==='hidden'))db.exec('ALTER TABLE tasks ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0');
  for(const [name,type] of [['review_stage','INTEGER'],['review_issue','TEXT'],['body_line','INTEGER']])if(!db.prepare('PRAGMA table_info(documents)').all().some(row=>row.name===name))db.exec(`ALTER TABLE documents ADD COLUMN ${name} ${type}`);
  if (db.prepare('SELECT projection_version FROM cache_meta LIMIT 1').get().projection_version < 14) {
    // Re-index Markdown once when projection rules evolve (including code-example
    // exclusion, card types, and guide/route/lesson/template separation), while
    // retaining metadata skipping on subsequent opens.
    db.exec('BEGIN; UPDATE documents SET mtime_ms=-1 WHERE lower(path) LIKE \'%.md\'; UPDATE cache_meta SET projection_version=14; COMMIT;');
  }
  let closed = false, watcher = null, watching = null;
  const changes = createVaultChanges();
  let transactionChanges = null;
  const metrics = { scans: 0, stats: 0, fileReads: 0, indexed: 0 };
  const errors = new Map();
  const documentCache = new Map();
  const graphCache = new Map();
  let linkSnapshot = null;
  let knowledgeSnapshot = null;
  const documentColumns = `d.path,d.mtime_ms,d.revision,d.title,d.type,d.tags_json,d.review_due,d.review_count,d.last_support,d.summary,d.last_result,d.independent_review_count,d.review_stage,d.review_issue,d.is_guide,d.frontmatter_json`;
  const copyDocument = value => ({ ...value, tags: [...value.tags],reviewPlans:(value.reviewPlans??[]).map(plan=>({...plan})), knowledgeTags: value.knowledgeTags.map(tag => ({ ...tag })), unresolvedKnowledgeTags: value.unresolvedKnowledgeTags.map(tag => ({ ...tag })) });
  const copyGraph = value => ({ relationsVersion: 2, nodes: value.nodes.map(node => ({ ...copyDocument(node), sourcePaths:[...(node.sourcePaths??[])] })), edges: value.edges.map(edge => ({ ...edge, declarations: edge.declarations.map(row => ({ ...row })) })) });
  const statements = new Map();
  function statement(sql) { if (closed) fail('vault_closed'); if (!statements.has(sql)) statements.set(sql, db.prepare(sql)); return statements.get(sql); }
  const today = () => civilDay(new Date(now()));
  const isOwnCache = path => cachePath !== ':memory:' && [cachePath, cachePath + '-wal', cachePath + '-shm', cachePath + '-journal'].includes(resolve(root, path));
  function checkedTarget(path, createParents = false, validate = safeRelativePath) {
    if (closed) fail('vault_closed');
    validate(path);
    if (isOwnCache(path)) fail('vault_path_invalid');
    if (realpathSync(root) !== root) fail('vault_path_invalid');
    let current = root;
    let finalStat = null;
    const parts = path.split('/');
    for (const [i, part] of parts.entries()) {
      current = join(current, part);
      let stat;
      try { stat = lstatSync(current); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (createParents && i < parts.length - 1) { mkdirSync(current); stat = lstatSync(current); }
        else if (i < parts.length - 1) throw error;
        else return { full: current, stat: null };
      }
      if (stat.isSymbolicLink() || (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile() || stat.nlink > 1)) fail('vault_path_invalid');
      if (i === parts.length - 1) finalStat = stat;
    }
    return { full: current, stat: finalStat };
  }
  function checkedPath(path, createParents = false) { return checkedTarget(path, createParents).full; }
  function bytes(path, max = 64 * 1024 * 1024, checked = null) {
    const { full } = checked ?? checkedTarget(path), fd = openSync(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink > 1) fail('vault_path_invalid');
      if (stat.size > max) fail('vault_content_too_large');
      metrics.fileReads++;
      return { data: readFileSync(fd), stat };
    } finally { closeSync(fd); }
  }
  function pdfRevision(checked) {
    const { full } = checked, fd = openSync(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink > 1) fail('vault_path_invalid');
      const digest = createHash('sha256'), chunk = Buffer.allocUnsafe(1024 * 1024);
      let length;
      metrics.fileReads++;
      while ((length = readSync(fd, chunk, 0, chunk.length, null)) > 0) digest.update(chunk.subarray(0, length));
      return { revision: digest.digest('hex'), stat };
    } finally { closeSync(fd); }
  }
  function remove(path) {
    const row = statement('SELECT rowid FROM documents WHERE path=?').get(path);
    errors.delete(path);
    if (!row) return;
    statement('DELETE FROM documents_fts WHERE rowid=?').run(row.rowid);
    for (const [table, key] of [['documents', 'path'], ['tasks', 'path'], ['links', 'source_path'],['source_regions','source_path']]) statement(`DELETE FROM ${table} WHERE ${key}=?`).run(path);
    errors.delete(path);
    documentCache.clear();
    graphCache.clear();
    linkSnapshot = null;
    knowledgeSnapshot = null;
    if (row) transactionChanges?.set(path, null);
  }
  function update(path, force = false) {
    if (closed) fail('vault_closed');
    let stat, target;
    try { target = checkedTarget(path, false, safeWorkspaceRelativePath); stat = target.stat; if (!stat) { remove(path); return false; } }
    catch (error) { if (error.code === 'ENOENT' || error.message === 'vault_path_invalid') { remove(path); return false; } throw error; }
    metrics.stats++;
    const previous = statement('SELECT rowid,mtime_ms,size,revision FROM documents WHERE path=?').get(path);
    const metadataRevision = isVaultFormat(path) ? null : hash(JSON.stringify([path, stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino]));
    if (!force && previous?.mtime_ms === stat.mtimeMs && previous.size === stat.size && (!metadataRevision || previous.revision === metadataRevision)) return false;
    let item, revision;
    if (!isVaultFormat(path)) {
      // Register ordinary files without reading or interpreting their contents.
      revision = metadataRevision;
      item = { fields: {}, title: basename(path), type: 'file', tags: [], reviewDue: null, reviewCount: 0, lastSupport: null, lastResult: null, independentReviewCount: 0, summary: '', guide: false, links: [], tasks: [], text: '' };
    } else if (extname(path).toLowerCase() === '.pdf') {
      // Index large originals in bounded chunks, independent of full-read limits.
      const file = pdfRevision(target); stat = file.stat; revision = file.revision; item = parseText(path, '');
    } else if (IMAGE_MIME[extname(path).toLowerCase()]) {
      const file = bytes(path, 64 * 1024 * 1024, target); stat = file.stat; revision = hash(file.data); item = parseText(path, '');
    } else { const file = bytes(path, 8 * 1024 * 1024, target); stat = file.stat; revision = hash(file.data); item = parseText(path, extname(path).toLowerCase() === '.base' ? new TextDecoder('utf-8', { fatal: true }).decode(file.data) : file.data.toString('utf8')); }
    const saved = statement('INSERT OR REPLACE INTO documents(path,mtime_ms,size,revision,title,type,tags_json,frontmatter_json,review_due,review_count,last_support,summary,is_guide,last_result,independent_review_count,review_stage,review_issue,body_line) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(path, stat.mtimeMs, stat.size, revision, item.title, item.type, JSON.stringify(item.tags), JSON.stringify(item.fields), item.reviewDue, item.reviewCount, item.lastSupport, item.summary, +item.guide, item.lastResult, item.independentReviewCount, item.reviewStage??null, item.reviewIssue??null, item.bodyLine??0);
    if (previous) statement('DELETE FROM documents_fts WHERE rowid=?').run(previous.rowid);
    statement('INSERT INTO documents_fts(rowid,path,title,tags,body,cjk) VALUES(?,?,?,?,?,?)').run(saved.lastInsertRowid, path, item.title, item.tags.join(' '), item.text, cjkTokens([path, item.title, ...item.tags, item.text].join(' ')));
    if (previous) statement('DELETE FROM links WHERE source_path=?').run(path);
    for (const link of item.links) statement('INSERT INTO links(source_path,target_path,section_kind,edge_style,target_exact,relation_kind,relation_context,relation_description,relation_evidence) VALUES(?,?,?,?,?,?,?,?,?)').run(path, link.target, link.section, link.style, +link.exact, link.relation?.kind ?? '', link.relation?.context ?? '', link.relation?.description ?? '', link.relation?.evidence ?? '');
    statement('DELETE FROM source_regions WHERE source_path=?').run(path);
    for(const link of item.links)if(link.reference)statement('INSERT OR IGNORE INTO source_regions VALUES(?,?,?)').run(path,link.reference.path,JSON.stringify(link.reference));
    if (previous) statement('DELETE FROM tasks WHERE path=?').run(path);
    for (const task of item.tasks) statement('INSERT INTO tasks VALUES(?,?,?,?,?)').run(path, task.line, +task.checked, task.text,+task.hidden);
    metrics.indexed++; errors.delete(path); graphCache.clear(); documentCache.clear(); linkSnapshot = null; knowledgeSnapshot = null;
    if (!previous || previous.revision !== revision || previous.mtime_ms !== stat.mtimeMs) transactionChanges?.set(path, revision);
    return true;
  }
  function transaction(fn) {
    db.exec('BEGIN');
    const pending = new Map(); transactionChanges = pending;
    let value;
    try { value = fn(); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
    finally { transactionChanges = null; }
    changes.publish([...pending].map(([path, revision]) => ({ path, revision })));
    return value;
  }
  function scan() {
    if (closed) fail('vault_closed');
    metrics.scans++;
    const seen = new Set(), pending = [''];
    transaction(() => {
      while (pending.length) {
        const dir = pending.pop();
        for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
          if (ignoredPart(entry.name) || entry.isSymbolicLink()) continue;
          const path = dir ? `${dir}/${entry.name}` : entry.name;
          if (entry.isDirectory()) { pending.push(path); continue; }
          if (!entry.isFile() || isOwnCache(path)) continue;
          seen.add(path);
          try { update(path); } catch (error) { remove(path); errors.set(path, error.message); onError(error); }
        }
      }
      for (const { path } of statement('SELECT path FROM documents').all()) if (!seen.has(path)) remove(path);
    });
    return { indexed: seen.size, errors: [...errors].map(([path, error]) => ({ path, error })) };
  }
  function knowledgeProjection() {
    if (knowledgeSnapshot) return knowledgeSnapshot;
    const rows = statement("SELECT path,type,is_guide,tags_json,coalesce(json_extract(frontmatter_json,'$.template'),0) AS is_template FROM documents").all();
    const resolver = createRelationResolver(rows), documents = new Map();
    // This table is a disposable query projection. Target moves/type changes
    // invalidate all references, without reading or editing the source files.
    // A rebuild is one projection write, not thousands of disk commits. A
    // savepoint also preserves callers that already hold a file transaction.
    db.exec('SAVEPOINT knowledge_projection');
    try {
      statement('DELETE FROM knowledge_tags').run();
      for (const row of rows) {
        const projected = projectKnowledgeTags(JSON.parse(row.tags_json), resolver.resolveTag);
        documents.set(row.path, projected);
        for (const tag of projected.knowledgeTags) statement('INSERT INTO knowledge_tags VALUES(?,?,?,?)').run(row.path, tag.raw, tag.target, tag.label);
      }
      db.exec('RELEASE knowledge_projection');
    } catch (error) { db.exec('ROLLBACK TO knowledge_projection; RELEASE knowledge_projection'); throw error; }
    return knowledgeSnapshot = { resolver, documents };
  }
  function dto(row, withTasks = false, day = today(), copy = true) {
    const cached = documentCache.get(row.path);
    if (!withTasks && cached?.revision === row.revision && cached.day === day && cached.mtimeMs === row.mtime_ms) return copy ? copyDocument(cached.value) : cached.value;
    const tags = JSON.parse(row.tags_json), knowledge = knowledgeProjection();
    const value = { path: row.path, title: row.title, type: row.type, isGuide: !!row.is_guide, tags, revision: row.revision,
      ...(knowledge.documents.get(row.path) ?? projectKnowledgeTags(tags, knowledge.resolver.resolveTag)),
      reviewDue: row.review_due, reviewStage:row.review_stage, reviewIssue:row.review_issue, reviewCount: row.review_count, lastSupport: row.last_support, lastResult: row.last_result, independentReviewCount: row.independent_review_count, summary: row.summary, mtimeMs: row.mtime_ms,
      reviewPlans:reviewProjection(JSON.parse(row.frontmatter_json),row.path).reviewPlans,
      reviewStatus: !isReviewDocument(row.type,row.path) ? null : row.review_issue ? 'needs-review' : !row.review_due ? 'pending' : row.review_due <= day ? 'due' : row.review_stage===null?'scheduled':row.review_stage >= 4 ? 'familiar' : 'learning',
      ...(withTasks ? { tasks: statement('SELECT line,checked,text FROM tasks WHERE path=? AND hidden=0 ORDER BY line').all(row.path).map(task => ({ ...task, checked: !!task.checked })) } : {}) };
    if (!withTasks) documentCache.set(row.path, { value, day, revision: row.revision, mtimeMs: row.mtime_ms });
    return copy ? copyDocument(value) : value;
  }
  function query(input = {}) {
    inputObject(input);
    if(input.referencesTo!==undefined){
      if(Object.keys(input).some(key=>!['referencesTo','offset','limit'].includes(key)))fail('vault_input_invalid');
      safeWorkspaceRelativePath(input.referencesTo);
      const limit=input.limit??100,offset=input.offset??0;
      if(!Number.isSafeInteger(limit)||limit<1||limit>200||!Number.isSafeInteger(offset)||offset<0)fail('vault_input_invalid');
      const targets=[input.referencesTo], short=input.referencesTo.replace(/\.md$/i,'');
      if(short!==input.referencesTo && referenceCandidates(short).includes(input.referencesTo) && !statement('SELECT 1 FROM documents WHERE path=?').get(short))targets.push(short);
      const from=`FROM source_regions r JOIN documents d ON d.path=r.source_path WHERE r.target_path IN (${targets.map(()=>'?').join(',')})`;
      const rows=statement(`SELECT d.path,d.title,d.revision,r.locator_json ${from} ORDER BY d.path,r.locator_json LIMIT ? OFFSET ?`).all(...targets,limit,offset);
      return {references:rows.map(row=>({path:row.path,title:row.title,revision:row.revision,reference:{...JSON.parse(row.locator_json),path:input.referencesTo}})),total:statement(`SELECT count(*) AS total ${from}`).get(...targets).total,offset,limit};
    }
    if (input.facet !== undefined) {
      if (input.facet !== 'tags' || Object.keys(input).some(key => !['facet','search','limit','offset'].includes(key))) fail('vault_input_invalid');
      const search = input.search ?? '', limit = input.limit ?? 40, offset = input.offset ?? 0;
      if (typeof search !== 'string' || search.length > 500 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200 || !Number.isSafeInteger(offset) || offset < 0) fail('vault_input_invalid');
      // Resolve against cached document metadata, never file reads. Search admits
      // a whole identity group: matching one alias must not reduce its count to
      // only documents that used that spelling. Paginate after aggregation.
      knowledgeProjection();
      const facets = `WITH tag_entries AS (
        SELECT d.path,tag.value AS raw,
          CASE WHEN k.target_path IS NULL THEN tag.value ELSE '[['||k.target_path||']]' END AS value,
          k.target_path AS target,
          CASE WHEN k.target_path IS NOT NULL THEN coalesce(nullif(trim(entity.title),''),k.target_path) END AS label
        FROM documents d,json_each(d.tags_json) tag
        LEFT JOIN knowledge_tags k ON k.source_path=d.path AND k.raw=tag.value
        LEFT JOIN documents entity ON entity.path=k.target_path
        WHERE tag.type='text' AND trim(tag.value)<>''
      ), facets AS (
        SELECT value,target,label,count(DISTINCT path) AS count FROM tag_entries
        GROUP BY value,target,label
        HAVING max(instr(lower(raw),lower(?))>0 OR instr(lower(value),lower(?))>0 OR instr(lower(coalesce(label,'')),lower(?))>0)
      )`;
      const term = search.trim().replace(/^#/, '');
      const total = statement(`${facets} SELECT count(*) AS total FROM facets`).get(term,term,term).total;
      const rows = statement(`${facets} SELECT value,count,label,target FROM facets ORDER BY value COLLATE NOCASE,value LIMIT ? OFFSET ?`).all(term,term,term,limit,offset);
      const values = rows.map(({value,count,label,target}) => ({value,count,...(target ? {label,target} : {})}));
      return {facet:'tags',values,total,offset,limit};
    }
    let baseRecord, config, baseView;
    if (input.base !== undefined) {
      inputObject(input.base);
      if (typeof input.base.path !== 'string' || !input.base.path.toLowerCase().endsWith('.base')) fail('vault_input_invalid');
      baseRecord = read({ path: input.base.path });
      if (input.base.expectedRevision !== undefined && input.base.expectedRevision !== baseRecord.revision) fail('vault_base_revision_conflict');
      config = input.base.path===DEFAULT_BASE_PATH?learningReviewBase(parseBase(baseRecord.content)):parseBase(baseRecord.content);
      baseView = evaluateBase(config, [], input.base.view ?? 0, { today: today() }).view;
      if (input.sort) baseView.sort = sortForBase(input.sort);
    }
    const where = [], args = [];
    const sourcePath = input.sourcePath ?? baseView?.notara?.sourcePath;
    const sourcesOnly = input.view === 'sources' || baseView?.notara?.scope === 'sources';
    if (sourcePath !== undefined) safeWorkspaceRelativePath(sourcePath);
    if (sourcesOnly || sourcePath !== undefined) {
      const { originalSources, origins } = resolvedLinks();
      const paths = sourcePath !== undefined
        ? [...origins].filter(([, sources]) => sources.has(sourcePath)).map(([path]) => path)
        : [...originalSources];
      // Use the same provenance as the graph, before Base/filter/paging. A JSON
      // parameter avoids SQLite's variable limit for large learning sets.
      where.push('d.path IN (SELECT value FROM json_each(?))'); args.push(JSON.stringify(paths));
    }
    if (input.paths !== undefined) {
      if (!Array.isArray(input.paths) || !input.paths.length || input.paths.length > 100) fail('vault_input_invalid');
      input.paths.forEach(safeWorkspaceRelativePath);
      where.push(`d.path IN (${input.paths.map(() => '?').join(',')})`); args.push(...input.paths);
    }
    if (input.type) {
      if (typeof input.type !== 'string') fail('vault_input_invalid');
      if (input.type === 'card') where.push("d.type IN ('card','concept','method','exercise')");
      else if (['guide','plan'].includes(input.type)) where.push("(d.is_guide=1 OR d.type='guide')");
      else { where.push('d.type=?'); args.push(input.type); }
    }
    if (input.view === 'guides') where.push("(d.is_guide=1 OR d.type='guide')");
    if (input.view === 'routes') where.push("d.type='route'");
    if (input.view === 'lessons') where.push("d.type='lesson'");
    if (input.view === 'routes' || input.view === 'lessons') {
      where.push("coalesce(json_extract(d.frontmatter_json,'$.template'),0)!=1", "d.path NOT LIKE '模板/%'");
    }
    if (input.view === 'review') where.push("(d.type IN ('card','concept','method','exercise','diary') OR d.type='note' AND d.path LIKE '日记/%.md')");
    if (input.tags !== undefined && (!Array.isArray(input.tags) || input.tags.length > 32 || input.tags.some(tag => typeof tag !== 'string'))) fail('vault_input_invalid');
    if (input.tagMatch !== undefined && !['all','any'].includes(input.tagMatch)) fail('vault_input_invalid');
    if (input.tags?.length) {
      const projection = knowledgeProjection();
      const checks=input.tags.map(tag=>{
        const target = projection.resolver.resolveTag(tag).target;
        if (target) { args.push(target); return 'EXISTS(SELECT 1 FROM knowledge_tags k WHERE k.source_path=d.path AND k.target_path=?)'; }
        args.push(tag.replace(/^#/,'')); return 'EXISTS(SELECT 1 FROM json_each(d.tags_json) WHERE value=?)';
      });
      where.push('('+checks.join(input.tagMatch==='any'?' OR ':' AND ')+')');
    }
    if (input.minReviews !== undefined) { if (!Number.isInteger(input.minReviews) || input.minReviews < 0) fail('vault_input_invalid'); where.push('d.review_count>=?'); args.push(input.minReviews); }
    if (input.reviewStatus && input.reviewStatus !== 'all') {
      where.push("(d.type IN ('card','concept','method','exercise','diary') OR d.type='note' AND d.path LIKE '日记/%.md')");
      const statuses = { due: 'd.review_due<=?', scheduled: 'd.review_due>?', new: 'd.review_due IS NULL AND d.review_issue IS NULL', pending: 'd.review_due IS NULL AND d.review_issue IS NULL', learning: "d.review_due IS NOT NULL AND d.review_stage<4", familiar: "d.review_stage>=4", 'needs-review':'d.review_issue IS NOT NULL' };
      if (!Object.hasOwn(statuses, input.reviewStatus)) fail('review_status_invalid'); where.push(statuses[input.reviewStatus]); if (input.reviewStatus === 'due' || input.reviewStatus === 'scheduled') args.push(today());
    }
    if (input.q !== undefined && typeof input.q !== 'string') fail('vault_input_invalid');
    for (const search of [baseView?.notara?.search, input.q].filter(text => text?.trim())) {
      const terms = search.trim().split(/\s+/).slice(0, 20), chinese = terms.filter(term => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(term));
      const fts = terms.flatMap(term => chinese.includes(term) ? cjkTokens(term).split(' ') : [term]).filter(Boolean).map(term => `"${term.replaceAll('"', '""')}"*`).join(' AND ');
      where.push(`d.path IN(SELECT path FROM documents_fts WHERE documents_fts MATCH ?${chinese.map(() => " AND instr(path||' '||title||' '||tags||' '||body,?)>0").join('')})`); args.push(fts, ...chinese);
    }
    const sorts = { title: 'd.title COLLATE NOCASE,d.path', path: 'd.path', updated: 'd.mtime_ms DESC,d.path', mtime: 'd.mtime_ms DESC,d.path', due: 'd.review_due IS NULL,d.review_due,d.path', reviewCount: 'd.review_count DESC,d.path' };
    if (input.sortDirection !== undefined && !['ASC','DESC'].includes(input.sortDirection)) fail('vault_sort_invalid');
    if (input.sortDirection === 'DESC') sorts.title = 'd.title COLLATE NOCASE DESC,d.path DESC';
    if (input.sort && !Object.hasOwn(sorts, input.sort)) fail('vault_sort_invalid');
    const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const total = statement(`SELECT count(*) AS total FROM documents d${clause}`).get(...args).total;
    const limit = input.limit ?? 500, offset = input.offset ?? 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > 10000 || !Number.isInteger(offset) || offset < 0) fail('vault_input_invalid');
    if (config) {
      const candidates = statement(`SELECT ${documentColumns},d.frontmatter_json,d.is_guide FROM documents d${clause} ORDER BY d.path`).all(...args).map(row => ({ ...dto(row), frontmatter: JSON.parse(row.frontmatter_json), isGuide: !!row.is_guide }));
      const result = evaluateBase(config, candidates, input.base.view ?? 0, { today: today(), resolveKnowledgeTag: knowledgeProjection().resolver.resolveTag });
      const properties = result.properties.map(property => ({ property, label: config.properties?.[property]?.displayName ?? property }));
      const documents = result.rows.slice(offset, offset + limit).map(document => {
        const { frontmatter, ...dto } = document;
        const viewReviewPlans=isReviewView(baseView)?reviewPlansForView(config,document,input.base.view??0,{today:today(),resolveKnowledgeTag:knowledgeProjection().resolver.resolveTag}):undefined;
        // Card descriptions are explicit source metadata, never body excerpts.
        const cardSummary = typeof frontmatter.summary === 'string' ? frontmatter.summary.replace(/\s+/g,' ').trim() : '';
        return { ...dto,...viewReviewPlans?{viewReviewPlans}:{}, cardSummary, propertyKeys:Object.keys(frontmatter), properties: Object.fromEntries(result.properties.map(property => [property, basePropertyValue(document, property)])), group: baseView.groupBy ? basePropertyValue(document, baseView.groupBy.property) : null };
      });
      const fields = new Set();
      for (const document of candidates) for (const [key,value] of Object.entries(document.frontmatter)) {
        if (value == null || ['string','number','boolean'].includes(typeof value) || (Array.isArray(value) && value.every(item => item == null || ['string','number','boolean'].includes(typeof item)))) fields.add(key);
      }
      const availableProperties = [...fields].sort().map(key => ({property:/^[\p{L}_][\p{L}\p{N}_-]*$/u.test(key) ? 'note.'+key : `note[${JSON.stringify(key)}]`, label:key}));
      return { documents, total: result.rows.length, scopePaths:result.rows.map(document=>document.path), properties, availableProperties, baseRevision: baseRecord.revision };
    }
    const rows = statement(`SELECT ${documentColumns},d.frontmatter_json FROM documents d${clause} ORDER BY ${sorts[input.sort] ?? sorts.title} LIMIT ? OFFSET ?`).all(...args, limit, offset), day = today();
    const withTasks = ['guides', 'routes', 'lessons'].includes(input.view);
    return { documents: rows.map(row => {
      const document = dto(row, withTasks, day);
      if (!sourcesOnly && sourcePath === undefined) return document;
      const frontmatter = JSON.parse(row.frontmatter_json);
      return {...document, propertyKeys:Object.keys(frontmatter), properties:{'file.name':document.title,'note.tags':frontmatter.tags ?? null}};
    }), total };
  }
  function resolvedLinks(knownPaths) {
    if (linkSnapshot) return linkSnapshot;
    const projection = knowledgeProjection(), { metadata, resolvePath } = projection.resolver;
    const paths = new Set(knownPaths ?? metadata.keys()), relations = new Map(), origins = new Map(), evidence = [];
    const regions=new Set(statement('SELECT source_path,target_path FROM source_regions').all().map(row=>row.source_path+'\0'+row.target_path));
    const sourceEligible=path=>isLearningDocument(metadata.get(path));
    const declaredSources=new Set([...paths].filter(path=>sourceEligible(path)&&['source','pdf'].includes(metadata.get(path)?.type)));
    const originalSources=new Set(declaredSources);
    let byName = null;
    function referenceTarget(row) {
      let target = null;
      const names = referenceCandidates(row.target_path);
      for (const name of names) {
        if (row.target_exact || name.includes('/')) { if (paths.has(name)) target = name; }
        else {
          const folder = row.source_path.includes('/') ? row.source_path.slice(0, row.source_path.lastIndexOf('/') + 1) : '';
          const local = folder + name;
          if (paths.has(local)) target = local;
          else {
            if (!byName) { byName = new Map(); for (const path of paths) { const name = basename(path); if (!byName.has(name)) byName.set(name, []); byName.get(name).push(path); } }
            const candidates = byName.get(name) ?? []; if (candidates.length === 1) target = candidates[0];
          }
        }
        if (target) break;
      }
      return target;
    }
    const knowledgePair = (source, target) => [source, target].every(path => sourceEligible(path) && isCardType(metadata.get(path)?.type));
    function add(kind, source, target, context, row, knowledge, state = '') {
      const identity = relationIdentity(kind, source, target, context);
      let edge = relations.get(identity.id);
      if (!edge) {
        edge = { ...identity, style: 'dashed', knowledge, sectionKind: row.section_kind, description: '', declarations: [] };
        relations.set(identity.id, edge);
      }
      const declaration = { path: row.source_path, sectionKind: row.section_kind, description: row.relation_description ?? '', style: state ? row.edge_style : 'dashed' };
      if (!edge.declarations.some(item => JSON.stringify(item) === JSON.stringify(declaration))) edge.declarations.push(declaration);
      edge.description = [...new Set(edge.declarations.map(item => item.description).filter(Boolean))].join('\n');
      if (state && knowledge) {
        if (row.section_kind === '学生理解/待探索的联系') { edge.style = 'dashed'; edge.sectionKind = row.section_kind; }
        else if (edge.sectionKind !== '学生理解/待探索的联系') { edge.style = row.edge_style; edge.sectionKind = row.section_kind; }
      }
      return edge;
    }
    for (const row of statement('SELECT * FROM links').all()) {
      const semantic = row.relation_kind && row.relation_evidence !== 'legacy';
      const resolved = semantic ? resolvePath(row.target_path, !!row.target_exact).target : null;
      const target = resolved ?? referenceTarget(row);
      if (!paths.has(row.source_path) || !target || !paths.has(target)) continue;
      const explicitSource=regions.has(row.source_path+'\0'+row.target_path)||['来源','原始资料','原文'].includes(row.section_kind);
      const provenance=explicitSource||row.section_kind==='内容';
      const learningSource=sourceEligible(row.source_path)&&isCardType(metadata.get(row.source_path)?.type);
      const inferredSource=explicitSource&&sourceEligible(target)&&['file','image','note'].includes(metadata.get(target)?.type);
      const sourceRelation = learningSource&&provenance&&(declaredSources.has(target)||inferredSource);
      if(sourceRelation){
        originalSources.add(target);
        if(!origins.has(row.source_path))origins.set(row.source_path,new Set());
        origins.get(row.source_path).add(target);
      }
      const knowledge = knowledgePair(row.source_path, target);
      const kind = row.relation_kind;
      const allowed = (!semantic || resolved) && (kind === 'prerequisite'
        ? [row.source_path, target].every(path => isKnowledgeEntity(metadata.get(path)))
        : kind === 'example' ? isExampleDocument(metadata.get(row.source_path)) && isKnowledgeEntity(metadata.get(target))
        : kind === 'association' && knowledge);
      if (allowed) {
        const source = ['prerequisite', 'example'].includes(kind) ? target : row.source_path;
        const end = ['prerequisite', 'example'].includes(kind) ? row.source_path : target;
        if (row.relation_evidence === 'qualified') evidence.push({ kind, source, target: end, row });
        else add(kind, source, end, row.relation_context, row, knowledge, row.relation_evidence);
      } else add(sourceRelation ? 'source' : 'reference', row.source_path, target, '', row, sourceRelation ? false : knowledge);
    }
    for (const [path, projected] of projection.documents) {
      if (!isExampleDocument(metadata.get(path))) continue;
      for (const tag of projected.knowledgeTags) add('example', tag.target, path, '', { source_path: path, section_kind: 'tags', relation_description: tag.raw }, true);
    }
    // Qualified personal statements can color only an existing relation. They
    // cannot manufacture prerequisites or attach an untagged example.
    for (const item of evidence) {
      const { kind, source, target, row } = item;
      if (relations.has(relationIdentity(kind, source, target, row.relation_context).id)) add(kind, source, target, row.relation_context, row, true, 'qualified');
      else add('reference', row.source_path, source === row.source_path ? target : source, '', row, knowledgePair(source, target));
    }
    return linkSnapshot = { edges: [...relations.values()].sort((a, b) => Number(b.style === 'solid') - Number(a.style === 'solid')), adjacent: null, origins, originalSources };
  }
  function adjacency(links) {
    if (links.adjacent) return links.adjacent;
    const adjacent = new Map();
    for (const edge of links.edges) {
      if (!adjacent.has(edge.source)) adjacent.set(edge.source, new Set());
      if (!adjacent.has(edge.target)) adjacent.set(edge.target, new Set());
      adjacent.get(edge.source).add(edge.target); adjacent.get(edge.target).add(edge.source);
    }
    return links.adjacent = adjacent;
  }
  function graph(input = {}) {
    inputObject(input);
    if(input.compact!==undefined&&typeof input.compact!=='boolean')fail('vault_input_invalid');
    const compact=input.compact===true,copy=compact?copyCompactGraph:copyGraph;
    const hops = input.hops ?? 1;
    if (!Number.isInteger(hops) || hops < 0 || hops > 5) fail('vault_input_invalid');
    const tags = input.tagFilter === undefined ? [] : Array.isArray(input.tagFilter) ? input.tagFilter : [input.tagFilter];
    if (tags.some(tag => typeof tag !== 'string')) fail('vault_input_invalid');
    if(input.tagMatch!==undefined&&!['all','any'].includes(input.tagMatch))fail('vault_input_invalid');
    const day = today(), cacheKey = JSON.stringify([day, input.focusPath ?? null, hops, tags, input.tagMatch || 'all',compact]);
    if (closed) fail('vault_closed');
    if (graphCache.has(cacheKey)) return copy(graphCache.get(cacheKey));
    const columns=compact?'d.path,d.title,d.type,d.tags_json,d.revision,d.independent_review_count,d.is_guide':documentColumns;
    let rows, links;
    if (input.focusPath) {
      safeWorkspaceRelativePath(input.focusPath);
      links = resolvedLinks(); const adjacent = adjacency(links);
      const selected = new Set([input.focusPath]); let frontier = [input.focusPath];
      for (let depth = 0; depth < hops; depth++) { const next = []; for (const path of frontier) for (const neighbor of adjacent.get(path) ?? []) if (!selected.has(neighbor)) { selected.add(neighbor); next.push(neighbor); } frontier = next; }
      rows = statement(`SELECT ${columns} FROM documents d WHERE d.path IN (${[...selected].map(() => '?').join(',')}) ORDER BY d.path`).all(...selected);
    } else { rows = statement(`SELECT ${columns} FROM documents d ORDER BY d.path`).all(); links = resolvedLinks(rows.map(row => row.path)); }
    const metadata=row=>{if(!compact)return dto(row,false,day,false);const tags=JSON.parse(row.tags_json),knowledge=knowledgeProjection();return {path:row.path,title:row.title,type:row.type,isGuide:!!row.is_guide,tags,revision:row.revision,independentReviewCount:row.independent_review_count,...(knowledge.documents.get(row.path)??projectKnowledgeTags(tags,knowledge.resolver.resolveTag))};};
    const nodes = rows.map(row => ({...metadata(row),isSource:links.originalSources.has(row.path),sourcePaths:[...(links.origins.get(row.path)??[])]})).filter(node => !tags.length || tags[input.tagMatch==='any'?'some':'every'](tag => matchesKnowledgeTag(node, tag, knowledgeProjection().resolver.resolveTag) || node.tags.includes(tag)));
    const paths = new Set(nodes.map(node => node.path));
    const result = { relationsVersion: 2, nodes, edges: links.edges.filter(edge => paths.has(edge.source) && paths.has(edge.target)) };
    if (graphCache.size >= 32) graphCache.delete(graphCache.keys().next().value);
    const value=compact?encodeCompactGraph(result):result;
    graphCache.set(cacheKey, value);
    return copy(value);
  }
  function syncHomeFiles(options = {}) {
    if (!watching) return;
    const candidates = new Set();
    for (const dir of ['路线', '备课']) {
      try {
        for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
          if (ignoredPart(entry.name) || entry.isSymbolicLink() || !entry.isFile() || !/\.md$/i.test(entry.name)) continue;
          candidates.add(`${dir}/${entry.name}`);
        }
      } catch {}
    }
    for (const r of statement("SELECT path FROM documents WHERE type IN ('route','lesson')").all()) candidates.add(r.path);
    for (const b of options.bindings ?? []) { if (typeof b?.path === 'string') candidates.add(b.path); }
    for (const path of candidates) { try { transaction(() => update(path)); } catch {} }
    for (const l of statement("SELECT DISTINCT target_path FROM links WHERE source_path IN (SELECT path FROM documents WHERE type='route')").all()) {
      const literal = isVaultFormat(l.target_path) || statement('SELECT 1 FROM documents WHERE path=?').get(l.target_path);
      const candidate = literal ? l.target_path : `${l.target_path}.md`;
      try { transaction(() => update(candidate)); } catch {}
    }
    try { transaction(() => update(`日记/${today()}.md`)); } catch {}
  }
  function homeRecommendations(options = {}) {
    if (!options.skipSync) syncHomeFiles(options);
    const due = query({ reviewStatus: 'due', sort: 'due', limit: 3 });
    const row = statement(`SELECT ${documentColumns} FROM documents d WHERE is_guide=1 ORDER BY mtime_ms DESC,path LIMIT 1`).get();
    let guide = null;
    if (row) { const document = dto(row, true), nextTask = document.tasks.find(task => !task.checked); guide = { path: row.path, title: row.title, revision: row.revision, completed: document.tasks.filter(task => task.checked).length, total: document.tasks.length, nextTask: nextTask ? { line: nextTask.line, text: nextTask.text } : null }; }
    const docsMeta = new Map(statement("SELECT path,title,revision,type,json_extract(frontmatter_json,'$.status') AS status FROM documents").all().map(item => [item.path, item]));
    const existingPaths = new Set(docsMeta.keys());
    const validSessionIds = options.validSessionIds ?? null;
    const rawBindings = Array.isArray(options.bindings) ? options.bindings : [];
    const continuations = rawBindings
      .filter(b => {
        if (!b || b.missing || typeof b.sessionId !== 'string' || !b.sessionId.trim()) return false;
        if (typeof b.path !== 'string' || !existingPaths.has(b.path)) return false;
        const meta = docsMeta.get(b.path);
        if (meta?.status === 'completed' || meta?.status === 'archived') return false;
        if (validSessionIds && !validSessionIds.has(b.sessionId)) return false;
        return (b.counts?.total > 0 && b.counts.completed < b.counts.total) || Boolean(b.currentTask) || Boolean(b.nextTask);
      })
      .map(b => {
        const meta = docsMeta.get(b.path);
        const total = Number.isSafeInteger(b.counts?.total) && b.counts.total >= 0 ? b.counts.total : 0;
        const completed = Number.isSafeInteger(b.counts?.completed) && b.counts.completed >= 0 ? Math.min(b.counts.completed, total) : 0;
        const inProgress = Number.isSafeInteger(b.counts?.inProgress) && b.counts.inProgress >= 0 ? b.counts.inProgress : 0;
        const pending = Number.isSafeInteger(b.counts?.pending) && b.counts.pending >= 0 ? b.counts.pending : Math.max(0, total - completed - inProgress);
        return {
          sessionId: b.sessionId.trim(),
          path: b.path,
          title: (typeof b.title === 'string' && b.title.trim()) || meta?.title || b.path,
          revision: (typeof b.revision === 'string' && b.revision) || meta?.revision || '',
          progressLabel: typeof b.progressLabel === 'string' ? b.progressLabel : '',
          counts: { total, completed, inProgress, pending },
          currentTask: b.currentTask && Number.isSafeInteger(b.currentTask.line) && typeof b.currentTask.content === 'string'
            ? { line: b.currentTask.line, content: b.currentTask.content }
            : null,
          nextTask: b.nextTask && Number.isSafeInteger(b.nextTask.line) && typeof b.nextTask.content === 'string'
            ? { line: b.nextTask.line, content: b.nextTask.content }
            : null,
        };
      })
      .filter(item => Boolean(item.revision));
    const continuation = continuations[0] ?? null;

    // One active profile owns the explicit list, including an empty list. Do
    // not pick between conflicting owners by unrelated file modification times.
    let teacherRecommendations = null;
    const profiles = statement(`SELECT d.path,d.title,d.revision,d.body_line,f.body
      FROM documents d JOIN documents_fts f ON f.path=d.path
      WHERE d.type='learner-profile' AND d.path NOT LIKE '模板/%'
        AND coalesce(json_extract(d.frontmatter_json,'$.template'),0)!=1
        AND coalesce(nullif(trim(json_extract(d.frontmatter_json,'$.status')),''),'active')='active'
      ORDER BY d.mtime_ms DESC,d.path`).all();
    for (const profile of profiles) {
      const recommendation = projectHomeRecommendations(profile.body, {
        path: profile.path, title: profile.title, revision: profile.revision,
        documentsByPath: docsMeta, validSessionIds, lineOffset: profile.body_line ?? 0,
      });
      if (!recommendation) continue;
      if (teacherRecommendations) { teacherRecommendations = null; break; }
      teacherRecommendations = recommendation;
    }

    const routeContext = options.routeContext;
    if (routeContext !== undefined && (!routeContext || typeof routeContext.sessionId !== 'string' || !routeContext.sessionId.trim())) fail('vault_route_context_invalid');
    const explicitRoute = routeContext?.path === undefined ? null : safeWorkspaceRelativePath(routeContext.path);
    const routeRows = statement(`SELECT ${documentColumns},d.frontmatter_json,d.body_line FROM documents d
      WHERE d.type='route' AND d.path NOT LIKE '模板/%'
        AND coalesce(json_extract(d.frontmatter_json,'$.template'),0)!=1
        AND coalesce(nullif(trim(json_extract(d.frontmatter_json,'$.status')),''),'active')='active'
      ORDER BY mtime_ms DESC,path ${routeContext ? '' : 'LIMIT 1'}`).all();
    const routes = routeRows.map(routeRow => {
      const document = dto(routeRow, true), fields = JSON.parse(routeRow.frontmatter_json);
      const body = statement('SELECT body FROM documents_fts WHERE path=?').get(routeRow.path)?.body ?? '';
      const projection = projectRouteDocument(body, {
        path: routeRow.path,
        title: routeRow.title,
        revision: routeRow.revision,
        frontmatter: fields,
        lineOffset: Number.isInteger(routeRow.body_line) ? routeRow.body_line : null,
        indexedTasks: document.tasks,
        existingPaths,
        documentsByPath: docsMeta,
        validSessionIds,
        bindings: rawBindings,
      });
      return {projection, refs: routeContext ? routeContextReferences(body, {path:routeRow.path, fields, documentsByPath:docsMeta}) : null};
    });
    let route = routes[0]?.projection ?? null, routeSelection = null, routeCandidates = [];
    if (routeContext) {
      const lesson = rawBindings.find(item => item.sessionId === routeContext.sessionId && !item.missing)?.path;
      const associated = routes.filter(item => item.refs.sessions.has(routeContext.sessionId) || lesson && item.refs.lessons.has(lesson));
      const matches = explicitRoute ? routes.filter(item => item.projection.path === explicitRoute) : associated.length ? associated : routes;
      route = matches.length === 1 ? matches[0].projection : null;
      routeSelection = explicitRoute ? route ? 'explicit' : 'unavailable' : associated.length ? route ? 'associated' : 'ambiguous' : routes.length === 1 ? 'single' : routes.length ? 'ambiguous' : 'none';
      if (!route) routeCandidates = (associated.length && !explicitRoute ? associated : routes).map(({projection:{path,title,revision}}) => ({path,title,revision}));
    }

    const revisits = [];
    for (const card of statement(`SELECT d.path,d.title,d.revision,f.body FROM documents d
      JOIN documents_fts f ON f.path=d.path WHERE d.type IN ('card','concept','method','exercise')
        AND d.path NOT LIKE '模板/%' AND coalesce(json_extract(d.frontmatter_json,'$.template'),0)!=1
        AND coalesce(json_extract(d.frontmatter_json,'$.status'),'')!='archived'
      ORDER BY d.mtime_ms DESC,d.path`).all()) {
      const candidate = projectCardRevisit(card.body, { bodyOnly: true });
      if (candidate) revisits.push({ path: card.path, title: card.title, revision: card.revision, ...candidate,
        snippet: candidate.snippet ?? `回看「${card.title}」，现在有什么想追问或换个角度理解的地方？` });
    }
    let followUp = null;
    const recentCandidates = statement(`SELECT d.path,d.title,d.revision,d.type,f.body
      FROM documents d JOIN documents_fts f ON f.path=d.path
      WHERE (d.type IN ('lesson','card','concept','method','exercise') OR d.path LIKE '日记/%.md')
        AND d.path NOT LIKE '模板/%'
        AND coalesce(json_extract(d.frontmatter_json,'$.template'),0)!=1
        AND coalesce(json_extract(d.frontmatter_json,'$.status'),'')!='archived'
      ORDER BY CASE
        WHEN coalesce(json_extract(d.frontmatter_json,'$.status'),'')='archived' THEN 3
        WHEN d.type='lesson' AND coalesce(json_extract(d.frontmatter_json,'$.status'),'')!='completed' THEN 0
        WHEN d.type='lesson' OR d.path LIKE '日记/%.md' THEN 1
        ELSE 2
      END, d.mtime_ms DESC, d.path
      LIMIT 12`).all();
    for (const candidate of recentCandidates) {
      const docKind = candidate.path.startsWith('日记/') ? 'diary' : candidate.type === 'lesson' ? 'lesson' : 'card';
      const extracted = docKind === 'card' ? revisits.find(item => item.path === candidate.path)
        : extractFollowUpSnippet(candidate.body ?? '', docKind, { bodyOnly: true });
      if (extracted) {
        followUp = {
          path: candidate.path,
          title: candidate.title,
          revision: candidate.revision,
          kind: extracted.kind,
          snippet: extracted.snippet,
        };
        break;
      }
    }

    const path = `日记/${today()}.md`;
    return {
      due: { total: due.total, cards: due.documents },
      guide,
      route,
      ...(routeContext ? {routeSelection,routeCandidates} : {}),
      continuation,
      continuations,
      followUp,
      revisits: revisits.slice(0, 12),
      revisitTotal: revisits.length,
      teacherRecommendations,
      diary: { path, exists: !!statement('SELECT 1 FROM documents WHERE path=?').get(path) },
    };
  }
  function read(input) {
    const { path } = inputObject(input), ext = extname(path ?? '').toLowerCase(), binary = ext === '.pdf' || Boolean(IMAGE_MIME[ext]), file = bytes(path, ext === '.pdf' ? 128 * 1024 * 1024 : undefined);
    return { path, content: ext === '.base' ? new TextDecoder('utf-8', { fatal: true }).decode(file.data) : file.data.toString(binary ? 'base64' : 'utf8'), revision: hash(file.data), mimeType: ext === '.base' ? 'application/yaml' : ext === '.pdf' ? 'application/pdf' : IMAGE_MIME[ext] || (['.canvas', '.excalidraw'].includes(ext) ? 'application/json' : 'text/markdown'), ...(binary ? { encoding: 'base64' } : {}) };
  }
  function save(input) {
    const { path, expectedRevision } = inputObject(input);
    let content = input.content;
    if (input.properties !== undefined || input.unsetProperties !== undefined) {
      if (content !== undefined || !/\.md$/i.test(path ?? '') || typeof expectedRevision !== 'string') fail('vault_property_invalid');
      inputObject(input.properties ?? {});
      const entries = Object.entries(input.properties ?? {}), unset=input.unsetProperties ?? [];
      const validKey=key=>typeof key==='string'&&/^[\p{L}_][\p{L}\p{N}_-]{0,100}$/u.test(key)&&!['__proto__','prototype','constructor'].includes(key);
      const scalar = value => value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= 8000);
      if (!Array.isArray(unset)||unset.length>64||unset.some(key=>!validKey(key)||Object.hasOwn(input.properties??{},key))||!entries.length&&!unset.length || entries.length > 64 || entries.some(([key,value]) => !validKey(key) || !(scalar(value) || (Array.isArray(value) && value.length <= 128 && value.every(scalar))))) fail('vault_property_invalid');
      const current = read({path});
      if(current.revision !== expectedRevision) fail('vault_revision_conflict');
      content = patchFields(current.content, {...input.properties,...Object.fromEntries(unset.map(key=>[key,undefined]))});
    }
    if (typeof content !== 'string' || Buffer.byteLength(content) > 8 * 1024 * 1024 || extname(path ?? '').toLowerCase() === '.pdf' || IMAGE_MIME[extname(path ?? '').toLowerCase()]) fail('vault_content_invalid');
    if (expectedRevision !== null && (typeof expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(expectedRevision))) fail('vault_revision_invalid');
    parseText(safeRelativePath(path), content);
    const full = checkedPath(path, true), lock = `${full}.notara-lock`;
    let lockFd;
    try { lockFd = openSync(lock, 'wx', 0o600); } catch (error) { if (error.code === 'EEXIST') fail('vault_locked'); throw error; }
    const temp = join(dirname(full), `.${basename(full)}.${randomUUID()}.tmp`);
    try {
      checkedPath(path);
      let current = null;
      try { current = read({ path }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if ((current?.revision ?? null) !== expectedRevision) fail('vault_revision_conflict');
      const fd = openSync(temp, 'wx', 0o600);
      try { writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
      checkedPath(path);
      // Compare once more immediately before replace to catch external edits during temp write.
      if (expectedRevision !== null && read({ path }).revision !== expectedRevision) fail('vault_revision_conflict');
      if (expectedRevision === null) { try { linkSync(temp, full); } catch (error) { if (error.code === 'EEXIST') fail('vault_revision_conflict'); throw error; } unlinkSync(temp); }
      else renameSync(temp, full);
      // Markdown is already durably saved. A cache failure must not report that
      // the authoritative file write failed; expose projection failure separately.
      try { transaction(() => update(path, true)); }
      catch (error) { errors.set(path, error.message); onError(error); }
      return { path, revision: hash(content) };
    } finally {
      try { unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      closeSync(lockFd); unlinkSync(lock);
    }
  }
  function mutate(input, transform) {
    inputObject(input); const doc = read({ path: input.path });
    if (input.expectedRevision !== undefined && input.expectedRevision !== doc.revision) fail('vault_revision_conflict');
    return save({ path: doc.path, content: transform(doc.content), expectedRevision: doc.revision });
  }
  function recordReview(input) {
    inputObject(input);
    if (input.source !== undefined) {
      const doc = read({ path: input.path });
      // A retry after a lost response must return the committed receipt even
      // with the original revision. Changed confirmations remain conflicts.
      if (recordedProposal(doc.content, input)) return { path: doc.path, revision: doc.revision };
      if (typeof input.expectedRevision !== 'string') fail('vault_revision_required');
    }
    return mutate(input, content => recordReviewContent(content, input, new Date(now())));
  }
  function scheduleReview(input){
    inputObject(input);const doc=read({path:input.path});
    if(recordedSchedule(doc.content,input))return {path:doc.path,revision:doc.revision};
    if(typeof input.expectedRevision!=='string')fail('vault_revision_required');
    return mutate(input,content=>scheduleReviewContent(content,input,new Date(now())));
  }
  function toggleTask(input) {
    if (!Number.isInteger(input?.line) || input.line < 1 || typeof input.checked !== 'boolean') fail('vault_input_invalid');
    return mutate(input, content => {
      if (!parseText(input.path, content).tasks.some(task => task.line === input.line)) fail('vault_task_conflict');
      const lines = content.split('\n'), line = lines[input.line - 1], match = line?.match(/^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s+)(.*?)(\r?)$/);
      const stripped = match ? stripTaskAnchor(match[4]) : null;
      if (!match || input.expectedText !== undefined && input.expectedText !== match[4] && input.expectedText !== stripped.content) fail('vault_task_conflict');
      lines[input.line - 1] = `${match[1]}${input.checked ? 'x' : ' '}${match[3]}${match[4]}${match[5]}`;
      let nextContent = lines.join('\n');
      if (input.checked && stripped?.anchorId && extname(input.path).toLowerCase() === '.md') {
        const parsed = parseMarkdown(nextContent);
        if (parsed.fields?.type === 'lesson' && parsed.fields.current_task === stripped.anchorId) {
          nextContent = patchFields(nextContent, { current_task: undefined });
        }
      }
      return nextContent;
    });
  }
  async function startWatching() {
    if (closed) fail('vault_closed');
    if (watching) return watching;
    watcher = watch(root, { ignoreInitial: true, followSymlinks: false, ignored: path => isOwnCache(relative(root, path)) || relative(root, path).split(/[\\/]/).some(ignoredPart), awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 20 } });
    function event(full) {
      if (closed) return;
      const path = relative(root, full).split('\\').join('/');
      if (isOwnCache(path)) return;
      try { transaction(() => update(path)); } catch (error) { transaction(() => remove(path)); errors.set(path, error.message); onError(error); }
    }
    watcher.on('add', event).on('change', event).on('unlink', event).on('error', onError);
    watching = new Promise((resolveReady, reject) => { watcher.once('ready', () => { try { if (!closed) scan(); resolveReady(); } catch (error) { reject(error); } }); watcher.once('error', reject); });
    return watching;
  }
  async function close() { if (closed) return; closed = true; changes.close(); await watcher?.close(); db.close(); }
  function calendarSources(){
    const rows=statement(`SELECT ${documentColumns},d.frontmatter_json FROM documents d WHERE lower(d.path) LIKE '%.md' ORDER BY d.path LIMIT 10001`).all();
    return {documents:rows.slice(0,10000).map(row=>({...dto(row),tasks:statement('SELECT line,checked,text FROM tasks WHERE path=? AND hidden=0 ORDER BY line').all(row.path).map(task=>({...task,checked:!!task.checked})),frontmatter:JSON.parse(row.frontmatter_json)})),partial:rows.length>10000,invalid:[...errors.keys()]};
  }
  function routeSessionRefs() {
    const ids = new Set();
    // Profile recommendations may link a continuable child with no lesson or
    // route binding. These are candidates only; the host still verifies scope.
    for (const row of statement("SELECT f.body FROM documents d JOIN documents_fts f ON f.path=d.path WHERE d.type IN ('route','learner-profile')").all()) {
      for (const s of extractLineLinks(row.body ?? '').sessions) ids.add(s.sessionId);
    }
    return [...ids];
  }
  const store = { query, graph, homeRecommendations, syncHomeFiles, routeSessionRefs, read, save, toggleTask, calendarSources,...createDrawingSession({read,save,now}),
    recordReview,scheduleReview,
    undoReview: input => mutate(input, content => undoReviewContent(content, new Date(now()), input.expectedRecordId,input.path)),
    changes: signal => changes.subscribe(signal),
    notifyChange: (path, revision = null) => changes.publish([{ path, revision }]),
    scan, update: path => transaction(() => update(path)), startWatching, close, metrics, errors };
  try { scan(); } catch (error) { db.close(); throw error; }
  return store;
}
