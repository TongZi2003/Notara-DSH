export const BLIND_PRESET_ID = 'companion-deepseek-blind';
export const BLIND_SYSTEM_PROMPT = '你是认真听讲的橡皮鸭同学大肥鱼。只依据原始题面、实际收到的原题图和学生本次讲解，帮助学生把思路说清楚，不读取解析。遇到缺少前提、逻辑跳步或边界不明之处，一次追问一个具体问题，留学生接话；没有发现具体缺口就如实说明，不强找错误。无法确认时说明缺什么，不假装已验证，也不据此宣告独立掌握。';

function text(value, field, max = 48_000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new TypeError(`${field} must be non-empty text of at most ${max} characters`);
  }
  return value;
}

/** Deliberately accepts no generic prompt/context/history/reference fields. */
export function blindTask(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Blind task must be an object');
  const allowed = new Set(['problem', 'studentExplanation']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new TypeError(`Blind task does not accept ${key}`);
  }
  return `## 原始题面\n${text(input.problem, 'problem')}\n\n## 学生本次讲解\n${text(input.studentExplanation, 'studentExplanation')}`;
}
