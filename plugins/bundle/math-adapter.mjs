import {readFile,writeFile,rename,rm,stat} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const expected='6e52c633c75e408d79d01754606aa7bd2f470eff720197862fb9f777076867a7';
const originalParser=`function parseGfmWithMath(text) {
\treturn recoverLocalImages(fromMarkdown(text, {
\t\textensions: [
\t\t\tgfm(),
\t\t\tcjkFriendlyStrong(),
\t\t\tmathCompatibility(),
\t\t\tmath()
\t\t],
\t\tmdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()]
\t}), text);
}`;
const patchedParser=`function parseGfmWithMath(text) {
\treturn recoverLocalImages(notaraParseMath(fromMarkdown, text, {
\t\textensions: [gfm(), cjkFriendlyStrong()],
\t\tmdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()]
\t}, math()), text);
}`;
const changes=[
  [originalParser,patchedParser],
  ['parser = new IncrementalMarkdownParser(parseGfm);',
   'parser = new IncrementalMarkdownParser(notaraStreamingMathParser((source, options) => recoverLocalImages(fromMarkdown(source, options), source), {extensions: [gfm(), cjkFriendlyStrong()], mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()]}, math(), (value, displayMode) => katex.renderToString(value, {displayMode, throwOnError: true, strict: "ignore"})));'],
  ['let firstUnstable = Math.max(0, blocks.length - UNSTABLE_TAIL_BLOCKS);',
   'let firstUnstable = notaraMathFreezeBoundary(blocks, Math.max(0, blocks.length - UNSTABLE_TAIL_BLOCKS));'],
];
const hash=text=>createHash('sha256').update(text).digest('hex');
function replaceOnce(source,from,to) {
  if(source.split(from).length!==2)throw new Error('DSH math patch anchor changed; review the upstream grammar before upgrading');
  return source.replace(from,to);
}

export async function atomicWrite(path,content){
  const temporary=new URL(path);temporary.pathname+=`.notara-${randomUUID()}.tmp`;
  const mode=await stat(path).then(info=>info.mode,error=>{if(error.code==='ENOENT')return 0o644;throw error;});
  try{await writeFile(temporary,content,{mode});await rename(temporary,path);}
  finally{await rm(temporary,{force:true});}
}

/** Patch settled math and the SDK streaming grammar/freeze frontier together.
 * No saved message or document is rewritten. */
export async function patchDshMath({restore=false,check=false,directory}={}) {
  const root=directory ? pathToFileURL(resolve(directory)+'/') : new URL('./',pathToFileURL(require.resolve('@deepseek-ai/dsh-client-ui-primitives/package.json')));
  const manifest=JSON.parse(await readFile(new URL('package.json',root),'utf8'));
  if(manifest.version!=='0.2.1-rc.4')throw new Error('DSH math patch only supports the verified 0.2.1-rc.4');
  const path=new URL('lib/index.js',root),source=await readFile(path,'utf8');
  const marker=/^\/\/ NOTARA_MATH_START ([a-f0-9]{64})\n([\s\S]*?)^\/\/ NOTARA_MATH_END\n/m;
  const patched=source.includes('// NOTARA_MATH_START');
  const installed=source.match(marker);
  if(patched&&(!installed||hash(installed[2])!==installed[1]))throw new Error('DSH math policy integrity differs from its payload checksum');
  let original=source.replace(marker,'');
  if(patched)for(const [from,to] of [...changes].reverse()){
    // Older adapters only replaced the settled parser. Both revisions must
    // reconstruct the exact pinned artifact before upgrade or restore.
    if(original.includes(to))original=replaceOnce(original,to,from);
    else if(!original.includes(from))throw new Error('DSH math patch anchor changed; review the upstream grammar before upgrading');
  }
  if(hash(original)!==expected)throw new Error('DSH math package integrity differs from the verified npm artifact');
  // Restore is based on the pinned original and installed payload, independent
  // of which helper version is now shipped. It can also recover after upgrades.
  if(restore&&!check){if(patched)await atomicWrite(path,original);return;}
  const helper=(await readFile(require.resolve('@oh-my-student/plugin-graph-and-blocks/markdown-math'),'utf8')).replace(/^export /gm,'').trimEnd()+'\n';
  let next=original;
  for(const [from,to] of changes)next=replaceOnce(next,from,to);
  next=replaceOnce(next,'function parseGfmWithMath(text) {',`// NOTARA_MATH_START ${hash(helper)}\n${helper}// NOTARA_MATH_END\nfunction parseGfmWithMath(text) {`);
  if(check)return {version:manifest.version,patched,current:source===next};
  if(source!==next)await atomicWrite(path,next);
}

const webEntry='./assets/index-BXV-oxvX.js';
const webEntryHash='0f3fc6b857e4f8bd4d69619ce1010240cdaaa443abf0826532a24ef8f6e32ef0';
const webHtmlHash='3ddfb0ce0bc60975c3dba70c8b960768f2f83d7293b562d82cb97e7d365a54c9';
const webParser='function qF(e){return ew(s7(e,{extensions:[a7(),tw(),JF(),yb()],mdastExtensions:[l7(),$b()]}),e)}';

/** The shipped web frontend embeds primitives at build time. Patching its
 * library source alone does not affect the browser. Keep the pinned asset
 * intact and switch HTML to a content-addressed copy, so caches also update. */
export async function patchDshWebMath({restore=false,check=false,directory}={}){
  const root=directory?pathToFileURL(resolve(directory)+'/'):new URL('./',pathToFileURL(require.resolve('@deepseek-ai/dsh-web-frontend/package.json')));
  const manifest=JSON.parse(await readFile(new URL('package.json',root),'utf8'));
  if(manifest.version!=='0.2.1-rc.4')throw new Error('DSH web math patch only supports the verified 0.2.1-rc.4');
  const dist=new URL('dist/',root),index=new URL('index.html',dist),html=await readFile(index,'utf8');
  const installed=html.match(/\.\/assets\/index-notara-math-([a-f0-9]{64})\.js/);
  const originalHtml=installed?replaceOnce(html,installed[0],webEntry):html;
  const original=await readFile(new URL(webEntry,dist),'utf8');
  if(hash(originalHtml)!==webHtmlHash||hash(original)!==webEntryHash)throw new Error('DSH web frontend integrity differs from the verified npm artifact');
  if(installed&&hash(await readFile(new URL(installed[0],dist),'utf8'))!==installed[1])throw new Error('DSH web math asset integrity differs from its filename checksum');
  if(restore&&!check){
    // A client may already hold the previous HTML. Keep its immutable entry
    // available until the containing npm package is replaced/uninstalled.
    if(installed)await atomicWrite(index,originalHtml);
    return;
  }
  const helper=(await readFile(require.resolve('@oh-my-student/plugin-graph-and-blocks/markdown-math'),'utf8')).replace(/^export /gm,'').trimEnd()+'\n';
  let patched=replaceOnce(original,webParser,`${helper}function qF(e){return ew(notaraParseMath(s7,e,{extensions:[a7(),tw()],mdastExtensions:[l7(),$b()]},yb()),e)}`);
  patched=replaceOnce(patched,'parser=new LF(rw);','parser=new LF(notaraStreamingMathParser((source,options)=>ew(s7(source,options),source),{extensions:[a7(),tw()],mdastExtensions:[l7(),$b()]},yb(),(value,displayMode)=>vh.renderToString(value,{displayMode,throwOnError:true,strict:"ignore"})));');
  patched=replaceOnce(patched,'let n=Math.max(0,i.length-EF);','let n=notaraMathFreezeBoundary(i,Math.max(0,i.length-EF));');
  const digest=hash(patched),entry=`./assets/index-notara-math-${digest}.js`;
  if(check)return {version:manifest.version,patched:Boolean(installed),current:installed?.[1]===digest};
  const target=new URL(entry,dist);
  const existing=await readFile(target,'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(existing!==null&&hash(existing)!==digest)throw new Error('DSH web math asset integrity differs from its filename checksum');
  if(existing===null)await atomicWrite(target,patched);
  if(!installed||installed[1]!==digest)await atomicWrite(index,replaceOnce(originalHtml,webEntry,entry));
}
