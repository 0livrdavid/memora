import {sourceBuild,writeBuildStamp} from './source-build.mjs';
import {buildIcon,applyAppIcon,iconMatches} from './app-icon.mjs';
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
// Persistent macOS identity: changing this can reset existing permissions and build receipts.
export const APP_ID='local.sonora.memora';
export function bundlePaths(root){return {root,bundle:path.join(root,'.local/macos/Memora.app'),entry:path.join(root,'src/main.cjs'),data:path.join(root,'.local')};}
export function preferredBundle(root,installed='/Applications/Memora.app'){
 try{const stamp=JSON.parse(fs.readFileSync(path.join(installed,'Contents/Resources/app/memora-build.json'),'utf8')),p=bundlePaths(root);if(stamp.entry===p.entry&&stamp.data===p.data)return installed;}catch{}
 return bundlePaths(root).bundle;
}
function run(command,args){const r=spawnSync(command,args,{encoding:'utf8'});if(r.error)throw r.error;if(r.status!==0)throw Error(`${command} falhou (${r.status}): ${r.stderr.slice(-2000)}`);return r.stdout.trim();}
export function validateBundleLinks(root){validateLinksInside(root,fs.realpathSync(root));}
function validateLinksInside(directory,boundary){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isSymbolicLink()){const resolved=fs.realpathSync(file);if(resolved!==boundary&&!resolved.startsWith(boundary+path.sep))throw Error('Link externo na cópia do runtime; assinatura recusada.');}else if(entry.isDirectory())validateLinksInside(file,boundary);}}
export function buildApp(root,runtime){
 const p=bundlePaths(root),receipt=path.join(root,'.local/macos/app-build.json');
 const donorInfo=path.join(runtime,'Contents/Info.plist'),version=run('/usr/bin/plutil',['-extract','CFBundleVersion','raw',donorInfo]);
 const icon=buildIcon(root),stamp=sourceBuild(root);
 if(fs.existsSync(p.bundle)&&fs.existsSync(receipt)){
  const prior=JSON.parse(fs.readFileSync(receipt));if(prior.root!==root||prior.runtime!==runtime||prior.runtimeVersion!==version||prior.identity!==APP_ID)throw Error('Existe um pacote anterior diferente. Preserve-o antes de reconstruir.');run('/usr/bin/codesign',['--verify','--deep','--strict',p.bundle]);
  if(prior.sourceDigest===stamp.sourceDigest&&prior.iconSourceSHA256===icon.sourceSHA256&&iconMatches(p.bundle,icon))return {...p,built:false,icon:icon.icns};
  if(runningOwner(root))throw Error('Memora está aberto. A atualização do pacote aguarda encerrar a instância ociosa.');
  const stage=path.join(path.dirname(p.bundle),'Memora.icon-build-'+process.pid+'.app');if(fs.existsSync(stage))throw Error('Stage de ícone já existe.');fs.cpSync(p.bundle,stage,{recursive:true,dereference:false,verbatimSymlinks:true,preserveTimestamps:true});applyAppIcon(stage,icon);writeBuildStamp(stage,root,stamp);validateBundleLinks(stage);
  run('/usr/bin/codesign',['--force','--deep','--sign','-','--preserve-metadata=entitlements',stage]);run('/usr/bin/codesign',['--verify','--deep','--strict',stage]);
  const backup=path.join(root,'.local/backups','app-icon-'+Date.now()+'-'+process.pid);fs.mkdirSync(backup,{recursive:true,mode:0o700});fs.copyFileSync(receipt,path.join(backup,'app-build.json'));fs.renameSync(p.bundle,path.join(backup,'Memora.app'));fs.renameSync(stage,p.bundle);
  fs.writeFileSync(receipt,JSON.stringify({...prior,sourceDigest:stamp.sourceDigest,build:stamp.build,builtAt:new Date().toISOString(),iconSourceSHA256:icon.sourceSHA256,iconSHA256:icon.icnsSHA256},null,2),{mode:0o600});return {...p,built:true,backup,icon:icon.icns};
 }
 if(fs.existsSync(p.bundle))throw Error('Já existe Memora.app sem recibo de construção. Nenhum arquivo foi sobrescrito.');
 fs.mkdirSync(path.dirname(p.bundle),{recursive:true});const stage=path.join(path.dirname(p.bundle),'Memora.build-'+process.pid+'.app');if(fs.existsSync(stage))throw Error('Pasta de construção já existe.');
 fs.cpSync(runtime,stage,{recursive:true,dereference:false,verbatimSymlinks:true,preserveTimestamps:true});
 const info=path.join(stage,'Contents/Info.plist');
 for(const [key,value] of Object.entries({CFBundleIdentifier:APP_ID,CFBundleName:'Memora',CFBundleDisplayName:'Memora',NSAudioCaptureUsageDescription:'O Memora mede o sinal do áudio do computador e grava somente quando você inicia uma sessão. Os arquivos ficam neste Mac.',NSMicrophoneUsageDescription:'O Memora mede o microfone selecionado e grava somente quando você inicia uma sessão. Nenhum áudio é enviado.'})){run('/usr/bin/plutil',['-replace',key,'-string',value,info]);}
 run('/usr/bin/plutil',['-replace','LSUIElement','-bool','YES',info]);
 const app=path.join(stage,'Contents/Resources/app');if(fs.existsSync(app)||fs.existsSync(path.join(stage,'Contents/Resources/app.asar')))throw Error('Runtime doador contém aplicativo; construção interrompida sem sobrescrever.');fs.mkdirSync(app);
 fs.writeFileSync(path.join(app,'package.json'),JSON.stringify({name:'memora-local',productName:'Memora',version:'0.1.0',main:'bootstrap.cjs'},null,2));
 fs.writeFileSync(path.join(app,'bootstrap.cjs'),`// Local development bundle: original data location is preserved by main.cjs.\nrequire(${JSON.stringify(p.entry)});\n`);
 applyAppIcon(stage,icon);writeBuildStamp(stage,root,stamp);
 // The donor runtime is untouched. Re-sign only the copy, including its nested code.
 validateBundleLinks(stage);
 run('/usr/bin/codesign',['--force','--deep','--sign','-','--preserve-metadata=entitlements',stage]);run('/usr/bin/codesign',['--verify','--deep','--strict',stage]);
 fs.renameSync(stage,p.bundle);fs.writeFileSync(receipt,JSON.stringify({root,runtime,runtimeVersion:version,identity:APP_ID,data:p.data,sourceDigest:stamp.sourceDigest,build:stamp.build,builtAt:new Date().toISOString(),signature:'local ad-hoc; no system security policy changed',iconSourceSHA256:icon.sourceSHA256,iconSHA256:icon.icnsSHA256},null,2),{mode:0o600});return {...p,built:true,icon:icon.icns};
}
export function runningOwner(root){
 try{const target=fs.readlinkSync(path.join(root,'.local/SingletonLock')),pid=Number(target.slice(target.lastIndexOf('-')+1));if(Number.isInteger(pid)&&pid>0){process.kill(pid,0);return pid;}}catch{}
 // macOS can use a native single-instance mechanism without a Chromium lock file.
 try{const status=JSON.parse(fs.readFileSync(path.join(root,'.local/monitor-status.json'),'utf8')),pid=status.pid;if(status.mode!=='closed'&&Number.isInteger(pid)&&pid>0){process.kill(pid,0);return pid;}}catch{}
 return null;
}
