import {readFile,readdir,writeFile} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';

// Retain full notices for packages whose code is actually bundled by esbuild.
export async function writeNotices(directory, inputs) {
  const packages=new Map();
  for(const input of inputs){
    let folder=dirname(resolve(input));
    if(!folder.includes('node_modules'))continue;
    while(folder!==dirname(folder)){
      try{
        const pkg=JSON.parse(await readFile(join(folder,'package.json'),'utf8'));
        if(pkg.name){packages.set(`${pkg.name}@${pkg.version}`,{folder,pkg});break;}
      }catch(error){if(error.code!=='ENOENT')throw error;}
      folder=dirname(folder);
    }
  }
  const missing=[];
  const sections=['# Third-party notices\n\nFirst-party Notara code is licensed under AGPL-3.0-only; see LICENSE and COPYRIGHT. The following notices apply to the named third-party components. Runtime dependencies retain their own license files.'];
  sections.push(`## DSH host and adapted examples\n\n${await readFile(new URL('./licenses/dsh-MIT.txt',import.meta.url),'utf8')}`);
  if(inputs.some(input=>input.includes('@excalidraw/excalidraw/'))){
    sections.push(await readFile(new URL('./licenses/excalidraw-fonts.txt',import.meta.url),'utf8'));
  }
  const excalimath=inputs.find(input=>input.endsWith('/vendor/excalimath/library.js'));
  if(excalimath)sections.push(`## ExcaliMath shape library\n\n${await readFile(join(dirname(resolve(excalimath)),'PROVENANCE.md'),'utf8')}\n\n${await readFile(join(dirname(resolve(excalimath)),'LICENSE'),'utf8')}`);
  for(const [name,{folder,pkg}] of [...packages].sort(([a],[b])=>a.localeCompare(b))){
    const files=(await readdir(folder)).filter(x=>/^(licen[sc]e|copying|notice)([.-]|$)/i.test(x));
    if(!files.length&&name==='fastdom@1.0.12'){
      const readme=await readFile(join(folder,'README.md'),'utf8'),start=readme.indexOf('## License');
      if(start<0)throw new Error('fastdom license missing');
      sections.push(`## ${name}\n\n${readme.slice(start)}`);continue;
    }
    const fallback=name.startsWith('@radix-ui/')?['radix-ui.txt','https://raw.githubusercontent.com/radix-ui/primitives/main/LICENSE']:name==='react-remove-scroll-bar@2.3.8'?['react-remove-scroll-bar.txt','https://raw.githubusercontent.com/theKashey/react-remove-scroll-bar/master/LICENSE']:null;
    if(!files.length&&fallback){
      sections.push(`## ${name}\n\nUpstream license retrieved 2026-10-28: ${fallback[1]}\n\n${await readFile(new URL('./licenses/'+fallback[0],import.meta.url),'utf8')}`);continue;
    }
    if(!files.length && name==='@excalidraw/excalidraw@0.18.1'){
      sections.push(`## ${name}\n\nSource: https://raw.githubusercontent.com/excalidraw/excalidraw/v0.18.1/LICENSE\n\n${await readFile(new URL('./licenses/excalidraw-0.18.1.txt',import.meta.url),'utf8')}`);
      continue;
    }
    if(!files.length){missing.push(name);continue;}
    sections.push(`## ${name}\n\nLicense: ${pkg.license ?? 'see text'}\n`);
    for(const file of files)sections.push(`### ${file}\n\n${await readFile(join(folder,file),'utf8')}`);
  }
  if(missing.length)throw new Error(`Missing bundled license texts: ${missing.join(', ')}`);
  await writeFile(join(directory,'THIRD_PARTY_NOTICES.md'),sections.join('\n\n').split(/\r?\n/).map(line=>line.trimEnd()).join('\n').trimEnd()+'\n');
}
