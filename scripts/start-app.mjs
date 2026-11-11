import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';import {runningOwner,preferredBundle} from './app-bundle.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),owner=runningOwner(root);
if(owner){console.log(`Memora já está aberto (PID ${owner}). Nenhum processo foi reiniciado ou trazido ao foco. Encerre pelo menu quando não estiver gravando para carregar a versão nova.`);}else{
 await import('./build-app.mjs');const bundle=preferredBundle(root);const result=spawnSync('/usr/bin/open',['-a',bundle],{stdio:'inherit'});if(result.error)throw result.error;process.exitCode=result.status||0;
}
