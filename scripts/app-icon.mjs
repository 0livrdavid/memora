import fs from 'node:fs';import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';import {spawnSync} from 'node:child_process';
export const ICON_SIZES=[{name:'icon_16x16.png',pixels:16},{name:'icon_16x16@2x.png',pixels:32},{name:'icon_32x32.png',pixels:32},{name:'icon_32x32@2x.png',pixels:64},{name:'icon_128x128.png',pixels:128},{name:'icon_128x128@2x.png',pixels:256},{name:'icon_256x256.png',pixels:256},{name:'icon_256x256@2x.png',pixels:512},{name:'icon_512x512.png',pixels:512},{name:'icon_512x512@2x.png',pixels:1024}];
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function run(command,args){const r=spawnSync(command,args,{encoding:'utf8'});if(r.error)throw r.error;if(r.status!==0)throw Error(`${command} falhou (${r.status}): ${r.stderr.slice(-1000)}`);return r.stdout.trim();}
export function imageInfo(file){const s=run('/usr/bin/sips',['-g','pixelWidth','-g','pixelHeight','-g','hasAlpha',file]);return {width:Number(/pixelWidth: (\d+)/.exec(s)?.[1]),height:Number(/pixelHeight: (\d+)/.exec(s)?.[1]),alpha:/hasAlpha: yes/.test(s)};}
export function buildIcon(root){
 const source=path.join(root,'assets/memora-icon.png');if(!fs.lstatSync(source).isFile())throw Error('PNG aprovado do Memora ausente ou inválido.');
 const head=fs.readFileSync(source);if(!head.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('O ícone deve ser o PNG aprovado.');
 const sourceSHA256=sha(source),base=path.join(root,'.local/icons'),directory=path.join(base,sourceSHA256),icns=path.join(directory,'Memora.icns'),receipt=path.join(directory,'icon-build.json');
 if(fs.existsSync(receipt)){
  const value=JSON.parse(fs.readFileSync(receipt));
  if(value.sourceSHA256!==sourceSHA256||sha(icns)!==value.icnsSHA256||!ICON_SIZES.every(s=>sha(path.join(directory,'Memora.iconset',s.name))===value.pngHashes?.[s.name]))throw Error('Cache do ícone alterado. Preserve-o antes de reconstruir.');
  return {...value,source,icns,directory,built:false};
 }
 const original=imageInfo(source);if(original.width!==original.height||original.width<1024||original.width>8192)throw Error('PNG do ícone precisa ser quadrado, com 1024 a 8192 pixels.');
 fs.mkdirSync(base,{recursive:true,mode:0o700});if(fs.existsSync(directory))throw Error('Existe um cache incompleto de ícone. Preserve-o antes de reconstruir.');
 const stage=path.join(base,'icon-build-'+randomUUID());fs.mkdirSync(stage,{mode:0o700});const iconset=path.join(stage,'Memora.iconset');fs.mkdirSync(iconset,{mode:0o700});const pngHashes={};
 for(const size of ICON_SIZES){const file=path.join(iconset,size.name);run('/usr/bin/sips',['-z',String(size.pixels),String(size.pixels),source,'--out',file]);const actual=imageInfo(file);if(actual.width!==size.pixels||actual.height!==size.pixels||original.alpha&&!actual.alpha)throw Error('Tamanho/transparência do ícone não foi preservado.');pngHashes[size.name]=sha(file);}
 const generated=path.join(stage,'Memora.icns');run('/usr/bin/iconutil',['--convert','icns','--output',generated,iconset]);if(sha(source)!==sourceSHA256)throw Error('O PNG original mudou durante o build.');
 const value={sourceSHA256,icnsSHA256:sha(generated),original,pngHashes,generatedAt:new Date().toISOString(),generator:'macOS sips + iconutil; approved PNG unchanged'};fs.writeFileSync(path.join(stage,'icon-build.json'),JSON.stringify(value,null,2),{mode:0o600});fs.renameSync(stage,directory);return {...value,source,icns,directory,built:true};
}
export function iconMatches(bundle,icon){try{return sha(path.join(bundle,'Contents/Resources/Memora.icns'))===icon.icnsSHA256&&run('/usr/bin/plutil',['-extract','CFBundleIconFile','raw',path.join(bundle,'Contents/Info.plist')])==='Memora.icns';}catch{return false;}}
export function applyAppIcon(bundle,icon){fs.copyFileSync(icon.icns,path.join(bundle,'Contents/Resources/Memora.icns'));run('/usr/bin/plutil',['-replace','CFBundleIconFile','-string','Memora.icns',path.join(bundle,'Contents/Info.plist')]);if(!iconMatches(bundle,icon))throw Error('Ícone não aplicado ao pacote.');}
