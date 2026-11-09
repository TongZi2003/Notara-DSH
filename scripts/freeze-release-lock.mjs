import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const source=process.argv[2];
if(!source)throw new Error('Usage: node scripts/freeze-release-lock.mjs <verified-clean-install>');
const lock=JSON.parse(await readFile(resolve(source,'package-lock.json'),'utf8'));
lock.packages[''].dependencies['@deepseek-ai/dsh']='0.2.1-rc.4';
for(const [name,value] of Object.entries(lock.packages[''].dependencies))if(name.startsWith('@oh-my-student/')){
  const file=value.split('/').at(-1);lock.packages[''].dependencies[name]=`file:${file}`;
  lock.packages[`node_modules/${name}`].resolved=`file:${file}`;
}
const data=JSON.stringify(lock,null,2)+'\n';
if(data.includes('/Users/')||data.includes('file:../'))throw new Error('Local path remains in release lock');
await writeFile(new URL('./release-host-lock.json',import.meta.url),data);
