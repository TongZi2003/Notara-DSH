import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

const directories=['presets','vault-sqlite','home-recommend','vault-views','graph-and-blocks','pomodoro','calendar','bundle'];
const json=async path=>JSON.parse(await readFile(new URL('../'+path,import.meta.url),'utf8'));
const workspace=await json('package.json');
const version=workspace.version;
const packages=await Promise.all(directories.map(async directory=>({directory,pkg:await json(`plugins/${directory}/package.json`)})));
const names=packages.map(({pkg})=>pkg.name).sort();
const workspaceLock=await json('package-lock.json');
const hostLock=await json('scripts/release-host-lock.json');
const dependencyFields=['dependencies','devDependencies','optionalDependencies','peerDependencies'];
const internal=dependencies=>Object.fromEntries(Object.entries(dependencies??{}).filter(([name])=>name.startsWith('@oh-my-student/')));
const tarball=pkg=>`file:${pkg.name.slice(1).replace('/','-')}-${version}.tgz`;

test('workspace, eight packages and both locks use the candidate version',()=>{
  assert.match(version,/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/);
  assert.equal(workspaceLock.name,workspace.name);
  assert.equal(workspaceLock.version,version);
  assert.equal(workspaceLock.packages[''].name,workspace.name);
  assert.equal(workspaceLock.packages[''].version,version);
  assert.equal(hostLock.name,'notara-local-host');
  assert.equal(hostLock.packages[''].name,hostLock.name);
  for(const {directory,pkg} of packages){
    assert.equal(pkg.name,`@oh-my-student/${directory==='bundle'?'dsh-bundle':'plugin-'+directory}`);
    assert.equal(pkg.version,version,pkg.name);
    const locked=workspaceLock.packages[`plugins/${directory}`];
    assert.equal(locked.name,pkg.name);
    assert.equal(locked.version,version,pkg.name);
    assert.equal(hostLock.packages[`node_modules/${pkg.name}`].version,version,pkg.name);
  }
});

test('internal dependencies and peers are exact and lock declarations match their manifests',()=>{
  for(const [label,record] of [
    ['workspace',workspace],
    ...packages.map(({pkg})=>[pkg.name,pkg]),
    ...Object.entries(workspaceLock.packages),
    ...Object.entries(hostLock.packages).filter(([key])=>key!==''),
  ])for(const field of dependencyFields)for(const [name,reference] of Object.entries(internal(record[field]))){
    assert.ok(names.includes(name),`${label}: unknown first-party package ${name}`);
    assert.equal(reference,version,`${label}.${field}.${name}`);
  }
  for(const {directory,pkg} of packages){
    const locked=workspaceLock.packages[`plugins/${directory}`];
    const hosted=hostLock.packages[`node_modules/${pkg.name}`];
    for(const field of [...dependencyFields,'peerDependenciesMeta']){
      assert.deepEqual(locked[field]??{},pkg[field]??{},`${pkg.name}: workspace lock ${field}`);
      if(field!=='devDependencies')assert.deepEqual(hosted[field]??{},pkg[field]??{},`${pkg.name}: host lock ${field}`);
    }
  }
});

test('locks contain the eight named packages with workspace links and portable tgz basenames',()=>{
  for(const lock of [workspaceLock,hostLock]){
    const lockedNames=Object.keys(lock.packages).filter(key=>/^node_modules\/@oh-my-student\/[^/]+$/.test(key)).map(key=>key.slice('node_modules/'.length)).sort();
    assert.deepEqual(lockedNames,names);
  }
  assert.deepEqual(Object.keys(internal(hostLock.packages[''].dependencies)).sort(),names);
  for(const {directory,pkg} of packages){
    assert.deepEqual(workspaceLock.packages[`node_modules/${pkg.name}`],{resolved:`plugins/${directory}`,link:true});
    assert.equal(hostLock.packages[''].dependencies[pkg.name],tarball(pkg));
    assert.equal(hostLock.packages[`node_modules/${pkg.name}`].resolved,tarball(pkg));
  }
});

test('release metadata contains no private absolute paths or malformed local file references',()=>{
  function check(value,label){
    if(typeof value==='string'){
      assert.doesNotMatch(value,/(?:^|file:)(?:[A-Za-z]:[\\/]|\/)|\/(?:Users|home)\//,label);
      if(value.startsWith('file:'))assert.match(value,/^file:[\w.-]+\.tgz$/,label);
    }else if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){
      assert.doesNotMatch(key,/^(?:[A-Za-z]:[\\/]|\/)/,label);
      check(item,`${label}.${key}`);
    }
  }
  check(workspace,'workspace');
  for(const {pkg} of packages)check(pkg,pkg.name);
  check(workspaceLock,'workspace lock');
  check(hostLock,'host lock');
});

test('release instructions target the unpublished candidate and both supported upgrade sources',async()=>{
  const guide=await readFile(new URL('../docs/RELEASE.md',import.meta.url),'utf8');
  const readme=await readFile(new URL('../README.md',import.meta.url),'utf8');
  assert.ok(guide.startsWith(`# Notara DSH ${version} 候选发行`));
  assert.match(guide,/尚未发布/);
  assert.match(guide,/从 0\.1\.0 \/ 0\.1\.1 升级/);
  assert.ok(guide.includes(`npm run pack:plugins -- release/${version}`));
  assert.ok(readme.includes(`npm run pack:plugins -- release/${version}`));
  const references=[...guide.matchAll(/(@oh-my-student\/[\w-]+)@(\d+\.\d+\.\d+(?:-[\w.-]+)?)/g)];
  assert.deepEqual([...new Set(references.map(match=>match[1]))].sort(),names);
  for(const [,name,reference] of references)assert.equal(reference,version,name);
  assert.ok(guide.includes('0.2.1-rc.4'));
  assert.match(guide,/Windows[\s\S]*尚未经过实机验证/);
});

test('bundle fixture uses the current workspace version without affecting non-bundle fixtures',async()=>{
  const source=await readFile(new URL('../scripts/native-runtime.mjs',import.meta.url),'utf8');
  const fixture=source.split('\n').find(line=>line.trim().startsWith('if(bundle)await writeFile('));
  assert.ok(fixture,'bundle profile fixture must exist');
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const writeProfile=new AsyncFunction('bundle','writeFile','join','home','PROFILE_TEMPLATES','readFile','workspaceRoot',fixture);
  for(const currentVersion of [version,'0.1.99']){
    const writes=[];
    await writeProfile(true,async(path,contents)=>writes.push([path,JSON.parse(contents)]),join,'test-home',{web:{bundles:['@deepseek-ai/dsh-base']}},async(path,encoding)=>{
      assert.equal(path,join('test-workspace','package.json'));
      assert.equal(encoding,'utf8');
      return JSON.stringify({...workspace,version:currentVersion});
    },'test-workspace');
    assert.equal(writes.length,1);
    assert.equal(writes[0][0],join('test-home','profiles/web/package.json'));
    assert.deepEqual(writes[0][1],{name:'notara-test-profile',private:true,dependencies:{'@oh-my-student/dsh-bundle':currentVersion},dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@oh-my-student/dsh-bundle']}}});
  }
  const unexpected=()=>assert.fail('non-bundle fixtures must not read or write bundle metadata');
  await writeProfile(false,unexpected,join,'test-home',{},unexpected,'test-workspace');
});
