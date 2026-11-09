import { ROLES, roleById } from './catalog.js';
import { scopeParentOf, scopeOf, scopeChainOf } from '@deepseek-ai/dsh-scope';
import {childHandoffRoute} from './handoff-context.js';
import {withContextWriteMetadata} from './context-snapshots.js';

const read = ['read', 'read_image', 'glob', 'grep'];
export function allowedTools(role) {
  switch (role.kind) {
    case 'blind': return [];
    case 'coordinator': return [...read, 'write', 'edit', 'bash', 'job_output', 'job_list', 'job_kill', 'web_search', 'skill', 'subagent', 'send_message', 'ask_user_question', 'lesson_summary','learning_followup','canvas','excalidraw'];
    case 'organizer': return [...read, 'write', 'edit', 'web_search', 'web_fetch', 'skill', 'subagent', 'send_message', 'interrupt_agent', 'lesson_summary'];
    case 'teacher': return [...read, 'write', 'edit', 'bash', 'web_search', 'web_fetch', 'skill', 'subagent', 'send_message', 'interrupt_agent', 'job_output', 'job_list', 'job_kill', 'ask_user_question', 'canvas', 'excalidraw', 'lesson_plan', 'lesson_summary','learning_followup'];
    case 'companion': return [...read, 'send_message'];
    case 'worker': return [...read, 'web_search', 'web_fetch', 'skill', 'bash', 'job_output', 'job_list', 'job_kill'];
    default: throw new TypeError('Unknown role kind');
  }
}

// A retained preset generation can outlive the plugin that registered it.
// The standing policy row admits Agents; each admitted Agent owns its own
// controller, listeners, restriction and guard until that Agent is disposed.
const controllers = new WeakMap();

// Match the native userQuestions ownership boundary, including restored roots
// that still have a durable parent-session lineage.
const toolsForAgent = (ctx, agent, role) => allowedTools(role).filter(name =>
  name !== 'ask_user_question' || ctx.agents.roots().includes(agent));

function attachPolicy(agent) {
  const existing = controllers.get(agent);
  if (existing) { existing.reconcile(); return; }
  const ctx = agent.ctx;
  const registry = ctx.get('agentPresets');
  let installed;
  let reconciling = false;
  let disposed = false;
  function reconcile() {
    if (reconciling || disposed) return;
    reconciling = true;
    try {
      const id = registry.composedPreset(ctx);
      const role = ROLES.find(role => role.id === id);
      const names = role ? toolsForAgent(ctx, agent, role) : [];
      const available = names.filter(name => ctx.tools.get(name, scopeParentOf(agent)) !== undefined);
      const signature = available.join(',');
      if (installed?.id === id && installed.signature === signature) return;
      installed?.dispose();
      installed = undefined;
      if (!role) return;
      const allowed = new Set(names);
      const disposers = [];
      const state = { id, signature, dispose: () => disposers.splice(0).reverse().forEach(dispose => dispose()) };
      installed = state;
      try {
        for (const name of ['write','edit']) if (available.includes(name)) {
          disposers.push(ctx.tools.register(withContextWriteMetadata(ctx.tools.get(name,scopeParentOf(agent)))));
        }
        if(agent.session.header.origin==='subagent'&&available.includes('subagent')){
          const tool=ctx.tools.get('subagent',scopeParentOf(agent)),properties=tool.parameters.properties;
          const targets=properties.preset.enum.filter(target=>target!=='notara-material-organizer'&&!(role.kind==='coordinator'&&target==='notara-teacher'));
          disposers.push(ctx.tools.register({...tool,parameters:{...tool.parameters,properties:{...properties,preset:{...properties.preset,enum:targets}}}}));
        }
        disposers.push(ctx.tools.presentAs('native'));
        disposers.push(ctx.tools.restrict({ allow: available }));
        disposers.push(ctx.tools.guard(exec => allowed.has(exec.name) ? undefined : `Tool ${exec.name} is unavailable for ${id}`));
      } catch (error) {
        installed = undefined;
        state.dispose();
        throw error;
      }
    } finally { reconciling = false; }
  }
  controllers.set(agent, { reconcile });
  ctx.on('tools/change', reconcile);
  // rc.4 may inject a canonical-directory notice while creating a child.
  // Blind assessment has no filesystem tools and admits no environment hints.
  // Filter at the native admission boundary so model input remains replayable.
  ctx.on('agent/pre-step', async (_payload, next) => {
    const decision=await next();
    if(decision.kind!=='enter')return decision;
    const events=agent.session.snapshotEvents();
    const initialChild=events.some(event=>event.type==='subagent/descriptor')&&!events.some(event=>event.type==='user/message');
    const blind=registry.composedPreset(ctx)==='companion-deepseek-blind';
    return {...decision,messages:decision.messages.filter(message=>!blind||message.source?.kind!=='working-directory').map(message=>{
      if(!initialChild||message.source?.kind!=='user'||message.source.rpcId)return message;
      const routePath=blind?undefined:childHandoffRoute(message);
      return {...message,source:{kind:'notara-child-handoff',form:'relay',...routePath?{routePath}:{}}};
    })};
  });
  // The listener is Agent-owned, as is the execution guard. Neither is revoked
  // when Subagent providers or the registering presets root disappear.
  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const result = await next();
    if (context.scope !== agent) return result;
    const role = ROLES.find(role => role.id === registry.composedPreset(ctx));
    if (!role) return result;
    const allowed = new Set(toolsForAgent(ctx, agent, role));
    return { ...result, tools: result.tools.filter(tool => allowed.has(tool.name)) };
  });
  ctx.effect(() => () => { disposed = true; installed?.dispose(); controllers.delete(agent); });
  reconcile();
}

export const name = 'notara-agent-policy';
export const inject = ['agents'];
export function apply(ctx, { preset }) {
  roleById(preset);
  const generation = scopeOf(ctx);
  if (!generation) throw new Error('Notara permissions require a standing preset scope');
  const admit = agent => { if (scopeChainOf(agent).includes(generation)) attachPolicy(agent); };
  ctx.on('agent/created', ({ agent }) => admit(agent));
  for (const agent of ctx.agents.list()) admit(agent);
}
