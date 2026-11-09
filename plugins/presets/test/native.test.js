import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile, copyFile, chmod, realpath, readdir, symlink } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import SessionStore from '@deepseek-ai/dsh-session';
import * as SessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import SessionQuery from '@deepseek-ai/dsh-session-query-sqlite';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import AgentPresetRegistry from '@deepseek-ai/dsh-agent-preset-registry';
import AgentPreset from '@deepseek-ai/dsh-agent-preset';
import Subagents from '@deepseek-ai/dsh-subagent';
import {isAdjacentAgentSendMessageTool} from '@deepseek-ai/dsh-subagent/internal';
import * as SpawnProvider from '@deepseek-ai/dsh-subagent-spawn-in-process';
import WorkingDirectory from '@deepseek-ai/dsh-working-directory';
import Skills from '@deepseek-ai/dsh-skill';
import LocalFileSystem from '@deepseek-ai/dsh-fs-local';
import Subprocess from '@deepseek-ai/dsh-subprocess-local';
import Shell from '@deepseek-ai/dsh-shell';
import * as ShellEnv from '@deepseek-ai/dsh-shell-env';
import Web from '@deepseek-ai/dsh-web';
import Jobs from '@deepseek-ai/dsh-jobs-local';
import UserQuestions from '@deepseek-ai/dsh-user-questions';
import Llm, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm';
import { buildDelegation } from '../tools.js';
import { resource, skillsForRole, skillsDirectoryFor } from '../resources.js';
import { presetDefinitions, ROLES } from '../index.js';
import {parse as parseYaml} from 'yaml';
import { validateBoardComponents } from '../../graph-and-blocks/src/domain/board-components.js';
import { registerLearningDeliveryTests } from './learning-delivery-scenarios.js';
import { registerCorrectionRelayTests } from './correction-relay-scenarios.js';
import { registerHomeSessionTests } from './home-session-scenarios.js';
import { registerContextHandoffTests } from './context-handoff-scenarios.js';
import { registerContextSnapshotTests } from './context-snapshot-scenarios.js';
import { registerImageReferenceTests } from './image-reference-scenarios.js';
import {collectRuntimeContexts} from '../prompt.js';
import {registerFollowUpTests} from './followup-scenarios.js';
import {registerPromptCleanupTests} from './prompt-cleanup-scenarios.js';
registerPromptCleanupTests({harness});

registerLearningDeliveryTests({ harness, mountSummaryVault, summaryFixture, untilSummary });
registerCorrectionRelayTests({ harness, mountSummaryVault, summaryFixture });
registerHomeSessionTests({ harness, mountSummaryVault });
registerContextHandoffTests({ harness });
registerContextSnapshotTests({ harness });
registerImageReferenceTests({ harness });
registerFollowUpTests({harness,mountSummaryVault});

test('real model maintains actionable homepage recommendations without a save reminder', { skip: !process.env.NOTARA_REAL_HOME_ACTIONS, timeout: 15 * 60 * 1000 }, async t => {
  const { runHomeActionsRealScenario } = await import('./home-actions-real-scenario.js');
  await runHomeActionsRealScenario(t, { harness, mountSummaryVault, untilSummary });
});

test('real model revisits ordinary learning through the persistent teacher', { skip: !process.env.NOTARA_REAL_REVISIT_HOME, timeout: 15 * 60 * 1000 }, async t => {
  const { runRevisitRealScenario } = await import('./revisit-real-scenario.js');
  await runRevisitRealScenario(t, { harness, mountSummaryVault });
});

test('real model diagnoses an error and maintains home recommendations', {
  skip: !process.env.NOTARA_REAL_ERROR_RECOMMEND_HOME, timeout: 15 * 60 * 1000,
}, async t => {
  const { runErrorRecommendRealScenario } = await import('./error-recommend-real-scenario.js');
  await runErrorRecommendRealScenario(t, { harness, mountSummaryVault, summaryFixture });
});

test('real peer questions preserve student space and continue one native companion session', {
  skip: !process.env.NOTARA_REAL_PEER_HOME, timeout: 12 * 60 * 1000,
}, async t => {
  const { runPeerQuestionsRealScenario } = await import('./peer-questions-real-scenario.js');
  await runPeerQuestionsRealScenario(t, { harness, mountSummaryVault });
});

test('real model closes a lightweight question and delivers preparation through the daily diary', {
  skip: !process.env.NOTARA_REAL_LEARNING_HOME, timeout: 20 * 60 * 1000,
}, async t => {
  const { runLearningDeliveryRealScenario } = await import('./learning-delivery-real-scenario.js');
  await runLearningDeliveryRealScenario(t, { harness, mountSummaryVault });
});

import {registerWhiteboardTests} from './whiteboard-scenarios.js';
registerWhiteboardTests({harness});

async function harness(t, { respond, withController=false, withBash=false, imageCapable=false, realHome, realSummaryHome, existingRoot } = {}) {
  const root = existingRoot ?? await mkdtemp(join(tmpdir(), 'notara-native-presets-'));
  let model={provider:'fixture',model:'fixture'},credentialRoot=root;
  let codex;
  if(realHome || realSummaryHome){
    const sourceHome = realSummaryHome ?? realHome;
    credentialRoot=await mkdtemp(join(tmpdir(),'notara-auth-probe-'));await chmod(credentialRoot,0o700);
    t.after(()=>rm(credentialRoot,{recursive:true,force:true}));
    const config=parseYaml(await readFile(join(sourceHome,'profiles/web/cordis.patch.yml'),'utf8')).find(row=>row.id==='agent-default-model')?.config;
    if(realSummaryHome && config?.provider === 'openai-codex') {
      const require = createRequire(join(sourceHome, 'package.json'));
      codex = await import(pathToFileURL(require.resolve('dsh-codex-oauth')).href);
      await copyFile(codex.authPath(sourceHome), codex.authPath(credentialRoot));
      await chmod(codex.authPath(credentialRoot),0o600);
    } else {
      if(config?.provider!=='deepseek-official')throw new Error('Real probe requires an explicitly supported existing model route');
      await copyFile(join(sourceHome,'.credentials.yaml'),join(credentialRoot,'.credentials.yaml'));await chmod(join(credentialRoot,'.credentials.yaml'),0o600);
    }
    model=config;
  }
  const ctx = new Context();
  t.after(async () => { await ctx.fiber.dispose(); if (!existingRoot) await rm(root, { recursive: true, force: true }); });
  const fibers = new Map();
  for (const [plugin, config] of [
    [Loader, { baseUrl: new URL('../../../', import.meta.url).href }],
    [SystemPrompt, {}], [Tools, {}], [AgentRegistry], [SessionPersistence, { root: join(root, 'sessions') }], [SessionStore], [SessionProjectionRegistry],
    [SessionQuery, { path: ':memory:', openAt: 'first-search' }], [Llm], [AgentLoop, { agents: [] }], [Subagents, { maxDepth: 2 }], [SpawnProvider, {}], [Skills],
    [LocalFileSystem, { cwd: root }], [WorkingDirectory, {defaultDirectory:root}], [Subprocess],
    [withBash ? (await import('@deepseek-ai/dsh-bash-local')).default : Shell, withBash ? { cwd: root, timeoutMs: 5000, maxTimeoutMs: 5000, maxOutputBytes: 4096, maxSpillBytes: 4096 } : undefined],
    [ShellEnv, { dshHome: root }], [Web], [Jobs], [UserQuestions],
    [AgentPresetRegistry, { default: 'notara-coordinator' }],
  ]) fibers.set(plugin, await ctx.plugin(plugin, config));
  const entryId = await ctx.loader.create({ name: '@oh-my-student/plugin-presets' });
  await ctx.loader.await();
  await ctx.loader.resolve(entryId).fiber.await();
  const roster = await ctx.agentPresets.list();
  assert.equal(roster.length, 13);
  assert.deepEqual(roster.filter(role => role.broken), [], JSON.stringify(roster));
  const requests = [];
  class FixtureAdapter extends LlmAdapter {
    async resolveModel(provider,model,signal){return imageCapable?{provider,id:model,name:model,inputModalities:['text','image']}:super.resolveModel(provider,model,signal);}
    async *stream(options) {
      requests.push(options);
      if (respond) { yield* respond(options); return; }
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: 'native fixture response' };
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'native fixture response' } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  ctx.llm.registerAdapter(['fixture'], new FixtureAdapter());
  if(withController) {
    for(const [name,config] of [
      ['dsh-storage'],['dsh-storage-json',{root:join(root,'storage')}],['dsh-storage-domain',{backend:'json'}],['dsh-workspace'],
      ['dsh-typert-registry'],['dsh-agent-default-model',model],
      ['dsh-attachment-local',{dshHome:root}],['dsh-credentials-local',{dshHome:credentialRoot,watch:false}],['dsh-client-connection',{}],
      ['dsh-commands'],['dsh-client-file-upload'],['dsh-api-remote-access'],
      ['dsh-session-title',{fallbackMaxWords:8,fallbackMaxBytes:80,maxTitleBytes:1024}],['dsh-api-session-controller',{nativeOpen:false}],
    ]) {
      const module=await import('@deepseek-ai/'+name);await ctx.plugin(module.default??module,config);
    }
    await ctx.workspaceRegistry.create(root);
    assert.ok(ctx.get('sessionController'));
  }
  if(realHome || realSummaryHome){
    if(codex) {
      const adapter = codex.createCodexAdapter(new codex.CodexCredentialStore(codex.authPath(credentialRoot)), () => ctx.get('attachments'));
      ctx.llm.registerAdapter([codex.OPENAI_CODEX_PROVIDER], adapter);
      ctx.effect(() => () => adapter.dispose());
    } else await ctx.plugin(await import('@deepseek-ai/dsh-llm-deepseek-api-key'),{});
    ctx.on('llm/stream',(options,next)=>{requests.push(options);return next();});
  }
  if (realSummaryHome) {
    const { checkSummaryProbeAccess } = await import('./summary-probe-boundary.js');
    const resources = fileURLToPath(new URL('../resources/', import.meta.url));
    ctx.on('tools/pre-execute', async (exec, next) => {
      if (!await checkSummaryProbeAccess(root, resources, exec.name, exec.arguments)) return { kind: 'deny', reason: '此隔离验收只允许读写当前学习集；内置教学资源只读，外部路径和命令执行不可用。' };
      return next();
    });
  }
  const handles = new Map();
  async function create(preset, cwd = root) {
    const handle = await ctx.agents.create({ sessionId: randomUUID(), meta: { cwd, agentPreset: preset }, agentOptions: model, setup: async childCtx => { await childCtx.get('agentPresets').mount(childCtx, preset); } });
    if (withController) {
      const ws = await ctx.workspaceRegistry.resolveByPath(cwd);
      await ws?.attachSession?.(handle.agent.id);
    }
    t.after(() => handle.dispose());
    handles.set(handle.agent.id, handle);
    return handle.agent;
  }
  return { ctx, root, create, requests, handles, presetsFiber: ctx.loader.resolve(entryId).fiber, subagentFiber: fibers.get(Subagents) };
}

async function attachmentFixture(t, options = {}) {
  const h = await harness(t, { withController: true, ...options });
  const fiber = await h.ctx.plugin(await import('../../vault-sqlite/index.js'), { root: h.root, cachePath: ':memory:' }); await fiber.await();
  await new Promise(resolve => h.ctx.inject(['notaraAttachmentImports'], resolve));
  const home = await h.create('notara-coordinator'), signal = new AbortController().signal;
  const upload = (agent, name, bytes) => h.ctx.fileUploads.upload(agent, { name, data: Buffer.from(bytes).toString('base64') }, signal);
  const send = async (agent, receiptId, text = '请结合这份资料。') => {
    await h.ctx.sessionController.prompt({ sessionId: agent.id, requestId: randomUUID(), mode: 'queue', content: [{ type: 'text', text }, { type: 'file', receiptId }] }, signal);
    await agent.whenIdle();
  };
  const receipts = agent => agent.session.snapshotEvents().filter(e => e.type === 'user/message' && e.data.source.kind === 'notara-attachment-import').map(e => e.data);
  return { ...h, home, upload, send, receipts };
}

test('sent file attachments enter the real source folder before the model request; drafts and duplicate sends stay quiet', { timeout: 30000 }, async t => {
  const h = await attachmentFixture(t), { ctx, root, home, upload, send, receipts } = h;
  const bytes = Buffer.from('%PDF-1.7\noriginal uploaded bytes\n%%EOF\n');
  let requestsWithSavedOriginal = 0;
  ctx.on('llm/stream', (_options, next) => {
    assert.deepEqual(readFileSync(join(root, '来源/商法则讲义.pdf')), bytes);
    requestsWithSavedOriginal++;
    return next();
  });
  const staged = await upload(home, '商法则讲义.pdf', bytes);
  await assert.rejects(readFile(join(root, '来源/商法则讲义.pdf')), { code: 'ENOENT' });
  assert.equal(h.requests.length, 0, 'choosing/uploading a draft cannot run the model or import into the learning set');
  await send(home, staged.receiptId);
  assert.deepEqual(await readFile(join(root, '来源/商法则讲义.pdf')), bytes);
  const first = receipts(home).at(-1);
  assert.equal(first.source.imports[0].status, 'saved'); assert.equal(first.source.imports[0].path, '来源/商法则讲义.pdf');
  assert.equal(first.source.form, 'notice');
  const wire = h.requests.at(-1).messages;
  assert.ok(wire.some(m => m.source?.kind === 'notara-attachment-import' && JSON.stringify(m.content).includes('来源/商法则讲义.pdf')));
  const original = home.session.snapshotEvents().find(e => e.type === 'user/message' && e.data.source.kind === 'user').data;
  assert.equal(original.content[0].text, '请结合这份资料。'); assert.equal(original.content[1].type, 'file');
  const ws = await ctx.workspaceRegistry.resolveByPath(root);
  assert.ok((await ctx.notaraVault.query({ workspaceId: ws.id })).documents.some(d => d.path === '来源/商法则讲义.pdf'));
  await send(home, (await upload(home, '商法则讲义.pdf', bytes)).receiptId, '还是刚才这份资料。');
  assert.equal(receipts(home).at(-1).source.imports[0].status, 'reused');
  assert.deepEqual(await readdir(join(root, '来源')), ['商法则讲义.pdf']);
  assert.equal(h.requests.length, 2, 'import receipts must not schedule additional model turns');
  assert.equal(requestsWithSavedOriginal, 2, 'each model request begins after the source file is saved');
});

test('attachment intake binds the receiving native workspace, preserves colliding files and rejects foreign upload receipts', { timeout: 30000 }, async t => {
  const h = await attachmentFixture(t), { ctx, root, home, upload, send, receipts } = h;
  const otherRoot = join(root, 'other-workspace'); await mkdir(otherRoot);
  await ctx.workspaceRegistry.create(otherRoot); const other = await h.create('notara-teacher', otherRoot);
  const staged = await upload(home, '笔记.docx', 'first-doc');
  await assert.rejects(send(other, staged.receiptId));
  await send(home, staged.receiptId);
  await send(other, (await upload(other, '笔记.docx', 'second-doc')).receiptId);
  assert.equal(await readFile(join(root, '来源/笔记.docx'), 'utf8'), 'first-doc');
  assert.equal(await readFile(join(otherRoot, '来源/笔记.docx'), 'utf8'), 'second-doc');
  await send(home, (await upload(home, '笔记.docx', 'third-doc')).receiptId);
  const renamed = receipts(home).at(-1).source.imports[0].path;
  assert.notEqual(renamed, '来源/笔记.docx'); assert.equal(await readFile(join(root, renamed), 'utf8'), 'third-doc');
  assert.equal(await readFile(join(root, '来源/笔记.docx'), 'utf8'), 'first-doc');
});

test('failed attachment intake keeps the native attachment usable and a later resend can recover without a file watcher', { timeout: 30000 }, async t => {
  const h = await attachmentFixture(t), { root, home, upload, send, receipts } = h;
  const outside = await mkdtemp(join(tmpdir(), 'notara-import-outside-')); t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, join(root, '来源'));
  await send(home, (await upload(home, '原件.txt', 'keep-these-bytes')).receiptId);
  const failure = receipts(home).at(-1);
  assert.equal(failure.source.imports[0].status, 'failed'); assert.equal(failure.source.imports[0].path, undefined);
  const original = home.session.snapshotEvents().find(e => e.type === 'user/message' && e.data.source.kind === 'user').data.content.find(p => p.type === 'file');
  assert.ok(original, 'the original attachment is retained in native history');
  assert.equal(await readFile(h.ctx.attachments.fileHostPath(original.attachment), 'utf8'), 'keep-these-bytes');
  assert.match(JSON.stringify(h.requests.at(-1).messages), /原件\.txt/, 'the native file handle still reaches the model');
  assert.deepEqual(await readdir(outside), []);
  await rm(join(root, '来源'));
  await send(home, (await upload(home, '原件.txt', 'keep-these-bytes')).receiptId);
  assert.equal(await readFile(join(root, '来源/原件.txt'), 'utf8'), 'keep-these-bytes');
  assert.equal(receipts(home).at(-1).source.imports[0].status, 'saved');
});

test('attachment intake skips rejected steps and does not re-import old attachments on cold continuation', { timeout: 30000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'notara-attachment-resume-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = await attachmentFixture(t, { existingRoot: root });
  const reject = first.home.ctx.on('agent/pre-step', async () => ({ kind: 'reject' }));
  await first.send(first.home, (await first.upload(first.home, '未接受.txt', 'rejected')).receiptId);
  await assert.rejects(readFile(join(root, '来源/未接受.txt')), { code: 'ENOENT' });
  reject();
  await first.send(first.home, (await first.upload(first.home, '已交付.txt', 'accepted')).receiptId);
  assert.equal(await readFile(join(root, '来源/已交付.txt'), 'utf8'), 'accepted');
  const homeId = first.home.id;
  await first.ctx.sessions.flush(first.home.session); await first.ctx.fiber.dispose();
  await rm(join(root, '来源/已交付.txt'));
  await writeFile(join(root, '普通新增文件.md'), '# 普通文件变更不会引发整理或复制');
  const second = await harness(t, { withController: true, existingRoot: root });
  const vault = await second.ctx.plugin(await import('../../vault-sqlite/index.js'), { root, cachePath: ':memory:' }); await vault.await();
  await new Promise(resolve => second.ctx.inject(['notaraAttachmentImports'], resolve));
  assert.equal(second.requests.length, 0);
  const restored = await second.ctx.notaraTopics.resume(homeId);
  restored.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '只继续讨论，不重新发送任何文件。' }] }));
  await restored.whenIdle();
  await assert.rejects(readFile(join(root, '来源/已交付.txt')), { code: 'ENOENT' });
  assert.equal(second.requests.length, 1);
  assert.equal(restored.session.snapshotEvents().filter(e => e.type === 'user/message' && e.data.source.kind === 'notara-attachment-import').length, 1);
});

test('real model closes a lesson, updates home documents and resumes a failed route with durable receipts', {
  timeout: 900000, skip: !process.env.NOTARA_REAL_SUMMARY_HOME,
}, async t => {
  const { runSummaryRealScenario } = await import('./summary-real-scenario.js');
  await runSummaryRealScenario(t, { harness, mountSummaryVault });
});

async function summaryFixture(t, options = {}) {
  const h = await harness(t, { withController: true, ...options });
  await mkdir(join(h.root, '备课'), { recursive: true });
  await mkdir(join(h.root, '路线'), { recursive: true });
  const path = '备课/本课.md';
  await writeFile(join(h.root, path), '---\ntype: lesson\n---\n# 本课\n- [ ] 一个课堂环节\n\n## 本节总结与下次续接\n学生在提示后完成判号；独立迁移尚未检查。\n');
  await writeFile(join(h.root, '画像.md'), '---\ntype: learner-profile\n---\n# 画像\n');
  await writeFile(join(h.root, '路线/当前.md'), '---\ntype: route\n---\n# 路线\n');
  const vaultFiber = await h.ctx.plugin(await import('../../vault-sqlite/index.js'), { root: h.root, cachePath: ':memory:' }); await vaultFiber.await();
  const home = await h.create('notara-coordinator');
  const signal = new AbortController().signal;
  const topic = await h.ctx.notaraTopics.start(home, { description: '本课', prompt: '开始本课。' }, 'summary-class', signal);
  const teacher = h.ctx.agents.get(topic.id); await teacher.whenIdle();
  const workspace = await h.ctx.workspaceRegistry.resolveByPath(h.root);
  const invoke = async (agent, args, callId = randomUUID()) => h.ctx.tools.execute({ name: 'lesson_summary', arguments: args, callId, agent, signal });
  const value = result => { assert.equal(result.isError, false, JSON.stringify(result)); return JSON.parse(result.value.result); };
  return { ...h, home, teacher, workspace, path, signal, invoke, value };
}

test('lesson summary delivery deduplicates by saved section, records verified partial receipts and rejects stale acknowledgements', { timeout: 30000 }, async t => {
  const h = await summaryFixture(t), { ctx, root, home, teacher, path, workspace, invoke, value } = h;
  const first = value(await invoke(teacher, { action: 'deliver', path }));
  await home.whenIdle();
  const again = value(await invoke(teacher, { action: 'deliver', path }));
  assert.equal(again.deliveryId, first.deliveryId); assert.equal(again.version, first.version);
  const notices = () => home.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source?.summaryDeliveryId === first.deliveryId);
  assert.equal(notices().length, 1, 'a new tool call for the same summary cannot duplicate its delivery');
  assert.equal(first.complete, false);
  const sourceLocator = first.sourceLocator;
  await ctx.notaraVault.save({ workspaceId: workspace.id, path: '画像.md', content: `---\ntype: learner-profile\n---\n# 画像\n提示后完成判号，未独立检验。来源：${sourceLocator}\n`, expectedRevision: (await ctx.notaraVault.read({ workspaceId: workspace.id, path: '画像.md' })).revision });
  const inspected = value(await invoke(home, { action: 'read', deliveryId: first.deliveryId, path: '画像.md' }));
  assert.equal(inspected.document.hasSourceReference, true);
  const ack = value(await invoke(home, { action: 'acknowledge', deliveryId: first.deliveryId, version: first.version, target: 'profile', outcome: 'updated', path: '画像.md', expectedRevision: inspected.document.revision, note: '已按实际提示经历更新。' }));
  assert.equal(ack.targets.profile.state, 'updated'); assert.equal(ack.targets.route.state, 'pending'); assert.equal(ack.complete, false);
  const partial = value(await invoke(home, { action: 'acknowledge', deliveryId: first.deliveryId, version: first.version, target: 'route', outcome: 'retryable', note: '路线写入暂时失败。' }));
  assert.equal(partial.targets.route.state, 'retryable'); assert.equal(partial.complete, false);
  const before = await readFile(join(root, '画像.md'), 'utf8');
  value(await invoke(home, { action: 'retry', deliveryId: first.deliveryId }));
  await home.whenIdle();
  assert.equal(await readFile(join(root, '画像.md'), 'utf8'), before, 'retry itself never rewrites learning facts');
  assert.equal(value(await invoke(home, { action: 'read', deliveryId: first.deliveryId })).targets.profile.state, 'updated');
  // A task-checkbox edit is not a new lesson summary version.
  await writeFile(join(root, path), (await readFile(join(root, path), 'utf8')).replace('- [ ]', '- [x]'));
  assert.equal(value(await invoke(teacher, { action: 'deliver', path })).version, first.version);
  // Revising the actual summary supersedes its receipts; it is not a second lesson.
  await writeFile(join(root, path), (await readFile(join(root, path), 'utf8')).replace('提示后完成判号', '无提示完成判号'));
  const revised = value(await invoke(teacher, { action: 'deliver', path }));
  assert.equal(revised.deliveryId, first.deliveryId); assert.equal(revised.version, first.version + 1);
  assert.equal(revised.targets.profile.state, 'pending');
  const stale = await invoke(home, { action: 'acknowledge', deliveryId: first.deliveryId, version: first.version, target: 'route', outcome: 'unchanged', path: '路线/当前.md', expectedRevision: (await ctx.notaraVault.read({ workspaceId: workspace.id, path: '路线/当前.md' })).revision, note: '旧稿无需更新。' });
  assert.equal(stale.isError, true); assert.match(JSON.stringify(stale), /summary_version_conflict/);
});

async function mountSummaryVault(h) {
  const fiber = await h.ctx.plugin(await import('../../vault-sqlite/index.js'), { root: h.root, cachePath: ':memory:' }); await fiber.await();
  const service = await new Promise(resolve => h.ctx.inject(['notaraSummaryDeliveries'], ctx => resolve(ctx.notaraSummaryDeliveries)));
  await service.ready; return service;
}
async function untilSummary(check) {
  const end = Date.now() + 6000;
  while (!await check()) { assert.ok(Date.now() < end, 'summary recovery did not settle'); await new Promise(resolve => setTimeout(resolve, 20)); }
}

for (const failureAt of ['before-inbox', 'after-inbox-before-receipt']) {
  test(`lesson summary restarts the whole native context at ${failureAt} and reconciles exactly one delivery`, { timeout: 30000 }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'notara-summary-restart-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const first = await summaryFixture(t, { existingRoot: root });
    const service = first.ctx.notaraSummaryDeliveries;
    if (failureAt === 'before-inbox') {
      const resume = first.ctx.notaraTopics.resume.bind(first.ctx.notaraTopics);
      first.ctx.notaraTopics.resume = async id => { if (id === first.home.id) throw new Error('fixture transport offline'); return resume(id); };
    } else {
      const put = service.store.put;
      let failOnce = true;
      service.store.put = async (id, row) => { if (row.delivery.messageId && failOnce) { failOnce = false; throw new Error('fixture receipt save interrupted'); } return put(id, row); };
    }
    const receipt = first.value(await first.invoke(first.teacher, { action: 'deliver', path: first.path }));
    assert.equal(receipt.delivery.sent, false);
    assert.match(receipt.delivery.error, /fixture/);
    await first.home.whenIdle();
    const homeId = first.home.id;
    await first.ctx.sessions.flush(first.home.session); await first.ctx.sessions.flush(first.teacher.session);
    await first.ctx.fiber.dispose();
    // Only on-disk files and string identities cross this boundary.
    const second = await harness(t, { existingRoot: root, withController: true });
    const restored = await mountSummaryVault(second);
    await untilSummary(() => restored.store.get(receipt.deliveryId)?.delivery.messageId);
    const persisted = await second.ctx.sessionQuery.readSession(homeId);
    const messages = persisted.events.filter(event => event.type === 'user/message' && event.data.source?.summaryDeliveryId === receipt.deliveryId);
    await second.ctx.agents.get(homeId)?.whenIdle();
    const after = await second.ctx.sessionQuery.readSession(homeId);
    assert.equal(after.events.filter(event => event.type === 'user/message' && event.data.source?.summaryDeliveryId === receipt.deliveryId).length, 1);
    if (failureAt === 'after-inbox-before-receipt') assert.equal(second.requests.length, 0, 'already consumed native message must not wake a second model turn');
    assert.ok(messages.length <= 1);
    const deliveredId = restored.store.get(receipt.deliveryId).delivery.messageId;
    await second.ctx.fiber.dispose();
    const third = await harness(t, { existingRoot: root, withController: true });
    const reopened = await mountSummaryVault(third);
    assert.equal(reopened.store.get(receipt.deliveryId).delivery.messageId, deliveredId);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(third.requests.length, 0, 'already delivered, unacknowledged work is passive context, not a periodic model loop');
  });
}

test('lesson summary partial processing survives full restart and next home turn completes only the remaining route', { timeout: 30000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'notara-summary-partial-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = await summaryFixture(t, { existingRoot: root });
  const receipt = first.value(await first.invoke(first.teacher, { action: 'deliver', path: first.path }));
  await first.home.whenIdle();
  const profileContent = `---\ntype: learner-profile\n---\n# 画像\n提示后完成判号；独立表现未知。来源：${receipt.sourceLocator}\n`;
  await writeFile(join(root, '画像.md'), profileContent);
  const inspected = first.value(await first.invoke(first.home, { action: 'read', deliveryId: receipt.deliveryId, path: '画像.md' }));
  first.value(await first.invoke(first.home, { action: 'acknowledge', deliveryId: receipt.deliveryId, version: receipt.version, target: 'profile', outcome: 'updated', path: '画像.md', expectedRevision: inspected.document.revision, note: '真实帮助程度已写入。' }));
  first.value(await first.invoke(first.home, { action: 'acknowledge', deliveryId: receipt.deliveryId, version: receipt.version, target: 'route', outcome: 'retryable', note: '路线暂时写入失败。' }));
  const homeId = first.home.id;
  await first.ctx.sessions.flush(first.home.session); await first.ctx.sessions.flush(first.teacher.session);
  await first.ctx.fiber.dispose();
  const second = await harness(t, { existingRoot: root, withController: true });
  const restored = await mountSummaryVault(second);
  assert.equal(restored.store.get(receipt.deliveryId).targets.profile.state, 'updated');
  assert.equal(restored.store.get(receipt.deliveryId).targets.route.state, 'retryable');
  const home = await second.ctx.notaraTopics.resume(homeId);
  home.followup(createUserMessage({ content: [{ type: 'text', text: '继续上次的课后收尾。' }], source: { kind: 'user' } }));
  await home.whenIdle();
  const wire = JSON.stringify(second.requests.at(-1).messages);
  assert.match(wire, /notara-summary-receipts/); assert.match(wire, /路线暂时写入失败/); assert.match(wire, /updated/);
  const call = async args => first.value(await second.ctx.tools.execute({ name: 'lesson_summary', arguments: args, callId: randomUUID(), agent: home, signal: new AbortController().signal }));
  const recovered = await call({ action: 'read', deliveryId: receipt.deliveryId });
  assert.equal(recovered.targets.profile.state, 'updated');
  const write = await second.ctx.tools.execute({ name: 'write', arguments: { file_path: '路线/当前.md', content: `---\ntype: route\n---\n# 路线\n下一步：独立判号检查。来源：${receipt.sourceLocator}\n` }, callId: 'recover-route-only', agent: home, signal: new AbortController().signal });
  assert.equal(write.isError, false);
  const route = await call({ action: 'read', deliveryId: receipt.deliveryId, path: '路线/当前.md' });
  const done = await call({ action: 'acknowledge', deliveryId: receipt.deliveryId, version: receipt.version, target: 'route', outcome: 'updated', path: '路线/当前.md', expectedRevision: route.document.revision, note: '已补上独立检查的下一步。' });
  assert.equal(done.complete, true);
  assert.equal(await readFile(join(root, '画像.md'), 'utf8'), profileContent, 'a completed profile is byte-for-byte preserved');
  const count = second.requests.length;
  assert.equal((await call({ action: 'retry', deliveryId: receipt.deliveryId })).complete, true);
  assert.equal(second.requests.length, count);
  assert.equal(await restored.context(home), null, 'completed receipt no longer enters pending context');
});

test('lesson summary acknowledgement requires the right recipient, document type, source link and fresh revision', { timeout: 30000 }, async t => {
  const h = await summaryFixture(t), { ctx, home, teacher, root, path, invoke, value } = h;
  const receipt = value(await invoke(teacher, { action: 'deliver', path })); await home.whenIdle();
  const other = await h.create('notara-coordinator');
  assert.equal((await invoke(other, { action: 'read', deliveryId: receipt.deliveryId })).isError, true);
  assert.equal((await invoke(teacher, { action: 'acknowledge', deliveryId: receipt.deliveryId, version: receipt.version, target: 'profile', outcome: 'blocked', note: '老师不能代首页确认。' })).isError, true);
  const initial = value(await invoke(home, { action: 'read', deliveryId: receipt.deliveryId, path: '画像.md' }));
  const common = { action: 'acknowledge', deliveryId: receipt.deliveryId, version: receipt.version, target: 'profile', outcome: 'updated', path: '画像.md', expectedRevision: initial.document.revision, note: '检查回执。' };
  assert.match(JSON.stringify(await invoke(home, common)), /summary_source_reference_missing/);
  await writeFile(join(root, '画像.md'), `---\ntype: learner-profile\n---\n来源：${receipt.sourceLocator}\n`);
  assert.match(JSON.stringify(await invoke(home, common)), /summary_target_revision_conflict/);
  assert.match(JSON.stringify(await invoke(home, { action: 'acknowledge', deliveryId: receipt.deliveryId, version: receipt.version, target: 'profile', outcome: 'unchanged', note: '不能忽略已存在的画像。' })), /summary_target_required/);
  const fresh = value(await invoke(home, { action: 'read', deliveryId: receipt.deliveryId, path: '画像.md' }));
  assert.equal(value(await invoke(home, { ...common, expectedRevision: fresh.document.revision })).targets.profile.state, 'updated');
  assert.match(JSON.stringify(await invoke(home, { action: 'acknowledge', deliveryId: receipt.deliveryId, version: receipt.version, target: 'profile', outcome: 'retryable', note: '迟到失败回执不得倒退已确认项。' })), /summary_target_already_settled/);
  const worker = await h.create('worker-review'); assert.equal(ctx.tools.get('lesson_summary', worker), undefined);
});

test('lesson summary transport retry is bounded and same retry tool call does not create another round', { timeout: 30000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'notara-summary-retry-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const h = await summaryFixture(t, { existingRoot: root }), { ctx, home, teacher, path, invoke, value } = h;
  const resume = ctx.notaraTopics.resume.bind(ctx.notaraTopics);
  let offline = true, attempts = 0;
  ctx.notaraTopics.resume = async id => { if (id === home.id && offline) { attempts++; throw new Error('fixture network unavailable'); } return resume(id); };
  const receipt = value(await invoke(teacher, { action: 'deliver', path }));
  assert.equal(receipt.delivery.sent, false);
  await untilSummary(() => ctx.notaraSummaryDeliveries.store.get(receipt.deliveryId).delivery.attempts === 3);
  await new Promise(resolve => setTimeout(resolve, 700));
  assert.equal(attempts, 3, 'bounded retries must not become a background polling loop');
  assert.equal(value(await invoke(teacher, { action: 'read', deliveryId: receipt.deliveryId })).complete, false);
  offline = false;
  const retried = value(await invoke(teacher, { action: 'retry', deliveryId: receipt.deliveryId }, 'same-summary-retry'));
  assert.equal(retried.delivery.sent, true); await home.whenIdle();
  value(await invoke(teacher, { action: 'retry', deliveryId: receipt.deliveryId }, 'same-summary-retry'));
  await home.whenIdle();
  assert.equal(home.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source?.summaryDeliveryId === receipt.deliveryId).length, 1);
  value(await invoke(home, { action: 'retry', deliveryId: receipt.deliveryId }, 'second-summary-retry'));
  await home.whenIdle();
  const round = ctx.notaraSummaryDeliveries.store.get(receipt.deliveryId).delivery.round;
  value(await invoke(teacher, { action: 'retry', deliveryId: receipt.deliveryId }, 'same-summary-retry'));
  await home.whenIdle();
  assert.equal(ctx.notaraSummaryDeliveries.store.get(receipt.deliveryId).delivery.round, round, 'an older retry replay remains idempotent after the other participant retries');
  assert.equal(home.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source?.summaryDeliveryId === receipt.deliveryId).length, 2);
  const homeId = home.id, teacherId = teacher.id;
  await ctx.sessions.flush(home.session); await ctx.sessions.flush(teacher.session); await ctx.fiber.dispose();
  const reopened = await harness(t, { existingRoot: root, withController: true });
  const service = await mountSummaryVault(reopened);
  const restoredTeacher = await reopened.ctx.notaraTopics.resume(teacherId);
  value(await reopened.ctx.tools.execute({ name: 'lesson_summary', arguments: { action: 'retry', deliveryId: receipt.deliveryId }, callId: 'same-summary-retry', agent: restoredTeacher, signal: new AbortController().signal }));
  assert.equal(service.store.get(receipt.deliveryId).delivery.round, round, 'retry deduplication survives a complete runtime restart');
  const persisted = await reopened.ctx.sessionQuery.readSession(homeId);
  assert.equal(persisted.events.filter(event => event.type === 'user/message' && event.data.source?.summaryDeliveryId === receipt.deliveryId).length, 2);
  assert.equal(reopened.requests.length, 0);
});

for (const failureAt of ['attempt-checkpoint', 'failure-receipt', 'permanent-storage']) {
  test(`lesson summary bounds and recovers receipt storage failure at ${failureAt}`, { timeout: 30000 }, async t => {
    const h = await summaryFixture(t), { ctx, teacher, home, path, invoke, value } = h;
    const service = ctx.notaraSummaryDeliveries, put = service.store.put;
    let failures = 0, transport = 0;
    service.store.put = async (id, row) => {
      if (row.delivery.attempts && (failureAt === 'permanent-storage' || (!failures && (failureAt === 'attempt-checkpoint' || row.delivery.error)))) {
        failures++; throw new Error('fixture storage unavailable');
      }
      return put(id, row);
    };
    const resume = ctx.notaraTopics.resume.bind(ctx.notaraTopics);
    ctx.notaraTopics.resume = async id => {
      if (id === home.id && failureAt === 'failure-receipt' && !transport++) throw new Error('fixture temporary transport failure');
      return resume(id);
    };
    const first = await invoke(teacher, { action: 'deliver', path });
    const id = value(await invoke(teacher, { action: 'read' })).deliveries[0].deliveryId;
    if (failureAt === 'permanent-storage') {
      assert.equal(first.isError, true, 'storage failure must not be reported as a saved receipt');
      await new Promise(resolve => setTimeout(resolve, 2800));
      const count = failures;
      assert.ok(count >= 3 && count <= 6, 'even when attempt counts cannot be persisted, in-process recovery is bounded');
      await new Promise(resolve => setTimeout(resolve, 700));
      assert.equal(failures, count); assert.equal(service.timers.size, 0);
      assert.equal(service.store.get(id).delivery.messageId, null);
      assert.equal(home.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source?.summaryDeliveryId === id).length, 0);
    } else {
      await untilSummary(() => service.store.get(id).delivery.messageId);
      await home.whenIdle();
      assert.equal(failures, 1);
      assert.equal(home.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source?.summaryDeliveryId === id).length, 1);
    }
  });
}

test('lesson summary new and revised deliveries ignore earlier stops after the user resumes', { timeout: 30000 }, async t => {
  let hanging = false, entered;
  const h = await summaryFixture(t, { respond: async function* (options) {
    if (hanging) {
      entered();
      await new Promise(resolve => { if (options.signal.aborted) resolve(); else options.signal.addEventListener('abort', resolve, { once: true }); });
      throw new DOMException('fixture canceled', 'AbortError');
    }
    yield { type: 'finish', reason: { kind: 'stop' } };
  } });
  const { ctx, root, home, teacher, path, invoke, value } = h;
  for (const agent of [home, teacher]) {
    const started = new Promise(resolve => { entered = resolve; }); hanging = true;
    agent.followup(createUserMessage({ content: [{ type: 'text', text: '先前的一次请求' }], source: { kind: 'user' } }));
    await started; await ctx.sessionController.cancel({ sessionId: agent.id }); await agent.whenIdle();
    hanging = false;
    agent.followup(createUserMessage({ content: [{ type: 'text', text: '继续学习' }], source: { kind: 'user' } }));
    await agent.whenIdle();
  }
  const first = value(await invoke(teacher, { action: 'deliver', path }));
  assert.equal(first.delivery.sent, true); assert.equal(first.delivery.suspended, null); await home.whenIdle();
  await writeFile(join(root, path), (await readFile(join(root, path), 'utf8')).replace('提示后完成判号', '提示后仍未完成判号'));
  const revised = value(await invoke(teacher, { action: 'deliver', path }));
  assert.equal(revised.version, first.version + 1); assert.equal(revised.delivery.sent, true);
});

test('lesson summary source references remain usable for special filenames and nested route documents', { timeout: 30000 }, async t => {
  const h = await summaryFixture(t), { root, teacher, home, invoke, value } = h;
  const path = '备课/[第1课].md', heading = '总结 | 第一课';
  await writeFile(join(root, path), `---\ntype: lesson\n---\n## ${heading}\n提示后完成，独立迁移未知。\n`);
  const receipt = value(await invoke(teacher, { action: 'deliver', path, heading })); await home.whenIdle();
  const inspected = value(await invoke(home, { action: 'read', deliveryId: receipt.deliveryId, path: '路线/当前.md' }));
  await writeFile(join(root, '路线/当前.md'), `---\ntype: route\n---\n# 路线\n来源：${inspected.sourceLocator}\n`);
  const read = value(await invoke(home, { action: 'read', deliveryId: receipt.deliveryId, path: '路线/当前.md' }));
  assert.equal(read.document.hasSourceReference, true);
  assert.equal(value(await invoke(home, { action: 'acknowledge', deliveryId: receipt.deliveryId, version: receipt.version, target: 'route', outcome: 'updated', path: '路线/当前.md', expectedRevision: read.document.revision, note: '特殊字符路径仍能准确引用。' })).targets.route.state, 'updated');
});

test('lesson summary respects archived recipients and recorded user cancellation without automatically restarting work', { timeout: 30000 }, async t => {
  let hanging = false, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const h = await summaryFixture(t, { respond: async function* (options) {
    if (hanging) {
      entered();
      await new Promise(resolve => { if (options.signal.aborted) resolve(); else options.signal.addEventListener('abort', resolve, { once: true }); });
      throw new DOMException('fixture canceled', 'AbortError');
    }
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text: '收到。' };
    yield { type: 'block-end', index: 0, block: { type: 'text', text: '收到。' } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } });
  const { ctx, home, teacher, path, invoke, value } = h;
  hanging = true;
  const receipt = value(await invoke(teacher, { action: 'deliver', path }));
  await started;
  await ctx.sessionController.cancel({ sessionId: home.id }); await home.whenIdle();
  await untilSummary(() => ctx.notaraSummaryDeliveries.store.get(receipt.deliveryId).delivery.suspended === 'user_stopped');
  hanging = false;
  const count = h.requests.length;
  await ctx.notaraSummaryDeliveries.attempt(receipt.deliveryId);
  assert.equal(h.requests.length, count);
  await ctx.workspaceRegistry.archiveSession(home.id, { stopActivity: true });
  const forbidden = await invoke(teacher, { action: 'retry', deliveryId: receipt.deliveryId });
  assert.equal(forbidden.isError, true); assert.match(JSON.stringify(forbidden), /summary_session_archived/);
  assert.equal(h.requests.length, count);
});

test('native model requests receive saved and reverted review choices without waking on confirmation', { timeout: 30000 }, async t => {
  const path = '复习回读.md';
  const proposal = '```notara-review\n' + JSON.stringify({ targetPath: path, keyStep: '建议步骤', result: 'done', support: 'independent', note: '建议备注' }) + '\n```';
  let replies = 0;
  const { ctx, root, create, requests } = await harness(t, { withController: true, respond: async function* () {
    const text = replies++ === 0 ? proposal : '继续讨论。';
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'block-end', index: 0, block: { type: 'text', text } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } });
  await writeFile(join(root, path), '---\ntype: card\n---\n# 复习回读\n');
  const fiber = await ctx.plugin(await import('../../vault-sqlite/index.js'), { root, cachePath: ':memory:' }); await fiber.await();
  const teacher = await create('notara-teacher'), workspace = await ctx.workspaceRegistry.resolveByPath(root);
  const ask = async text => { teacher.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })); await teacher.whenIdle(); };
  await ask('请给出复习建议。');
  const message = (await ctx.sessionQuery.readSurface(teacher.id)).events.findLast(event => event.type === 'assistant/message').data.message;
  const document = await ctx.notaraVault.read({ workspaceId: workspace.id, path });
  const before = requests.length;
  await ctx.notaraVault.recordReview({ workspaceId: workspace.id, path, expectedRevision: document.revision, source: { messageId: message.id, index: 0 }, result: 'missed', support: 'hint', keyStep: '实际确认步骤', note: '实际确认仍有卡点' });
  await teacher.whenIdle(); assert.equal(requests.length, before, 'confirmation does not create a model request');
  await ask('继续。');
  const latestContext = () => requests.findLast(request => request.sessionId === teacher.id).messages.flatMap(message => message.content ?? []).filter(block => block.type === 'text' && block.text.includes('当前会话近期复习建议的确认状态快照')).at(-1)?.text ?? '';
  assert.match(latestContext(), /"status":"已记录"/); assert.match(latestContext(), /"result":"仍有卡点"/); assert.match(latestContext(), /"support":"有提示"/); assert.match(latestContext(), /实际确认步骤/);
  const saved = await ctx.notaraVault.read({ workspaceId: workspace.id, path });
  const history = parseYaml(saved.content.split('---')[1]).review_history;
  const count = requests.length;
  await ctx.notaraVault.undoReview({ workspaceId: workspace.id, path, expectedRevision: saved.revision, expectedRecordId: history[0].id });
  await teacher.whenIdle(); assert.equal(requests.length, count, 'undo does not wake the teacher');
  await ask('再继续。');
  assert.match(latestContext(), /"status":"已撤销"/);
});

test('native Loader registers Chinese preset metadata before root tool/Agent/Subagent services exist', async t => {
  for (const definition of presetDefinitions()) assert.equal(AgentPreset.Config(definition).id, definition.id);
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  await ctx.plugin(Loader, { baseUrl: new URL('../../../', import.meta.url).href });
  await ctx.plugin(SessionProjectionRegistry);
  await ctx.plugin(AgentPresetRegistry, { default: 'notara-coordinator' });
  assert.equal(ctx.get('tools'), undefined);
  assert.equal(ctx.get('systemPrompt'), undefined);
  const entryId = await ctx.loader.create({ name: '@oh-my-student/plugin-presets' });
  await ctx.loader.await();
  await ctx.loader.resolve(entryId).fiber.await();
  const roster = await ctx.agentPresets.list();
  assert.equal(roster.length, 13);
  assert.equal(roster.find(row => row.id === 'notara-coordinator').name, '首页学习助手');
  assert.ok(roster.find(row => row.id === 'notara-teacher'));
  assert.equal(roster.find(row => row.id === 'notara-material-organizer').name, '资料整理助手');
});

test('real DeepSeek answers a peer through send_message after native cold recovery', {timeout:240000,skip:!process.env.NOTARA_REAL_HOME}, async t=>{
  const {ctx,create,handles,requests,root}=await harness(t,{withController:true,realHome:process.env.NOTARA_REAL_HOME});
  await writeFile(join(root,'00-学习画像与偏好.md'),'# 通信回归的合成学习者\n已学三角形法则，计算做对了一题；选路理由尚未检验。\n');
  await new Promise(resolve=>ctx.inject(['notaraTopics'],resolve));
  const home=await create('notara-coordinator'),signal=new AbortController().signal;
  const created=await ctx.notaraTopics.start(home,{description:'独立通信回归',prompt:'这是隔离副本中的通信验证。本次只确认收到课堂材料“三角形法则”，不要开课、委派、写文件或主动联络首页。等学生之后发言。'},'real-create',signal);
  const topic=ctx.agents.get(created.id);await topic.whenIdle();
  await ctx.sessions.flush(home.session);await handles.get(home.id).dispose();
  await ctx.notaraTopics.send(topic,home.id,'这节课暂时停在三角形法则：学生正确相加了一题，但还没解释为什么这样选路。下一节先补一句选路理由，还是继续向量减法？请给我一个简短建议，不要替学生生成解释。','real-peer-question',signal);
  const restored=ctx.agents.get(home.id);await restored.whenIdle();await topic.whenIdle();
  const log=restored.session.snapshotEvents();
  const calls=log.filter(e=>e.type==='tool/call'&&e.data.name==='send_message');
  assert.ok(calls.length>0,'The real receiver must choose the reply tool rather than only writing local prose');
  const replies=topic.session.snapshotEvents().filter(e=>e.type==='user/message'&&e.data.source?.kind==='agent-message'&&e.data.source.senderSessionId===home.id);
  assert.ok(replies.length>0,'The answer must actually arrive in the originating conversation');
  assert.ok(requests.some(r=>r.provider==='deepseek-official'&&r.model==='deepseek-flash'));
  console.log(JSON.stringify({probe:'real-peer-reply',provider:'deepseek-official',model:'deepseek-flash',requests:requests.length,deliveredReplies:replies.length}));
});

test('real classmate invitation is delegated by the teacher and answered in a native peer session', {timeout:240000,skip:!process.env.NOTARA_REAL_HOME}, async t=>{
  const {invitationText}=await import('../../vault-views/src/companions.js');
  const {ctx,create,root,requests}=await harness(t,{withController:true,realHome:process.env.NOTARA_REAL_HOME});
  await writeFile(join(root,'00-学习画像与偏好.md'),'# 学习画像\n高二学生，会二次函数和平均变化率。当前只请同学回答一个简短问题，不整理资料。');
  const teacher=await create('notara-teacher');
  teacher.followup(createUserMessage({content:[{type:'text',text:'我算出 y=x^2 从 x=1 到 x=2 的平均变化率是3，但老师说 x=1 处的切线斜率是2，这两个为什么不同？请只让大小姐用几句话回答，老师暂不讲解，也不用保存笔记。'+invitationText({preset:'companion-claude',mode:'answer'})}],source:{kind:'user'}}));
  await teacher.whenIdle();await ctx.subagents.waitForChildren(teacher);await teacher.whenIdle();
  const calls=teacher.session.snapshotEvents().filter(e=>e.type==='tool/call'&&e.data.name==='subagent');
  assert.ok(calls.some(call=>JSON.stringify(call.data.arguments).includes('companion-claude')),'The teacher must actually delegate the explicit invitation');
  const children=await ctx.subagents.listChildren(teacher.id);assert.ok(children.length);
  const texts=[];
  for(const child of children){const live=ctx.agents.get(child.id);if(live){await live.whenIdle();await ctx.sessions.flush(live.session);}const snapshot=await ctx.sessionQuery.readSession(child.id);texts.push(...snapshot.events.filter(e=>e.type==='assistant/message').flatMap(e=>e.data.message.content??[]).filter(b=>b.type==='text').map(b=>b.text));}
  assert.ok(texts.some(text=>text.trim().length>20),'The classmate must return an actual answer');
  const output=new URL('../../../outputs/companions-migration-20261027/',import.meta.url);await mkdir(output,{recursive:true});
  await writeFile(new URL('real-classmate.md',output),texts.join('\n\n'));
  await writeFile(new URL('real-result.json',output),JSON.stringify({status:'PASS',provider:'deepseek-official',model:requests[0]?.model,delegations:calls.length,children:children.length,modelCalls:requests.length},null,2));
});

test('real model chooses brief confirmation and a diagram from natural student requests', {timeout:240000,skip:!process.env.NOTARA_REAL_HOME}, async t=>{
  const {ctx,create,root}=await harness(t,{withController:true,realHome:process.env.NOTARA_REAL_HOME});
  const output=new URL('../../../outputs/questions-drawing-20261027/',import.meta.url);
  await mkdir(output,{recursive:true});
  const home=await create('notara-coordinator');
  const asked=[];
  home.ctx.on('user-questions/request',async request=>{
    asked.push(request.questions);
    return {answers:request.questions.map(q=>({id:q.id,selected:[],custom:'下次先学导数，大约二十分钟；今天只确认安排，暂时不开始上课。'}))};
  });
  home.followup(createUserMessage({content:[{type:'text',text:'我想补一下数学，导数和向量都想学，但下次先选哪个、花多少时间还没定。今天先跟我确认这两件事，先别开课，也别创建专题。'}],source:{kind:'user'}}));
  await home.whenIdle();
  const homeCalls=home.session.snapshotEvents().filter(e=>e.type==='tool/call').map(e=>e.data.name);
  await writeFile(new URL('real-question.json',output),JSON.stringify({calls:homeCalls,questions:asked},null,2));
  assert.ok(asked.length>0,'The model must independently choose the native brief-confirmation tool');
  assert.ok(!homeCalls.includes('subagent'),'Confirming an arrangement must not start an unrequested class');
  await writeFile(join(root,'00-学习画像与偏好.md'),'---\ntype: learner-profile\n---\n# 合成学生\n已学二次函数图像和平均变化率。高二，未学大学极限证明。不理解瞬时变化率为何有意义。只按课内方法教学；尚无新掌握证据。\n');
  const teacher=await create('notara-teacher');
  teacher.ctx.on('user-questions/request',async request=>({answers:request.questions.map(q=>({id:q.id,selected:[],custom:'我会算二次函数的平均变化率。请先解释当前这一步，用高中课内的方法就好。'}))}));
  teacher.followup(createUserMessage({content:[{type:'text',text:'我会算一段路程的平均速度，也会算二次函数两点间的平均变化率，但“这一点变化得多快”到底是什么意思，我还是很抽象。请先把这一步讲清楚，留一份下次能重看的笔记，暂时不要出新题。'}],source:{kind:'user'}}));
  await teacher.whenIdle();
  const events=teacher.session.snapshotEvents();
  const texts=events.filter(e=>e.type==='assistant/message').flatMap(e=>e.data.message.content??[]).filter(b=>b.type==='text').map(b=>b.text).join('\n\n');
  const calls=events.filter(e=>e.type==='tool/call').map(e=>({name:e.data.name,arguments:e.data.arguments}));
  await writeFile(new URL('real-teacher.md',output),texts);
  await writeFile(new URL('real-teacher-tools.json',output),JSON.stringify(calls,null,2));
  const figures=validateBoardComponents(texts).filter(c=>c.type==='figure');
  const artifacts=[];
  for(const call of calls.filter(c=>c.name==='write')){
    const args=typeof call.arguments==='string'?JSON.parse(call.arguments):call.arguments;
    if(typeof args?.file_path!=='string'||! /\.(md|canvas)$/.test(args.file_path))continue;
    const path=resolve(root,args.file_path),rel=relative(root,path);
    if(rel.startsWith('..'))continue;
    const content=await readFile(path,'utf8');
    artifacts.push({path:rel,content});
    if(path.endsWith('.md'))validateBoardComponents(content);
    else for(const node of JSON.parse(content).nodes??[])if(node.type==='text')validateBoardComponents(node.text??'');
  }
  await writeFile(new URL('real-artifacts.json',output),JSON.stringify(artifacts,null,2));
  await writeFile(new URL('real-result.json',output),JSON.stringify({nativeConfirmationCalls:asked.length,inlineFigures:figures.length,files:artifacts.map(a=>a.path),tools:calls.map(c=>c.name)},null,2));
  assert.ok(figures.length>0,'The teacher must choose an inline diagram without the student naming a tool');
  assert.ok(artifacts.length>0,'The requested reviewable notes must actually be saved');
});

test('native SessionController restores an offline home for a reply and preserves sender identity on the model wire', {timeout:20000}, async t=>{
  const {ctx,create,handles,requests}=await harness(t,{withController:true});
  await new Promise(resolve=>ctx.inject(['notaraTopics'],resolve));
  const home=await create('notara-coordinator'),signal=new AbortController().signal;
  home.followup(createUserMessage({content:[{type:'text',text:'OLD_HOME_CONTEXT'}],source:{kind:'user'}}));await home.whenIdle();
  const created=await ctx.notaraTopics.start(home,{description:'冷恢复专题',prompt:'ONLY_CONFIRMED_PREREQUISITES'},'cold-create',signal);
  const topic=ctx.agents.get(created.id);await topic.whenIdle();
  await ctx.sessions.flush(home.session);await handles.get(home.id).dispose();
  assert.equal(ctx.agents.get(home.id),undefined);assert.equal(ctx.sessions.get(home.id),undefined);
  const a=await ctx.notaraTopics.send(topic,home.id,'TOPIC_REPLY_AFTER_HOME_CLOSED','cold-reply',signal);
  const restored=ctx.agents.get(home.id);assert.ok(restored);assert.notEqual(restored,home);await restored.whenIdle();
  assert.equal(ctx.agentPresets.composedPreset(restored.ctx),'notara-coordinator');
  const wire=JSON.stringify(requests.findLast(row=>row.sessionId===home.id));
  assert.match(wire,/OLD_HOME_CONTEXT/);assert.match(wire,/TOPIC_REPLY_AFTER_HOME_CLOSED/);assert.ok(wire.includes(topic.id));assert.match(wire,/send_message/);assert.match(wire,/不是学生发言/);
  const b=await ctx.notaraTopics.send(topic,home.id,'TOPIC_REPLY_AFTER_HOME_CLOSED','cold-reply',signal);assert.equal(a.messageId,b.messageId);
  const events=(await ctx.sessionQuery.readSession(home.id)).events;
  assert.equal(events.filter(e=>e.type==='user/message'&&e.data.id===a.messageId).length,1);
});

test('teacher Excalidraw uses native tools, creates stable groups and protects student edits',async t=>{
  const {ctx,create,root}=await harness(t,{withController:true});const fiber=await ctx.plugin(await import('../../vault-sqlite/index.js'),{root,cachePath:':memory:'});await fiber.await();
  const agent=await create('notara-teacher'),signal=new AbortController().signal,path='课堂.excalidraw';
  const run=async(args,callId=randomUUID())=>{const result=await ctx.tools.execute({name:'excalidraw',callId,agent,signal,arguments:{path,...args}});assert.equal(result.isError,false,JSON.stringify(result));return JSON.parse(result.value.result);};
  const empty=await run({action:'read'});assert.equal(empty.revision,null);
  const args={action:'draw',expectedRevision:null,title:'函数与切线',shapes:[{kind:'text',text:'f(x) = x²',x:0,y:0},{kind:'function',expression:'x^2',x:0,y:60,width:400,height:300,xRange:[-2,2],yRange:[0,4]}]},callId=randomUUID();
  const first=await run(args,callId);assert.equal((await run(args,callId)).alreadyApplied,true);
  const read=await run({action:'read'});assert.equal(read.groups.length,1);assert.ok(read.elements.some(e=>e.type==='line'));
  const workspace=await ctx.workspaceRegistry.resolveByPath(root),id=first.elementIds[0];
  await ctx.notaraVault.drawingActivity({workspaceId:workspace.id,path,clientId:'student',elementIds:[id]});
  const blocked=await ctx.tools.execute({name:'excalidraw',callId:randomUUID(),agent,signal,arguments:{path,action:'update',expectedRevision:first.revision,updates:[{id,text:'不能覆盖正在输入的内容'}]}});assert.equal(blocked.isError,true);
  await ctx.notaraVault.drawingActivity({workspaceId:workspace.id,path,clientId:'student',elementIds:[]});
  const next=await run({action:'draw',expectedRevision:read.revision,after:read.groups[0].id,placement:'beside',shapes:[{kind:'text',x:0,y:0,text:'请你补充切线'}]});assert.ok(next.elementIds.length);
  const math=await run({action:'draw',expectedRevision:next.revision,after:id,placement:'beside',shapes:[{kind:'math',x:0,y:0,source:'axes x -2..2 y -1..5\nparam a = 1 in 0.5..2 step 0.1\nfunction f(x) = a*x^2'}]});
  assert.ok(math.embed.startsWith('```drawing'));
  const shown=await ctx.tools.execute({name:'excalidraw',callId:'show-math',agent,signal,arguments:{path,action:'show'}});
  assert.equal(shown.isError,false);assert.equal(shown.meta.notaraDrawing.workspaceId,workspace.id);
  const frozen=shown.meta.notaraDrawing.content;assert.ok(JSON.parse(frozen).elements.some(e=>e.customData?.notaraMath?.source.includes('a*x^2')));
  const updated=await run({action:'update',expectedRevision:math.revision,updates:[{id:math.elementIds[0],source:'axes x -2..2 y -1..5\nfunction f(x) = x^2+1'}]});
  assert.notEqual(updated.revision,math.revision);assert.equal(shown.meta.notaraDrawing.content,frozen);
  const coordinator=await create('notara-coordinator');assert.ok(ctx.tools.get('excalidraw',coordinator));
});

test('teacher Canvas tool binds the session workspace, requires explicit anchors and rejects stale updates',async t=>{
  const {ctx,create,root}=await harness(t,{withController:true});
  const vaultFiber=await ctx.plugin(await import('../../vault-sqlite/index.js'),{root,cachePath:':memory:'});await vaultFiber.await();
  assert.ok(ctx.get('notaraVault'));assert.ok(ctx.get('workspaceRegistry'));
  const agent=await create('notara-teacher'),signal=new AbortController().signal;
  const invoke=async(args,callId=randomUUID())=>{const result=await ctx.tools.execute({callId,name:'canvas',arguments:args,agent,signal});assert.equal(result.isError,false,JSON.stringify(result));return JSON.parse(result.value.result);};
  const fresh=await invoke({action:'read',path:'白板.canvas'});assert.equal(fresh.revision,null);
  const callId=randomUUID(),args={action:'append',path:'白板.canvas',expectedRevision:null,title:'题设',body:'原题条件'};
  const first=await invoke(args,callId),repeat=await invoke(args,callId);assert.equal(first.nodeId,repeat.nodeId);assert.equal(repeat.alreadyApplied,true);
  const missing=await ctx.tools.execute({callId:randomUUID(),name:'canvas',arguments:{...args,expectedRevision:first.revision},agent,signal});assert.equal(missing.isError,true);
  const second=await invoke({...args,expectedRevision:first.revision,after:first.nodeId,title:'第一步',body:'推导'});assert.equal(second.nodes.length,2);assert.ok(second.position.y>first.position.y);
  const stale=await ctx.tools.execute({callId:randomUUID(),name:'canvas',arguments:{action:'update',path:'白板.canvas',expectedRevision:first.revision,nodeId:first.nodeId,title:'旧版本',body:'不得覆盖'},agent,signal});assert.equal(stale.isError,true);
  const other=join(root,'other');await mkdir(other);const ws=await ctx.workspaceRegistry.create(other);await ctx.notaraVault.save({workspaceId:ws.id,path:'白板.canvas',content:'{"nodes":[],"edges":[]}',expectedRevision:null});
  assert.equal((await invoke({action:'read',path:'白板.canvas'})).nodes.length,2);
  const coordinator=await create('notara-coordinator');assert.ok(ctx.tools.get('canvas',coordinator));
});

test('native questions belong to independent teaching conversations and preserve structured human answers', async t => {
  const {ctx,create,root}=await harness(t);
  const signal=new AbortController().signal;
  for (const preset of ['notara-coordinator','notara-teacher']) {
    const agent=await create(preset);
    const tool=ctx.tools.get('ask_user_question',agent);
    assert.ok(tool, `${preset} must expose the native question tool`);
    let requested;
    const off=agent.ctx.on('user-questions/request',async request=>{
      requested=request;
      return {answers:[{id:'focus',selected:['导数'],custom:'先复习概念'}]};
    });
    const result=await ctx.tools.execute({callId:randomUUID(),name:'ask_user_question',arguments:{questions:[{id:'focus',question:'今天先学什么？',options:[{label:'导数'},{label:'向量'}],multi_select:true}]},agent,signal});
    assert.equal(result.isError,false,JSON.stringify(result));
    assert.deepEqual(result.value,{answers:[{id:'focus',selected:['导数'],custom:'先复习概念'}]});
    assert.equal(requested.agent,agent); assert.equal(requested.questions[0].multiSelect,true);
    assert.equal(requested.wait.callId != null,true,'native persistent waiting contract is used');
    off();
  }
  const parent=await create('notara-teacher');
  const child=await ctx.agents.create({sessionId:randomUUID(),parentAgent:parent,meta:{cwd:root,agentPreset:'notara-teacher'},agentOptions:{provider:'fixture',model:'fixture'},setup:async childCtx=>{await childCtx.get('agentPresets').mount(childCtx,'notara-teacher');}});
  t.after(()=>child.dispose());
  assert.equal(ctx.tools.get('ask_user_question',child.agent),undefined,'owned children cannot wait on a human UI');
  const assembly=await ctx.systemPrompt.assemble({scope:child.agent});
  assert.ok(!assembly.tools.some(tool=>tool.name==='ask_user_question'));
  const denied=await ctx.tools.execute({callId:randomUUID(),name:'ask_user_question',arguments:{questions:[{id:'x',question:'等待？'}]},agent:child.agent,signal});
  assert.equal(denied.isError,true);
  const worker=await create('worker-problem');
  assert.equal(ctx.tools.get('ask_user_question',worker),undefined);
});

for (const preset of ['notara-coordinator','worker-general','worker-lesson']) test(`native Bash grant executes for ${preset}, honors host denial and follows role changes`,async t=>{
  const {ctx,root,create}=await harness(t,{withBash:true});
  const agent=await create(preset),signal=new AbortController().signal;
  const run=id=>ctx.tools.execute({callId:id,name:'bash',arguments:{description:'Compute a small result without writing files',command:"printf 'check:%s\\n' \"$((6 * 7))\"",timeoutMs:5000},agent,signal});
  const assembly=await ctx.systemPrompt.assemble({scope:agent});assert.ok(assembly.tools.some(tool=>tool.name==='bash'));
  const result=await run('new-role-bash');assert.equal(result.isError,false,JSON.stringify(result));
  assert.equal(result.value.exitCode,0);assert.equal(result.value.stdout.text,'check:42\n');assert.equal(result.value.cwd,root);
  const deny=agent.ctx.on('tools/pre-execute',async(exec,next)=>exec.name==='bash'?{kind:'deny',reason:'fixture host permission denied'}:next());
  const blocked=await run('host-denied');assert.equal(blocked.isError,true);assert.match(JSON.stringify(blocked),/fixture host permission denied/);deny();
  await ctx.agentPresets.select(agent,'companion-claude');assert.equal(ctx.tools.get('bash',agent),undefined);assert.equal((await run('peer-denied')).isError,true);
  await ctx.agentPresets.select(agent,preset);assert.equal((await run('restored-bash')).isError,false);
});

test('native roster loads all presets; coordinator writes and reads back learner profile, loads orchestrator skill, exposes Bash, masks board tools, and delegates to teacher or organizer', async t => {
  const { ctx, root, create } = await harness(t, { withController: true });
  const coordinator = await create('notara-coordinator');
  const signal = new AbortController().signal;
  const names = ctx.tools.schemas(coordinator).map(tool => tool.name).sort();
  assert.deepEqual(names, ['ask_user_question', 'bash', 'edit', 'glob', 'grep', 'job_kill', 'job_list', 'job_output', 'read', 'read_image', 'send_message', 'skill', 'subagent', 'web_search', 'write']);
  assert.ok(ctx.tools.get('bash', coordinator));
  assert.equal(ctx.tools.get('web_fetch', coordinator), undefined);
  assert.equal(ctx.tools.get('canvas', coordinator), undefined);
  assert.equal(ctx.tools.get('excalidraw', coordinator), undefined);
  assert.equal(ctx.tools.get('interrupt_agent', coordinator), undefined);
  const writeProfile = await ctx.tools.execute({
    callId: 'write-profile',
    name: 'write',
    arguments: { file_path: '00-学习画像与偏好.md', content: '---\ntype: learner-profile\n---\n# 学习画像\n高二学生，已说明仅整理学校导数笔记，暂不开课。\n' },
    agent: coordinator,
    signal,
  });
  assert.equal(writeProfile.isError, false, JSON.stringify(writeProfile));
  const editProfile = await ctx.tools.execute({
    callId: 'edit-profile',
    name: 'edit',
    arguments: { file_path: '00-学习画像与偏好.md', old_string: '暂不开课。', new_string: '暂不开课；偏好先看几何直观。' },
    agent: coordinator,
    signal,
  });
  assert.equal(editProfile.isError, false, JSON.stringify(editProfile));
  const readBack = await ctx.tools.execute({ callId: 'read-profile', name: 'read', arguments: { file_path: '00-学习画像与偏好.md' }, agent: coordinator, signal });
  assert.equal(readBack.isError, false, JSON.stringify(readBack));
  assert.match(JSON.stringify(readBack.value), /偏好先看几何直观/);
  const coordinatorSkills = (await ctx.skills.list({ cwd: root, scope: coordinator })).filter(s => s.provider === 'notara-bundled').map(s => s.name).sort();
  assert.deepEqual(coordinatorSkills, [
    'notara-error-analysis',
    'notara-exam-cram',
    'notara-exam-diagnosis',
    'notara-practice-design',
    'notara-quest-orchestrator',
    'notara-recommend',
    'notara-review-brainstorm',
    'notara-school-notes',
    'notara-summer-preview',
    'notara-whiteboard',
  ]);
  const loadedSkill = await ctx.tools.execute({ callId: 'load-orchestrator', name: 'skill', arguments: { name: 'notara-quest-orchestrator' }, agent: coordinator, signal });
  assert.equal(loadedSkill.isError, false, JSON.stringify(loadedSkill));
  assert.equal(buildDelegation('notara-coordinator', { preset: 'notara-material-organizer', description: '整理学校笔记', prompt: '保留原题与来源' }).target.id, 'notara-material-organizer');
  assert.equal(buildDelegation('notara-coordinator', { preset: 'notara-teacher', description: '导数专题课', prompt: '备课并授课' }).target.id, 'notara-teacher');
  assert.throws(() => buildDelegation('notara-coordinator', { preset: 'worker-problem', description: 'direct worker', prompt: 'analyze paper' }), /not allowed/);
  assert.throws(() => buildDelegation('notara-coordinator', { preset: 'companion-deepseek', description: 'bypass', prompt: 'change' }), /not allowed/);
  assert.throws(() => buildDelegation('notara-material-organizer', { preset: 'notara-teacher', description: 'fake class', prompt: 'outsource' }), /not allowed/);
  assert.equal(buildDelegation('notara-material-organizer', { preset: 'worker-general', description: 'draft cards', prompt: 'extract definitions' }).target.id, 'worker-general');
  await ctx.agentPresets.select(coordinator, 'notara-teacher');
  assert.ok(ctx.tools.get('bash', coordinator));
  const assembly = await ctx.systemPrompt.assemble({ scope: coordinator });
  assert.ok(renderPrompt(assembly).startsWith(`${resource('learning-records.md')}\n\n${resource('base.md')}`));
  assert.ok(!renderPrompt(assembly).includes(resource('coordinator.md')));
  await ctx.agentPresets.select(coordinator, 'worker-general');
  assert.equal(ctx.tools.get('write', coordinator), undefined);
  assert.ok(ctx.tools.get('bash', coordinator));
  await ctx.agentPresets.select(coordinator, 'notara-coordinator');
  assert.ok(ctx.tools.get('write', coordinator));
  assert.ok(ctx.tools.get('bash', coordinator));
});

test('native preset activation accepts student turns and restores its own preset after release', async t => {
  const { ctx, create, requests } = await harness(t);
  const home = await create('notara-coordinator');
  const signal = new AbortController().signal;
  const result = await ctx.subagents.startActivation({ provider: 'spawn', label: '持续课堂', request: { parent: home, agentPreset:'notara-teacher', prompt: [{ type: 'text', text: 'STUDENT_CLASSROOM_OPEN' }], maxDepth: 2 }, signal, delivery:'caller' });
  const child = ctx.agents.get(result.childId);
  assert.ok(child);
  assert.equal(ctx.agentPresets.composedPreset(child.ctx), 'notara-teacher');
  assert.ok(ctx.tools.get('bash', child));
  assert.ok(ctx.tools.get('bash', home));
  assert.equal(child.session.snapshotEvents().find(e => e.type === 'subagent/descriptor').data.mode, 'continuable');
  await result.result;
  await ctx.subagents.prompt({ requestId: randomUUID(), parentSessionId: home.id, childSessionId: child.id,
    mode: 'continuable', delivery: 'queue', content: [{ type: 'text', text: 'STUDENT_CLASSROOM_SECOND_TURN' }],
  }, signal);
  await ctx.subagents.waitForChildren(home);
  const last = JSON.stringify(requests.findLast(row=>row.sessionId===child.id));
  assert.match(last, /STUDENT_CLASSROOM_OPEN/);
  assert.match(last, /STUDENT_CLASSROOM_SECOND_TURN/);
  assert.match(last, /专题课堂|自学|学习/);
  assert.equal(ctx.agents.get(child.id), undefined);
  await ctx.subagents.prompt({ requestId: randomUUID(), parentSessionId: home.id, childSessionId: child.id,
    mode: 'continuable', delivery: 'queue', content: [{ type: 'text', text: 'STUDENT_COLD_RESUME' }],
  }, signal);
  const resumed = ctx.agents.get(child.id);
  assert.equal(ctx.agentPresets.composedPreset(resumed.ctx), 'notara-teacher');
  assert.ok(ctx.tools.get('write', resumed));
  await ctx.subagents.waitForChildren(home);
  assert.match(JSON.stringify(requests.findLast(row=>row.sessionId===child.id)), /STUDENT_CLASSROOM_SECOND_TURN/);
  assert.match(JSON.stringify(requests.findLast(row=>row.sessionId===child.id)), /STUDENT_COLD_RESUME/);
});

test('ordinary topic survives home disposal; native teaching subagents keep isolated multi-turn histories', {timeout:20000}, async t => {
  let topicId;
  const { ctx, create, requests, handles } = await harness(t,{respond:async function*(options){
    const history=JSON.stringify(options.messages);
    if(options.sessionId!==topicId&&history.includes('A_STUDENT_ANSWER')&&!history.includes('只想告知：这里还需要一个例子')){
      const block={type:'tool-call',id:'optional-note',name:'send_message',arguments:JSON.stringify({agent_id:topicId,message:'只想告知：这里还需要一个例子。'})};
      yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'tool-call-delta',index:0,id:block.id,name:block.name,argumentsDelta:block.arguments};yield {type:'block-end',index:0,block};yield {type:'finish',reason:{kind:'tool-calls'}};return;
    }
    yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:'native fixture response'};yield {type:'block-end',index:0,block:{type:'text',text:'native fixture response'}};yield {type:'finish',reason:{kind:'stop'}};
  }});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('TopicConversations did not activate')),3000);ctx.inject(['notaraTopics'],()=>{clearTimeout(timer);resolve();});});
  const home = await create('notara-coordinator'), signal = new AbortController().signal;
  home.followup(createUserMessage({ content: [{ type:'text', text:'HOME_PRIVATE_HISTORY' }], source:{kind:'user'} }));
  await home.whenIdle();
  const args = { preset:'notara-teacher', description:'实验专题', prompt:'TOPIC_OVERVIEW' };
  const first = await ctx.tools.execute({callId:'topic-1',name:'subagent',arguments:args,agent:home,signal});
  assert.equal(first.isError,false,JSON.stringify(first));
  assert.equal(first.value.kind,'topic');
  const topic = ctx.agents.get(first.value.id); await topic.whenIdle();
  topicId=topic.id;
  assert.equal(topic.session.header.origin,undefined);
  assert.equal(ctx.agents.isOwnedBy(topic.id,home),false);
  assert.doesNotMatch(JSON.stringify(requests.at(-1)),/HOME_PRIVATE_HISTORY/);
  const retry = await ctx.tools.execute({callId:'topic-1',name:'subagent',arguments:args,agent:home,signal});
  assert.equal(retry.value.id,topic.id);
  await handles.get(home.id).dispose();
  assert.equal(ctx.agents.get(topic.id),topic);
  topic.followup(createUserMessage({content:[{type:'text',text:'TOPIC_PRIVATE_DISCUSSION'}],source:{kind:'user'}})); await topic.whenIdle();
  const block = async (key,overview) => {
    const result=await ctx.tools.execute({callId:key,name:'subagent',arguments:{preset:'notara-teacher',description:key,prompt:overview+'\n前置：KNOWS_PYTHON'},agent:topic,signal});
    assert.equal(result.isError,false,JSON.stringify(result));
    assert.equal(result.value.kind,'continuable');
    const agent=ctx.agents.get(result.value.id); await agent.whenIdle(); return agent;
  };
  const a=await block('A','A_OVERVIEW'),b=await block('B','B_OVERVIEW');
  const bRequest=requests.findLast(request=>request.sessionId===b.id);
  assert.doesNotMatch(JSON.stringify(bRequest),/HOME_PRIVATE_HISTORY|TOPIC_PRIVATE_DISCUSSION|A_OVERVIEW/);
  await ctx.subagents.prompt({requestId:randomUUID(),parentSessionId:topic.id,childSessionId:a.id,mode:'continuable',delivery:'queue',content:[{type:'text',text:'A_STUDENT_ANSWER'}]},signal);
  await ctx.agents.get(a.id).whenIdle();
  const aRequest=JSON.stringify(requests.findLast(request=>request.sessionId===a.id));
  assert.match(aRequest,/A_OVERVIEW/);assert.match(aRequest,/KNOWS_PYTHON/);assert.doesNotMatch(aRequest,/B_OVERVIEW|TOPIC_PRIVATE_DISCUSSION/);
  assert.equal(ctx.tools.get('teaching_progress',a),undefined);assert.equal(ctx.tools.get('teaching_block',topic),undefined);
  await topic.whenIdle();
  assert.match(JSON.stringify(requests.findLast(request=>request.sessionId===topic.id)),/只想告知：这里还需要一个例子/);
  await ctx.subagents.waitForChildren(topic);
  await ctx.notaraTopics.release(topic.id);
  const resumed=await ctx.notaraTopics.resume(topic.id);
  resumed.followup(createUserMessage({content:[{type:'text',text:'TOPIC_AFTER_REOPEN'}],source:{kind:'user'}}));await resumed.whenIdle();
  assert.match(JSON.stringify(requests.findLast(request=>request.sessionId===topic.id)),/TOPIC_AFTER_REOPEN/);
  const returnHome=await ctx.tools.execute({callId:'optional-home-note',name:'send_message',arguments:{agent_id:home.id,message:'我决定稍后再继续这个专题。'},agent:resumed,signal});
  assert.equal(returnHome.isError,false,JSON.stringify(returnHome));await ctx.agents.get(home.id).whenIdle();
  assert.match(JSON.stringify(requests.findLast(request=>request.sessionId===home.id)),/我决定稍后再继续/);
});

test('ordinary handoffs and relays deduplicate queued work, reject conflicting retries, and honor cancellation', {timeout:20000}, async t=>{
  let release,entered;const held=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
  const {ctx,create}=await harness(t,{respond:async function*(options){
    if(JSON.stringify(options.messages).includes('HOLD_RECIPIENT')){entered();await held;}
    yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:'ok'};yield {type:'block-end',index:0,block:{type:'text',text:'ok'}};yield {type:'finish',reason:{kind:'stop'}};
  }});
  t.after(()=>release());
  await new Promise(resolve=>ctx.inject(['notaraTopics'],resolve));
  const home=await create('notara-coordinator'),service=ctx.notaraTopics,signal=new AbortController().signal;
  const args={description:'排队课堂',prompt:'HOLD_RECIPIENT'};
  try{
    const creation=service.start(home,args,'same-create',signal);
    await assert.rejects(service.start(home,{...args,prompt:'different'},'same-create',signal),/另一份|不同|冲突/);
    const created=await creation;await started;
    const [a,b]=await Promise.all([service.send(home,created.id,'QUEUED_RELAY','same-send',signal),service.send(home,created.id,'QUEUED_RELAY','same-send',signal)]);
    const c=await service.send(home,created.id,'QUEUED_RELAY','same-send',signal);
    assert.equal(a.messageId,b.messageId);assert.equal(a.messageId,c.messageId);
    assert.equal(ctx.agents.get(created.id).inbox.nextTurn.filter(m=>m.id===a.messageId).length,1);
    await assert.rejects(service.send(home,created.id,'OTHER_RELAY','same-send',signal),/不同|冲突/);
    const original=service.native.attach;const controller=new AbortController();let cancelledId;
    service.native.attach=async(_cwd,id)=>{cancelledId=id;controller.abort();};
    await assert.rejects(service.start(home,{description:'已取消',prompt:'DO_NOT_DELIVER'},'cancel-create',controller.signal));
    service.native.attach=original;
    assert.equal(ctx.agents.get(cancelledId).inbox.nextTurn.length,0);
    assert.ok(!(await service.read(cancelledId)).events.some(e=>JSON.stringify(e.data).includes('DO_NOT_DELIVER')));
  }finally{release();}
});

test('relay retry during claimed-message assembly never enqueues a second copy', {timeout:20000}, async t=>{
  const {ctx,create}=await harness(t);
  await new Promise(resolve=>ctx.inject(['notaraTopics'],resolve));
  const home=await create('notara-coordinator'),service=ctx.notaraTopics,signal=new AbortController().signal;
  const created=await service.start(home,{description:'领取窗口',prompt:'initial'},'claim-window',signal),topic=ctx.agents.get(created.id);await topic.whenIdle();
  let release,entered;const hold=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
  const off=topic.ctx.on('system-prompt/assemble',async(a,c,next)=>{const value=await next();entered();await hold;return value;});
  try{
    const delivery=service.send(home,topic.id,'CLAIMED_NOT_YET_PUBLISHED','claim-relay',signal);
    await started;const first=await delivery;
    assert.equal(topic.inbox.nextTurn.length,0);
    const retry=await service.send(home,topic.id,'CLAIMED_NOT_YET_PUBLISHED','claim-relay',signal);
    assert.equal(retry.messageId,first.messageId);assert.equal(topic.inbox.nextTurn.length,0);
  }finally{release();off();await topic.whenIdle();}
});

test('native shared lesson judgments assemble once for teacher, research and review, and never for other roles', async t => {
  const { ctx, create } = await harness(t);
  const prompts = new Map();
  for (const role of ROLES) {
    const agent = await create(role.id);
    prompts.set(role.id, renderPrompt(await ctx.systemPrompt.assemble({ scope: agent })));
  }
  const shared = resource('lesson-judgments.md').trim();
  assert.ok(shared.length > 0);
  const recipients = new Set(['notara-teacher', 'worker-general', 'worker-review']);
  for (const [id, prompt] of prompts) assert.equal(prompt.split(shared).length - 1, recipients.has(id) ? 1 : 0, `${id} assembled shared judgment count`);
  const records=resource('learning-records.md');
  for(const [id,prompt]of prompts){
    const receives=['notara-teacher','notara-coordinator'].includes(id);
    assert.equal(prompt.split(records.trim()).length-1,receives?1:0,`${id} record guidance count`);
    if(receives)assert.ok(prompt.startsWith(records+'\n\n'),`${id} record guidance is first`);
  }
});

test('native static prompt preserves current teaching contracts, resists assembly replacement, and loads five filesystem skills', async t => {
  const { ctx, create, root } = await harness(t);
  const teacher = await create('notara-teacher');
  ctx.on('system-prompt/assemble', async (assembly, _context, next) => ({ ...await next(), sections: [{ name: 'bad-hook', text: 'lost core' }] }));
  const assembly = await ctx.systemPrompt.assemble({ scope: teacher });
  assert.ok(renderPrompt(assembly).startsWith(`${resource('learning-records.md')}\n\n${resource('base.md')}`));
  assert.ok(renderPrompt(assembly).includes('ask_user_question'));
  assert.match(renderPrompt(assembly), /不拿确认框承接|数学推导.*留在对话正文，不放进确认框/);
  assert.match(renderPrompt(assembly), /不生成 choice\/blank 组件/);
  const skills = await ctx.skills.list({ cwd: root, scope: teacher });
  const bundled = skills.filter(skill => skill.provider === 'notara-bundled');
  assert.equal(bundled.length, skillsForRole('teacher').length);
  assert.ok(bundled.some(skill => skill.name === 'notara-lesson-preparation'));
  for (const skill of bundled) assert.ok((await ctx.skills.get(skill.name, { cwd: root, scope: teacher })).content.length > 100);
});

test('native tutoring skill defers drawing examples to a readable bundled reference', async t => {
  const {ctx, create} = await harness(t);
  const teacher = await create('notara-teacher'), signal = new AbortController().signal;
  const loaded = await ctx.tools.execute({callId:'drawing-skill',name:'skill',arguments:{name:'notara-quest-tutor'},agent:teacher,signal});
  assert.equal(loaded.isError,false);
  const text = JSON.stringify(loaded);
  assert.match(text,/references\/drawing\.md/);
  assert.doesNotMatch(text,/param h = 1 in 0\.1\.\.2/);
  const base = /Base directory for this skill:\s*([^\n"\\]+)/.exec(text)?.[1]?.trim();
  assert.ok(base);
  const detail = await ctx.tools.execute({callId:'drawing-reference',name:'read',arguments:{file_path:join(base,'references/drawing.md')},agent:teacher,signal});
  assert.equal(detail.isError,false);
  assert.match(JSON.stringify(detail.value),/param h = 1 in 0\.1\.\.2/);
  assert.match(JSON.stringify(detail.value),/连续 Canvas 板书/);
});

test('real native Agent factory spawn gives teacher its own preset and blind zero tools/history/context', async t => {
  const { ctx, create, requests, root } = await harness(t);
  const coordinator = await create('notara-coordinator');
  coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'PARENT_SECRET_REFERENCE' }], source: { kind: 'user' } }));
  await coordinator.whenIdle();
  const signal = new AbortController().signal;
  const teacher = await create('notara-teacher');
  teacher.followup(createUserMessage({content:[{type:'text',text:'fresh lesson task'}],source:{kind:'user'}}));
  await teacher.whenIdle();
  const task = buildDelegation('notara-teacher', { preset: 'companion-deepseek-blind', description: 'blind test', problem: '原始问题', studentExplanation: '学生讲解' });
  const blind = await ctx.subagents.startActivation({provider:'spawn',label:'blind',request:{parent:teacher,agentPreset:'companion-deepseek-blind',maxDepth:2,prompt:[{type:'text',text:task.prompt}]},signal,delivery:'caller'});
  const child = ctx.agents.get(blind.childId);
  const assembly = await ctx.systemPrompt.assemble({ scope: child });
  assert.deepEqual(assembly.tools, []);
  assert.deepEqual(ctx.tools.schemas(child), []);
  assert.ok(assembly.contexts.every(row=>!row.text), 'Blind context must contain no runtime information');
  assert.equal(child.session.header.isSeeded, false);
  assert.equal(ctx.agentPresets.composedPreset(child.ctx), 'companion-deepseek-blind');
  const result = await blind.result;
  assert.equal(result.stopReason, 'completed');
  const serialized = JSON.stringify(requests.at(-1));
  assert.ok(serialized.includes('原始问题'));
  assert.ok(serialized.includes('学生讲解'));
  assert.ok(!serialized.includes('PARENT_SECRET_REFERENCE'));
  assert.ok(!serialized.includes('fresh lesson task'));
  assert.ok(!serialized.includes(resource('base.md')));
  assert.ok(!serialized.includes(root), 'Blind prompt must not expose the runtime directory: '+serialized.slice(Math.max(0,serialized.indexOf(root)-180),serialized.indexOf(root)+root.length+80));
  const descriptor = child.session.snapshotEvents().find(event => event.type === 'subagent/descriptor');
  assert.equal(descriptor.data.mode, 'continuable');
  assert.equal(descriptor.data.provider, 'spawn');
  await blind.dispose();
});

for (const preset of ['companion-deepseek', 'companion-claude', 'companion-gemini', 'companion-gpt']) test(`${preset} supports a student invitation with bounded background and continues the same native conversation`, async t=>{
  const {ctx,create,requests}=await harness(t),teacher=await create('notara-teacher'),signal=new AbortController().signal;
  teacher.followup(createUserMessage({content:[{type:'text',text:'TEACHER_ONLY_CONTEXT_WITH_COMPLETE_LESSON_ANSWER'}],source:{kind:'user'}}));await teacher.whenIdle();
  const { invitationText } = await import('../../vault-views/src/companions.js');
  teacher.followup(createUserMessage({content:[{type:'text',text:'我想和这位同学换个角度讨论，请他先问我一个问题。'+invitationText({preset,mode:'discuss'})}],source:{kind:'user'}}));await teacher.whenIdle();
  const invitation = '学生邀请你一起讨论，想听一个不同的提问角度。当前材料：向量相加。学生刚画完首尾相接的图，问能否交换顺序；已经给过的帮助：只说明了箭头的含义。备课可选问题仅供参考，你可以独立提出问题和探索，直接与学生交流。';
  const created=await ctx.tools.execute({callId:'invite-companion',name:'subagent',arguments:{preset,description:'向量相加的同学问题',prompt:invitation},agent:teacher,signal});
  assert.equal(created.isError,false,JSON.stringify(created));assert.equal(created.value.kind,'continuable');
  const child=ctx.agents.get(created.value.id);assert.equal(ctx.agentPresets.composedPreset(child.ctx),preset);
  assert.equal(isAdjacentAgentSendMessageTool(ctx.tools.get('send_message',child)),false,'interactive peers do not receive worker-style mandatory delivery guidance');
  assert.equal(child.session.header.parentSession,teacher.id);
  assert.ok(ctx.tools.get('send_message',child));assert.equal(ctx.tools.get('subagent',child),undefined);assert.equal(ctx.tools.get('write',child),undefined);
  await ctx.subagents.waitForChildren(teacher);
  const first = requests.filter(row => row.sessionId === created.value.id);
  assert.equal(first.length, 1, 'one native invitation reaches the peer; it does not manufacture student followups');
  assert.match(JSON.stringify(first[0]), /学生邀请/);
  assert.match(JSON.stringify(first[0]), /当前同学会话直接与学生/);
  assert.match(JSON.stringify(first[0]), /问完留给学生接话/);
  assert.match(JSON.stringify(first[0]), /学生想带回结论或确有会话协调事项时，再用 send_message/);
  assert.doesNotMatch(JSON.stringify(first[0]), /需要保存的内容必须在最终回复中作为完整可核查草案/);
  assert.ok(JSON.stringify(first[0]).includes(invitation));
  const initial=child.session.snapshotEvents().find(e=>e.type==='user/message'&&e.data.content?.some(b=>b.text?.includes(invitation)));
  assert.equal(initial.data.content.length,1,'the peer handoff has no appended SDK delivery block');
  await teacher.whenIdle();
  assert.ok(teacher.session.snapshotEvents().some(e=>e.type==='user/message'&&e.data.source?.kind==='subagent-settled'&&e.data.source.senderSessionId===child.id),'native settlement is retained');
  const { findPeerSession } = await import('./peer-questions-real-scenario.js');
  assert.deepEqual(await findPeerSession(ctx, teacher.id), { id: created.value.id, preset });
  const coldLookup = { subagents: ctx.subagents, agents: { get: () => undefined }, sessionQuery: ctx.sessionQuery };
  assert.deepEqual(await findPeerSession(coldLookup, teacher.id), { id: created.value.id, preset }, 'a persisted native child remains identifiable without a resident Agent or JSON tool receipt');
  await ctx.subagents.prompt({requestId:randomUUID(),parentSessionId:teacher.id,childSessionId:created.value.id,mode:'continuable',delivery:'queue',content:[{type:'text',text:'STUDENT_EXPLAINS_TRIANGLE_RULE'}]},signal);
  await ctx.subagents.waitForChildren(teacher);
  const history=JSON.stringify(requests.findLast(row=>row.sessionId===created.value.id));
  assert.equal(requests.filter(row => row.sessionId === created.value.id).length, 2);
  assert.match(history,/STUDENT_EXPLAINS_TRIANGLE_RULE/);assert.ok(history.includes(invitation));assert.doesNotMatch(history,/TEACHER_ONLY_CONTEXT_WITH_COMPLETE_LESSON_ANSWER/);
});

test('native tool executor validates the delegation schema and completes a foreground preset spawn', async t => {
  const { ctx, create, root } = await harness(t);
  const teacher = await create('notara-teacher');
  const signal = new AbortController().signal;
  const write = await ctx.tools.execute({ callId: 'teacher-write', name: 'write', arguments: { file_path: 'teacher.md', content: 'saved by native tool' }, agent: teacher, signal });
  assert.equal(write.isError, false, JSON.stringify(write));
  assert.equal(await readFile(join(root, 'teacher.md'), 'utf8'), 'saved by native tool');
  const invalid = await ctx.tools.execute({ callId: 'blind-invalid', name: 'subagent', arguments: { preset: 'companion-deepseek-blind', description: 'test', prompt: 'forbidden generic context', problem: '原题', studentExplanation: '讲解' }, agent: teacher, signal });
  assert.equal(invalid.isError, true);
  const valid = await ctx.tools.execute({ callId: 'blind-valid', name: 'subagent', arguments: { preset: 'companion-deepseek-blind', description: 'test', problem: '原题', studentExplanation: '讲解' }, agent: teacher, signal });
  assert.equal(valid.isError, false, JSON.stringify(valid));
  assert.match(JSON.stringify(valid), /completed/);
  assert.match(JSON.stringify(valid), /native fixture response/);
  const worker = await create('worker-problem');
  assert.equal(ctx.tools.get('subagent', worker), undefined);
  assert.equal(ctx.tools.get('write', worker), undefined);
  assert.ok(ctx.tools.get('bash', worker));
  const background = await ctx.tools.execute({ callId: 'worker-background', name: 'subagent', arguments: { preset: 'worker-general', description: 'background test', prompt: '独立整理交接', run_in_background: true }, agent: teacher, signal });
  assert.equal(background.isError, false, JSON.stringify(background));
  assert.equal(background.value.kind, 'background');
  await ctx.subagents.waitForChildren(teacher);
  assert.match(JSON.stringify((await ctx.sessionQuery.readSession(background.value.id)).events), /native fixture response/);
  const aborted = new AbortController();
  aborted.abort();
  const before = ctx.agents.list().length;
  await assert.rejects(ctx.subagents.startActivation({provider:'spawn',label:'aborted',request:{parent:teacher,agentPreset:'companion-deepseek-blind',maxDepth:2,prompt:[{type:'text',text:'should not start'}]},signal:aborted.signal,delivery:'caller'}));
  assert.equal(ctx.agents.list().length, before);
});

test('retained permission restrictions survive Subagent and presets-root unload', async t => {
  for (const dependency of ['subagentFiber', 'presetsFiber']) {
    await t.test(dependency, async t => {
      const h = await harness(t);
      const coordinator = await h.create('notara-coordinator');
      const worker = await h.create('worker-general');
      await writeFile(join(h.root, 'retained.md'), 'original');
      await h[dependency].dispose();
      assert.equal(h.ctx.agentPresets.composedPreset(coordinator.ctx), 'notara-coordinator');
      assert.equal(h.ctx.agentPresets.composedPreset(worker.ctx), 'worker-general');
      assert.ok(h.ctx.tools.get('bash', coordinator));
      assert.equal(h.ctx.tools.get('web_fetch', coordinator), undefined);
      assert.equal(h.ctx.tools.get('write', worker), undefined);
      const jobs = await h.ctx.tools.execute({ callId: 'retained-jobs-list', name: 'job_list', arguments: {}, agent: coordinator, signal: new AbortController().signal });
      assert.equal(jobs.isError, false);assert.ok(Array.isArray(jobs.value));
      const writeDenied = await h.ctx.tools.execute({ callId: 'retained-write-denied', name: 'write', arguments: { file_path: 'retained.md', content: 'permission leak' }, agent: worker, signal: new AbortController().signal });
      assert.equal(writeDenied.isError, true);
      assert.equal(await readFile(join(h.root, 'retained.md'), 'utf8'), 'original');
      const assembly = await h.ctx.systemPrompt.assemble({ scope: coordinator });
      assert.ok(!assembly.tools.some(tool => ['web_fetch', 'canvas', 'excalidraw'].includes(tool.name)));
      assert.ok(assembly.tools.some(tool => tool.name==='job_output'));
      assert.ok(assembly.tools.some(tool=>tool.name==='bash'));
      assert.ok(renderPrompt(assembly).startsWith(resource('learning-records.md')+'\n\n'+resource('coordinator.md')));
      const workerAssembly = await h.ctx.systemPrompt.assemble({ scope: worker });
      assert.ok(!workerAssembly.tools.some(tool => ['write', 'edit', 'subagent'].includes(tool.name)));
      assert.ok(workerAssembly.tools.some(tool=>tool.name==='bash'));
    });
  }
});

test('coordinator rejects background in native schema and at execution while teacher and organizer keep it', async t => {
  const { ctx, create } = await harness(t);
  const coordinator = await create('notara-coordinator');
  const teacher = await create('notara-teacher');
  const organizer = await create('notara-material-organizer');
  assert.equal(ctx.tools.get('subagent', coordinator).parameters.properties.run_in_background, undefined);
  assert.equal(ctx.tools.get('subagent', teacher).parameters.properties.run_in_background.type, 'boolean');
  assert.equal(ctx.tools.get('subagent', organizer).parameters.properties.run_in_background.type, 'boolean');
  assert.throws(() => buildDelegation('notara-coordinator', { preset: 'notara-teacher', description: 'background', prompt: 'should not start', run_in_background: true }), /background.*disabled/i);
  assert.throws(() => buildDelegation('notara-coordinator', { preset: 'notara-material-organizer', description: 'background', prompt: 'should not start', run_in_background: true }), /background.*disabled/i);
  const before = ctx.agents.list().length;
  const result = await ctx.tools.execute({ callId: 'coordinator-background-denied', name: 'subagent', arguments: { preset: 'notara-teacher', description: 'background', prompt: 'should not start', run_in_background: true }, agent: coordinator, signal: new AbortController().signal });
  assert.equal(result.isError, true);
  assert.equal(ctx.jobs.list(coordinator.id).length, 0);
  assert.equal(ctx.agents.list().length, before);
  const assembly=await ctx.systemPrompt.assemble({scope:coordinator});
  assert.equal(assembly.tools.find(tool=>tool.name==='subagent').parameters.properties.run_in_background,undefined,'the model-facing schema also excludes background delegation');
});

test('unsuccessful native child results become failed tool receipts and still dispose runs', async t => {
  let outcome = 'error';
  const { ctx, create } = await harness(t, { respond: async function* () {
    if (outcome === 'error') throw new Error('AUDIT_FIXTURE_PROVIDER_FAILURE');
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text: 'PRESERVED_PARTIAL' };
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'PRESERVED_PARTIAL' } };
    yield { type: 'finish', reason: { kind: outcome === 'max-tokens' ? 'max-tokens' : 'stop' } };
  } });
  const teacher = await create('notara-teacher');
  ctx.on('agent/created', ({ agent }) => {
    if (ctx.agentPresets.composedPreset(agent.ctx) !== 'worker-general') return;
    agent.ctx.on('agent/pre-step', async (_payload, next) => {
      if (outcome === 'refusal') return { kind: 'reject' };
      if (outcome === 'aborted') agent.cancel({ kind: 'parent' });
      return next();
    });
  });
  const ended = [];
  ctx.on('subagent/end', info => ended.push(info));
  for (const reason of ['error', 'max-tokens', 'refusal', 'aborted']) {
    outcome = reason;
    const result = await ctx.tools.execute({ callId: `child-${reason}`, name: 'subagent', arguments: { preset: 'worker-general', description: 'failure test', prompt: 'isolated task' }, agent: teacher, signal: new AbortController().signal });
    assert.equal(ended.at(-1)?.stopReason, reason);
    assert.equal(result.isError, true, `${reason}: ${JSON.stringify(result)}`);
    assert.equal(ctx.agents.get(ended.at(-1).id), undefined);
    assert.ok(!Object.hasOwn(result, 'value'));
    if (reason === 'max-tokens') assert.match(JSON.stringify(result), /PRESERVED_PARTIAL/);
  }
});

test('foreground cancellation after admission disposes the active native worker, and background has a native interrupt tool', {timeout:15000}, async t=>{
  let entered;const started=new Promise(resolve=>entered=resolve);
  const {ctx,create}=await harness(t,{respond:async function*(options){
    entered();await new Promise(resolve=>{if(options.signal.aborted)resolve();else options.signal.addEventListener('abort',resolve,{once:true});});
    throw new DOMException('fixture aborted','AbortError');
  }});
  const teacher=await create('notara-teacher'),control=new AbortController(),ended=[];ctx.on('subagent/end',row=>ended.push(row));
  const pending=ctx.tools.execute({callId:'late-cancel',name:'subagent',arguments:{preset:'worker-general',description:'cancel test',prompt:'wait for cancellation'},agent:teacher,signal:control.signal});
  await started;control.abort();const result=await pending;
  assert.equal(result.isError,true);assert.equal(ended.at(-1).stopReason,'aborted');assert.equal(ctx.agents.get(ended.at(-1).id),undefined);
  const bg=await ctx.tools.execute({callId:'bg-cancel',name:'subagent',arguments:{preset:'worker-general',description:'background',prompt:'wait for interruption',run_in_background:true},agent:teacher,signal:new AbortController().signal});
  assert.equal(bg.isError,false);
  const receipt=await ctx.tools.execute({callId:'interrupt',name:'interrupt_agent',arguments:{agent_id:bg.value.id},agent:teacher,signal:new AbortController().signal});
  assert.equal(receipt.isError,false);assert.equal(receipt.value.requested,true);
  await ctx.subagents.waitForChildren(teacher);assert.equal(ctx.agents.get(bg.value.id),undefined);
});

test('standalone material-organizer workflow: coordinator writes profile, organizer invokes worker, saves/reads cards, delivers checklist, and survives cold resume without fake classroom', { timeout: 25000 }, async t => {
  let holdBg;
  const bgBlocked = new Promise(resolve => { holdBg = resolve; });
  t.after(() => holdBg?.());
  const { ctx, root, create, handles, requests } = await harness(t, {
    withController: true,
    respond: async function* (options) {
      const wire = JSON.stringify(options.messages);
      if (wire.includes('HOLD_BG_WORKER')) {
        await new Promise(resolve => {
          if (options.signal.aborted) resolve();
          else options.signal.addEventListener('abort', resolve, { once: true });
          bgBlocked.then(resolve);
        });
        if (options.signal.aborted) throw new DOMException('aborted', 'AbortError');
      }
      if (wire.includes('EXTRACT_DERIVATIVE_NOTES')) {
        const draft = '草案：切线斜率即函数在 x0 处的导数 f\'(x0)，来源：来源/导数课堂笔记.md 第1节。';
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield { type: 'text-delta', index: 0, text: draft };
        yield { type: 'block-end', index: 0, block: { type: 'text', text: draft } };
        yield { type: 'finish', reason: { kind: 'stop' } };
        return;
      }
      const reply = wire.includes('整理交付清单') ? '已核实卡片保存完好：[导数与切线斜率](卡片/导数与切线斜率.md)。按你的要求本次仅整理笔记，不安排题目或课程。' : 'ok';
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: reply };
      yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    },
  });
  await new Promise(resolve => ctx.inject(['notaraTopics'], resolve));
  await mkdir(join(root, '来源'), { recursive: true });
  await writeFile(join(root, '来源/导数课堂笔记.md'), '# 导数课堂笔记\n## 1. 切线斜率\n割线斜率极限给出切线斜率 $f\'(x_0)$。\n## 2. 复合函数（字迹模糊待核对）\n');

  const home = await create('notara-coordinator');
  const signal = new AbortController().signal;
  // 1. Coordinator updates learner profile directly and reads it back.
  const saveProfile = await ctx.tools.execute({
    callId: 'home-profile-save',
    name: 'write',
    arguments: { file_path: '00-学习画像与偏好.md', content: '---\ntype: learner-profile\n---\n# 学习画像\n高二数学；本次学生明确说明“只整理学校导数笔记，先不上课”。\n' },
    agent: home,
    signal,
  });
  assert.equal(saveProfile.isError, false);
  const verifyProfile = await ctx.tools.execute({ callId: 'home-profile-read', name: 'read', arguments: { file_path: '00-学习画像与偏好.md' }, agent: home, signal });
  assert.equal(verifyProfile.isError, false);
  assert.match(JSON.stringify(verifyProfile.value), /只整理学校导数笔记/);

  // 2. Coordinator delegates to standalone notara-material-organizer; duplicate retry deduplicates; role conflict rejects.
  const handoffArgs = {
    preset: 'notara-material-organizer',
    description: '整理高二导数课堂笔记',
    prompt: '材料：来源/导数课堂笔记.md。学生要求：只整理成卡片并给清单，不上课不出题。',
  };
  const created = await ctx.tools.execute({ callId: 'org-handoff-1', name: 'subagent', arguments: handoffArgs, agent: home, signal });
  assert.equal(created.isError, false, JSON.stringify(created));
  assert.equal(created.value.kind, 'topic');
  assert.equal(created.value.preset, 'notara-material-organizer');
  const retrySame = await ctx.tools.execute({ callId: 'org-handoff-1', name: 'subagent', arguments: handoffArgs, agent: home, signal });
  assert.equal(retrySame.isError, false);
  assert.equal(retrySame.value.id, created.value.id, 'same callId retry must reuse the exact organizer session');
  const conflictRole = await ctx.tools.execute({
    callId: 'org-handoff-1',
    name: 'subagent',
    arguments: { ...handoffArgs, preset: 'notara-teacher' },
    agent: home,
    signal,
  });
  assert.equal(conflictRole.isError, true, 'conflicting target preset on same callId must reject');

  const organizer = ctx.agents.get(created.value.id);
  assert.ok(organizer);
  await organizer.whenIdle();
  assert.equal(ctx.agentPresets.composedPreset(organizer.ctx), 'notara-material-organizer');
  const orgTools = ctx.tools.schemas(organizer).map(tool => tool.name).sort();
  assert.deepEqual(orgTools, ['edit', 'glob', 'grep', 'interrupt_agent', 'read', 'read_image', 'send_message', 'skill', 'subagent', 'web_fetch', 'web_search', 'write']);
  const orgSkills = (await ctx.skills.list({ cwd: root, scope: organizer })).filter(s => s.provider === 'notara-bundled').map(s => s.name).sort();
  assert.deepEqual(orgSkills, ['notara-examiner-analysis', 'notara-pdf-learning-set', 'notara-review-brainstorm', 'notara-school-notes']);
  const loadCuration = await ctx.tools.execute({callId:'org-load-curation',name:'skill',arguments:{name:'notara-pdf-learning-set'},agent:organizer,signal});
  assert.equal(loadCuration.isError,false);
  for (const file of ['references/book-backbone.md','references/curation-spec.md']) {
    const location = fileURLToPath(new URL(`notara-pdf-learning-set/${file}`, skillsDirectoryFor('organizer')));
    const result = await ctx.tools.execute({callId:`org-read-${file}`,name:'read',arguments:{file_path:location},agent:organizer,signal});
    assert.equal(result.isError,false,JSON.stringify(result));
    assert.match(JSON.stringify(result.value),file.includes('book-backbone')?/标杆/:/零剧透/);
  }
  const orgAssembly = await ctx.systemPrompt.assemble({scope:organizer});
  assert.ok(renderPrompt(orgAssembly).startsWith(resource('material-organizer.md')));
  assert.match(JSON.stringify(await collectRuntimeContexts(ctx,organizer)), new RegExp(`本整理会话由会话 ${home.id} 发起`));

  // Organizer cannot outsource to notara-teacher or interrupt another session's worker.
  const forbidTeacher = await ctx.tools.execute({
    callId: 'org-outsource-teacher',
    name: 'subagent',
    arguments: { preset: 'notara-teacher', description: '假课堂', prompt: '不能外包' },
    agent: organizer,
    signal,
  });
  assert.equal(forbidTeacher.isError, true);

  const otherTeacher = await create('notara-teacher');
  const otherBg = await ctx.tools.execute({
    callId: 'other-teacher-bg',
    name: 'subagent',
    arguments: { preset: 'worker-general', description: '他课后台', prompt: 'HOLD_BG_WORKER', run_in_background: true },
    agent: otherTeacher,
    signal,
  });
  assert.equal(otherBg.isError, false);
  const crossInterrupt = await ctx.tools.execute({
    callId: 'cross-interrupt',
    name: 'interrupt_agent',
    arguments: { agent_id: otherBg.value.id },
    agent: organizer,
    signal,
  });
  assert.equal(crossInterrupt.isError, true, 'organizer interrupt_agent must be restricted to its own child workers');
  const ownBg = await ctx.tools.execute({
    callId: 'own-bg',
    name: 'subagent',
    arguments: { preset: 'worker-general', description: '自身后台核对', prompt: 'HOLD_BG_WORKER', run_in_background: true },
    agent: organizer,
    signal,
  });
  assert.equal(ownBg.isError, false);
  const ownInterrupt = await ctx.tools.execute({
    callId: 'own-interrupt',
    name: 'interrupt_agent',
    arguments: { agent_id: ownBg.value.id },
    agent: organizer,
    signal,
  });
  assert.equal(ownInterrupt.isError, false);
  holdBg();
  await Promise.all([ctx.subagents.waitForChildren(organizer), ctx.subagents.waitForChildren(otherTeacher)]);

  // 3. Organizer loads pdf-learning-set skill, runs foreground worker, writes card, reads back, and sends checklist after home is closed.
  const skillRes = await ctx.tools.execute({ callId: 'org-load-skill', name: 'skill', arguments: { name: 'notara-pdf-learning-set' }, agent: organizer, signal });
  assert.equal(skillRes.isError, false);
  const workerRes = await ctx.tools.execute({
    callId: 'org-worker-draft',
    name: 'subagent',
    arguments: { preset: 'worker-general', description: '提取切线概念', prompt: 'EXTRACT_DERIVATIVE_NOTES' },
    agent: organizer,
    signal,
  });
  assert.equal(workerRes.isError, false);
  assert.match(JSON.stringify(workerRes.value.output), /切线斜率/);

  const cardPath = '卡片/导数与切线斜率.md';
  const writeCard = await ctx.tools.execute({
    callId: 'org-write-card',
    name: 'write',
    arguments: {
      file_path: cardPath,
      content: '---\ntype: card\ntags: [导数]\nsources: ["[[来源/导数课堂笔记.md]]"]\n---\n# 导数与切线斜率\n\n## 参考理解\n割线斜率极限给出切线斜率 $f\'(x_0)$。\n\n## 学生理解\n',
    },
    agent: organizer,
    signal,
  });
  assert.equal(writeCard.isError, false);
  const readCard = await ctx.tools.execute({ callId: 'org-read-card', name: 'read', arguments: { file_path: cardPath }, agent: organizer, signal });
  assert.equal(readCard.isError, false);

  // Close home session to verify organizer persists in workspace list & wakes home on checklist handback.
  await ctx.sessions.flush(home.session);
  await handles.get(home.id).dispose();
  assert.equal(ctx.agents.get(home.id), undefined);
  const ws = await ctx.workspaceRegistry.resolveByPath(root);
  assert.ok(ws.sessionIds.includes(organizer.id), 'organizer session is attached to the workspace session list');

  const checklist = [
    '## 整理交付清单',
    '- **处理范围**：`来源/导数课堂笔记.md` 第 1 节（第 2 节字迹模糊暂未拆卡）',
    '- **新增文件**：[导数与切线斜率](卡片/导数与切线斜率.md)',
    '- **来源定位**：`来源/导数课堂笔记.md` 第 1 节',
    '- **未处理部分**：第 2 节复合函数求导',
    '- **待核对项**：请核对第 2 节原笔记字迹是否完整',
  ].join('\n');
  const delivered = await ctx.tools.execute({
    callId: 'org-deliver-checklist',
    name: 'send_message',
    arguments: { agent_id: home.id, message: checklist },
    agent: organizer,
    signal,
  });
  assert.equal(delivered.isError, false);
  const restoredHome = ctx.agents.get(home.id);
  assert.ok(restoredHome, 'closed home is cold-resumed upon receiving organizer checklist');
  await restoredHome.whenIdle();
  const homeReply = JSON.stringify(requests.findLast(r => r.sessionId === home.id));
  assert.match(homeReply, /整理交付清单/);

  // Cold-resume organizer itself after release and verify role, tools, and workspace are preserved.
  const organizerId = organizer.id;
  await ctx.sessions.flush(organizer.session);
  const sessionCtrl = ctx.get('sessionController');
  if (sessionCtrl?.closeSession) await sessionCtrl.closeSession({ sessionId: organizerId }).catch(() => {});
  await ctx.notaraTopics.release(organizerId);
  const resumedOrganizer = await ctx.notaraTopics.resume(organizerId);
  assert.equal(ctx.agentPresets.composedPreset(resumedOrganizer.ctx), 'notara-material-organizer');
  assert.equal(resumedOrganizer.session.header.cwd, root);
  assert.ok(ctx.tools.get('write', resumedOrganizer));
  assert.equal(ctx.tools.get('canvas', resumedOrganizer), undefined);
});

test('cross-workspace isolation and failed/unverified checklist paths never masquerade as saved completion', async t => {
  const { ctx, root, create } = await harness(t, { withController: true });
  await new Promise(resolve => ctx.inject(['notaraTopics'], resolve));
  const vaultB = await mkdtemp(join(tmpdir(), 'notara-vault-b-'));
  t.after(() => rm(vaultB, { recursive: true, force: true }));
  await ctx.workspaceRegistry.create(vaultB);

  const signal = new AbortController().signal;
  const homeA = await create('notara-coordinator');
  const handleB = await ctx.agents.create({
    sessionId: randomUUID(),
    meta: { cwd: vaultB, agentPreset: 'notara-coordinator' },
    agentOptions: { provider: 'fixture', model: 'fixture' },
    setup: async childCtx => { await childCtx.get('agentPresets').mount(childCtx, 'notara-coordinator'); },
  });
  t.after(() => handleB.dispose());
  const homeB = handleB.agent;

  const orgAResult = await ctx.tools.execute({
    callId: 'vault-a-org',
    name: 'subagent',
    arguments: { preset: 'notara-material-organizer', description: 'A库整理', prompt: '整理 A 库资料' },
    agent: homeA,
    signal,
  });
  assert.equal(orgAResult.isError, false);
  const orgA = ctx.agents.get(orgAResult.value.id);
  await orgA.whenIdle();

  // Cross-workspace send_message is rejected.
  const crossSend = await ctx.tools.execute({
    callId: 'cross-vault-send',
    name: 'send_message',
    arguments: { agent_id: orgA.id, message: '跨库串改' },
    agent: homeB,
    signal,
  });
  assert.equal(crossSend.isError, true);

  // Writing in vaultB never writes into vaultA, and an unsaved/invalid path in a partial report fails verification on read.
  const writeB = await ctx.tools.execute({
    callId: 'write-b',
    name: 'write',
    arguments: { file_path: '00-学习画像与偏好.md', content: 'VAULT_B_ONLY' },
    agent: homeB,
    signal,
  });
  assert.equal(writeB.isError, false);
  assert.equal(await readFile(join(vaultB, '00-学习画像与偏好.md'), 'utf8'), 'VAULT_B_ONLY');
  const readFromA = await ctx.tools.execute({
    callId: 'read-a-missing',
    name: 'read',
    arguments: { file_path: '00-学习画像与偏好.md' },
    agent: homeA,
    signal,
  });
  assert.equal(readFromA.isError, true, 'vaultA must not see vaultB files');

  // Simulate partial/failed write in organizer: directory collision causes write failure; read verification catches invalid checklist path.
  await mkdir(join(root, '目录冲突.md'), { recursive: true });
  const failedWrite = await ctx.tools.execute({
    callId: 'org-write-fail',
    name: 'write',
    arguments: { file_path: '目录冲突.md', content: 'cannot overwrite directory' },
    agent: orgA,
    signal,
  });
  assert.equal(failedWrite.isError, true, 'failed save must return an actual tool error');
  const invalidPathCheck = await ctx.tools.execute({
    callId: 'home-verify-invalid-path',
    name: 'read',
    arguments: { file_path: '卡片/未实际保存的卡片.md' },
    agent: homeA,
    signal,
  });
  assert.equal(invalidPathCheck.isError, true, 'delivery receipt alone does not make an unsaved path readable');
});

test('error analysis loads through native skill tools without expanding worker or organizer authority', async t => {
  const { ctx, root, create } = await harness(t, { withController: true });
  const signal = new AbortController().signal;
  const profile = '---\ntype: learner-profile\n---\n# 现有画像\n原记录保留。\n';
  await writeFile(join(root, '画像.md'), profile);
  for (const preset of ['notara-coordinator', 'notara-teacher', 'worker-review']) {
    const agent = await create(preset);
    const loaded = await ctx.tools.execute({ callId: `load-errors-${preset}`, name: 'skill', arguments: { name: 'notara-error-analysis' }, agent, signal });
    assert.equal(loaded.isError, false, preset);
    const base = /Base directory for this skill:\s*([^\n"\\]+)/.exec(JSON.stringify(loaded))?.[1]?.trim();
    assert.ok(base, preset);
    for (const file of ['card.md', 'learner-profile.md']) {
      const result = await ctx.tools.execute({ callId: `error-template-${preset}-${file}`, name: 'read', arguments: { file_path: join(base, 'templates', file) }, agent, signal });
      assert.equal(result.isError, false, `${preset}: ${file}`);
    }
    if (preset === 'worker-review') {
      const denied = await ctx.tools.execute({ callId: 'worker-errors-no-write', name: 'write', arguments: { file_path: '画像.md', content: '不得写入' }, agent, signal });
      assert.equal(denied.isError, true);
    }
  }
  const organizer = await create('notara-material-organizer');
  const unavailable = await ctx.tools.execute({ callId: 'organizer-errors-unavailable', name: 'skill', arguments: { name: 'notara-error-analysis' }, agent: organizer, signal });
  assert.equal(unavailable.isError, true);
  assert.equal(await readFile(join(root, '画像.md'), 'utf8'), profile);
});

test('recommend loads without writing and explicitly saved recommendations reach home through native file tools', async t => {
  const { buildHomeActions } = await import('../../home-recommend/src/model.js');
  const { ctx, root, home, teacher, workspace, signal } = await summaryFixture(t);
  const original = await readFile(join(root, '画像.md'), 'utf8');
  for (const agent of [home, teacher]) {
    const loaded = await ctx.tools.execute({ callId: `recommend-load-${agent.session.id}`, name: 'skill', arguments: { name: 'notara-recommend' }, agent, signal });
    assert.equal(loaded.isError, false);
  }
  assert.equal(await readFile(join(root, '画像.md'), 'utf8'), original, 'using recommendation guidance alone must not mutate the profile');
  assert.equal((await ctx.notaraVault.homeRecommendations({ workspaceId: workspace.id })).teacherRecommendations, null);
  // Exercise the actual Markdown example shipped to the model, with its target present.
  await mkdir(join(root, '卡片'), { recursive: true });
  await writeFile(join(root, '卡片/导数错题.md'), '---\ntype: card\n---\n# 导数错题\n');
  const example = /```md\n([\s\S]*?)\n```/.exec(resource('pi-skills-built/notara-recommend/SKILL.md'))[1];
  const saved = await ctx.tools.execute({ callId: 'recommend-save', name: 'write', arguments: { file_path: '画像.md', content: original + '\n' + example }, agent: home, signal });
  assert.equal(saved.isError, false);
  const reread = await ctx.tools.execute({ callId: 'recommend-read', name: 'read', arguments: { file_path: '画像.md' }, agent: home, signal });
  assert.equal(reread.isError, false);
  await untilSummary(async () => (await ctx.notaraVault.homeRecommendations({ workspaceId: workspace.id })).teacherRecommendations?.items.length === 2);
  const projected = (await ctx.notaraVault.homeRecommendations({ workspaceId: workspace.id })).teacherRecommendations;
  assert.equal(projected.items[0].references[0].path, '卡片/导数错题.md');
  assert.match(projected.items[0].reason, /补方法还是练熟操作/);
  const actions = buildHomeActions(await ctx.notaraVault.homeRecommendations({ workspaceId: workspace.id }));
  assert.equal(actions.primary.badge, '老师建议');
  assert.equal(actions.primary.request.reference.path, '卡片/导数错题.md');
  assert.equal(actions.alternatives[0].title, projected.items[1].text);
  const updated = await ctx.tools.execute({ callId: 'recommend-replace', name: 'edit', arguments: { file_path: '画像.md', old_string: example, new_string: '## 首页推荐\n- [ ] 今天先探索一个新问题\n  - 理由：学生刚提出了新想法。' }, agent: home, signal });
  assert.equal(updated.isError, false);
  await untilSummary(async () => (await ctx.notaraVault.homeRecommendations({ workspaceId: workspace.id })).teacherRecommendations?.items[0]?.text === '今天先探索一个新问题');
  const cleared = await ctx.tools.execute({ callId: 'recommend-complete', name: 'edit', arguments: { file_path: '画像.md', old_string: '- [ ] 今天先探索一个新问题', new_string: '- [x] 今天先探索一个新问题' }, agent: home, signal });
  assert.equal(cleared.isError, false);
  await untilSummary(async () => (await ctx.notaraVault.homeRecommendations({ workspaceId: workspace.id })).teacherRecommendations?.items.length === 0);
  assert.notEqual(buildHomeActions(await ctx.notaraVault.homeRecommendations({ workspaceId: workspace.id })).primary?.badge, '老师建议');
});

test('installed skills expose readable bundled templates via base directory without overwriting personal Vault templates', async t => {
  const { ctx, root, create } = await harness(t, { withController: true });
  const signal = new AbortController().signal;
  await mkdir(join(root, '模板'), { recursive: true });
  const personalContent = '---\ntemplate: true\nname: 个人推导题模板\n---\n# {{title}}\n个人专属结构，不得覆盖\n';
  await writeFile(join(root, '模板/计算与推导题模板.md'), personalContent);

  const organizer = await create('notara-material-organizer');
  const loadedPdfSkill = await ctx.tools.execute({
    callId: 'load-pdf-skill',
    name: 'skill',
    arguments: { name: 'notara-pdf-learning-set' },
    agent: organizer,
    signal,
  });
  assert.equal(loadedPdfSkill.isError, false);
  const skillText = JSON.stringify(loadedPdfSkill);
  const baseMatch = /Base directory for this skill:\s*([^\n"\\]+)/.exec(skillText);
  assert.ok(baseMatch, `expected skill base directory in ${skillText}`);
  const skillBaseDir = baseMatch[1].trim();

  // Read personal template first from workspace, then default bundled reference from skill directory.
  const personalRead = await ctx.tools.execute({
    callId: 'read-personal-template',
    name: 'read',
    arguments: { file_path: '模板/计算与推导题模板.md' },
    agent: organizer,
    signal,
  });
  assert.equal(personalRead.isError, false);
  assert.match(JSON.stringify(personalRead.value), /个人专属结构，不得覆盖/);

  const bundledMathProblem = await ctx.tools.execute({
    callId: 'read-bundled-math-template',
    name: 'read',
    arguments: { file_path: join(skillBaseDir, 'templates/math-problem.md') },
    agent: organizer,
    signal,
  });
  assert.equal(bundledMathProblem.isError, false);
  assert.match(JSON.stringify(bundledMathProblem.value), /题设阻碍与突破口形成/);

  const coordinator = await create('notara-coordinator');
  const loadedOrchSkill = await ctx.tools.execute({
    callId: 'load-orch-skill',
    name: 'skill',
    arguments: { name: 'notara-quest-orchestrator' },
    agent: coordinator,
    signal,
  });
  assert.equal(loadedOrchSkill.isError, false);
  const orchBaseDir = /Base directory for this skill:\s*([^\n"\\]+)/.exec(JSON.stringify(loadedOrchSkill))?.[1]?.trim();
  assert.ok(orchBaseDir);
  for (const rel of ['templates/route.md', 'templates/lesson.md', 'templates/learner-profile.md']) {
    const res = await ctx.tools.execute({
      callId: `read-${rel}`,
      name: 'read',
      arguments: { file_path: join(orchBaseDir, rel) },
      agent: coordinator,
      signal,
    });
    assert.equal(res.isError, false, `failed reading bundled ${rel}`);
  }
  assert.equal(await readFile(join(root, '模板/计算与推导题模板.md'), 'utf8'), personalContent, 'personal template in Vault must never be overwritten');
});

test('scripted native lesson preparation saves and reads the full draft, reviews the exact file, handles findings, rechecks changes and binds without worker writes or fact changes', { timeout: 25_000 }, async t => {
  // The adapter scripts the order. This tests real tools, file bytes, child sessions
  // and result delivery, not autonomous model compliance or a runtime review gate.
  const lessonPath = '备课/极值点偏移-60min.md';
  const oldPath = '备课/极值点偏移-旧稿.md';
  const oldBody = '---\ntype: lesson\n---\n# 旧稿\n- [ ] OLD_DRAFT_MUST_SURVIVE\n';
  const finding = '需修改：对数均值熟练度未知，正常目标不能直接调用；请明确独立迁移未完成时的补救与续接。';
  const reviewDecision = '- 审稿处理：采纳对数均值前置未知的意见，将该方法降为拓展；最低目标保留对称化主例题，正常目标保留独立短检验，顺畅再拓展、受阻先补台阶。';
  const introTask = '比较 $q(x)=(x-1)^2$ 在 $x=0,2$ 及 $x=0.5,1.5$ 两组位置的函数值与到 $x=1$ 的距离，说明各组有什么共同点';
  const coreTask = '设 $f(x)=\\ln x-x\\ (x>0)$，若 $x_1<1<x_2$ 且 $f(x_1)=f(x_2)$，探讨 $x_1+x_2$ 与 $2$ 的大小关系';
  const checkTask = '独立判断：设 $p(x)=\\ln x-2x$，若 $0<r_1<1/2<r_2$ 且 $p(r_1)=p(r_2)$，判断 $r_1+r_2$ 与 $1$ 的关系并给出理由';
  const checkFollowup = '- 独立短检验：先不提示方法；若受阻，只补定义域或单调区间的局部检查，再记录本次帮助条件；时间不足延后拓展，不挤掉当前迁移题的反馈。';
  const alternativeMethod = '- 备选解法：由等高条件得 $\\ln(x_2/x_1)=x_2-x_1$。令 $t=x_2/x_1>1$，则 $x_1=\\ln t/(t-1)$、$x_2=t\\ln t/(t-1)$，故两根和大于 $2$ 等价于 $h(t)=\\ln t-2(t-1)/(t+1)>0$。$h(1)=0$ 且 $h\'(t)=(t-1)^2/[t(t+1)^2]>0$，结论成立；同除前确认 $t-1>0$。';
  const alternativeChoice = '- 选路理由：等高关系便于消元而反射差函数难处理时，可选上述比值法；须能解释正变量范围和辅助函数。当前先用对称构造建立主线，完整备选法留教师参考，不追加课内任务或挤占检验时间。';
  const thinkingBridge = [
    '- 提示桥预案：若已会移项和单调性但策略受阻，已有认识是比较 $x_2$ 与 $2-x_1$；中间目标是先找到可比较的函数值。新增判断是把位置关系转到同一递减区间的函数值，理由是题设的等高关系可以替换其中一项。',
    '- 最少必要帮助：只问“想借同一递减区间比较两点位置，先比较什么？”让学生接续选出对象，再自行用等高条件替换并说明理由；仍卡住时只示范替换一项，余下交回学生。已会即跳过，不固定提示级数。',
    '- 撤提示复核：撤去比较对象的提示，让学生在同一关键判断上重新选出可比较对象并说明等高条件为何有用；只算导数或复述差函数不算此判断的复核。以上仅为未授课预案，不记录学生已完成。',
  ].join('\n');
  let currentLessonBody;
  const reviews = [];
  const workerPrompts = [];
  function* textStream(text) {
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'block-end', index: 0, block: { type: 'text', text } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
  function* toolStream(id, name, args) {
    const argumentsText = JSON.stringify(args);
    yield { type: 'block-start', index: 0, blockType: 'tool-call' };
    yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argumentsText };
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: argumentsText } };
    yield { type: 'finish', reason: { kind: 'tool-calls' } };
  }
  let bgDispatched = false;
  const { ctx, root, create, requests } = await harness(t, {
    withController: true,
    withBash: true,
    async *respond(options) {
      const currentAgent = ctx.agents.get(options.sessionId);
      const preset = currentAgent && ctx.agentPresets.composedPreset(currentAgent.ctx);
      const userText = JSON.stringify(options.messages.filter(m => m.role === 'user'));
      if (preset === 'worker-general') {
        workerPrompts.push({ preset, userText });
        yield* textStream(userText.includes('候选母题研究')
          ? '候选母题研究：卡片/极值点偏移母题.md 可提供 $f(x)=\\ln x-x$ 的等高点关系；触发信号是两点同高与位置比较，使用反射点须核查定义域与同一单调支。选定主例后再研究相应检验题，不在本次调研拟整课。'
          : '独立反例研究：二次函数 $q(x)=(x-1)^2$ 满足二阶导数恒正却关于极值点对称，故二阶导数符号不直接决定偏移。可联系等高点、反射与单调性三个知识单元；结论来自该具体反例，不推定学生已经理解。');
        return;
      }
      if (preset === 'worker-review') {
        const readResult = options.messages.find(message => message.role === 'tool' && message.toolCallId === 'review-read-final');
        if (!readResult) {
          workerPrompts.push({ preset: 'worker-review', userText });
          assert.ok(userText.includes(lessonPath), 'handoff identifies this saved draft, not an old lesson');
          yield* toolStream('review-read-final', 'read', { file_path: lessonPath });
          return;
        }
        assert.equal(readResult.isError, false, JSON.stringify(readResult));
        const toolText = readResult.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
        assert.ok(toolText.includes(`<path>${await realpath(join(root, lessonPath))}</path>`), 'reviewer receives the exact canonical path');
        assert.deepEqual(toolText.split('\n').filter(line => /^\d+: /.test(line)).map(line => line.replace(/^\d+: /, '')), currentLessonBody.split('\n'), 'reviewer receives every actual line, including teacher references and the tail');
        assert.ok(toolText.includes(`End of file - total ${currentLessonBody.split('\n').length} lines`));
        assert.ok(!toolText.includes('OLD_DRAFT_MUST_SURVIVE'));
        reviews.push({ sessionId: options.sessionId, body: currentLessonBody });
        yield* textStream(toolText.includes(reviewDecision)
          ? 'INTERNAL_PREP_SECRET_AUDIT：受影响部分复核通过，对数均值已降为拓展并保留独立短检验；尚无学生掌握证据。'
          : `INTERNAL_PREP_SECRET_AUDIT：${finding}`);
        return;
      }
      if (userText.includes('TRIGGER_BG_AUDIT') && !bgDispatched) {
        bgDispatched = true;
        yield* toolStream('bg-audit-1', 'subagent', { preset: 'worker-review', description: '复核修订后的受影响部分', prompt: `${abcPayload}\n请 read 完整文件 ${lessonPath}，复核审稿意见涉及的目标取舍与独立短检验；前置题卡核验不算最终稿审查。`, run_in_background: true });
        return;
      }
      yield* textStream('备课稿已保存；审稿完成后处理并绑定，尚未开始授课。');
    },
  });
  await mkdir(join(root, '备课'), { recursive: true });
  await mkdir(join(root, '卡片'), { recursive: true });
  await mkdir(join(root, '路线'), { recursive: true });
  const retainedFiles = new Map([
    [oldPath, oldBody],
    ['00-学习画像与偏好.md', '---\ntype: learner-profile\n---\n# 合成画像\n商法则符号偶有失误；对数均值熟练度未知。\n'],
    ['卡片/极值点偏移母题.md', '---\ntype: card\nreview_history: []\n---\n# 母题\n## 学生理解\n暂无本次课堂作答证据。\n'],
    ['路线/导数路线.md', '---\ntype: route\n---\n# 导数路线\n- [ ] 独立完成极值点偏移证明\n'],
  ]);
  for (const [path, body] of retainedFiles) await writeFile(join(root, path), body);
  const vaultFiber = await ctx.plugin(await import('../../vault-sqlite/index.js'), { root, cachePath: ':memory:' });
  await vaultFiber.await();
  const signal = new AbortController().signal;
  const teacher = await create('notara-teacher');

  const assembledTeacherPrompt = renderPrompt(await ctx.systemPrompt.assemble({ scope: teacher }));
  const runtimeStart = assembledTeacherPrompt.indexOf('## 当前 DSH 工具合同');
  assert.ok(runtimeStart >= 0, 'the actual teacher assembly includes the runtime contract');
  const runtimeTeacherContract = assembledTeacherPrompt.slice(runtimeStart);
  assert.match(assembledTeacherPrompt,/notara-lesson-preparation/);
  assert.match(assembledTeacherPrompt,/主老师先定整课立意与递进/);
  const delegation=(await ctx.systemPrompt.assemble({scope:teacher})).tools.find(tool=>tool.name==='subagent');
  assert.match(delegation.description,/单课备课仅用 worker-general 调研与 worker-review 审核/);
  assert.equal(runtimeTeacherContract.includes('内部备课与验算调用 worker-lesson / worker-problem / worker-exercise / worker-review / worker-general'), false, 'the old five-worker preparation instruction must not survive assembly');

  const skillRes = await ctx.tools.execute({
    callId: 'load-lesson-prep',
    name: 'skill',
    arguments: { name: 'notara-lesson-preparation' },
    agent: teacher,
    signal,
  });
  assert.equal(skillRes.isError, false);
  assert.match(JSON.stringify(skillRes.value), /notara-lesson-preparation/);
  const preparationRouting=JSON.stringify(skillRes.value);
  assert.match(preparationRouting,/worker-general.{0,12}调研.{0,12}worker-review.{0,12}审核/);
  assert.ok(/任务依赖/.test(preparationRouting)&&/并行/.test(preparationRouting)&&/串行/.test(preparationRouting),'loaded skill owns dependency ordering');
  assert.match(preparationRouting,/整课构思/);
  assert.match(preparationRouting,/保存并.*read.*回读完整稿后/);
  const tutor=resource('role-skills/teacher/notara-quest-tutor/SKILL.md');
  assert.match(tutor,/正式独立练习题[\s\S]*不预置额外辅助线、提示或拆步作答组件/);
  assert.match(tutor,/讲解新概念的推演演示/);

  // Research helpers retain their own resources and tools, without inheriting
  // the teacher's whole-lesson skill. Other workers remain usable elsewhere.
  const problemWorker = await create('worker-problem');
  const workerSkill = await ctx.tools.execute({
    callId: 'worker-load-examiner',
    name: 'skill',
    arguments: { name: 'notara-examiner-analysis' },
    agent: problemWorker,
    signal,
  });
  assert.equal(workerSkill.isError, false);
  assert.equal(ctx.tools.get('subagent', problemWorker), undefined);
  assert.equal(ctx.tools.get('write', problemWorker), undefined);
  const reviewWorker = await create('worker-review');
  assert.ok(ctx.tools.get('bash', reviewWorker), 'worker-review must expose bash for independent checks');
  const scriptCheck = await ctx.tools.execute({
    callId: 'review-worker-script-check', name: 'bash',
    arguments: { description: 'Check a small arithmetic result without file writes', command: "printf 'review-check:%s\\n' \"$((6 * 7))\"", timeoutMs: 5000 },
    agent: reviewWorker, signal,
  });
  assert.equal(scriptCheck.isError, false, JSON.stringify(scriptCheck));
  assert.equal(scriptCheck.value.kind, 'foreground');
  assert.equal(scriptCheck.value.exitCode, 0);
  assert.equal(scriptCheck.value.stdout.text, 'review-check:42\n');
  assert.equal(scriptCheck.value.stderr.text, '');
  assert.equal(scriptCheck.value.timedOut, false);
  assert.equal(scriptCheck.value.aborted, false);
  const lessonWorker = await create('worker-lesson');
  const exerciseWorker = await create('worker-exercise');
  const generalWorker = await create('worker-general');
  for (const worker of [problemWorker, reviewWorker, lessonWorker, exerciseWorker, generalWorker]) {
    assert.ok(ctx.tools.get('read', worker));
    const skillList = await ctx.skills.list({ cwd: root, scope: worker });
    assert.ok(!skillList.some(skill => skill.name === 'notara-lesson-preparation'));
    const deniedPrepSkill = await ctx.tools.execute({ callId: `worker-denied-prep-${worker.id}`, name: 'skill', arguments: { name: 'notara-lesson-preparation' }, agent: worker, signal });
    assert.equal(deniedPrepSkill.isError, true, 'workers cannot load the teacher preparation skill');
    assert.ok(ctx.tools.get('bash', worker), 'every worker may compute without inheriting teacher ownership');
    for (const name of ['write', 'edit', 'subagent', 'lesson_plan']) assert.equal(ctx.tools.get(name, worker), undefined, `${name} is unavailable to ${worker.id}`);
    for (const [name, args] of [
      ['write', { file_path: oldPath, content: 'UNAUTHORIZED_OVERWRITE' }],
      ['edit', { file_path: oldPath, old_string: 'OLD_DRAFT_MUST_SURVIVE', new_string: 'UNAUTHORIZED_EDIT' }],
    ]) {
      const denied = await ctx.tools.execute({ callId: `denied-${name}-${worker.id}`, name, arguments: args, agent: worker, signal });
      assert.equal(denied.isError, true, JSON.stringify(denied));
      assert.equal(await readFile(join(root, oldPath), 'utf8'), oldBody);
    }
  }

  // C and the course intent are supplied by this fixture. Native reads of A/B
  // precede two independent research questions within that same concrete plan;
  // this is not evidence that the model independently formed the plan.
  for (const path of ['卡片/极值点偏移母题.md', '00-学习画像与偏好.md']) {
    const readInput = await ctx.tools.execute({ callId: `teacher-read-input-${path}`, name: 'read', arguments: { file_path: path }, agent: teacher, signal });
    assert.equal(readInput.isError, false);
    assert.equal(readInput.value.lines.length, readInput.value.totalLines);
    assert.equal(readInput.value.lines.map(line => line.text).join('\n').trimEnd(), retainedFiles.get(path).trimEnd());
  }
  const lessonThroughline = '整课构思：由熟悉二次函数的等高与等距观察进入，比较一般函数的等高点位置，再检验条件变化；关键进展是解释为何将位置关系转成函数值比较。';
  const abcPayload = `A: 卡片/极值点偏移母题.md；B: 00-学习画像与偏好.md，历史记录显示商法则 (ln x / x)' 分子符号易错，对数均值未证实（未知）；C: 60 分钟。${lessonThroughline}主例及课堂任务由老师选定；未知问题分别是候选主例的条件和二阶导数概括的反例，当前只调研相应局部产物。`;
  const research = await Promise.all([
    ['research-candidate', '候选母题研究'],
    ['research-counterexample', '独立反例研究'],
  ].map(([callId, question]) => ctx.tools.execute({ callId, name: 'subagent', arguments: { preset: 'worker-general', description: question, prompt: `${abcPayload}\n${question}：给出局部依据、成立条件与跨题联系，不代写整课。` }, agent: teacher, signal })));
  for (const result of research) {
    assert.equal(result.isError, false, JSON.stringify(result));
    assert.equal(result.value.kind, 'foreground');
    assert.equal(result.value.preset, 'worker-general');
    assert.equal(result.value.stopReason, 'completed');
  }
  assert.match(JSON.stringify(research[0].value.output), /候选母题研究/);
  assert.match(JSON.stringify(research[1].value.output), /独立反例研究/);
  assert.equal(workerPrompts.length, 2);
  for (const row of workerPrompts) {
    assert.equal(row.preset, 'worker-general');
    assert.match(row.userText, /商法则.*未知/);
    assert.ok(row.userText.includes(lessonThroughline), 'independent researchers receive the same concrete course intent');
  }

  // Teacher synthesizes and saves type: lesson without fabricating student understanding or review records.
  const lessonBody = [
    '---',
    'title: 极值点偏移（60分钟备课本）',
    'type: lesson',
    'summary: "围绕极值点偏移组织从现象观察、对称化构造到多解比较的60分钟单课备课本。"',
    '---',
    '# 极值点偏移（60分钟备课本）',
    '',
    '## 本课目标与学情依据',
    '- A：围绕 $f(x)=\\ln x-x$ 建立极值点偏移证明主线。',
    '- B：已有记录显示 $\\left(\\frac{\\ln x}{x}\\right)\'$ 商法则分子符号偶有失误；对数均值不等式熟练度未知。',
    '- C：60 分钟，保住核心主例题与方法条件。',
    '',
    '## 课堂任务清单',
    `- [ ] ${introTask}`,
    '',
    '<details data-notara="teacher">',
    '<summary>教师参考</summary>',
    '',
    '- 用途与活动（10 分钟）：用已学二次函数建立“等高是否总等距”的观察起点。教师展示：$q(0)=q(2)=1$，让学生自己计算第二组数值并比较距离，不先给一般结论。',
    '- 参考解答：$q(0.5)=q(1.5)=1/4$，两组到 $x=1$ 的距离分别为 $1$ 和 $1/2$，每组各自等高等距；这只是当前二次函数的现象。',
    '- 推进与补救：能算出第二组并说明比较对象后进入下一题；受阻时只示范 $q(0)$ 的代入，再让学生完成其余值。',
    '- 衔接：老师追问“换成下一题的函数，等高还必然等距吗”，引出主问题。注意二次函数 $f\'\'(x)>0$ 仍对称，不能仅凭二阶导数符号直接断定偏移方向。',
    '',
    '</details>',
    '',
    `- [ ] ${coreTask}`,
    '',
    '<details data-notara="teacher">',
    '<summary>教师参考</summary>',
    '',
    '- 方式：按实际卡点选择讲清或搭梯（25 分钟），盯防定义域与复合求导符号；不要求每个运算都追问。',
    thinkingBridge,
    '- 完整推导：$f\'(x)=1/x-1$，故 $f$ 在 $(1,+\\infty)$ 递减。$G\'(x)=2(x-1)^2/[x(2-x)]>0$（$0<x<1$）且 $G(1)=0$，所以 $f(x_1)<f(2-x_1)$。两侧比较点 $x_2,2-x_1$ 同在递减区间，结合 $f(x_2)=f(x_1)$ 得 $x_2>2-x_1$，即 $x_1+x_2>2$。',
    '- 方法比较：对比对称构造、对数均值不等式（按 B 未知先确认是否需用 $h(t)$ 补证）与 $t=x_2/x_1>1$ 比值换元。',
    alternativeMethod,
    alternativeChoice,
    '- 贴例费曼总结：贴着本题说明为什么想到 $2-x_1$ 及为何必须落回同一单调区间。',
    '- 超时取舍：若本环节超过 30 分钟，优先缩减后续含参变式，留作下次续接。',
    '',
    '</details>',
    '',
    `- [ ] ${checkTask}`,
    '',
    '<details data-notara="teacher">',
    '<summary>教师参考</summary>',
    '',
    '- 用途与活动（15 分钟）：把系数改变后的方法选择留给学生，老师先只给完整题面，观察学生能否自行选路，不能先把换元写进公开任务。',
    '- 参考解答：令 $t_i=2r_i$，则 $p(r_i)=\\ln t_i-t_i-\\ln2$，等高关系化为主例题，且 $t_1<1<t_2$。因此 $t_1+t_2>2$，即 $r_1+r_2>1$。也可直接检查关于 $1/2$ 的反射构造及单调区间。',
    '- 推进与衔接：只有实际独立选路并说明区间条件后才讨论拓展；未作答时保持待处理，本次纯备课不预填检验结果。',
    '',
    '</details>',
    '',
    '## 本节总结与下次续接',
    '- 尚未开始授课；无学生作答记录。',
  ].join('\n');
  currentLessonBody = lessonBody;
  const writeLesson = await ctx.tools.execute({
    callId: 'save-lesson-book',
    name: 'write',
    arguments: { file_path: lessonPath, content: lessonBody },
    agent: teacher,
    signal,
  });
  assert.equal(writeLesson.isError, false);
  const readBack = await ctx.tools.execute({
    callId: 'readback-lesson-book',
    name: 'read',
    arguments: { file_path: lessonPath },
    agent: teacher,
    signal,
  });
  assert.equal(readBack.isError, false);
  assert.equal(readBack.value.path, await realpath(join(root, lessonPath)));
  assert.deepEqual(readBack.value.lines.map(line => line.text), lessonBody.split('\n'));
  assert.equal(readBack.value.totalLines, lessonBody.split('\n').length);
  assert.doesNotMatch(lessonBody, /notara-review|## 学生理解/);
  const referenceBlocks = [...lessonBody.matchAll(/<details data-notara="teacher">([\s\S]*?)<\/details>/g)];
  assert.equal(referenceBlocks.length, 3, 'opening, core and independent check each retain folded teacher references');
  const publicBody = lessonBody.replace(/<details data-notara="teacher">[\s\S]*?<\/details>/g, '');
  for (const phrase of ['教师展示：', '完整推导：', '参考解答：', '提示桥预案：', '备选解法：', '选路理由：']) {
    assert.ok(referenceBlocks.some(block => block[1].includes(phrase)));
    assert.ok(!publicBody.includes(phrase), `${phrase} stays inside teacher references`);
  }
  assert.ok(referenceBlocks[1][1].includes(alternativeMethod) && referenceBlocks[1][1].includes(alternativeChoice));
  assert.ok(referenceBlocks[1][1].includes(thinkingBridge), 'the complete continuation and prompt-withdrawal plan stays in the saved teacher reference');

  const finalReview = await ctx.tools.execute({
    callId: 'review-saved-full-lesson', name: 'subagent',
    arguments: { preset: 'worker-review', description: '独立审查已保存完整课稿', prompt: `${abcPayload}\n请 read ${lessonPath} 本次完整备课本（含教师参考与收尾）；前置题卡核验不算最终稿审查。` },
    agent: teacher, signal,
  });
  assert.equal(finalReview.isError, false, JSON.stringify(finalReview));
  assert.equal(finalReview.value.kind, 'foreground');
  assert.ok(finalReview.value.output.some(block => block.type === 'text' && block.text.includes(finding)), 'actual reviewer conclusion returns to the caller');
  assert.equal(reviews.length, 1);
  assert.equal(await readFile(join(root, lessonPath), 'utf8'), lessonBody, 'review only reads the saved draft');

  const teacherRead = await ctx.tools.execute({ callId: 'teacher-read-reviewed-draft', name: 'read', arguments: { file_path: lessonPath }, agent: teacher, signal });
  assert.equal(teacherRead.isError, false);
  assert.deepEqual(teacherRead.value.lines.map(line => line.text), lessonBody.split('\n'));
  const revised = await ctx.tools.execute({
    callId: 'teacher-handle-review-finding', name: 'edit',
    arguments: { file_path: lessonPath, old_string: '- 方法比较：对比对称构造、对数均值不等式（按 B 未知先确认是否需用 $h(t)$ 补证）与 $t=x_2/x_1>1$ 比值换元。', new_string: `${reviewDecision}\n${checkFollowup}` },
    agent: teacher, signal,
  });
  assert.equal(revised.isError, false, JSON.stringify(revised));
  currentLessonBody = lessonBody.replace('- 方法比较：对比对称构造、对数均值不等式（按 B 未知先确认是否需用 $h(t)$ 补证）与 $t=x_2/x_1>1$ 比值换元。', `${reviewDecision}\n${checkFollowup}`);
  assert.equal(await readFile(join(root, lessonPath), 'utf8'), currentLessonBody);
  const revisedRead = await ctx.tools.execute({ callId: 'teacher-readback-revision', name: 'read', arguments: { file_path: lessonPath }, agent: teacher, signal });
  assert.equal(revisedRead.isError, false);
  assert.deepEqual(revisedRead.value.lines.map(line => line.text), currentLessonBody.split('\n'));

  // Background settlement preserves the reviewer's session identity and delivers
  // its conclusion into the next real teacher request. No browser projection is tested.
  teacher.followup(createUserMessage({ content: [{ type: 'text', text: 'TRIGGER_BG_AUDIT：复核本次修订后的完整备课本，尚未授课' }], source: { kind: 'user' } }));
  await teacher.whenIdle();
  await ctx.subagents.waitForChildren(teacher);
  for (let i = 0; i < 40; i++) {
    await teacher.whenIdle();
    if (teacher.session.snapshotEvents().some(event => event.type === 'user/message' && event.data?.source?.kind === 'subagent-settled')) break;
    await new Promise(resolve => setTimeout(resolve, 15));
  }
  const parentEvents = teacher.session.snapshotEvents();
  const settledMsg = parentEvents.find(event => event.type === 'user/message' && event.data?.source?.kind === 'subagent-settled');
  assert.ok(settledMsg, 'expected subagent-settled event in parent session');
  const bgChildId = settledMsg.data.source.senderSessionId;
  assert.ok(bgChildId);
  await teacher.whenIdle();
  const childSession = await ctx.sessionQuery.readSession(bgChildId);
  const childPreset = childSession.events.filter(e => e.type === 'agent-preset/selected').at(-1)?.data.agentPreset ?? childSession.session.agentPreset;
  assert.equal(childPreset, 'worker-review');
  assert.equal(reviews.length, 2);
  assert.equal(reviews[1].sessionId, bgChildId);
  assert.equal(reviews[1].body, currentLessonBody);
  for (const review of reviews) {
    const snapshot = await ctx.sessionQuery.readSession(review.sessionId);
    const calls = snapshot.events.filter(event => event.type === 'tool/call');
    assert.deepEqual(calls.map(event => ({ name: event.data.name, args: JSON.parse(event.data.arguments) })), [{ name: 'read', args: { file_path: lessonPath } }]);
    const readEvent = snapshot.events.find(event => event.type === 'tool/result' && event.data.message.toolCallId === 'review-read-final');
    const conclusion = snapshot.events.find(event => event.type === 'assistant/message' && event.data.message.content.some(block => block.type === 'text' && block.text.includes('INTERNAL_PREP_SECRET_AUDIT')));
    assert.ok(readEvent && conclusion);
    assert.ok(snapshot.events.indexOf(readEvent) < snapshot.events.indexOf(conclusion), 'real read result precedes scripted reviewer conclusion');
  }
  assert.match(JSON.stringify(settledMsg.data), /受影响部分复核通过/);
  assert.ok(requests.some(request => request.sessionId === teacher.id && request.messages.some(message => message.source?.kind === 'subagent-settled' && JSON.stringify(message.content).includes('受影响部分复核通过'))), 'native settlement reaches the next teacher request');
  assert.deepEqual(new Set(workerPrompts.map(row => row.preset)), new Set(['worker-general', 'worker-review']));
  const finalSave = await ctx.tools.execute({ callId: 'teacher-final-save-after-audit', name: 'write', arguments: { file_path: lessonPath, content: currentLessonBody }, agent: teacher, signal });
  assert.equal(finalSave.isError, false, JSON.stringify(finalSave));
  const finalRead = await ctx.tools.execute({ callId: 'teacher-read-after-recheck', name: 'read', arguments: { file_path: lessonPath }, agent: teacher, signal });
  assert.equal(finalRead.isError, false);
  assert.deepEqual(finalRead.value.lines.map(line => line.text), currentLessonBody.split('\n'));
  const bind = await ctx.tools.execute({ callId: 'bind-reviewed-lesson', name: 'lesson_plan', arguments: { action: 'bind', path: lessonPath }, agent: teacher, signal });
  assert.equal(bind.isError, false, JSON.stringify(bind));
  const bound = JSON.parse(bind.value.result);
  assert.equal(bound.bound, true);
  assert.equal(bound.path, lessonPath);
  assert.equal(bound.currentTask, null, 'pure preparation does not start teaching');
  assert.deepEqual(bound.tasks.map(task => task.content), [introTask, coreTask, checkTask], 'binding preserves opening -> core -> independent check without exposing reference text');
  assert.ok(bound.tasks.every(task => task.checked === false));
  // bind adds host-owned stable task anchors; all reviewed prose remains exact.
  const boundBody = await readFile(join(root, lessonPath), 'utf8');
  assert.equal(boundBody.replace(/ <!-- notara-task:[a-zA-Z0-9_-]{3,48} -->/g, ''), currentLessonBody);
  assert.ok(boundBody.includes('尚未开始授课；无学生作答记录。'));

  // The fixture chooses a planned smaller-goal branch; it does not simulate a
  // learner diagnosis. Save/read/bind a different task rather than relabel the
  // original proof as easier or manufacture a student observation in the profile.
  const smallerPath = '备课/等高与距离-较小目标预案.md';
  const smallerTask = '读取三条测量记录，指出哪两次高度相同，并比较它们到位置 1 的距离';
  const smallerBody = [
    '---', 'type: lesson', 'title: 等高与距离的具体比较', '---',
    '# 等高与距离的具体比较', '',
    '<details data-notara="teacher">', '<summary>教师参考</summary>', '',
    '- 适用分支：若今后实际观察到概念或关系受阻，目标缩小为区分这三条记录中的等高与等距；当前只是未授课预案，不声称已经观察到此卡点。',
    '- 运算受阻可提供计算结果，但关系仍不清时不继续追加公式提示。改用熟悉的长度测量、三个固定位置和整数高度，去掉字母、参数与函数变换。',
    '- 延后一般性证明、比值法与系数变化迁移题；检验只看能否辨认给定记录的两种关系，不把局部判断记成独立完成原证明。',
    '', '</details>', '',
    `- [ ] ${smallerTask}`, '',
    '| 位置（厘米） | 0 | 1 | 3 |', '| --- | --- | --- | --- |', '| 高度（厘米） | 4 | 1 | 4 |', '',
    '<details data-notara="teacher">', '<summary>教师参考</summary>', '',
    '- 具体解答：位置 0 和 3 高度同为 4，到位置 1 的距离分别为 1 和 2，并不相等。这里只解释给出的记录，不推断完整函数的极值或一般定理。',
    '- 先让学生指出对应数据再说明距离；若仍受阻，示范一处距离后让其比较另一处，帮助条件另记。本分支约 10 分钟，后续依实际表现再恢复原目标。',
    '', '</details>', '',
    '## 本节总结与下次续接', '- 尚未开始授课；无学生作答记录。',
  ].join('\n');
  const saveSmaller = await ctx.tools.execute({ callId: 'save-smaller-goal-branch', name: 'write', arguments: { file_path: smallerPath, content: smallerBody }, agent: teacher, signal });
  assert.equal(saveSmaller.isError, false, JSON.stringify(saveSmaller));
  for (const reader of [teacher, reviewWorker]) {
    const readSmaller = await ctx.tools.execute({ callId: `read-smaller-goal-${reader.id}`, name: 'read', arguments: { file_path: smallerPath }, agent: reader, signal });
    assert.equal(readSmaller.isError, false);
    assert.equal(readSmaller.value.path, await realpath(join(root, smallerPath)));
    assert.deepEqual(readSmaller.value.lines.map(line => line.text), smallerBody.split('\n'));
  }
  const bindSmaller = await ctx.tools.execute({ callId: 'bind-smaller-goal-branch', name: 'lesson_plan', arguments: { action: 'bind', path: smallerPath }, agent: teacher, signal });
  assert.equal(bindSmaller.isError, false, JSON.stringify(bindSmaller));
  const smallerPlan = JSON.parse(bindSmaller.value.result);
  assert.equal(smallerPlan.path, smallerPath);
  assert.deepEqual(smallerPlan.tasks.map(task => ({ content: task.content, checked: task.checked })), [{ content: smallerTask, checked: false }]);
  assert.equal(smallerPlan.currentTask, null);
  assert.equal(await readFile(join(root, lessonPath), 'utf8'), boundBody, 'the smaller branch preserves the original full draft and its alternative proof');
  for (const [path, body] of retainedFiles) assert.equal(await readFile(join(root, path), 'utf8'), body, `preparation leaves ${path} unchanged`);
});

test('lesson_plan tool is exclusive to notara-teacher, host-binds sessionId and workspaceId, excludes hidden teacher tasks, and enforces CAS', { timeout: 25_000 }, async t => {
  const { ctx, root, create } = await harness(t, { withController: true });
  const fiber = await ctx.plugin(await import('../../vault-sqlite/index.js'), { root, cachePath: ':memory:' });
  await fiber.await();

  const signal = new AbortController().signal;
  const teacher = await create('notara-teacher');
  const teacher2 = await create('notara-teacher');
  const coordinator = await create('notara-coordinator');
  const organizer = await create('notara-material-organizer');
  const worker = await create('worker-lesson');
  const companion = await create('companion-deepseek');
  const blind = await create('companion-deepseek-blind');

  assert.ok(ctx.tools.get('lesson_plan', teacher));
  for (const agent of [coordinator, organizer, worker, companion, blind]) {
    assert.equal(ctx.tools.get('lesson_plan', agent), undefined);
    const denied = await ctx.tools.execute({
      callId: 'denied-lesson-plan',
      name: 'lesson_plan',
      arguments: { action: 'read' },
      agent,
      signal,
    });
    assert.equal(denied.isError, true);
  }

  // Schema must not expose sessionId or workspaceId to the model.
  const schemaProps = ctx.tools.get('lesson_plan', teacher).parameters.properties;
  assert.equal(schemaProps.sessionId, undefined);
  assert.equal(schemaProps.workspaceId, undefined);

  await mkdir(join(root, '备课'), { recursive: true });
  const writeRes = await ctx.tools.execute({
    callId: 'teacher-write-lesson',
    name: 'write',
    arguments: {
      file_path: '备课/课堂清单验证.md',
      content: [
        '---',
        'type: lesson',
        'status: ready',
        '---',
        '# 课堂清单验证',
        '- [ ] 热身：回顾导数几何意义',
        '- [ ] 主例题：独立构造辅助函数',
        '<details data-notara="teacher">',
        '- [ ] 教师私密备忘：不要泄漏给学生清单',
        '</details>',
        '',
      ].join('\n'),
    },
    agent: teacher,
    signal,
  });
  assert.equal(writeRes.isError, false);

  // Immediately bind in the very next step before chokidar debounce.
  const bindRes = await ctx.tools.execute({
    callId: 'teacher-bind-lesson',
    name: 'lesson_plan',
    arguments: { action: 'bind', path: '备课/课堂清单验证.md' },
    agent: teacher,
    signal,
  });
  assert.equal(bindRes.isError, false, JSON.stringify(bindRes));
  const boundPayload = JSON.parse(bindRes.value.result);
  assert.equal(boundPayload.bound, true);
  assert.equal(boundPayload.counts.total, 2);
  assert.equal(boundPayload.nextTask.content, '热身：回顾导数几何意义');
  assert.doesNotMatch(bindRes.value.result, /教师私密备忘/);

  // Another teacher session remains unbound even if extra spoofed sessionId were passed in arguments.
  const teacher2Read = await ctx.tools.execute({
    callId: 'teacher2-read',
    name: 'lesson_plan',
    arguments: { action: 'read' },
    agent: teacher2,
    signal,
  });
  assert.equal(JSON.parse(teacher2Read.value.result).bound, false);

  // Set current task, complete it, and verify stale expectedRevision fails honestly.
  const setRes = await ctx.tools.execute({
    callId: 'teacher-set-current',
    name: 'lesson_plan',
    arguments: {
      action: 'set_current',
      line: boundPayload.tasks[0].line,
      expectedText: boundPayload.tasks[0].expectedText,
      expectedRevision: boundPayload.revision,
    },
    agent: teacher,
    signal,
  });
  assert.equal(setRes.isError, false, JSON.stringify(setRes));
  const activePayload = JSON.parse(setRes.value.result);
  assert.equal(activePayload.currentTask.content, '热身：回顾导数几何意义');

  const staleFail = await ctx.tools.execute({
    callId: 'teacher-stale-complete',
    name: 'lesson_plan',
    arguments: {
      action: 'complete',
      line: activePayload.tasks[0].line,
      expectedText: activePayload.tasks[0].expectedText,
      expectedRevision: boundPayload.revision, // stale!
    },
    agent: teacher,
    signal,
  });
  assert.equal(staleFail.isError, true);
  assert.match(JSON.stringify(staleFail), /版本已变化/);

  const completeRes = await ctx.tools.execute({
    callId: 'teacher-complete-1',
    name: 'lesson_plan',
    arguments: {
      action: 'complete',
      line: activePayload.tasks[0].line,
      expectedText: activePayload.tasks[0].expectedText,
      expectedRevision: activePayload.revision,
    },
    agent: teacher,
    signal,
  });
  assert.equal(completeRes.isError, false, JSON.stringify(completeRes));
  const donePayload = JSON.parse(completeRes.value.result);
  assert.equal(donePayload.counts.completed, 1);
  assert.equal(donePayload.currentTask, null);
  assert.equal(donePayload.nextTask.content, '主例题：独立构造辅助函数');

  // Coordinator reads active classroom-lesson bindings and review confirmations read-only, without lesson_plan tool access.
  const coordAssembly = {contexts:await collectRuntimeContexts(ctx,coordinator)};
  assert.ok(coordAssembly.contexts.some(c => c.name === 'notara-review-confirmations'), 'coordinator retains review confirmation snapshot');
  const coordBindingsCtx = coordAssembly.contexts.find(c => c.name === 'notara-lesson-bindings');
  assert.ok(coordBindingsCtx, 'coordinator receives read-only classroom-lesson binding snapshot');
  assert.match(coordBindingsCtx.text, new RegExp(teacher.id));
  assert.match(coordBindingsCtx.text, /备课\/课堂清单验证\.md/);

  // Bound teacher receives read-only notara-current-lesson-plan snapshot on reload/UI binding; unbound teacher2 does not.
  const teacherBoundAssembly = {contexts:await collectRuntimeContexts(ctx,teacher)};
  const teacherPlanCtx = teacherBoundAssembly.contexts.find(c => c.name === 'notara-current-lesson-plan');
  assert.ok(teacherPlanCtx, 'bound teacher receives current lesson plan context');
  assert.match(teacherPlanCtx.text, /备课\/课堂清单验证\.md/);
  assert.match(teacherPlanCtx.text, /主例题：独立构造辅助函数/);
  const teacher2Contexts = await collectRuntimeContexts(ctx,teacher2);
  assert.equal(teacher2Contexts.find(c => c.name === 'notara-current-lesson-plan').text, '');

  // Archiving the classroom via real DSH WorkspaceRegistry excludes it from lessonBindings/coordinator context and blocks mutations.
  await ctx.workspaceRegistry.archiveSession(teacher.id);
  const ws = await ctx.workspaceRegistry.resolveByPath(root);
  const afterArchiveBindings = await ctx.notaraVault.lessonBindings({ workspaceId: ws.id });
  assert.deepEqual(afterArchiveBindings.bindings, [], 'archived session must be excluded from active lessonBindings');
  const coordAfterArchive = await collectRuntimeContexts(ctx,coordinator);
  assert.equal(coordAfterArchive.find(c => c.name === 'notara-lesson-bindings').text, '');
  const archivedMutate = await ctx.tools.execute({
    callId: 'teacher-archived-mutate',
    name: 'lesson_plan',
    arguments: {
      action: 'set_current',
      line: donePayload.tasks[1].line,
      expectedText: donePayload.tasks[1].expectedText,
      expectedRevision: donePayload.revision,
    },
    agent: teacher,
    signal,
  });
  assert.equal(archivedMutate.isError, true);
  assert.match(JSON.stringify(archivedMutate), /已归档课堂/);
});

test('Phase 5 post-lesson loop: mid-lesson waiting never closes class; explicit closure saves & reads summary, rejects invalid locators, cold-resumes closed home, handles partial failure honestly, deduplicates retries, adapts next lesson on verification gaps, and preserves classroom checklist across ad-hoc turns', { timeout: 30_000 }, async t => {
  function* textTurn(text) {
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'block-end', index: 0, block: { type: 'text', text } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
  function* toolCallTurn(id, name, argsObj) {
    const args = JSON.stringify(argsObj);
    yield { type: 'block-start', index: 0, blockType: 'tool-call' };
    yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args };
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } };
    yield { type: 'finish', reason: { kind: 'tool-calls' } };
  }

  let homeTurnStep = 0;
  let homeId = null;
  let deliveryPhase = 'idle';
  let phaseStep = 0;

  const { ctx, root, create, handles } = await harness(t, {
    withController: true,
    async *respond(options) {
      const isCoordinator = homeId !== null && options.sessionId === homeId;
      const allMsgs = JSON.stringify(options.messages);

      if (!isCoordinator) {
        if (allMsgs.includes('MID_LESSON_WAIT')) {
          yield* textTurn('请先写出你设的切点坐标，我等你回答后再继续。');
          return;
        }
        yield* textTurn('收到，我们继续。');
        return;
      }

      if (deliveryPhase === 'ghost') {
        const step = phaseStep++;
        if (step === 0) {
          yield* toolCallTurn(`coord-read-ghost-${++homeTurnStep}`, 'read', { file_path: '备课/未保存的幽灵总结.md' });
          return;
        }
        yield* textTurn('未能读取总结原文件（备课/未保存的幽灵总结.md 不存在），暂不更新画像或路线。');
        return;
      }

      if (deliveryPhase === 'first') {
        const step = phaseStep++;
        if (step === 0) {
          yield* toolCallTurn(`coord-read-summary-${++homeTurnStep}`, 'read', { file_path: '备课/极值点偏移-第一课.md' });
          return;
        }
        if (step === 1) {
          yield* toolCallTurn(`coord-read-profile-${++homeTurnStep}`, 'read', { file_path: '00-学习画像与偏好.md' });
          return;
        }
        if (step === 2) {
          yield* toolCallTurn(`coord-read-route-${++homeTurnStep}`, 'read', { file_path: '路线/导数主线.md' });
          return;
        }
        if (step === 3) {
          yield* toolCallTurn(`coord-write-profile-${++homeTurnStep}`, 'write', {
            file_path: '00-学习画像与偏好.md',
            content: [
              '---',
              'title: 学习画像与偏好',
              'type: learner-profile',
              '---',
              '# 学习画像与偏好',
              '## 已证实记录',
              '- 来源：[[备课/极值点偏移-第一课.md#本节总结与下次续接]]',
              '  - 无提示独立完成：对称点 $2-x_1$ 范围判断',
              '  - 经过提示完成：构造 $G(x)=f(x)-f(2-x)$',
              '  - 尚未检查 / 暴露缺口：商法则分子符号与复合求导负号尚未独立通过',
            ].join('\n'),
          });
          return;
        }
        if (step === 4) {
          yield* toolCallTurn(`coord-edit-route-fail-${++homeTurnStep}`, 'edit', {
            file_path: '路线/导数主线.md',
            old_string: 'THIS_ANCHOR_DOES_NOT_EXIST_SIMULATING_CONFLICT',
            new_string: '不会写入',
          });
          return;
        }
        yield* textTurn('学习画像（00-学习画像与偏好.md）已更新，但路线文件（路线/导数主线.md）更新失败，尚未完成全部长期记录。');
        return;
      }

      if (deliveryPhase === 'retry') {
        const step = phaseStep++;
        if (step === 0) {
          yield* toolCallTurn(`coord-retry-read-summary-${++homeTurnStep}`, 'read', { file_path: '备课/极值点偏移-第一课.md' });
          return;
        }
        if (step === 1) {
          yield* toolCallTurn(`coord-retry-read-profile-${++homeTurnStep}`, 'read', { file_path: '00-学习画像与偏好.md' });
          return;
        }
        if (step === 2) {
          yield* toolCallTurn(`coord-retry-read-route-${++homeTurnStep}`, 'read', { file_path: '路线/导数主线.md' });
          return;
        }
        if (step === 3) {
          const currentProfile = await readFile(join(root, '00-学习画像与偏好.md'), 'utf8');
          assert.ok(currentProfile.includes('备课/极值点偏移-第一课.md#本节总结与下次续接'), 'retry sees summary locator already recorded in profile');
          yield* toolCallTurn(`coord-write-route-ok-${++homeTurnStep}`, 'write', {
            file_path: '路线/导数主线.md',
            content: [
              '---',
              'title: 导数主线',
              'type: route',
              'status: active',
              'lessons:',
              '  - 备课/极值点偏移-第一课.md',
              '---',
              '# 导数主线',
              '## 里程碑',
              '- [x] 里程碑 1：独立完成极值点偏移对称构造与求导判号',
              '  - 关联课堂：[[备课/极值点偏移-第一课]]',
              '  - 校验依据：不依赖提示独立完成对称函数构造与复合求导判号',
              '  - 已有证据：[[备课/极值点偏移-第一课#本节总结与下次续接|第一课总结]]（无提示完成区间判断；提示后完成构造；商法则符号出错）',
              '  - 待补内容：复合求导负号 $-f\'(2-x)$ 与商法则分子符号尚未独立通过校验',
              '## 下一步行动',
              '- 当前下一步：先补齐复合求导与商法则符号专项检验，再复核里程碑 1',
            ].join('\n'),
          });
          return;
        }
        if (step === 4) {
          yield* toolCallTurn(`coord-readback-route-${++homeTurnStep}`, 'read', { file_path: '路线/导数主线.md' });
          return;
        }
        yield* textTurn('已核实第一课总结（不重复累计画像记录），并更新路线/导数主线.md 的待补缺口与下一步行动。');
        return;
      }

      yield* textTurn('首页就绪。');
    },
  });

  const vaultFiber = await ctx.plugin(await import('../../vault-sqlite/index.js'), { root, cachePath: ':memory:' });
  await vaultFiber.await();
  await new Promise(resolve => ctx.inject(['notaraTopics'], resolve));
  const workspace = await ctx.workspaceRegistry.resolveByPath(root);

  await mkdir(join(root, '备课'), { recursive: true });
  await mkdir(join(root, '路线'), { recursive: true });
  await mkdir(join(root, '日记'), { recursive: true });
  await mkdir(join(root, '笔记'), { recursive: true });

  const initialRoute = [
    '---',
    'title: 导数主线',
    'type: route',
    'status: active',
    '---',
    '# 导数主线',
    '## 里程碑',
    '- [ ] 里程碑 1：独立完成极值点偏移对称构造与求导判号',
    '  - 校验依据：不依赖提示独立完成对称函数构造与复合求导判号',
    '## 下一步行动',
    '- 当前下一步：进入第一课极值点偏移',
  ].join('\n');
  await writeFile(join(root, '路线/导数主线.md'), initialRoute);
  await writeFile(join(root, '00-学习画像与偏好.md'), '---\ntitle: 学习画像与偏好\ntype: learner-profile\n---\n# 学习画像与偏好\n');

  const signal = new AbortController().signal;
  const home = await create('notara-coordinator');
  homeId = home.id;
  const spawned = await ctx.tools.execute({
    callId: 'spawn-teacher-cls1',
    name: 'subagent',
    arguments: { preset: 'notara-teacher', description: '极值点偏移第一课', prompt: '围绕极值点偏移开展教学' },
    agent: home,
    signal,
  });
  assert.equal(spawned.isError, false);
  const teacher = ctx.agents.get(spawned.value.id);
  await teacher.whenIdle();

  // Verify origin prompt on teacher explicitly distinguishes mid-lesson waiting from stage closure.
  const teacherAssembly = {contexts:await collectRuntimeContexts(ctx,teacher)};
  assert.match(JSON.stringify(teacherAssembly.contexts), /普通等待无需汇报.*任务收口先保存并回读报告/);

  // 1. Mid-lesson waiting for student answer does NOT auto-close class or send summary to home.
  const homeEventsBefore = home.session.snapshotEvents().length;
  teacher.followup(createUserMessage({ content: [{ type: 'text', text: 'MID_LESSON_WAIT：我想先试试设切点' }], source: { kind: 'user' } }));
  await teacher.whenIdle();
  assert.equal(home.session.snapshotEvents().length, homeEventsBefore, 'mid-lesson waiting turn must not message home or close class');

  // 2. Invalid/unsaved summary locator sent via send_message is caught on coordinator read and leaves route untouched.
  deliveryPhase = 'ghost';
  phaseStep = 0;
  const ghostDeliver = await ctx.tools.execute({
    callId: 'ghost-summary-deliver',
    name: 'send_message',
    arguments: { agent_id: home.id, message: '课后总结定位：[[备课/未保存的幽灵总结.md]]' },
    agent: teacher,
    signal,
  });
  assert.equal(ghostDeliver.isError, false);
  await home.whenIdle();
  assert.equal(await readFile(join(root, '路线/导数主线.md'), 'utf8'), initialRoute, 'unverified summary locator must not mutate route');

  // 3. Explicit class closure: teacher saves factual summary separating independent / hint / unchecked, reads back, and delivers while home is closed!
  const lesson1Path = '备课/极值点偏移-第一课.md';
  const lesson1Content = [
    '---',
    'title: 极值点偏移第一课',
    'type: lesson',
    'status: completed',
    '---',
    '# 极值点偏移第一课',
    '## 课堂任务清单',
    '- [x] 判断对称点 $2-x_1$ 所在单调区间',
    '- [x] 构造 $G(x)=f(x)-f(2-x)$ 并求导判号',
    '## 本节总结与下次续接',
    '- 提示清单：第 1 步无提示；第 2 步提示“比较 $x_2$ 与 $2-x_1$ 的单调区间函数值”',
    '- 无提示独立完成：自主写出 $0<x_1<1\\Rightarrow 1<2-x_1<2$',
    '- 经过提示完成：在提示下写出 $G(x)=f(x)-f(2-x)$',
    '- 尚未检查与暴露缺口：求导时漏掉复合函数内层负号 $-f\'(2-x)$ 且商法则分子符号出错，尚未独立通过校验',
  ].join('\n');
  const saveSummary = await ctx.tools.execute({
    callId: 'save-lesson1-summary',
    name: 'write',
    arguments: { file_path: lesson1Path, content: lesson1Content },
    agent: teacher,
    signal,
  });
  assert.equal(saveSummary.isError, false);
  const readSummary = await ctx.tools.execute({
    callId: 'readback-lesson1-summary',
    name: 'read',
    arguments: { file_path: lesson1Path },
    agent: teacher,
    signal,
  });
  assert.equal(readSummary.isError, false);

  // Dispose home session handle so home is temporarily closed before teacher sends summary.
  await ctx.sessions.flush(home.session);
  await handles.get(home.id).dispose();
  assert.equal(ctx.agents.get(home.id), undefined, 'home handle is closed');

  // First delivery wakes cold home; profile write succeeds, route edit fails -> partial failure preserved honestly!
  deliveryPhase = 'first';
  phaseStep = 0;
  const summaryMsg = '本课已收口，事实总结已保存：[[备课/极值点偏移-第一课.md#本节总结与下次续接]]（无提示完成区间判断；提示后完成构造；复合求导负号与商法则仍待补）。';
  const firstDeliver = await ctx.tools.execute({
    callId: 'deliver-lesson1-summary-1',
    name: 'send_message',
    arguments: { agent_id: home.id, message: summaryMsg },
    agent: teacher,
    signal,
  });
  assert.equal(firstDeliver.isError, false);
  const coldResumedHome = ctx.agents.get(home.id);
  assert.ok(coldResumedHome, 'closed home must cold-resume from real persisted session on summary delivery');
  await coldResumedHome.whenIdle();

  const profileAfterPartial = await readFile(join(root, '00-学习画像与偏好.md'), 'utf8');
  const routeAfterPartial = await readFile(join(root, '路线/导数主线.md'), 'utf8');
  assert.match(profileAfterPartial, /无提示独立完成：对称点/);
  assert.match(profileAfterPartial, /经过提示完成：构造/);
  assert.match(profileAfterPartial, /尚未检查 \/ 暴露缺口：商法则/);
  assert.equal(routeAfterPartial, initialRoute, 'failed route update leaves route at prior revision without faking full completion');
  const partialAssistantText = JSON.stringify(coldResumedHome.session.snapshotEvents().filter(e => e.type === 'assistant/message').at(-1));
  assert.match(partialAssistantText, /更新失败|尚未完成/);

  // 4. Retry / duplicate delivery of the same summary locator completes the pending route update WITHOUT duplicating learner-profile evidence!
  deliveryPhase = 'retry';
  phaseStep = 0;
  const retryDeliver = await ctx.tools.execute({
    callId: 'deliver-lesson1-summary-retry',
    name: 'send_message',
    arguments: { agent_id: home.id, message: summaryMsg },
    agent: teacher,
    signal,
  });
  assert.equal(retryDeliver.isError, false);
  await coldResumedHome.whenIdle();

  const profileAfterRetry = await readFile(join(root, '00-学习画像与偏好.md'), 'utf8');
  const locatorOccurrences = profileAfterRetry.split('备课/极值点偏移-第一课.md#本节总结与下次续接').length - 1;
  assert.equal(locatorOccurrences, 1, 'duplicate summary delivery must not duplicate learner-profile records');

  const routeAfterRetry = await readFile(join(root, '路线/导数主线.md'), 'utf8');
  assert.match(routeAfterRetry, /待补内容：复合求导负号/);

  // Verify route projection does NOT count checked milestone as completed while remediation gap remains!
  await ctx.notaraVault.read({ workspaceId: workspace.id, path: '路线/导数主线.md' });
  const homeRecs = await ctx.notaraVault.homeRecommendations({ workspaceId: workspace.id });
  assert.equal(homeRecs.route?.checkedCount, 1);
  assert.equal(homeRecs.route?.completed, 0, 'checked task with pending remediation gap must not count as passed milestone');
  assert.equal(homeRecs.route?.needsRemediation, true);

  // 5. Milestone verification gap changes the next lesson's actual starting point & tasks; ad-hoc jump-out preserves classroom checklist position.
  const lesson2Path = '备课/导数第二课-符号修补与复核.md';
  const writeLesson2 = await ctx.tools.execute({
    callId: 'write-lesson2-adapted',
    name: 'write',
    arguments: {
      file_path: lesson2Path,
      content: [
        '---',
        'title: 导数第二课：复合求导符号修补与偏移复核',
        'type: lesson',
        'status: ready',
        '---',
        '# 导数第二课：复合求导符号修补与偏移复核',
        '## 本课目标与学情依据',
        '- 依据 [[备课/极值点偏移-第一课#本节总结与下次续接]] 与 [[路线/导数主线]] 待补内容调整起点：先修补复合求导负号 $-f\'(2-x)$ 与商法则符号，再独立复核偏移证明。',
        '## 课堂任务清单',
        '- [ ] 起点修补：独立完成 $f(2-x)$ 与 $\\frac{\\ln x}{x}$ 的求导符号核对',
        '- [ ] 里程碑复核：不看提示独立完成一道极值点偏移证明',
        '## 本节总结与下次续接',
      ].join('\n'),
    },
    agent: teacher,
    signal,
  });
  assert.equal(writeLesson2.isError, false);
  const bindLesson2 = await ctx.tools.execute({
    callId: 'bind-lesson2',
    name: 'lesson_plan',
    arguments: { action: 'bind', path: lesson2Path },
    agent: teacher,
    signal,
  });
  assert.equal(bindLesson2.isError, false);
  const l2Bound = JSON.parse(bindLesson2.value.result);
  assert.match(l2Bound.nextTask.content, /起点修补：独立完成/);

  const setL2Current = await ctx.tools.execute({
    callId: 'set-l2-current',
    name: 'lesson_plan',
    arguments: {
      action: 'set_current',
      line: l2Bound.tasks[0].line,
      expectedText: l2Bound.tasks[0].expectedText,
      expectedRevision: l2Bound.revision,
    },
    agent: teacher,
    signal,
  });
  assert.equal(setL2Current.isError, false);
  const l2Current = JSON.parse(setL2Current.value.result);

  // Student temporarily jumps out for ad-hoc ("散打") discussion: clear_current pauses without checking off task 1;
  // relevant ad-hoc diary evidence can be referenced by route while unrelated ad-hoc notes stay out of route.
  const pauseForAdHoc = await ctx.tools.execute({
    callId: 'pause-l2-adhoc',
    name: 'lesson_plan',
    arguments: { action: 'clear_current', expectedRevision: l2Current.revision },
    agent: teacher,
    signal,
  });
  assert.equal(pauseForAdHoc.isError, false);
  await writeFile(join(root, '日记/2026-10-31.md'), '---\ntype: diary\n---\n# 2026-10-31\n- 散打验证：独立写对 $(f(2-x))\'=-f\'(2-x)$ 符号。\n');
  await writeFile(join(root, '笔记/散打排列组合随笔.md'), '---\ntitle: 散打排列组合随笔\n---\n# 散打排列组合随笔\n与导数路线无关的临时讨论。\n');

  // Returning to the original classroom recovers the exact bound lesson and unchecked task 1 position!
  const resumeL2Read = await ctx.tools.execute({
    callId: 'resume-l2-read',
    name: 'lesson_plan',
    arguments: { action: 'read' },
    agent: teacher,
    signal,
  });
  assert.equal(resumeL2Read.isError, false);
  const resumedState = JSON.parse(resumeL2Read.value.result);
  assert.equal(resumedState.path, lesson2Path);
  assert.equal(resumedState.counts.completed, 0, 'ad-hoc jump must not check off unfinished classroom tasks');
  assert.equal(resumedState.nextTask.line, l2Bound.tasks[0].line);
  assert.match(resumedState.nextTask.content, /起点修补/);
});

test('scenario entry skills preserve the organizer short path and restrict practice design to home and teacher', async t => {
  const { ctx, root, create } = await harness(t, {
    withController: true,
    async *respond() {
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, delta: '已就绪。' };
      yield { type: 'block-end', index: 0, block: { type: 'text', text: '已就绪。' } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    },
  });

  const vaultFiber = await ctx.plugin(await import('../../vault-sqlite/index.js'), { root, cachePath: ':memory:' });
  await vaultFiber.await();
  await new Promise(resolve => ctx.inject(['notaraTopics'], resolve));
  const workspace = await ctx.workspaceRegistry.resolveByPath(root);

  await mkdir(join(root, '资料'), { recursive: true });
  await mkdir(join(root, '卡片'), { recursive: true });
  await mkdir(join(root, '备课'), { recursive: true });
  await mkdir(join(root, '路线'), { recursive: true });

  const signal = new AbortController().signal;
  const home = await create('notara-coordinator');
  const worker = await create('worker-lesson');

  // Four current entrances and the retained preview skill use existing roles.
  for (const skillName of ['notara-exam-diagnosis', 'notara-exam-cram', 'notara-school-notes', 'notara-practice-design', 'notara-summer-preview']) {
    const res = await ctx.tools.execute({
      callId: `coord-skill-${skillName}`,
      name: 'skill',
      arguments: { name: skillName },
      agent: home,
      signal,
    });
    assert.equal(res.isError, false, `coordinator must load ${skillName}`);
  }
  for (const deniedSkill of ['notara-exam-diagnosis', 'notara-exam-cram', 'notara-school-notes', 'notara-practice-design', 'notara-summer-preview']) {
    const res = await ctx.tools.execute({
      callId: `worker-deny-${deniedSkill}`,
      name: 'skill',
      arguments: { name: deniedSkill },
      agent: worker,
      signal,
    });
    assert.equal(res.isError, true, `worker must not load orchestration entry skill ${deniedSkill}`);
  }
  for (const [preset, denied] of [['notara-material-organizer', true]]) {
    const agent = await create(preset);
    const res = await ctx.tools.execute({ callId: `practice-${preset}`, name: 'skill', arguments: { name: 'notara-practice-design' }, agent, signal });
    assert.equal(res.isError, denied, `${preset} practice-design boundary`);
  }
  const coordDeniedLessonTool = await ctx.tools.execute({
    callId: 'coord-deny-lesson-plan',
    name: 'lesson_plan',
    arguments: { action: 'read' },
    agent: home,
    signal,
  });
  assert.equal(coordDeniedLessonTool.isError, true, 'coordinator has no classroom teaching tools');

  // 2. "只整理学校笔记" short path: home delegates to standalone organizer -> saves source & card -> reads back -> ends cleanly with zero teacher classroom spawned!
  const orgSpawn = await ctx.tools.execute({
    callId: 'spawn-notes-organizer',
    name: 'subagent',
    arguments: { preset: 'notara-material-organizer', description: '整理高数学校笔记', prompt: '整理拉格朗日中值定理课堂笔记并回交清单' },
    agent: home,
    signal,
  });
  assert.equal(orgSpawn.isError, false);
  const organizer = ctx.agents.get(orgSpawn.value.id);
  await organizer.whenIdle();

  const orgSkill = await ctx.tools.execute({
    callId: 'org-load-school-notes',
    name: 'skill',
    arguments: { name: 'notara-school-notes' },
    agent: organizer,
    signal,
  });
  assert.equal(orgSkill.isError, false);
  assert.match(JSON.stringify(orgSkill.value), /可以在这里干净结束/);

  const writeSource = await ctx.tools.execute({
    callId: 'org-write-source',
    name: 'write',
    arguments: {
      file_path: '资料/高数第4周课堂笔记.md',
      content: '---\ntitle: 高数第4周课堂笔记\ntype: source\n---\n# 高数第4周课堂笔记\n拉格朗日中值定理要求闭区间连续、开区间可导。\n',
    },
    agent: organizer,
    signal,
  });
  assert.equal(writeSource.isError, false);
  const writeCard = await ctx.tools.execute({
    callId: 'org-write-card',
    name: 'write',
    arguments: {
      file_path: '卡片/拉格朗日中值定理适用条件.md',
      content: [
        '---',
        'title: 拉格朗日中值定理适用条件',
        'type: card',
        '---',
        '# 拉格朗日中值定理适用条件',
        '## 内容',
        '为什么闭区间端点连续不可省略？',
        '## 来源',
        '- [[资料/高数第4周课堂笔记]]',
      ].join('\n'),
    },
    agent: organizer,
    signal,
  });
  assert.equal(writeCard.isError, false);
  const verifyRead = await ctx.tools.execute({
    callId: 'org-verify-card',
    name: 'read',
    arguments: { file_path: '卡片/拉格朗日中值定理适用条件.md' },
    agent: organizer,
    signal,
  });
  assert.equal(verifyRead.isError, false);
  assert.equal(
    ctx.agents.list().filter(a => ctx.agentPresets.composedPreset(a.ctx) === 'notara-teacher').length,
    0,
    'clean school-notes short path finishes without spawning a teacher classroom',
  );

  // 3. Full classroom continuation -> completion -> Home recommendation live transition!
  const teacherSpawn = await ctx.tools.execute({
    callId: 'spawn-cram-teacher',
    name: 'subagent',
    arguments: { preset: 'notara-teacher', description: '考前中值定理冲刺课', prompt: '按 45 分钟剩余时间聚焦中值定理关键题型' },
    agent: home,
    signal,
  });
  assert.equal(teacherSpawn.isError, false);
  const teacher = ctx.agents.get(teacherSpawn.value.id);
  await teacher.whenIdle();

  const practiceSkill = await ctx.tools.execute({ callId: 'practice-teacher', name: 'skill', arguments: { name: 'notara-practice-design' }, agent: teacher, signal });
  assert.equal(practiceSkill.isError, false, 'teacher can load the practice-design skill');

  const teacherCramSkill = await ctx.tools.execute({
    callId: 'teacher-load-cram',
    name: 'skill',
    arguments: { name: 'notara-exam-cram' },
    agent: teacher,
    signal,
  });
  assert.equal(teacherCramSkill.isError, false);

  const cramLessonPath = '备课/中值定理考前冲刺.md';
  await ctx.tools.execute({
    callId: 'teacher-write-cram-lesson',
    name: 'write',
    arguments: {
      file_path: cramLessonPath,
      content: [
        '---',
        'title: 中值定理考前冲刺',
        'type: lesson',
        'status: in_progress',
        '---',
        '# 中值定理考前冲刺',
        '## 课堂任务清单',
        '- [ ] 辨析端点不连续反例',
        '- [ ] 独立构造乘积辅助函数 $x e^x$',
        '<details data-notara="teacher">',
        '- [ ] 隐藏教师备用压轴题（绝不成为首页推荐）',
        '</details>',
      ].join('\n'),
    },
    agent: teacher,
    signal,
  });
  const bindRes = await ctx.tools.execute({
    callId: 'teacher-bind-cram',
    name: 'lesson_plan',
    arguments: { action: 'bind', path: cramLessonPath },
    agent: teacher,
    signal,
  });
  assert.equal(bindRes.isError, false);

  let recs = await ctx.notaraVault.homeRecommendations({ workspaceId: workspace.id });
  assert.equal(recs.continuation?.sessionId, teacher.session.id, 'unfinished bound classroom is surfaced as Home continuation');
  assert.match(recs.continuation?.nextTask?.content ?? '', /辨析端点不连续反例/);
  assert.ok(!JSON.stringify(recs).includes('隐藏教师备用压轴题'), 'hidden teacher task never leaks into Home recommendations');

  // Archiving an unfinished classroom via real DSH WorkspaceRegistry removes it from Home continuation immediately; unarchiving restores it.
  await ctx.workspaceRegistry.archiveSession(teacher.session.id);
  const archivedRecs = await ctx.notaraVault.homeRecommendations({ workspaceId: workspace.id });
  assert.equal(archivedRecs.continuation, null, 'archived unfinished classroom must not appear as Home continuation');
  assert.deepEqual(archivedRecs.continuations, []);
  await ctx.workspaceRegistry.unarchiveSession(teacher.session.id);
  assert.equal((await ctx.notaraVault.homeRecommendations({ workspaceId: workspace.id })).continuation?.sessionId, teacher.session.id);

  // Complete lesson, save summary, and update route -> Home continuation clears and advances to the updated route!
  await ctx.tools.execute({
    callId: 'teacher-finish-cram-lesson',
    name: 'write',
    arguments: {
      file_path: cramLessonPath,
      content: [
        '---',
        'title: 中值定理考前冲刺',
        'type: lesson',
        'status: completed',
        '---',
        '# 中值定理考前冲刺',
        '## 课堂任务清单',
        '- [x] 辨析端点不连续反例',
        '- [x] 独立构造乘积辅助函数 $x e^x$',
        '## 本节总结与下次续接',
        '- 无提示独立完成：端点反例辨析',
        '- 经过提示完成：构造 $F(x)=e^x f(x)$',
        '- 下次起点建议：考前最后 15 分钟快速自检积分型辅助函数符号',
      ].join('\n'),
    },
    agent: teacher,
    signal,
  });
  await ctx.tools.execute({
    callId: 'coord-update-cram-route',
    name: 'write',
    arguments: {
      file_path: '路线/考前冲刺路线.md',
      content: [
        '---',
        'title: 高数考前冲刺路线',
        'type: route',
        'status: active',
        '---',
        '# 高数考前冲刺路线',
        '## 里程碑',
        '- [ ] 里程碑 1：独立完成辅助函数构造快检',
        '  - 已有证据：[[备课/中值定理考前冲刺#本节总结与下次续接]]',
        '## 下一步行动',
        '- 当前下一步：围绕 [[卡片/拉格朗日中值定理适用条件]] 做 15 分钟考前独立快检',
      ].join('\n'),
    },
    agent: home,
    signal,
  });
  await ctx.notaraVault.read({ workspaceId: workspace.id, path: '路线/考前冲刺路线.md' });

  recs = await ctx.notaraVault.homeRecommendations({ workspaceId: workspace.id });
  assert.equal(recs.continuation, null, 'completed classroom clears from unfinished continuations');
  assert.equal(recs.route?.path, '路线/考前冲刺路线.md');
  assert.match(recs.route?.nextAction?.text ?? '', /15 分钟考前独立快检/);
  assert.equal(recs.followUp?.kind, 'lesson-summary');
  assert.match(recs.followUp?.snippet ?? '', /积分型辅助函数符号/);
});
