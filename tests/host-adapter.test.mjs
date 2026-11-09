import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {patchDshChat,patchDshMath,patchDshHost,patchDshEntryCopy} from '../plugins/bundle/host-adapter.mjs';
import {createHash} from 'node:crypto';

const sha=source=>createHash('sha256').update(source).digest('hex');
const chatPolicy=/\/\/ NOTARA_CHAT_POLICY_START(?: [a-f0-9]{64})?\n([\s\S]*?)\/\/ NOTARA_CHAT_POLICY_END\n/;
// Rebuild the immutable old 0.1.1 patch from pristine rc.4. Its complete hash,
// not the currently installed helper/package revision, identifies the fixture.
async function legacyChatPatch(pristine){
  const replacements=[
    ['const order = useChat((s) => s.order);',
     '// NOTARA_CHAT_PRESENTATION_RC4\n\t\t\tconst snapshot = useChat((s) => s);\n\t\t\tconst grouped = useConversation((s) => s.views.grouped("chat"));\n\t\t\tconst rawOutline = useProjection("turnOutline");\n\t\t\tconst projected = (0, react.useMemo)(() => notaraProjectStudentChat({snapshot, grouped, outline:rawOutline}), [snapshot, grouped, rawOutline]);\n\t\t\tconst order = projected.order;'],
    ['const groupedEntries = useConversation((snapshot) => snapshot.views.grouped("chat")?.entries);','const groupedEntries = projected.entries;'],
    ['const turnNavigationItems = useChat((s) => s.navigation.items());\n\t\t\tconst turnOutline = useProjection("turnOutline");','const turnNavigationItems = projected.navigation;\n\t\t\tconst turnOutline = projected.outline;'],
  ];
  for(const [from,to] of replacements){assert.equal(pristine.split(from).length,2);pristine=pristine.replace(from,()=>to);}
  const policy=await readFile(new URL('./fixtures/chat-policy-0.1.1.js',import.meta.url),'utf8');
  const legacy=pristine.replace('function ChatView(',()=>`// NOTARA_CHAT_POLICY_START\n${policy}\n// NOTARA_CHAT_POLICY_END\nfunction ChatView(`);
  assert.equal(sha(legacy),'95527b55bae5ab7ade2be2c432aa5f463825d44142248120d02e38db433dda38');
  return legacy;
}

async function webFixture(directory){
  for(const name of ['dsh-client-ui-skill','dsh-client-ui-input-trigger']){
    const target=join(directory,'..',name);await mkdir(join(target,'lib'),{recursive:true});
    await writeFile(join(target,'package.json'),JSON.stringify({version:'0.2.1-rc.4'}));
    await writeFile(join(target,'lib/client.js'),await readFile(new URL(`../node_modules/@deepseek-ai/${name}/lib/client.js`,import.meta.url)));
  }
  const entry=join(directory,'../dsh-client-ui-conversation');
  await mkdir(join(entry,'lib'),{recursive:true});
  await writeFile(join(entry,'package.json'),JSON.stringify({version:'0.2.1-rc.4'}));
  await writeFile(join(entry,'lib/client.js'),await readFile(new URL('../node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js',import.meta.url)));
  const source=new URL('../node_modules/@deepseek-ai/dsh-web-frontend/',import.meta.url);
  const html=await readFile(new URL('dist/index.html',source),'utf8');
  await mkdir(join(directory,'dist/assets'),{recursive:true});
  await writeFile(join(directory,'package.json'),JSON.stringify({version:'0.2.1-rc.4'}));
  await writeFile(join(directory,'dist/index.html'),html);
  const entries=new Set(['assets/index-BXV-oxvX.js',html.match(/src="\.\/([^\"]+\.js)"/)[1]]);
  for(const entry of entries)await writeFile(join(directory,'dist',entry),await readFile(new URL('dist/'+entry,source)));
}

test('host adapter checks integrity, applies idempotently and restores pristine rc.4',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'notara-adapter-'));
  try{
    await mkdir(join(directory,'lib'));
    await writeFile(join(directory,'package.json'),JSON.stringify({version:'0.2.1-rc.4'}));
    await writeFile(join(directory,'lib/client.js'),await readFile(new URL('../node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js',import.meta.url)));
    await patchDshChat({directory,restore:true});
    const pristine=await readFile(join(directory,'lib/client.js'),'utf8');
    assert.deepEqual(await patchDshChat({directory,check:true}),{version:'0.2.1-rc.4',patched:false,current:false});
    assert.equal(await readFile(join(directory,'lib/client.js'),'utf8'),pristine,'check never writes');
    await patchDshChat({directory});
    const patched=await readFile(join(directory,'lib/client.js'),'utf8');
    assert.match(patched,/\n\t\t\/\/ NOTARA_CHAT_POLICY_START [a-f0-9]{64}\n/,'START inherits the original ChatView indentation');
    assert.deepEqual(await patchDshChat({directory,check:true}),{version:'0.2.1-rc.4',patched:true,current:true});
    await patchDshChat({directory});assert.equal(await readFile(join(directory,'lib/client.js'),'utf8'),patched);
    await writeFile(join(directory,'lib/client.js'),patched.replace('function notaraProjectStudentChat','function BROKEN_notaraProjectStudentChat'));
    await assert.rejects(patchDshChat({directory,check:true}),/policy integrity/);
    await assert.rejects(patchDshChat({directory,restore:true}),/policy integrity/);
    await writeFile(join(directory,'lib/client.js'),patched.replace(chatPolicy,''));
    await assert.rejects(patchDshChat({directory,check:true}),/policy integrity/);
    await writeFile(join(directory,'lib/client.js'),patched);
    await patchDshChat({directory,restore:true});assert.equal(await readFile(join(directory,'lib/client.js'),'utf8'),pristine);
    await writeFile(join(directory,'lib/client.js'),pristine+'\n// unrelated modification');
    await assert.rejects(patchDshChat({directory}),/integrity/);
    await writeFile(join(directory,'package.json'),JSON.stringify({version:'0.2.2'}));
    await assert.rejects(patchDshChat({directory}),/only supports/);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('chat policy upgrades/restores pinned legacy and valid previous payloads, rejects tampering without writes',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'notara-chat-upgrade-')),file=join(directory,'lib/client.js');
  try{
    await mkdir(join(directory,'lib'));
    await writeFile(join(directory,'package.json'),JSON.stringify({version:'0.2.1-rc.4'}));
    await writeFile(file,await readFile(new URL('../node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js',import.meta.url)));
    await patchDshChat({directory,restore:true});const pristine=await readFile(file,'utf8');
    assert.equal(sha(pristine),'a00e5176d1257d51604cefbe9a15d326d4283439df31f76ba20ff690c76e10a1');
    const legacy=await legacyChatPatch(pristine);
    await patchDshChat({directory});const current=await readFile(file,'utf8');
    assert.match(current,/NOTARA_USER_REFERENCE_DISPLAY_RC4/);
    const older=current.replace(chatPolicy,(_marker,payload)=>{
      const previous='// previous helper revision\n'+payload;
      return `// NOTARA_CHAT_POLICY_START ${sha(previous)}\n${previous}// NOTARA_CHAT_POLICY_END\n`;
    });
    for(const previous of [legacy,older]){
      await writeFile(file,previous);
      assert.deepEqual(await patchDshChat({directory,check:true}),{version:'0.2.1-rc.4',patched:true,current:false});
      assert.equal(await readFile(file,'utf8'),previous,'checking an older patch never upgrades it');
      await patchDshChat({directory});assert.equal(await readFile(file,'utf8'),current);
      await patchDshChat({directory});assert.equal(await readFile(file,'utf8'),current,'upgrade is idempotent');
      await writeFile(file,previous);await patchDshChat({directory,restore:true});assert.equal(await readFile(file,'utf8'),pristine);
    }
    const malformed=[
      current.replace('function notaraProjectStudentChat','function changedPolicy'),
      current.replace(/(NOTARA_CHAT_POLICY_START )[a-f0-9]{64}/,'$1'+'0'.repeat(64)),
      current.replace(chatPolicy,''),
      current.replace('NOTARA_CHAT_POLICY_END','BROKEN_CHAT_POLICY_END'),
      current+'\n// outside payload',
      legacy.replace('function notaraProjectStudentChat','function changedLegacyPolicy'),
    ];
    for(const source of malformed)for(const mode of [{check:true},{},{restore:true}]){
      await writeFile(file,source);await assert.rejects(patchDshChat({directory,...mode}),/integrity/);
      assert.equal(await readFile(file,'utf8'),source,'rejected policy must not write');
    }
    await writeFile(file,current);await writeFile(join(directory,'package.json'),JSON.stringify({version:'0.2.2'}));
    for(const mode of [{check:true},{},{restore:true}]){
      await assert.rejects(patchDshChat({directory,...mode}),/only supports/);assert.equal(await readFile(file,'utf8'),current);
    }
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('chat role hydration automatically reads cold child projections without opening the child and rerenders safely',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'notara-chat-roles-'));
  try{
    await mkdir(join(directory,'lib'));
    await writeFile(join(directory,'package.json'),JSON.stringify({version:'0.2.1-rc.4'}));
    await writeFile(join(directory,'lib/client.js'),await readFile(new URL('../node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js',import.meta.url)));
    await patchDshChat({directory});
    const source=await readFile(join(directory,'lib/client.js'),'utf8');
    assert.ok(/function ChatView\(\{ notaraRefreshProjections,/.test(source),'ChatView must receive the public projection reader');
    const callback=source.match(/notaraRefreshProjections: ([^\n]+),\n/);
    assert.ok(callback,'Chat inject must wire the public projection reader');
    const prologue=source.match(/\/\/ NOTARA_CHAT_SESSIONS_RC4\n([\s\S]*?)const order = projected.order;/)?.[1];
    assert.ok(prologue);
    const project=new Function(source.match(chatPolicy)[1]+'\nreturn notaraProjectStudentChat;')();
    const render=new Function('react','notaraProjectStudentChat','snapshot','grouped','useProjection','useSessions','sessionId','notaraDisplayUserText','notaraRefreshProjections',prologue+'\nreturn projected;');
    for(const preset of ['companion-deepseek','notara-teacher','worker-problem',null]){
      const requests=[],effects=[];
      let dependencies,complete;
      const react={
        useMemo:fn=>fn(),
        useEffect(fn,next){if(!dependencies||next.some((item,i)=>item!==dependencies[i]))effects.push(fn);dependencies=next;},
      };
      let sessions={byId:{child:{id:'child',origin:'subagent',parentId:'parent'}},projectionsBySession:{}};
      const ctx={sessions:{refreshProjections(id){requests.push(id);return new Promise((resolve,reject)=>{complete=()=>{
        if(preset===null){reject(new Error('offline'));return;}
        sessions={...sessions,projectionsBySession:{child:{values:{agentPreset:preset}}}};resolve();
      };});}}};
      const refresh=new Function('ctx','return ('+callback[1]+');')(ctx);
      const turn={turn:0,start:{seq:1}},nodes=new Map([
        ['trigger',{kind:'context',location:{turn},data:{source:{kind:'subagent-settled',senderSessionId:'child'}}}],
        ['answer',{kind:'assistant-step',location:{turn},data:{blocks:[{text:'SECRET'}]}}],
      ]);
      const snapshot={nodes,order:[...nodes.keys()],timeline:{turns:new Map([[0,turn]])},navigation:{items:()=>[{turn:0,anchorKey:'answer',prompt:'SECRET',response:'SECRET'}]}};
      const rawOutline=[{turn:0,prompt:'SECRET',response:'SECRET'}];
      const projection=key=>key==='agentPreset'?'notara-teacher':key==='subagentCatalog'?[{id:'child',mode:'continuable',provider:'spawn',label:'伙伴'}]:rawOutline;
      const paint=()=>render(react,project,snapshot,undefined,projection,selector=>selector(sessions),'parent',undefined,refresh);
      const cold=paint();
      assert.deepEqual(cold.order,[]);
      assert.equal(cold.outline[0].response,'');
      effects.splice(0).forEach(effect=>effect());
      await new Promise(resolve=>setImmediate(resolve));
      assert.deepEqual(requests,['child'],'no manual open/retain is required to load child role');
      paint();assert.equal(effects.length,0,'unrelated renders must not loop role reads');
      complete();await new Promise(resolve=>setImmediate(resolve));
      const hydrated=paint();
      const visible=preset==='companion-deepseek'||preset==='notara-teacher';
      assert.deepEqual(hydrated.order,visible?['trigger','answer']:[]);
      assert.equal(hydrated.navigation.length,visible?1:0);
      assert.equal(hydrated.outline[0]?.response??'',visible?'SECRET':'');
      effects.splice(0).forEach(effect=>effect());
      await new Promise(resolve=>setImmediate(resolve));
      assert.deepEqual(requests,['child'],'hydrated or failed role reads do not poll');
    }
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('math adapter patches streaming/freeze and settled grammars and restores its exact source',async()=>{
  const root=await mkdtemp(join(tmpdir(),'notara-math-adapter-'));
  const chat=join(root,'dsh-client-ui-chat'),directory=join(root,'dsh-client-ui-primitives');
  try{
    for(const dir of [chat,directory]){await mkdir(join(dir,'lib'),{recursive:true});await writeFile(join(dir,'package.json'),JSON.stringify({version:'0.2.1-rc.4'}));}
    await webFixture(join(root,'dsh-web-frontend'));
    const file=join(directory,'lib/index.js');
    await writeFile(file,await readFile(new URL('../node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/index.js',import.meta.url)));
    await writeFile(join(chat,'lib/client.js'),await readFile(new URL('../node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js',import.meta.url)));
    await patchDshMath({directory,restore:true});
    const pristine=await readFile(file,'utf8');
    await patchDshHost({directory:chat});
    const patched=await readFile(file,'utf8');
    assert.equal((await patchDshHost({directory:chat,check:true})).math.patched,true);
    const conversation=await readFile(join(root,'dsh-client-ui-conversation/lib/client.js'),'utf8');
    assert.match(conversation,/NOTARA_TRANSIENT_SUCCESS_RC4/);
    assert.doesNotMatch(conversation,/notice\?\.level === "info" && \(0, react_jsx_runtime\.jsx\)\("div"/);
    assert.match(conversation,/if \(notice\?\.level === "error"\) showToast\(notice.text\);/,'native error handling stays unchanged');
    assert.match(conversation,/current === successNotice \? null : current/,'old timers cannot dismiss a later receipt');
    assert.match(patched,/notaraParseMath\(fromMarkdown, text/);
    const settled=text=>text.match(/function parseGfmWithMath\(text\) \{[\s\S]*?\n\}/)[0];
    assert.doesNotMatch(settled(patched),/mathCompatibility\(\)/);
    const streaming=text=>text.match(/function parseGfm\(text\) \{[\s\S]*?\n\}/)[0];
    assert.equal(streaming(patched),streaming(pristine));
    assert.match(patched,/parser = new IncrementalMarkdownParser\(notaraStreamingMathParser\(/);
    assert.match(patched,/let firstUnstable = notaraMathFreezeBoundary\(blocks,/);
    assert.match(patched,/recoverLocalImages\(fromMarkdown\(source, options\), source\)/);
    await patchDshMath({directory});assert.equal(await readFile(file,'utf8'),patched);
    await writeFile(file,patched.replace('function notaraMath','function BROKEN_notaraMath'));
    await assert.rejects(patchDshMath({directory,check:true}),/policy integrity/);
    await assert.rejects(patchDshMath({directory,restore:true}),/policy integrity/);
    const oldPayload=patched.replace(/\/\/ NOTARA_MATH_START [a-f0-9]{64}\n([\s\S]*?)\/\/ NOTARA_MATH_END\n/,(_,payload)=>{
      const previous='// previous helper revision\n'+payload;
      return '// NOTARA_MATH_START '+createHash('sha256').update(previous).digest('hex')+'\n'+previous+'// NOTARA_MATH_END\n';
    });
    await writeFile(file,oldPayload);
    assert.equal((await patchDshMath({directory,check:true})).current,false);
    await patchDshMath({directory});assert.equal(await readFile(file,'utf8'),patched);
    await writeFile(file,oldPayload);await patchDshMath({directory,restore:true});
    assert.equal(await readFile(file,'utf8'),pristine);
    const legacy=oldPayload.replace(/parser = new IncrementalMarkdownParser\(notaraStreamingMathParser\([^\n]+;/,'parser = new IncrementalMarkdownParser(parseGfm);')
      .replace('let firstUnstable = notaraMathFreezeBoundary(blocks, Math.max(0, blocks.length - UNSTABLE_TAIL_BLOCKS));','let firstUnstable = Math.max(0, blocks.length - UNSTABLE_TAIL_BLOCKS);');
    await writeFile(file,legacy);assert.equal((await patchDshMath({directory,check:true})).current,false);
    await patchDshMath({directory});assert.equal(await readFile(file,'utf8'),patched,'upgrade a settled-only patch');
    await writeFile(file,legacy);await patchDshMath({directory,restore:true});assert.equal(await readFile(file,'utf8'),pristine,'restore a settled-only patch');
    await writeFile(file,pristine+'\n// unrelated modification');
    const beforeChat=await readFile(join(chat,'lib/client.js'),'utf8');
    await assert.rejects(patchDshHost({directory:chat}),/integrity/);
    assert.equal(await readFile(join(chat,'lib/client.js'),'utf8'),beforeChat);
    await writeFile(join(directory,'package.json'),JSON.stringify({version:'0.2.2'}));
    await assert.rejects(patchDshMath({directory}),/only supports/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('web math adapter updates the served entry with a distinct cache URL and restores pinned assets',async()=>{
  const {patchDshWebMath}=await import('../plugins/bundle/math-adapter.mjs');
  assert.equal(typeof patchDshWebMath,'function');
  const directory=await mkdtemp(join(tmpdir(),'notara-web-math-'));
  try{
    await webFixture(directory);await patchDshWebMath({directory,restore:true});
    const entry=join(directory,'dist/index.html'),original=await readFile(entry,'utf8');
    await patchDshWebMath({directory});
    const checked=await patchDshWebMath({directory,check:true});assert.equal(checked.patched,true);assert.equal(checked.current,true);
    const html=await readFile(entry,'utf8'),name=html.match(/src="\.\/([^\"]+\.js)"/)[1];
    assert.match(name,/index-notara-math-[a-f0-9]{64}\.js$/);assert.notEqual(html,original);
    const path=join(directory,'dist',name),body=await readFile(path,'utf8');
    assert.match(body,/notaraParseMath\(s7,e/);
    assert.match(body,/parser=new LF\(notaraStreamingMathParser\(/);
    assert.match(body,/let n=notaraMathFreezeBoundary\(i,/);
    assert.match(body,/ew\(s7\(source,options\),source\)/);
    await patchDshWebMath({directory});assert.equal(await readFile(entry,'utf8'),html);
    await writeFile(path,body+'\n// tampered');await assert.rejects(patchDshWebMath({directory}),/integrity/);await assert.rejects(patchDshWebMath({directory,restore:true}),/integrity/);
    await writeFile(path,body);await patchDshWebMath({directory,restore:true});assert.equal(await readFile(entry,'utf8'),original);assert.equal((await patchDshWebMath({directory,check:true})).patched,false);
    assert.equal(await readFile(path,'utf8'),body,'in-flight clients can still load the previous content-addressed entry');
    const legacy=body.replace(/parser=new LF\(notaraStreamingMathParser\([^\n]+?;frozenCount/,'parser=new LF(rw);generation=-1;frozenCount')
      .replace('let n=notaraMathFreezeBoundary(i,Math.max(0,i.length-EF));','let n=Math.max(0,i.length-EF);');
    assert.notEqual(legacy,body);
    const legacyName='assets/index-notara-math-'+createHash('sha256').update(legacy).digest('hex')+'.js';
    await writeFile(join(directory,'dist',legacyName),legacy);
    await writeFile(entry,original.replace('assets/index-BXV-oxvX.js',legacyName));
    assert.equal((await patchDshWebMath({directory,check:true})).current,false);
    await patchDshWebMath({directory});assert.equal(await readFile(entry,'utf8'),html,'upgrade generates the current content hash');
    assert.equal(await readFile(join(directory,'dist',legacyName),'utf8'),legacy,'keep the previous immutable entry');
    await writeFile(entry,original.replace('assets/index-BXV-oxvX.js',legacyName));
    await patchDshWebMath({directory,restore:true});assert.equal(await readFile(entry,'utf8'),original);
    await writeFile(entry,original+'\n<!-- unrelated -->');await assert.rejects(patchDshWebMath({directory}),/integrity/);
    await writeFile(join(directory,'package.json'),JSON.stringify({version:'0.2.2'}));await assert.rejects(patchDshWebMath({directory}),/only supports/);
  }finally{await rm(directory,{recursive:true,force:true});}
});
