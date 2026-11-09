import { resource, skillManifest, skillsForRole } from './resources.js';
import { BLIND_PRESET_ID, BLIND_SYSTEM_PROMPT } from './isolation.js';

export const SKILL_NAMES = Object.freeze(skillManifest.skills.map(skill => `notara-${skill.id}`));

const lessonJudgments = resource('lesson-judgments.md');
const conversationJudgments = resource('conversation-judgments.md');
const learningRecords = resource('learning-records.md');

const roles = [
  { id: 'notara-coordinator', name: '首页学习助手', description: '承接学习需求与轻量讨论、维护画像与长期路线，将批量资料整理或系统课堂交给对应会话。', kind: 'coordinator', prompt: `${learningRecords}\n\n${resource('coordinator.md')}\n\n${conversationJudgments}`, skills: skillsForRole('coordinator') },
  { id: 'notara-teacher', name: '专题课堂老师', description: '结合资料、学情与目标备课，支持探索、活动编排与练习，保留真实认识变化和贡献。', kind: 'teacher', prompt: `${learningRecords}\n\n${resource('base.md')}\n\n${lessonJudgments}\n\n${conversationJudgments}`, skills: skillsForRole('teacher') },
  { id: 'notara-material-organizer', name: '资料整理助手', description: '独立整理教材、讲义、试卷与个人笔记，核对保存并交回真实清单。', kind: 'organizer', prompt: resource('material-organizer.md'), skills: skillsForRole('organizer') },
  ...[
    ['deepseek', '大肥鱼', '费曼听讲与橡皮鸭调试。'],
    ['claude', '大小姐', '梳理结构，寻找简洁路径。'],
    ['gemini', '多动鬼', '图像直觉与跨领域类比。'],
    ['gpt', '后桌', '检查前提、边界与反例。'],
  ].map(([id, name, description]) => ({ id: `companion-${id}`, name, description, kind: 'companion', prompt: resource(`companions/${id}.md`), skills: skillsForRole('companion') })),
  { id: BLIND_PRESET_ID, name: '大肥鱼（不看解析）', description: '只接收原始题面与学生本次讲解，禁用工具与父会话历史。', kind: 'blind', prompt: BLIND_SYSTEM_PROMPT, skills: skillsForRole('blind') },
  ...[
    ['problem', '题目研究员', '独立推演与 Python/SymPy 验算。'],
    ['review', '核验员', '检查逻辑、依据和遗漏条件。'],
    ['exercise', '出题员', '设计并核验变式与铺垫题。'],
    ['general', '资料研究员', '检索本地材料与公开来源。'],
    ['lesson', '备课员', '梳理学习路径与备课草案。'],
  ].map(([id, name, description]) => ({ id: `worker-${id}`, name, description, kind: 'worker', prompt: `${resource('workers/base.md')}\n\n${resource(`workers/${id}.md`)}${['general', 'review'].includes(id) ? `\n\n${lessonJudgments}` : ''}`, skills: skillsForRole('worker') })),
];

export const ROLES = Object.freeze(roles.map(Object.freeze));
export const PRESET_IDS = Object.freeze(ROLES.map(role => role.id));
export function roleById(id) {
  const role = ROLES.find(role => role.id === id);
  if (!role) throw new TypeError(`Unknown Notara preset: ${id}`);
  return role;
}
