import { REVIEW_SUPPORT_LABELS as SUPPORT_LABELS } from '@oh-my-student/plugin-vault-sqlite/review-contract';

export const QUICK_REQUESTS = Object.freeze([
  { id: 'exam-diagnosis', label: '试卷诊断与补强', text: '我想做试卷诊断与补强。我会带入试卷、批改和自己的实际作答，请依据具体步骤定位关键缺口，选择短练或补强课；只要求诊断时可直接交付诊断。' },
  { id: 'school-notes', label: '笔记整理与拓展', text: '我想整理并拓展笔记或讲义。我会带入材料，请保留原笔记和出处，补充已有知识实体，围绕我的目的选择比较、解释或延伸；教师补充与我的实际理解分别记录。' },
  { id: 'exam-cram', label: '考前复习与状态准备', text: '我想做考前复习与状态准备。请结合考试范围、剩余时间、历史弱点和我近期的状态作取舍，安排重点复习、答题节奏与少量有代表性的检验。' },
  { id: 'practice-design', label: '题库提高练习', text: '我想从已导入的题库中提高练习。请读取题目、知识标签及对应实体，结合我的目标与学情选题，说明每道题的用途和编排理由；只要求组卷时交付后结束。' },
]);

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const validSessionId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,160}$/.test(value.trim());

export function isVaultPath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096
    && !/[\\\x00-\x1f]/u.test(value) && !value.startsWith('/')
    && !/^[A-Za-z]:/.test(value) && !value.split('/').some(part => !part || part === '..' || part === '.');
}

const document = value => object(value) && isVaultPath(value.path)
  && typeof value.title === 'string' && value.title.trim().length > 0
  && typeof value.revision === 'string' && value.revision.length > 0;

function validTaskItem(value) {
  return value === null || (object(value) && count(value.line) && typeof value.content === 'string' && value.content.trim().length > 0);
}

function validContinuation(value) {
  return object(value) && validSessionId(value.sessionId) && document(value)
    && object(value.counts) && count(value.counts.total) && count(value.counts.completed)
    && value.counts.completed <= value.counts.total
    && validTaskItem(value.currentTask ?? null) && validTaskItem(value.nextTask ?? null);
}

function validRoute(value) {
  if (!document(value) || !count(value.completed) || !count(value.total) || value.completed > value.total) return false;
  if (value.nextAction !== null && value.nextAction !== undefined) {
    if (!object(value.nextAction) || typeof value.nextAction.text !== 'string' || !Array.isArray(value.nextAction.references) || !Array.isArray(value.nextAction.sessions)) return false;
    if (value.nextAction.references.some(ref => !object(ref) || !isVaultPath(ref.path))) return false;
    if (value.nextAction.sessions.some(s => !object(s) || !validSessionId(s.sessionId))) return false;
  }
  if (value.nextMilestone !== null && value.nextMilestone !== undefined) {
    if (!object(value.nextMilestone) || typeof value.nextMilestone.text !== 'string') return false;
  }
  return true;
}

function validFollowUp(value) {
  return object(value) && document(value)
    && ['lesson-summary', 'diary', 'card-next'].includes(value.kind)
    && typeof value.snippet === 'string' && value.snippet.trim().length > 0;
}

/** A broken response must not become a reassuring empty-learning-set state. */
export function parseRecommendations(value) {
  if (!object(value) || !object(value.due) || !count(value.due.total)
    || !Array.isArray(value.due.cards) || !value.due.cards.every(document)
    || value.due.cards.length > value.due.total
    || !object(value.diary) || !isVaultPath(value.diary.path) || typeof value.diary.exists !== 'boolean') {
    throw new TypeError('Invalid home recommendations');
  }
  const guide = value.guide;
  if (guide !== null && (!document(guide) || !count(guide.completed) || !count(guide.total)
    || guide.completed > guide.total || (guide.nextTask !== null
      && (!object(guide.nextTask) || !count(guide.nextTask.line) || typeof guide.nextTask.text !== 'string')))) {
    throw new TypeError('Invalid home guide');
  }
  if (value.route !== undefined && value.route !== null && !validRoute(value.route)) {
    throw new TypeError('Invalid home route');
  }
  if (value.continuation !== undefined && value.continuation !== null && !validContinuation(value.continuation)) {
    throw new TypeError('Invalid home continuation');
  }
  if (value.continuations !== undefined && (!Array.isArray(value.continuations) || !value.continuations.every(validContinuation))) {
    throw new TypeError('Invalid home continuations');
  }
  if (value.followUp !== undefined && value.followUp !== null && !validFollowUp(value.followUp)) {
    throw new TypeError('Invalid home followUp');
  }
  if (value.revisits !== undefined && (!Array.isArray(value.revisits) || !value.revisits.every(validFollowUp))) throw new TypeError('Invalid home revisits');
  return value;
}

export function supportLabel(support) {
  return Object.hasOwn(SUPPORT_LABELS, support) ? `上次${SUPPORT_LABELS[support]}` : '上次帮助情况未记录';
}

/** Match the published Conversation hero phase without depending on private DOM. */
export function isRecommendationHero(session, hasActiveTargets) {
  return Boolean(session) && !session.removed && !hasActiveTargets && !session.running
    && (session.blank || session.awaitingFirstTurn) && !session.promptAttempted;
}

// Markdown task references are readable without displaying raw link syntax or paths.
export function taskLabel(text) {
  return String(text)
    .replace(/!?\[\[session:[^\]|]+(?:\|([^\]]+))?\]\]/gi, (_, alias) => alias || '关联课堂')
    .replace(/!?\[\[([^\]]+)\]\]/g, (_, ref) => {
      const [path, alias] = ref.split('|');
      return alias || path.split('/').pop().replace(/\.md(?:#.*)?$/, '').split('#').pop();
    });
}

export function reviewRequest(card) {
  return {
    text: `我想回顾「${card.title}」。先帮我回想上次的思路，再从我想追问的地方展开。`,
    reference: { path: card.path, title: card.title, revision: card.revision },
  };
}

export function guideRequest(guide) {
  return {
    text: `我想继续学习「${guide.title}」。请结合已有记录，和我一起选一个合适的起点。`,
    reference: { path: guide.path, title: guide.title, revision: guide.revision },
  };
}

export function routeRequest(route, stepText, reference) {
  const ref = reference && document(reference)
    ? { path: reference.path, title: reference.title, revision: reference.revision }
    : { path: route.path, title: route.title, revision: route.revision };
  return {
    text: `我想沿「${route.title}」继续学习。请先读取路线，结合当前进度和目标安排下一步。`,
    reference: ref,
  };
}

export function followUpRequest(followUp) {
  return {
    text: `我想回看「${followUp.title}」，聊聊现在还有什么想问的。请先读取相关学习记录。`,
    reference: { path: followUp.path, title: followUp.title, revision: followUp.revision },
  };
}

/** Optional teacher data is validated here so a broken block only disables this priority tier. */
function teacherActions(recommendations, canOpenSession) {
  if (!document(recommendations) || !Array.isArray(recommendations.items)) return [];
  const actions = [];
  const seenSessions = new Set(), seenPaths = new Set(), seenQuestions = new Set(), seenLines = new Set();
  for (const item of recommendations.items) {
    if (!object(item) || !count(item.line) || item.line === 0
      || typeof item.text !== 'string' || !item.text.trim() || typeof item.reason !== 'string'
      || !Array.isArray(item.references) || !Array.isArray(item.sessions)) continue;
    const title = taskLabel(item.text).trim();
    const reason = taskLabel(item.reason).trim();
    const question = title.replace(/\s+/gu, ' ').toLowerCase();
    const material = item.references.find(document);
    const sessions = item.sessions.filter(session => object(session) && validSessionId(session.sessionId)
      && typeof session.label === 'string' && session.label.trim()).map(session => session.sessionId.trim());
    if ((item.references.length || item.sessions.length) && !material && !sessions.length) continue;
    if (!title || seenQuestions.has(question) || seenLines.has(item.line)
      || (material && seenPaths.has(material.path)) || sessions.some(id => seenSessions.has(id))) continue;
    const sessionId = sessions.find(id => canOpenSession(id));
    const source = material ?? recommendations;
    const reference = { path: source.path, title: source.title, revision: source.revision };
    actions.push({
      id: `teacher:${recommendations.path}:${item.line}`,
      kind: sessionId ? 'open-session' : 'prefill',
      path: reference.path,
      badge: '老师建议',
      title,
      detail: reason,
      meta: reason,
      ctaLabel: sessionId ? '进入关联课堂' : '带入对话',
      ...(sessionId ? { sessionId } : { request: {
        text: `我想继续：${title}`,
        reference,
        recommendation: { path: recommendations.path, revision: recommendations.revision, line: item.line, title, reason },
      } }),
    });
    seenQuestions.add(question);
    seenLines.add(item.line);
    if (material) seenPaths.add(material.path);
    sessions.forEach(id => seenSessions.add(id));
    if (actions.length === 3) break;
  }
  return actions;
}

/** Only the teacher's saved choices become recommendation cards. */
export function buildHomeActions(data, { canOpenSession = () => false } = {}) {
  const empty = { primary: null, alternatives: [], continuation: null };
  if (!data) return empty;
  const recommended = teacherActions(data.teacherRecommendations, canOpenSession);
  if (recommended.length) return { primary: recommended[0], alternatives: recommended.slice(1), continuation: null };

  // Navigation is not a teaching judgment. Keep raw assessment text out of it.
  const continuations = Array.isArray(data.continuations)
    ? data.continuations : data.continuation ? [data.continuation] : [];
  const activeClass = continuations.find(item => validContinuation(item)
    && ((item.counts.total > 0 && item.counts.completed < item.counts.total) || item.currentTask != null || item.nextTask != null)
    && canOpenSession(item.sessionId));
  if (activeClass) return { ...empty, continuation: {
    kind: 'open-session', sessionId: activeClass.sessionId, title: taskLabel(activeClass.title),
  } };

  // Lightweight classrooms need not have a bound lesson notebook. Reuse the
  // route's existing, host-verified classroom references for their navigation.
  const route = data.route?.status !== 'archived' ? data.route : null;
  const linked = [...(route?.nextAction?.sessions ?? []), ...(route?.nextMilestone?.sessions ?? [])]
    .find(item => validSessionId(item?.sessionId) && canOpenSession(item.sessionId));
  return linked ? { ...empty, continuation: {
    kind: 'open-session', sessionId: linked.sessionId, title: taskLabel(linked.label || ''),
  } } : empty;
}

/** Overlapping refreshes and late resolutions after unmount cannot publish. */
export function createRecommendationLoader(read, publish) {
  let generation = 0;
  let disposed = false;
  let hasReady = false;
  async function run(silent) {
    if (disposed) return;
    const ticket = ++generation;
    if (!silent || !hasReady) publish({ phase: 'loading' });
    try {
      const result = await read();
      // Generated DSH client methods return RemoteResult<T>, never a bare DTO.
      if (!object(result) || result.ok !== true) throw new Error('Home recommendations unavailable');
      const data = parseRecommendations(result.value);
      if (!disposed && ticket === generation) {
        hasReady = true;
        publish({ phase: 'ready', data });
      }
    } catch {
      if (!disposed && ticket === generation) {
        hasReady = false;
        publish({ phase: 'error' });
      }
    }
  }
  return {
    load: () => run(false),
    refresh: () => run(true),
    dispose() { disposed = true; generation++; },
  };
}
