#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {patchDshMath,patchDshWebMath,atomicWrite} from './math-adapter.mjs';
import {patchDshSkills} from './skill-adapter.mjs';
export {patchDshMath,patchDshWebMath};
export {patchDshSkills};

// rc.4 has no presentation transform seam. This version/hash-checked patch
// applies the tested Chat-only presentation function; native slots, histories,
// and the independent Trajectory target remain owned by upstream.
const require=createRequire(import.meta.url);
const hash=text=>createHash('sha256').update(text).digest('hex');
const expected='a00e5176d1257d51604cefbe9a15d326d4283439df31f76ba20ff690c76e10a1';
const changes=[
  ['const order = useChat((s) => s.order);',
   '// NOTARA_CHAT_PRESENTATION_RC4\n\t\t\tconst snapshot = useChat((s) => s);\n\t\t\tconst grouped = useConversation((s) => s.views.grouped("chat"));\n\t\t\tconst rawOutline = useProjection("turnOutline");\n\t\t\tconst projected = (0, react.useMemo)(() => notaraProjectStudentChat({snapshot, grouped, outline:rawOutline}), [snapshot, grouped, rawOutline]);\n\t\t\tconst order = projected.order;'],
  ['const groupedEntries = useConversation((snapshot) => snapshot.views.grouped("chat")?.entries);',
   'const groupedEntries = projected.entries;'],
  ['const turnNavigationItems = useChat((s) => s.navigation.items());\n\t\t\tconst turnOutline = useProjection("turnOutline");',
   'const turnNavigationItems = projected.navigation;\n\t\t\tconst turnOutline = projected.outline;'],
];
const referenceChanges=[
  ['function ChatView({ useSession,','function ChatView({ notaraDisplayUserText, useSession,'],
  ['notaraProjectStudentChat({snapshot, grouped, outline:rawOutline})','notaraProjectStudentChat({snapshot, grouped, outline:rawOutline,displayUserText:notaraDisplayUserText})'],
  ['...nodeSources(binding),\n\t\t\t\t\t\t\tfileMentions:',
   '...nodeSources(binding),\n\t\t\t\t\t\t\t// NOTARA_USER_REFERENCE_DISPLAY_RC4\n\t\t\t\t\t\t\tnotaraDisplayUserText: (text, facts) => userMessageCopyText(text, ctx.uiConversation.userText.createEvaluator()({text, facts})),\n\t\t\t\t\t\t\tfileMentions:'],
];
const sessionChanges=[
  ['const rawOutline = useProjection("turnOutline");\n\t\t\tconst projected = (0, react.useMemo)(() => notaraProjectStudentChat({snapshot, grouped, outline:rawOutline,displayUserText:notaraDisplayUserText}), [snapshot, grouped, rawOutline]);',
   '// NOTARA_CHAT_SESSIONS_RC4\n\t\t\tconst rawOutline = useProjection("turnOutline");\n\t\t\tconst sessionPreset = useProjection("agentPreset");\n\t\t\tconst subagentCatalog = useProjection("subagentCatalog");\n\t\t\tconst sessionsSnapshot = useSessions((s) => s);\n\t\t\tconst projected = (0, react.useMemo)(() => notaraProjectStudentChat({snapshot, grouped, outline:rawOutline,displayUserText:notaraDisplayUserText,sessions:sessionsSnapshot,sessionId,sessionPreset,subagentCatalog}), [snapshot, grouped, rawOutline, notaraDisplayUserText, sessionsSnapshot, sessionId, sessionPreset, subagentCatalog]);'],
];
const hydrationChanges=[
  ['function ChatView({ notaraDisplayUserText,','function ChatView({ notaraRefreshProjections, notaraDisplayUserText,'],
  ['const order = projected.order;',
   '// NOTARA_CHAT_ROLE_HYDRATION_RC4\n\t\t\tconst pendingRoleKey = JSON.stringify(projected.pendingRoleSessionIds);\n\t\t\t(0, react.useEffect)(() => {\n\t\t\t\tfor (const id of JSON.parse(pendingRoleKey)) void Promise.resolve().then(() => notaraRefreshProjections(id)).catch(() => {});\n\t\t\t}, [notaraRefreshProjections, pendingRoleKey, sessionId]);\n\t\t\tconst order = projected.order;'],
  ['// NOTARA_USER_REFERENCE_DISPLAY_RC4\n',
   'notaraRefreshProjections: (id) => ctx.sessions.refreshProjections(id),\n\t\t\t\t\t\t\t// NOTARA_USER_REFERENCE_DISPLAY_RC4\n'],
];
const quietChanges = [
  [
    "if (mode === \"compact\") return speed === null ? null : (0, react_jsx_runtime.jsx)(PlainPill, {\n\t\t\t\tstat: \"activity\",\n\t\t\t\ticon,\n\t\t\t\tlabel: speed\n\t\t\t});",
    "// NOTARA_COMPACT_STATS_RC4: compact summaries retain the native details dialog."
  ],
  [
    "if (mode === \"compact\") return cacheHitText === null ? null : (0, react_jsx_runtime.jsx)(PlainPill, {\n\t\t\t\tstat: \"usage\",\n\t\t\t\ticon,\n\t\t\t\tlabel: cacheHitText\n\t\t\t});",
    "// Compact usage still exposes the complete native token breakdown."
  ],
  [
    "label: joined$1(counts, speed)",
    "label: mode === \"compact\" && speed !== null ? speed : counts"
  ],
  [
    "label: joined$1(totalText, cacheHitText)",
    "label: totalText"
  ],
  [
    "if (stats.steps === 0) return null;",
    "if (stats.steps === 0 && speed === null) return null;"
  ]
];
function replaceOnce(source,from,to) {
  if(source.split(from).length!==2)throw new Error('DSH Chat patch anchor changed; review the upstream interface before upgrading');
  return source.replace(from,to);
}
export async function patchDshChat({restore=false,check=false,directory}={}) {
  directory=directory ? pathToFileURL(resolve(directory)+'/') : new URL('./',pathToFileURL(require.resolve('@deepseek-ai/dsh-client-ui-chat/package.json')));
  const manifest=JSON.parse(await readFile(new URL('package.json',directory),'utf8'));
  if(manifest.version!=='0.2.1-rc.4')throw new Error('DSH Chat patch only supports the verified 0.2.1-rc.4');
  const path=new URL('lib/client.js',directory),source=await readFile(path,'utf8');
  const patched=source.includes('// NOTARA_CHAT_PRESENTATION_RC4');
  const referencesPatched=source.includes('// NOTARA_USER_REFERENCE_DISPLAY_RC4');
  const sessionsPatched=source.includes('// NOTARA_CHAT_SESSIONS_RC4');
  const hydrationPatched=source.includes('// NOTARA_CHAT_ROLE_HYDRATION_RC4');
  // START inherits the original ChatView indentation. Match from the slash
  // so removal preserves those tabs for exact pristine reconstruction.
  const marker=/\/\/ NOTARA_CHAT_POLICY_START ([a-f0-9]{64})\n([\s\S]*?)^\/\/ NOTARA_CHAT_POLICY_END\n/m;
  const installed=source.match(marker);
  const previousPolicy='95527b55bae5ab7ade2be2c432aa5f463825d44142248120d02e38db433dda38';
  const legacy=patched&&!installed&&hash(source)===previousPolicy;
  if(patched&&!legacy&&(!installed||hash(installed[2])!==installed[1]))throw new Error('DSH Chat policy integrity differs from its payload checksum');
  let original=legacy?source.replace(/\/\/ NOTARA_CHAT_POLICY_START\n[\s\S]*?\/\/ NOTARA_CHAT_POLICY_END\n/,''):source.replace(marker,'');
  if(source.includes('// NOTARA_COMPACT_STATS_RC4'))for(const [from,to] of [...quietChanges].reverse())original=replaceOnce(original,to,from);
  if(hydrationPatched)for(const [from,to] of [...hydrationChanges].reverse())original=replaceOnce(original,to,from);
  if(sessionsPatched)for(const [from,to] of [...sessionChanges].reverse())original=replaceOnce(original,to,from);
  if(referencesPatched)for(const [from,to] of [...referenceChanges].reverse())original=replaceOnce(original,to,from);
  if(patched)for(const [from,to] of [...changes].reverse())original=replaceOnce(original,to,from);
  if(hash(original)!==expected)throw new Error('DSH Chat package integrity differs from the verified npm artifact');
  if(restore&&!check){if(patched)await atomicWrite(path,original);return;}
  let next=original;for(const [from,to] of changes)next=replaceOnce(next,from,to);
  const policyPath=require.resolve('@oh-my-student/plugin-graph-and-blocks/chat-visibility');
  const textPolicy=(await readFile(new URL('./user-message-text.js',pathToFileURL(policyPath)),'utf8')).replaceAll('export function ','function ');
  const policy=(textPolicy+'\n'+(await readFile(policyPath,'utf8')).replace('export function projectStudentChat','function notaraProjectStudentChat')).trimEnd()+'\n';
  next=replaceOnce(next,'function ChatView(',`// NOTARA_CHAT_POLICY_START ${hash(policy)}\n${policy}// NOTARA_CHAT_POLICY_END\nfunction ChatView(`);
  for(const [from,to] of referenceChanges)next=replaceOnce(next,from,to);
  for(const [from,to] of sessionChanges)next=replaceOnce(next,from,to);
  for(const [from,to] of hydrationChanges)next=replaceOnce(next,from,to);
  for(const [from,to] of quietChanges)next=replaceOnce(next,from,to);
  if(check)return {version:manifest.version,patched,current:source===next};
  if(next!==source)await atomicWrite(path,next);
}
const entryCopyChanges = [
  ["const imageLimits = useProjection(\"imageLimits\");", "// NOTARA_TRANSIENT_SUCCESS_RC4: command success is a receipt, not composer state.\n\t\t\tconst [successNotice, setSuccessNotice] = (0, react.useState)(null);\n\t\t\t(0, react.useEffect)(() => {\n\t\t\t\tsetSuccessNotice(notice?.level === \"info\" ? { ...notice, owner: sessionId } : null);\n\t\t\t}, [notice, sessionId]);\n\t\t\tconst imageLimits = useProjection(\"imageLimits\");"],
  ["notice?.level === \"info\" && (0, react_jsx_runtime.jsx)(\"div\", {\n\t\t\t\t\t\tclassName: InputBar_module_css_default.notice,\n\t\t\t\t\t\trole: \"status\",\n\t\t\t\t\t\tchildren: notice.text\n\t\t\t\t\t})", "successNotice !== null && successNotice.owner === sessionId && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Toast, {\n\t\t\t\t\t\ttext: successNotice.text,\n\t\t\t\t\t\ttone: \"success\",\n\t\t\t\t\t\tholdMs: 3000,\n\t\t\t\t\t\tanchor: cardRef.current,\n\t\t\t\t\t\tonDone: () => setSuccessNotice(current => current === successNotice ? null : current)\n\t\t\t\t\t}, `${sessionId}:${successNotice.seq}`)"],
  [
    'function ReferenceChip({ label, appearance, invalid }) {',
    'function ReferenceChip({ label, appearance, invalid, source }) {'
  ],
  [
    'children: [appearance === void 0 ? (0, react_jsx_runtime.jsx)("span", {',
    'children: [source === "skill" ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSkillOutlineRegular, {size:14,className:ReferenceChip_module_css_default.icon}) : appearance === void 0 ? (0, react_jsx_runtime.jsx)("span", {'
  ],
  [
    'label: this.__label,\n\t\t\t\t\tappearance: this.__appearance,',
    'label: this.__label,\n\t\t\t\t\tsource: this.__source,\n\t\t\t\t\tappearance: this.__appearance,'
  ],
  [
    'variant === "composer" && input !== void 0 && sessionId !== void 0 ? renderSlot("conversation.composer.dock", {})',
    'input !== void 0 && sessionId !== void 0 ? renderSlot("conversation.composer.dock", {})'
  ],
  [
    "\"placeholder.default\": \"发消息或创建任务, / 调用指令, @ 文件或对话\"",
    "\"placeholder.default\": \"说说你的想法，或带上资料一起讨论\""
  ],
  [
    "\"placeholder.hero\": \"描述你想要构建的内容, / 调用指令, @ 文件或对话\"",
    "\"placeholder.hero\": \"今天想弄懂什么？\""
  ],
  [
    "\"placeholder.default\": \"Message or run a task, / commands, @ files or sessions\"",
    "\"placeholder.default\": \"Share a thought, question, or material to explore\""
  ],
  [
    "\"placeholder.hero\": \"Describe what you want to build, / commands, @ files or sessions\"",
    "\"placeholder.hero\": \"What would you like to understand today?\""
  ]
];
export async function patchDshEntryCopy({restore=false,check=false,directory}={}) {
  directory=directory ? pathToFileURL(resolve(directory)+'/') : new URL('./',pathToFileURL(require.resolve('@deepseek-ai/dsh-client-ui-conversation/package.json')));
  const manifest=JSON.parse(await readFile(new URL('package.json',directory),'utf8'));
  if(manifest.version!=='0.2.1-rc.4')throw new Error('DSH entry copy only supports the verified 0.2.1-rc.4');
  const path=new URL('lib/client.js',directory),source=await readFile(path,'utf8');
  const patched=source.includes('"placeholder.hero": "今天想弄懂什么？"');
  let original=source;
  if(patched)for(const [from,to] of [...entryCopyChanges].reverse())if(original.includes(to))original=replaceOnce(original,to,from);
  if(hash(original)!=='cfbd9fd95b0509f7c93a22a62a67ebc10481c8eda611704ea50c2e195b9a5a69')throw new Error('DSH conversation package integrity differs from the verified npm artifact');
  let next=original;for(const [from,to] of entryCopyChanges)next=replaceOnce(next,from,to);
  if(check)return {version:manifest.version,patched,current:source===next};
  if(source!==(restore?original:next))await atomicWrite(path,restore?original:next);
}
export async function patchDshHost(options={}) {
  const entryOptions={...options,directory:options.directory?resolve(options.directory,'../dsh-client-ui-conversation'):undefined};
  const mathOptions={...options,directory:options.directory?resolve(options.directory,'../dsh-client-ui-primitives'):undefined};
  const webOptions={...options,directory:options.directory?resolve(options.directory,'../dsh-web-frontend'):undefined};
  const skillOptions={...options,directory:options.directory?resolve(options.directory,'../dsh-client-ui-skill'):undefined};
  // Validate all targets before writing any of them.
  const chat=await patchDshChat({...options,check:true});
  const math=await patchDshMath({...mathOptions,check:true});
  const web=await patchDshWebMath({...webOptions,check:true});
  const entry=await patchDshEntryCopy({...entryOptions,check:true});
  const skills=await patchDshSkills({...skillOptions,check:true});
  if(options.check)return {chat,math,web,entry,skills};
  await patchDshChat(options);
  await patchDshMath(mathOptions);
  await patchDshWebMath(webOptions);
  await patchDshEntryCopy(entryOptions);
  await patchDshSkills(skillOptions);
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),host=args.indexOf('--host');
  if(host>=0&&(!args[host+1]||args[host+1].startsWith('--')))throw new Error('--host requires a directory');
  for(let i=0;i<args.length;i++){if(args[i]==='--host'){i++;continue;}if(!['--check','--restore'].includes(args[i]))throw new Error('Unknown argument');}
  console.log(await patchDshHost({directory:host>=0?args[host+1]:undefined,check:args.includes('--check'),restore:args.includes('--restore')})??'Host adapter updated');
}
