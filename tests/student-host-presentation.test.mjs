import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as jsx from 'react/jsx-runtime';
import {patchDshChat,patchDshEntryCopy} from '../plugins/bundle/host-adapter.mjs';

test('learning entry copy is version-checked, reversible and idempotent',async()=>{
  const root=await mkdtemp(join(tmpdir(),'notara-entry-ui-')),file=join(root,'lib/client.js');
  try{
    await mkdir(join(root,'lib'));await writeFile(join(root,'package.json'),JSON.stringify({version:'0.2.1-rc.4'}));
    await writeFile(file,await readFile(new URL('../node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js',import.meta.url)));
    await patchDshEntryCopy({directory:root,restore:true});const original=await readFile(file,'utf8');
    assert.equal((await patchDshEntryCopy({directory:root,check:true})).patched,false);
    await patchDshEntryCopy({directory:root});const changed=await readFile(file,'utf8');
    assert.match(changed,/'placeholder.hero'|"placeholder.hero": "今天想弄懂什么？"/);
    assert.match(changed,/父会话已离线，无法继续发送/);
    await patchDshEntryCopy({directory:root});assert.equal(await readFile(file,'utf8'),changed);
    await patchDshEntryCopy({directory:root,restore:true});assert.equal(await readFile(file,'utf8'),original);
    await writeFile(file,original+'\n// unrecognized');await assert.rejects(patchDshEntryCopy({directory:root}),/integrity/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('compact native statistics retain the full details dialog, and omit missing usage',async()=>{
  const root=await mkdtemp(join(tmpdir(),'notara-stat-ui-')),file=join(root,'lib/client.js');
  try{
    await mkdir(join(root,'lib'));await writeFile(join(root,'package.json'),JSON.stringify({version:'0.2.1-rc.4'}));
    await writeFile(file,await readFile(new URL('../node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js',import.meta.url)));
    await patchDshChat({directory:root});const source=await readFile(file,'utf8');
    const stats={steps:4,turns:2,decodeMs:1000,decodeTokens:123,llmMs:2000,toolMs:300,ttftSteps:2,ttftMs:300};
    const usage={uncachedInputTokens:100,cacheReadTokens:400,cacheWriteTokens:0,outputTokens:50};
    function DialogPill(){} function PlainPill(){}
    const env={react_jsx_runtime:jsx,react:{Fragment:Symbol.for('react.fragment')},_deepseek_ai_dsh_client_ui_primitives:{IconGaugeOutlineRegular:()=>null,IconDatabaseOutlineRegular:()=>null},DialogPill,PlainPill,useSessionStats:()=>stats,decodeSpeed:()=> '123 tok/s',joined$1:(a,b)=>a+' · '+b,stat_dialog_module_css_default:{details:'details'},formatDuration:n=>n+'ms',cacheHitPercent:()=>80,billedInputTokens:u=>u.uncachedInputTokens+u.cacheReadTokens+u.cacheWriteTokens,formatTokens:String,exactCount:String};
    const extract=name=>{const start=source.indexOf('function '+name+'('),end=source.indexOf('\n\t\t});',start);assert.ok(start>0&&end>start);return new Function(...Object.keys(env),'return '+source.slice(start,end)+'\n}')(...Object.values(env));};
    const props={useChat:()=>{},useProjection:()=>usage,usePerformanceUsage:fn=>fn('compact'),t:(key,args)=>key+JSON.stringify(args??{})};
    const activity=extract('ActivityPill')(props),tokens=extract('UsagePill')(props);
    assert.equal(activity.type,DialogPill);assert.equal(tokens.type,DialogPill);
    assert.equal(activity.props.label,'123 tok/s');assert.match(tokens.props.label,/550/);
    assert.equal(activity.props.children.props['data-session-stats-details'],true);
    assert.equal(tokens.props.children.props['data-session-stats-usage'],true);
    assert.equal(extract('UsagePill')({...props,useProjection:()=>undefined}),null);
  }finally{await rm(root,{recursive:true,force:true});}
});
