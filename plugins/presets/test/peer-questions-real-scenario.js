import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile, symlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { stringify } from 'yaml';
import { writeFileSync } from 'node:fs';
import { checkSummaryProbeAccess } from './summary-probe-boundary.js';

const now = () => new Date().toISOString();
const sha = x => createHash('sha256').update(x).digest('hex');
const textOf = message => (message?.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('\n');
const argsOf = event => { try { return typeof event.data.arguments === 'string' ? JSON.parse(event.data.arguments) : event.data.arguments; } catch { return {}; } };
const lessonPath = '备课/向量相加.md';
const fixtures = {
  '来源/向量相加.md': '---\ntype: source\n---\n# 向量相加（合成材料）\n\n箭头表示有方向和长度的位移。把向量 b 的起点平移到 a 的终点，起点到最后终点的箭头表示 a+b。画图比较 a+b 与 b+a，尝试解释关系。所有材料及前置记录均为隔离验收合成数据。\n',
  [lessonPath]: '---\ntype: lesson\ntitle: 向量相加与交换顺序\n---\n# 向量相加与交换顺序\n\n本课已准备，所有学情均为合成 fixture。本次直接从学生画图开始，不重新备课。\n\n## 本课目标\n从首尾相接的图比较两种相加顺序，解释为什么得到同一位移。\n\n## 公开任务\n- [ ] 画出 a 向右 2 格、b 向上 1 格的首尾相接图\n- [ ] 比较交换顺序后的终点并提出自己的解释\n- [ ] 若愿意，尝试一般方向的箭头\n\n<details data-notara="teacher">\n<summary>教师参考</summary>\n\n学生已有前置：认识箭头的方向和长度，会平移箭头。本课未有实际作答记录。\n推导参考：a=(2,0)、b=(0,1)，两种顺序终点都是 (2,1)。一般向量从同一原点出发，以两箭头作邻边构成平行四边形，两条首尾路线同达对角顶点；平移不改变向量的方向和长度。不可把教师参考写成学生已掌握。\n\n可选同学问题：学生自然完成首尾相接并提出顺序猜想后，可以请好奇的同桌问“只是这两根箭头刚好如此，还是换成斜着的箭头也会如此？你打算怎么说明？”可根据实际表达缩窄为一个主要问题；学生还在自行画图时跳过。不要求每一单元邀请，也不预写学生回答。\n\n</details>\n\n## 本节总结与下次续接\n',
};
const inputs = {
  progressing: '我在画这节课里 a 向右2格、b 向上1格的图。先把 b 的起点挪到 a 的终点，我还没画完，想自己接着试一试。',
  conjecture: '我画好了，两次都到了右2格、上1格的位置。我猜 a+b 和 b+a 是同一个向量，不过还没想好怎么说明换成斜着的箭头也成立。',
  explicit: '我画了 a 向右2格、b 向上1格的两种首尾相接图，终点都一样。我猜换成斜着的箭头，交换顺序后也还是同一个向量。能请大肥鱼对这个想法提一个问题吗？我想自己解释，老师先让我试试。',
  continuationRule: '只依据同学公开问题编写一次自然模拟回应，不查看思考或隐藏参考，不要求模型调用任何工具。',
};

export async function findPeerSession(ctx, parentSessionId) {
  const children = await ctx.subagents.listChildren(parentSessionId);
  assert.ok(children.length <= 1, 'only one native child is permitted');
  for (const row of children) {
    const live = ctx.agents.get(row.id);
    const snapshot = live ? { session: live.session.header, events: live.session.snapshotEvents() }
      : await ctx.sessionQuery.readSession(row.id);
    const preset = snapshot.events.findLast(e => e.type === 'agent-preset/selected')?.data.agentPreset ?? snapshot.session.agentPreset;
    if (/^companion-(deepseek|claude|gemini|gpt)$/.test(preset)) return { id: row.id, preset };
  }
  return null;
}

// Opt-in acceptance with an explicitly selected test route; production is unchanged.
export async function runPeerQuestionsRealScenario(t, { harness, mountSummaryVault }) {
  const home = process.env.NOTARA_REAL_PEER_HOME;
  assert.ok(home);
  const base = resolve('work/peer-questions-20261102/real');
  await mkdir(base, { recursive: true });
  const output = await mkdtemp(join(base, 'continuation-'));
  const root = await mkdtemp(join(tmpdir(), 'notara-peer-real-'));
  const routeHome = await mkdtemp(join(tmpdir(), 'notara-peer-route-'));
  await chmod(routeHome, 0o700);
  t.after(() => rm(routeHome, { recursive: true, force: true }));
  const resources = fileURLToPath(new URL('../resources/', import.meta.url));
  const report = { status: 'RUNNING', startedAt: now(), fixture: 'synthetic; no real student responses',
    requestBudget: 12, studentMessageBudget: 2, timeBudgetMs: 480000, modelRequests: [], studentMessages: [],
    kind: 'explicit-invitation-and-same-child-continuation supplement',
    previousRuns: { completedObservation: { output: 'run-jgymam', modelRequests: 13 }, operationInterrupted: { output: 'run-DouM8y', confirmedRequests: 3, possibleOutstanding: 1 },
      recorderBlockedSupplement: { output: 'continuation-9iY7oe', modelRequests: 7, studentMessages: 1 },
      reason: 'Parent approved a bounded recorder-repair supplement within the user-requested acceptance; costs separate; earlier natural stages are not repeated.' },
    sessions: {}, stages: [], guards: [], checks: [], output, root, mechanism: 'unchanged native subagent / send_message / settled',
    uncovered: ['browser/Electron rendering', 'refresh/reconnect/cold recovery', 'other companion personalities', 'other subjects', 'real learner outcomes'] };
  let h, teacher, deadline, fatal;
  let order = 0, stageName = 'setup', invitations = 0;
  const events = [], requests = [];
  const scrub = value => String(value).replaceAll(`/private${root}`, '<workspace>').replaceAll(root, '<workspace>')
    .replaceAll(resources, '<built-in-resources>').replaceAll(home, '<configured-home>')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer <redacted>')
    .replace(/\b(?:sk|dsk)[_-][A-Za-z0-9_-]{20,}\b/g, '<redacted>')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '<redacted>')
    .replace(/\/(?:Users|home)\/[^\s<>"'`]+/g, '<host-path>');
  const clean = value => {
    if (typeof value === 'string') return scrub(value);
    if (Array.isArray(value)) return value.map(clean).filter(x => x !== undefined);
    if (value && typeof value === 'object') {
      if (/reasoning|thinking|signature/i.test(value.type ?? '')) return undefined;
      return Object.fromEntries(Object.entries(value).filter(([k]) => !/reasoning|thinking|signature|replayState|authorization|password|credential|token|api.?key/i.test(k)).map(([k,v]) => [k,clean(v)]));
    }
    return value;
  };
  const safeText = text => {
    try { return JSON.stringify(clean(JSON.parse(text))); } catch {}
    return scrub(text);
  };
  const content = blocks => (blocks ?? []).flatMap(b => b.type === 'text' ? [{ type: 'text', text: safeText(b.text) }]
    : b.type === 'tool-call' ? [{ type: 'tool-call', id: b.id, name: b.name, arguments: clean(typeof b.arguments === 'string' ? (() => { try { return JSON.parse(b.arguments); } catch { return b.arguments; } })() : b.arguments) }] : []);
  const json = (path, value) => writeFile(join(output, path), JSON.stringify(clean(value), null, 2));
  const flush = async () => { await json('report.json', report); await json('events.json', events); await json('requests-public.json', requests); };
  const stage = async (name, details = {}) => {
    report.stages.push({ name, at: now(), order, requestCount: report.modelRequests.length, ...details });
    await flush(); console.log(JSON.stringify({ probe: 'peer-real-stage', name, requests: report.modelRequests.length, output }));
  };
  const stop = async reason => {
    fatal ??= reason;
    if (!h) return;
    for (const id of new Set([...report.modelRequests.map(r => r.sessionId), teacher?.id].filter(Boolean))) {
      try { await h.ctx.agents.get(id)?.interrupt(); } catch {}
    }
  };
  const budget = () => {
    if (fatal) throw new Error(fatal);
    if (deadline && Date.now() >= deadline) throw new Error('model-run time budget exhausted');
  };
  const settle = async () => {
    budget();
    for (let i=0;i<4;i++) {
      await teacher.whenIdle();
      await h.ctx.subagents.waitForChildren(teacher);
      await teacher.whenIdle();
      const n=order;
      await new Promise(r=>setTimeout(r,250));
      if(order===n) break;
    }
    budget();
  };
  const send = async (agent, text, name, child = false) => {
    budget(); assert.ok(report.studentMessages.length < report.studentMessageBudget);
    stageName = name;
    const startOrder = order;
    report.studentMessages.push({ name, sessionId: agent.id, text, synthetic: true, at: now(), order });
    if (child) await h.ctx.subagents.prompt({ requestId: randomUUID(), parentSessionId: teacher.id, childSessionId: agent.id,
      mode: 'continuable', delivery: 'queue', content: [{ type: 'text', text }] }, new AbortController().signal);
    else { agent.followup(createUserMessage({ content: [{ type:'text',text }], source:{kind:'user'} })); await agent.whenIdle(); }
    await settle();
    await stage(name, { startOrder, endOrder: order });
    const failed = events.find(e => e.order > startOrder && e.type === 'turn/end' && e.reason.kind !== 'completed');
    if (failed) throw new Error(`Native turn did not complete: ${JSON.stringify(failed.reason)}`);
  };
  const companion = async () => {
    const peer = await findPeerSession(h.ctx, teacher.id);
    if (!peer) return null;
    report.childVerification = { ...peer, source: 'native parent catalog and native preset; no rendered-receipt parsing' };
    return { agent: { id: peer.id }, call: events.find(e => e.type === 'tool/call' && e.name === 'subagent' && e.arguments?.preset === peer.preset) };
  };
  try {
    // User explicitly switched this acceptance to DeepSeek after the retained
    // Codex attempt expired. Only the harness copies credentials; this external
    // temporary routing shim points it at the existing read-only source.
    const config={provider:'deepseek-official',model:'deepseek-v4-pro'};
    report.model=config;
    report.routeOverride={source:'direct user message in validation subthread',exactText:'换deepseek，这个问题是认证过期了导致的',authorizedProvider:'DeepSeek',modelWasSpecified:false,selectedModel:'deepseek-v4-pro',modelSelectionOwner:'validation engineer',productionRouteChanged:false};
    await mkdir(join(routeHome,'profiles/web'),{recursive:true});
    await writeFile(join(routeHome,'profiles/web/cordis.patch.yml'),stringify([{id:'agent-default-model',config}]));
    await symlink(join(home,'.credentials.yaml'),join(routeHome,'.credentials.yaml'));
    console.log(JSON.stringify({probe:'peer-real-route',...report.model}));
    const instance=JSON.parse(await readFile(resolve(home,'../instance.json'),'utf8'));
    assert.equal(instance.pid,61437);
    const installed=join(instance.installed,'node_modules/@oh-my-student/plugin-presets');
    const tree=async(dir,prefix='')=>{
      const result={};
      for(const entry of await readdir(dir,{withFileTypes:true})) {
        assert.ok(!entry.isSymbolicLink(), 'resource tree must not contain symlinks');
        if(entry.isDirectory()) Object.assign(result,await tree(join(dir,entry.name),prefix+entry.name+'/'));
        else result[prefix+entry.name]=sha(await readFile(join(dir,entry.name)));
      }
      return Object.fromEntries(Object.entries(result).sort(([a],[b])=>a.localeCompare(b)));
    };
    const sourceHashes=await tree(resources),installedHashes=await tree(join(installed,'resources'));
    assert.deepEqual(sourceHashes,installedHashes,'current core resources differ from instance.installed package');
    const entryHashes={};
    for(const name of (await readdir(installed)).filter(x=>x.endsWith('.js')||x==='package.json')) {
      const local=await readFile(fileURLToPath(new URL('../'+name,import.meta.url)));
      const deployed=await readFile(join(installed,name)); assert.equal(sha(local),sha(deployed),`deployed code mismatch: ${name}`);
      entryHashes[name]=sha(deployed);
    }
    report.preflight={status:'PASS',pid:instance.pid,port:60323,resourceFiles:Object.keys(sourceHashes).length,resourceTreeHash:sha(JSON.stringify(sourceHashes)),entryHashes};
    await json('resources-sha256.json',{sourceHashes,installedHashes,entryHashes});
    await json('experiment-inputs.json',{fixtures,inputs,expected:{progressing:'no interruption or invitation; brief acknowledgment allowed',autonomous:'optional; absence is NOT RUN, never FAIL',peer:'one principal question without answering it or multiple tasks',teacher:'creation/settled may link session, must not answer for student',continuity:'natural simulated reply goes to same actual companion session'},budgets:{teachers:1,companions:1,studentMessages:6,modelRequests:30,minutes:12}});
    for (const [path,body] of Object.entries(fixtures)) { await mkdir(resolve(root,path,'..'),{recursive:true}); await writeFile(join(root,path),body); }
    h=await harness(t,{existingRoot:root,withController:true,realSummaryHome:routeHome});
    await mountSummaryVault(h);
    h.ctx.on('session/event',(session,event)=>{
      const d=event.data;
      if(event.type==='user/message'&&!['user','agent-message','subagent-settled'].includes(d.source?.kind))return;
      let e={order:++order,at:now(),sessionId:session.id,seq:event.seq,type:event.type,stage:stageName};
      if(event.type==='tool/call') Object.assign(e,{callId:d.callId,name:d.name,arguments:clean(argsOf(event))});
      else if(event.type==='tool/result') Object.assign(e,{toolCallId:d.message.toolCallId,isError:d.message.isError,content:content(d.message.content)});
      else if(event.type==='assistant/message') Object.assign(e,{content:content(d.message.content),turn:d.turn,step:d.step});
      else if(event.type==='user/message') Object.assign(e,{source:clean(d.source),content:content(d.content)});
      else if(event.type==='turn/end') Object.assign(e,{turn:d.turn,reason:clean(d.reason)});
      else if(event.type==='turn/start') e.turn=d.turn;
      else {order--;return;}
      events.push(e);
      if(event.type==='assistant/message') console.log(JSON.stringify({probe:'peer-real-public',stage:stageName,role:session.id===teacher?.id?'teacher':'companion',text:textOf({content:e.content})}));
    });
    h.ctx.on('llm/stream',(options,next)=>{
      budget();
      if(report.modelRequests.length>=report.requestBudget) throw new Error('Remaining model-request budget exhausted');
      deadline??=Date.now()+report.timeBudgetMs;
      const row={number:report.modelRequests.length+1,at:now(),order:++order,stage:stageName,sessionId:options.sessionId,provider:options.provider,model:options.model};
      report.modelRequests.push(row);
      writeFileSync(join(output,'report.json'),JSON.stringify(clean(report),null,2));
      requests.push({...row,messages:options.messages.filter(m=>m.role!=='system'&&!['runtime-context','skill-catalog'].includes(m.source?.kind)).map(m=>({role:m.role,source:clean(m.source),content:content(m.content)}))});
      return next();
    });
    h.ctx.on('tools/pre-execute',async(exec,next)=>{
      budget();
      if(exec.name==='subagent') {
        if(exec.agent?.id!==teacher?.id || !/^companion-(deepseek|claude|gemini|gpt)$/.test(exec.arguments?.preset) || invitations>=1) {
          report.guards.push({kind:'extra-agent-denied',at:now(),arguments:clean(exec.arguments)});
          return {kind:'deny',reason:'本次隔离实验最多一个老师与一个普通同学，不创建其他会话。'};
        }
        invitations++;
      }
      if(!await checkSummaryProbeAccess(root,resources,exec.name,exec.arguments)) {
        report.guards.push({kind:'scope-denied',name:exec.name,arguments:clean(exec.arguments)});
        return {kind:'deny',reason:'隔离验收禁止命令执行及访问学习集外的学生文件。'};
      }
      return next();
    });
    const timer=setTimeout(()=>void stop('remaining model-run budget exhausted'),report.timeBudgetMs-10000);
    timer.unref(); t.after(()=>clearTimeout(timer));
    teacher=await h.create('notara-teacher');report.sessions.teacher=teacher.id;
    const ws=await h.ctx.workspaceRegistry.resolveByPath(root);
    await h.ctx.notaraVault.bindLessonPlan({workspaceId:ws.id,sessionId:teacher.id,path:lessonPath});
    report.boundLesson=lessonPath;
    await stage('ready');
    report.autonomousInvitation={status:'NOT RUN',reason:'supplement only; see original run-jgymam natural transition, where no autonomous invitation was observed'};
    await send(teacher,inputs.explicit,'03-explicit-invitation');
    const peer=await companion();
    if(peer) {
      report.sessions.companion=peer.agent.id;report.invitationPath=peer.call.stage==='03-explicit-invitation'?'explicit':'autonomous';
      const peerPublic=events.filter(e=>e.sessionId===peer.agent.id&&e.type==='assistant/message').map(e=>textOf({content:e.content})).filter(Boolean);
      await json('awaiting-student.json',{sessionId:peer.agent.id,publicReplies:peerPublic,instruction:'Write student-reply.txt in this output directory from public question only; no tool instructions.'});
      await stage('04-awaiting-simulated-student');
      let reply;
      while(!reply) { budget();try {reply=(await readFile(join(output,'student-reply.txt'),'utf8')).trim();}catch(error){if(error.code!=='ENOENT')throw error;}if(!reply)await new Promise(r=>setTimeout(r,500)); }
      await send(peer.agent,reply,'05-same-companion-continuation',true);
      report.continuity={sameSession:true,childSessionId:peer.agent.id,requestCounts:report.modelRequests.filter(r=>r.sessionId===peer.agent.id).length};
    } else report.continuity={status:'BLOCKED',reason:'No actual companion session was created; no forced tool invitation.'};
    report.status=report.continuity?.sameSession?'OBSERVED_REQUIRES_SEMANTIC_ASSESSMENT':'BLOCKED';
  } catch(error) {
    report.status='BLOCKED';report.failure={name:error.name,message:scrub(error.message),stage:stageName};
    console.log(JSON.stringify({probe:'peer-real-blocked',...report.failure}));
  } finally {
    report.endedAt=now();report.elapsedMs=Date.now()-Date.parse(report.startedAt);
    report.modelElapsedMs=deadline?Date.now()-(deadline-report.timeBudgetMs):0;
    if(h) {
      await stop('experiment cleanup');
      const durable=[];
      for(const id of new Set([...report.modelRequests.map(r=>r.sessionId),teacher?.id].filter(Boolean))) {
        const agent=h.ctx.agents.get(id);if(!agent)continue;
        for(const e of agent.session.snapshotEvents()) {
          const d=e.data,base={sessionId:id,seq:e.seq,time:e.time,type:e.type};
          if(e.type==='assistant/message')durable.push({...base,content:content(d.message.content)});
          else if(e.type==='user/message'&&['user','agent-message','subagent-settled'].includes(d.source?.kind))durable.push({...base,source:clean(d.source),content:content(d.content)});
          else if(e.type==='tool/call')durable.push({...base,callId:d.callId,name:d.name,arguments:clean(argsOf(e))});
          else if(e.type==='tool/result')durable.push({...base,toolCallId:d.message.toolCallId,isError:d.message.isError,content:content(d.message.content)});
          else if(['turn/start','turn/end'].includes(e.type))durable.push({...base,data:clean(d)});
        }
      }
      await json('native-public-events.json',durable);
      await h.ctx.fiber.dispose();
    }
    await rm(root,{recursive:true,force:true});report.cleanup={temporaryWorkspaceRemoved:true,temporaryAuth:'harness t.after removes its private credential copy',servicesStarted:0};
    await flush();
    console.log(JSON.stringify({probe:'peer-real-complete',status:report.status,requests:report.modelRequests.length,studentMessages:report.studentMessages.length,elapsedMs:report.elapsedMs,output}));
  }
  assert.notEqual(report.status,'BLOCKED',report.failure?.message??report.continuity?.reason);
}
