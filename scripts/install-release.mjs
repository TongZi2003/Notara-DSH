#!/usr/bin/env node
import {mkdir,readFile,copyFile,readdir} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {npmCommand} from './npm-command.mjs';

// Installs into a NEW prefix. Never changes an existing DSH home or account.
const [destination]=process.argv.slice(2);
if(!destination || process.argv.length!==3)throw new Error('Usage: node install-release.mjs <new-install-directory>');
if(Number(process.versions.node.split('.')[0])<24)throw new Error('Node 24 or newer is required');
const root=dirname(fileURLToPath(import.meta.url)),target=resolve(destination);
const manifest=JSON.parse(await readFile(join(root,'release.json'),'utf8'));
const packages=manifest.packages;
if(packages.length!==8)throw new Error('Expected eight Notara packages');
for(const pkg of packages){
  if(!/^[\w.-]+\.tgz$/.test(pkg.file))throw new Error('Invalid package filename');
  const actual=createHash('sha256').update(await readFile(join(root,pkg.file))).digest('hex');
  if(actual!==pkg.sha256)throw new Error(`Checksum mismatch: ${pkg.file}`);
}
await mkdir(target,{recursive:true});
if((await readdir(target)).length)throw new Error('Installation directory must be empty');
await copyFile(join(root,'host-package.json'),join(target,'package.json'));
await copyFile(join(root,'host-package-lock.json'),join(target,'package-lock.json'));
for(const pkg of packages)await copyFile(join(root,pkg.file),join(target,pkg.file));
const run=(bin,args)=>{const result=spawnSync(bin,args,{cwd:target,stdio:'inherit'});if(result.status!==0)throw new Error(`${bin} exited ${result.status}`);};
run(...npmCommand(['ci','--registry=https://registry.npmjs.org/','--no-audit','--no-fund']));
run(process.execPath,[join(target,'node_modules/@oh-my-student/dsh-bundle/host-adapter.mjs'),'--host',join(target,'node_modules/@deepseek-ai/dsh-client-ui-chat')]);
run(process.execPath,[join(target,'node_modules/@oh-my-student/dsh-bundle/host-adapter.mjs'),'--host',join(target,'node_modules/@deepseek-ai/dsh-client-ui-chat'),'--check']);
console.log('Installed and adapted. Configure a dedicated DSH profile as described in RELEASE.md.');
