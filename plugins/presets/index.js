import { fileURLToPath } from 'node:url';
import { Service } from '@deepseek-ai/cordis';
import { ROLES } from './catalog.js';
import { skillsDirectoryFor } from './resources.js';
import { foldSubagentDescriptor } from '@deepseek-ai/dsh-subagent';
import { TopicConversations } from './topic-conversations.js';
import { installContextUpdates } from './context-snapshots.js';
import { collectRuntimeContexts } from './prompt.js';

export { PRESET_IDS, ROLES, SKILL_NAMES } from './catalog.js';
export { BLIND_PRESET_ID } from './isolation.js';

export function presetDefinitions() {
  return ROLES.map((role, order) => ({
    id: role.id, name: role.name, description: role.description, order,
    plugins: [
      { id: 'notara-prompt', name: '@oh-my-student/plugin-presets/prompt', config: { preset: role.id } },
      { id: 'notara-policy', name: '@oh-my-student/plugin-presets/policy', config: { preset: role.id } },
      ...['teacher', 'coordinator'].includes(role.kind) ? [
        { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user', config: { mode: 'timed', timeout: -1 } },
      ] : [],
      ...role.kind === 'blind' ? [] : [
        { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' },
        { id: 'tool-fs-search', name: '@deepseek-ai/dsh-tool-fs-search', config: { sampleOverCapGlobResults: false } },
      ],
      ...['teacher', 'organizer', 'worker', 'coordinator'].includes(role.kind) ? [{ id: 'tool-web', name: '@deepseek-ai/dsh-tool-web', config: { fetch: role.kind !== 'coordinator' } }] : [],
      ...['teacher', 'coordinator', 'worker'].includes(role.kind) ? [{ id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' }] : [],
      ...role.skills.length > 0 ? [
        { id: 'notara-skills', name: '@deepseek-ai/dsh-skill-filesystem', config: { providerName: 'notara-bundled', includeDefaultRoots: false, bundledSkillDir: fileURLToPath(skillsDirectoryFor(role.kind)), watch: false } },
        { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill' },
      ] : [],
      ...['teacher', 'coordinator', 'organizer', 'companion'].includes(role.kind) ? [
        { id: 'notara-delegation', name: '@oh-my-student/plugin-presets/tools', config: { preset: role.id } },
      ] : [],
      ...['teacher', 'coordinator', 'worker'].includes(role.kind) ? [{ id: 'tool-jobs', name: '@deepseek-ai/dsh-tool-jobs' }] : [],
    ],
  }));
}

// Same registration API as dsh-agent-preset's Service.init, with disposers
// retained by Cordis. No host services are published from a preset group.
export default class NotaraPresets {
  static inject = ['agentPresets'];
  constructor(ctx) { this.ctx = ctx; }
  async *[Service.init]() {
    const ctx = this.ctx;
    ctx.inject(['agents'],runtimeCtx=>{installContextUpdates(runtimeCtx,collectRuntimeContexts);});
    ctx.inject(TopicConversations.inject, runtimeCtx => { runtimeCtx.plugin(TopicConversations); });
    ctx.inject(['agents', 'agentPresets', 'attachments', 'workspaceRegistry', 'notaraVault'], async runtimeCtx => {
      const { AttachmentImports } = await import('./attachment-import.js');
      runtimeCtx.plugin(AttachmentImports);
    });
    // Vault is an optional peer of presets. Load its summary helpers only once
    // the actual Vault and durable host storage are available.
    ctx.inject([...TopicConversations.inject, 'storageDomain', 'workspaceRegistry', 'notaraVault', 'notaraTopics'], async runtimeCtx => {
      const { SummaryDeliveries } = await import('./summary-delivery.js');
      runtimeCtx.plugin(SummaryDeliveries);
    });
    // Preset registration has exactly the native preset plugin's dependency.
    // Host services may arrive independently; model-facing prompt/tool services
    // need not exist in this root plugin's dependency scope.
    ctx.inject(['agents', 'subagents'], runtimeCtx => {
      // Native continuations initially inherit their parent's preset. Commit the
      // teacher selection before publication releases the first queued prompt.
      // The native selection event also restores the right role on cold resume.
      runtimeCtx.on('agent/created', async ({ agent }) => {
        const events = agent.session.snapshotEvents();
        const descriptor = foldSubagentDescriptor(events);
        if (descriptor?.mode !== 'continuable' || descriptor.provider !== 'notara-preset:notara-teacher') return;
        if (runtimeCtx.agentPresets.composedPreset(agent.ctx) !== 'notara-teacher') {
          const recorded = events.filter(e => e.type === 'agent-preset/selected').at(-1)?.data.agentPreset ?? agent.session.header.agentPreset;
          // Restoring the recorded composition is not a new selection in an
          // already-started classroom. No prompt can run until this listener ends.
          if (recorded === 'notara-teacher') await runtimeCtx.agentPresets.mount(agent.ctx, recorded);
          else await runtimeCtx.agentPresets.select(agent, 'notara-teacher');
        }
      });
    });
    for (const definition of presetDefinitions()) yield await ctx.agentPresets.register(definition);
  }
}
