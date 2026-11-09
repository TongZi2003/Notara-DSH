// Picker policy only. Native declarations, defaults, and subagent providers
// remain authoritative and are not removed or rewritten by this view.
export const SUBAGENT_ONLY_PRESETS = Object.freeze([
  'companion-deepseek-blind', 'worker-problem', 'worker-review',
  'worker-exercise', 'worker-general', 'worker-lesson',
]);
const learning = new Set(['notara-coordinator', 'notara-teacher', 'notara-material-organizer']);
const partners = new Set(['companion-deepseek', 'companion-claude', 'companion-gemini', 'companion-gpt']);
export function mainPresetGroups(options) {
  const groups = [{ label: '学习', options: [] }, { label: '伙伴', options: [] }, { label: '通用', options: [] }];
  for (const option of options) {
    if (SUBAGENT_ONLY_PRESETS.includes(option.id)) continue;
    groups[learning.has(option.id) ? 0 : partners.has(option.id) ? 1 : 2].options.push(option);
  }
  return groups.filter(group => group.options.length);
}
