import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
export function sourceBuild(root){
 const sourceHashes={};
 function add(relative){const file=path.join(root,relative),stat=fs.lstatSync(file);if(stat.isSymbolicLink())throw Error('Link de código não suportado: '+relative);if(stat.isDirectory()){for(const name of fs.readdirSync(file).sort())add(path.join(relative,name));}else if(stat.isFile())sourceHashes[relative]=createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
 for(const name of ['src','native','scripts','assets','package.json'])if(fs.existsSync(path.join(root,name)))add(name);
 return {build:'2026-11-11-organization-speaker-review',sourceDigest:createHash('sha256').update(JSON.stringify(sourceHashes)).digest('hex'),sourceHashes};
}
export function writeBuildStamp(bundle,root,stamp){const file=path.join(bundle,'Contents/Resources/app/memora-build.json');fs.writeFileSync(file,JSON.stringify({...stamp,builtAt:new Date().toISOString(),entry:path.join(root,'src/main.cjs'),data:path.join(root,'.local')},null,2),{mode:0o600});}
