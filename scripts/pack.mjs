import { mkdir, readFile, writeFile, copyFile, access } from 'node:fs/promises';
import {createHash} from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {npmCommand} from './npm-command.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = resolve(process.argv[2] ?? resolve(root, 'work/packages'));
await mkdir(destination, { recursive: true });
const build=spawnSync(process.execPath,[resolve(root,'scripts/build.mjs')],{cwd:root,stdio:'inherit'});
if(build.status!==0)throw new Error('Fresh build failed; no release created');
const packages=[];
for (const name of ['presets', 'vault-sqlite', 'home-recommend', 'vault-views', 'graph-and-blocks', 'pomodoro', 'calendar', 'bundle']) {
  const cwd = resolve(root, 'plugins', name);
  const pkg = JSON.parse(await readFile(resolve(cwd, 'package.json'), 'utf8'));
  if(pkg.license!=='AGPL-3.0-only'||!pkg.repository?.url)throw new Error(`${pkg.name}: missing release metadata`);
  if(!pkg.dsh?.client)await writeFile(resolve(cwd,'THIRD_PARTY_NOTICES.md'),`# Third-party notices\n\nFirst-party Notara code is licensed under AGPL-3.0-only; see LICENSE and COPYRIGHT. Dependencies keep their own licenses.\n\n## DSH host and adapted examples\n\n${await readFile(resolve(root,'scripts/licenses/dsh-MIT.txt'),'utf8')}`);
  for(const target of Object.values(pkg.exports??{}))if(typeof target==='string'&&!target.includes('*'))await access(resolve(cwd,target));
  const result = spawnSync(...npmCommand(['pack', '--json', '--ignore-scripts', '--pack-destination', destination]), { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${pkg.name}: ${result.stderr}`);
  const artifact = JSON.parse(result.stdout)[0];
  if (artifact.files.some(file => /(?:^|\/)(?:node_modules|\.test-output|outputs?|work|test-results)\/|DEVELOPMENT\.md|claude-fonts\/c[^/]*\.ttf|(?:^|\/)\.env(?:\.|$)/.test(file.path))) throw new Error(`${pkg.name}: excluded files entered the package`);
  for(const required of ['LICENSE','COPYRIGHT','THIRD_PARTY_NOTICES.md'])if(!artifact.files.some(f=>f.path===required))throw new Error(`${pkg.name}: missing ${required}`);
  const sha256=createHash('sha256').update(await readFile(resolve(destination,artifact.filename))).digest('hex');
  packages.push({name:pkg.name,version:pkg.version,file:artifact.filename,sha256,integrity:artifact.integrity,files:artifact.files.map(f=>f.path)});
  console.log(JSON.stringify({ package: pkg.name, file: resolve(destination, artifact.filename), files: artifact.entryCount, bytes: artifact.size, integrity: artifact.integrity }));
}
const workspace=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));
const lock=JSON.parse(await readFile(resolve(root,'scripts/release-host-lock.json'),'utf8'));
for(const pkg of packages){
  lock.packages[''].dependencies[pkg.name]=`file:${pkg.file}`;
  const entry=lock.packages[`node_modules/${pkg.name}`];
  if(!entry||entry.version!==pkg.version)throw new Error('Refresh release lock for changed package versions');
  entry.resolved=`file:${pkg.file}`;entry.integrity=pkg.integrity;
}
await writeFile(resolve(destination,'host-package.json'),JSON.stringify({name:'notara-local-host',private:true,dependencies:lock.packages[''].dependencies,overrides:workspace.overrides},null,2)+'\n');
await writeFile(resolve(destination,'host-package-lock.json'),JSON.stringify(lock,null,2)+'\n');
await copyFile(resolve(root,'scripts/install-release.mjs'),resolve(destination,'install-release.mjs'));
await copyFile(resolve(root,'scripts/npm-command.mjs'),resolve(destination,'npm-command.mjs'));
await copyFile(resolve(root,'docs/RELEASE.md'),resolve(destination,'RELEASE.md'));
await copyFile(resolve(root,'COPYRIGHT'),resolve(destination,'COPYRIGHT'));
await copyFile(resolve(root,'LICENSE'),resolve(destination,'LICENSE'));
const git=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'});
const state=spawnSync('git',['status','--porcelain','--','.'],{cwd:root,encoding:'utf8'});
const sourceCommit=git.status===0&&state.status===0&&!state.stdout.trim()?git.stdout.trim():null;
await writeFile(resolve(destination,'release.json'),JSON.stringify({status:'candidate',sourceCommit,version:workspace.version,dsh:workspace.devDependencies['@deepseek-ai/dsh'],overrides:workspace.overrides,packages},null,2)+'\n');
const sums=[];for(const file of [...packages.map(p=>p.file),'release.json','host-package.json','host-package-lock.json','install-release.mjs','npm-command.mjs','RELEASE.md','COPYRIGHT','LICENSE'])sums.push(`${createHash('sha256').update(await readFile(resolve(destination,file))).digest('hex')}  ${file}`);
await writeFile(resolve(destination,'SHA256SUMS'),sums.join('\n')+'\n');
