import {messagesOf} from './topic-conversations.js';
import {childHandoffRoute} from './handoff-context.js';
const context = text => ({ name: 'notara-learning-context', text, interpolate: false });
const unavailableContext=text=>({...context(text),documents:[],fragments:[text],complete:false});
const unavailable = label => `${label}暂不可读；相关情况仍未知，需要时用 read 核实，不能把读取失败当成没有记录。`;
const source = (path, revision) => `来源：${JSON.stringify({ path, revision })}`;

// Deliberately conservative: unfamiliar sections (including 历史学科基础),
// current evidence and unstructured profiles stay whole. There is no size budget.
function isHistory(title) {
  if (/当前|目前|现阶段|最新|本轮|本课/.test(title)) return false;
  return /^(?:历史(?:记录|证据|学情|快照|版本|回顾|沿革)|归档(?:记录|证据|学情|区)|演进记录|修订(?:记录|历史|日志)|过往记录|旧版画像)(?:$|[\s：:（(与及/])/u.test(title)
    || /^(?:历史|归档|history|archives?|changelog)$/i.test(title);
}

function literalLine(line, state) {
  const text = line.trim();
  if (state.fence) {
    const close = /^(`+|~+)\s*$/.exec(text);
    if (close && close[1][0] === state.fence[0] && close[1].length >= state.fence.length) state.fence = null;
  } else if (state.mathEnd) {
    if (text.includes(state.mathEnd)) state.mathEnd = null;
  } else if (state.comment) {
    if (text.includes('-->')) state.comment = false;
  } else {
    const open = /^(`{3,}|~{3,})/.exec(text);
    if (open) state.fence = open[1];
    else if (text.startsWith('$$') && !/^\$\$[\s\S]+\$\$\s*$/.test(text)) state.mathEnd = '$$';
    else if (text.startsWith('\\[') && !text.includes('\\]')) state.mathEnd = '\\]';
    else if (text.startsWith('<!--')) state.comment = !text.includes('-->');
    else return false;
  }
  return true;
}

export function currentSections(body, lineOffset) {
  const lines = body.split(/(?<=\n)/u), kept = [], omitted = [], state = {};
  let historyLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!literalLine(line, state)) {
      const heading = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (heading) {
        if (historyLevel && heading[1].length <= historyLevel) historyLevel = 0;
        if (!historyLevel && isHistory(heading[2])) {
          historyLevel = heading[1].length;
          omitted.push(lineOffset + i + 1);
        }
      }
      // Treat a complete folded section as one semantic unit, including nested
      // details. Unclosed folds stay intact rather than hiding the remaining text.
      if (/^\s*<details\b/i.test(line)) {
        const detailState = {};
        let depth = 0, end = i, block = '';
        for (; end < lines.length; end++) {
          block += lines[end];
          if (literalLine(lines[end], detailState)) continue;
          const markup = lines[end].replace(/`+[^`]*`+/g, '').replace(/<!--.*?-->/g, '');
          for (const tag of markup.matchAll(/<\s*(\/?)\s*details\b[^>]*>/gi)) depth += tag[1] ? -1 : 1;
          if (depth === 0) break;
        }
        if (depth === 0) {
          const summary = /^\s*<details\b[^>]*>\s*<summary\b[^>]*>([\s\S]*?)<\/summary>/i.exec(block)?.[1]?.trim();
          if (!historyLevel) {
            if (summary && isHistory(summary)) omitted.push(lineOffset + i + 1);
            else kept.push(block);
          }
          i = end;
          continue;
        }
      }
    }
    if (!historyLevel) kept.push(line);
  }
  return { text: kept.join(''), omitted };
}

/** Passive, workspace-bound source context for ordinary native prompt assembly.
 * Reads profiles/route and the coordinator's indexed revisit pointers; no
 * messages, writes, card/diary file sweep or additional model turns. */
export async function readLearningContext(ctx, { agent, scope, signal } = {}) {
  const target = agent ?? scope;
  if (!target || (agent && scope && agent !== scope) || !target.session?.header?.cwd) return null;
  const preset = ctx.get('agentPresets')?.composedPreset?.(target.ctx);
  if (!['notara-teacher', 'notara-coordinator'].includes(preset)) return null;

  const checked = async operation => {
    signal?.throwIfAborted();
    const result = await operation();
    signal?.throwIfAborted();
    return result;
  };
  const checkAbort = error => {
    signal?.throwIfAborted();
    if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') throw error;
  };
  signal?.throwIfAborted();
  const vault = ctx.get('notaraVault'), registry = ctx.get('workspaceRegistry');
  if (!vault?.query || !vault.read || !vault.homeRecommendations || !registry?.resolveByPath) return unavailableContext(unavailable('当前会话的学习情况'));
  let workspace;
  try {
    workspace = await checked(() => registry.resolveByPath(target.session.header.cwd));
    if (!workspace?.id) return unavailableContext(unavailable('当前会话绑定的学习集'));
  } catch (error) {
    checkAbort(error);
    return unavailableContext(unavailable('当前会话绑定的学习集'));
  }

  // Vault is an optional peer. A preset without the live service never loads
  // its parser or treats an unavailable service as an empty student profile.
  const { parseMarkdown } = await import('@oh-my-student/plugin-vault-sqlite/frontmatter');

  const parts = [], documents = [], fragments = [], seen = new Set();
  let complete = true;
  async function readDocument(metadata, type) {
    const { path } = metadata;
    if (typeof path !== 'string' || !path) throw Error('learning_context_document_invalid');
    if (/^模板\//.test(path)) return;
    const label = type === 'route' ? '活跃路线' : '学习画像';
    try {
      const record = await checked(() => vault.read({ workspaceId: workspace.id, path }));
      if (record?.path !== path || typeof record.content !== 'string' || typeof record.revision !== 'string' || !record.revision) throw Error('learning_context_document_invalid');
      const { fields, body } = parseMarkdown(record.content);
      const status = typeof fields.status === 'string' && fields.status.trim() ? fields.status.trim() : 'active';
      if (fields.template === true || status === 'archived') return;
      if (fields.type !== type) throw Error('learning_context_document_type_changed');
      if (type === 'route' && status !== 'active') {
        parts.push(`${source(path, record.revision)}\n原路线已非活跃，当前进度请按需重新核实。`);
        return;
      }
      const lineOffset = record.content.split('\n').length - body.split('\n').length;
      const selected = currentSections(body, lineOffset);
      const progress = type === 'route'
        ? record.revision !== metadata.revision
          ? '路线正文已更新，旧推荐快照的进度不再引用；以以下正文清单为准。\n'
          : `路线里程碑进度：${metadata.completed}/${metadata.total}；勾选进度不代表学生掌握，待补条件仍以正文为准。\n`
        : '';
      const summary = typeof fields.summary === 'string' && fields.summary.trim() ? `文档概况：${fields.summary}\n` : '';
      const omitted = selected.omitted.length
        ? '\n概况已省略明确的历史/归档章节；需要时可用 read 读取原文件定位（不限制后续读取）：\n' + selected.omitted.map(line => `${path}#L${line}`).join('\n')
        : '';
      const text=`### ${label}\n${source(path, record.revision)}\n${progress}${summary}${selected.text}${omitted}`;
      const visibleContent=currentSections(record.content,0).text;
      documents.push({path,revision:record.revision,content:record.content,text,visibleContent,
        snapshotText:`### ${label}\n${source(path,record.revision)}\n${progress}${visibleContent}${omitted}`});
      parts.push(text);
    } catch (error) {
      checkAbort(error); complete = false;
      parts.push(`${source(path, metadata.revision)}\n${error?.code === 'ENOENT' ? `${label}文件已缺失，当前情况未知；需要时重新检索定位。` : unavailable(label)}`);
    }
  }

  try {
    let offset = 0, total;
    do {
      const page = await checked(() => vault.query({ workspaceId: workspace.id, type: 'learner-profile', sort: 'updated', limit: 100, offset }));
      if (!Array.isArray(page?.documents) || !Number.isSafeInteger(page.total) || page.total < 0 || (!page.documents.length && offset < page.total)) throw Error('learning_context_query_invalid');
      total = page.total;
      for (const document of page.documents) {
        if (!document || typeof document.path !== 'string') throw Error('learning_context_query_invalid');
        if (seen.has(document.path)) continue;
        seen.add(document.path);
        await readDocument(document, 'learner-profile');
      }
      offset += page.documents.length;
    } while (offset < total);
  } catch (error) {
    checkAbort(error);
    parts.push(unavailable('学习画像检索'));
    complete = false;
  }
  try {
    // Assembly precedes user/message publication. Include the native claimed
    // inbox so the first request gets the same route as a cold resumed one.
    const handoff = messagesOf({events:target.session.snapshotEvents?.()??[]}).find(message => ['notara-topic-handoff','notara-child-handoff'].includes(message.source?.kind)
      || target.session.header.origin==='subagent'&&message.source?.kind==='user'&&!message.source.rpcId&&childHandoffRoute(message));
    const routePath = handoff?.source?.routePath ?? (handoff ? childHandoffRoute(handoff) : undefined);
    const recommendations = await checked(() => vault.homeRecommendations({ workspaceId: workspace.id, routeContext:{sessionId:target.id,...routePath ? {path:routePath} : {}} }));
    if (!recommendations || !Object.hasOwn(recommendations, 'route')) throw Error('learning_context_route_invalid');
    if (recommendations.route) await readDocument(recommendations.route, 'route');
    else if (recommendations.routeSelection === 'unavailable' || recommendations.routeCandidates?.length) {
      parts.push('### 路线定位\n' + (recommendations.routeSelection === 'unavailable' ? `交接路线 ${JSON.stringify(routePath)} 已缺失或非活跃，不替换为其他路线。` : '有多条可能相关的活跃路线，尚未确定本会话归属；按任务核对，不按修改时间猜测。')
        + '\n候选定位（不是已绑定路线）：\n' + (recommendations.routeCandidates ?? []).map(item => JSON.stringify(item)).join('\n'));
    }
    if (preset === 'notara-coordinator' && recommendations.revisits?.length) {
      parts.push('### 可回访的学习线索\n来自卡片当前学生理解及下次探讨，不是到期债务或掌握结论；按目标择取，行动前按路径回读。这里只列近期候选，旧问题仍可按主题搜索卡片。\n'
        + recommendations.revisits.map(item => `${source(item.path, item.revision)}\n${item.snippet}`).join('\n\n'));
    }
    if(preset==='notara-coordinator'&&recommendations.due?.cards?.length){
      parts.push('### 到期的学习续接\n这些是可调整的邀请，不是欠下的任务。结合当前目标统筹；需要更多候选时用 learning_followup due。\n'+recommendations.due.cards.map(doc=>JSON.stringify({path:doc.path,revision:doc.revision,plans:doc.reviewPlans??[],due:doc.reviewDue})).join('\n'));
    }
  } catch (error) {
    checkAbort(error);
    parts.push(unavailable('活跃路线进度'));
    complete = false;
  }
  signal?.throwIfAborted();
  const header='当前会话所属学习集的已有记录（只读），不是本轮新的学生表达。分别保留各文档来源，不随意合并多个画像或替学生确认偏好；与本轮明确表达冲突时核对原记录。未记录、未检验或暂不可读的能力仍为未知；资料展示、路线勾选不代表学生掌握。本课绑定状态与续接回执由其他上下文提供。';
  const documentTexts=new Set(documents.map(item=>item.text));
  fragments.push(...parts.filter(text=>!documentTexts.has(text)));
  return {...context(parts.length?header+'\n\n'+parts.join('\n\n'):''),header,documents,fragments,complete};
}
