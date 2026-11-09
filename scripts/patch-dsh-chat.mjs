import {fileURLToPath} from 'node:url';
import {patchDshChat,patchDshHost} from '../plugins/bundle/host-adapter.mjs';
export {patchDshChat,patchDshHost};
if(process.argv[1]===fileURLToPath(import.meta.url))await patchDshHost();
