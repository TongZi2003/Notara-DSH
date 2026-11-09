import {existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';

export function npmCommand(args){
  if(process.platform!=='win32')return ['npm',args];
  // Do not run a .cmd file directly or interpolate user paths into cmd.exe.
  const cli=[process.env.npm_execpath,process.env.NOTARA_NPM_CLI,resolve(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js')]
    .find(path=>path&&path.endsWith('npm-cli.js')&&existsSync(path));
  if(!cli)throw new Error('Cannot locate npm-cli.js. Install Node with npm, or set NOTARA_NPM_CLI to its absolute path.');
  return [process.execPath,[cli,...args]];
}
