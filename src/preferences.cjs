const fs=require('node:fs');const {privateJSON}=require('./recordings.cjs');
function validShortcut(value){if(value==='')return true;if(typeof value!=='string'||value.length>100||! /^(?:(?:CommandOrControl|Command|Control|Alt|Shift|Super)\+)*(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space)$/.test(value))return false;return value.includes('+')||/^F\d+$/.test(value);}
class Preferences{
 constructor(file,shortcuts,toggle,mark=()=>{}){this.file=file;this.shortcuts=shortcuts;this.toggle=toggle;this.mark=mark;this.registered='';this.registeredMarker='';this.error='';this.markerError='';this.value={shortcut:'CommandOrControl+Shift+R',markerShortcut:'CommandOrControl+Shift+M',userName:'',popover:true,microphone:'default',source:'system-default'};try{this.value={...this.value,...JSON.parse(fs.readFileSync(file,'utf8'))};}catch{}if(!validShortcut(this.value.shortcut))this.value.shortcut='';if(!validShortcut(this.value.markerShortcut)||this.value.markerShortcut===this.value.shortcut)this.value.markerShortcut='';if(typeof this.value.userName!=='string'||this.value.userName.length>100)this.value.userName='';try{this.register(this.value.shortcut);}catch(e){this.error=e.message;}try{this.registerMarker(this.value.markerShortcut);}catch(e){this.markerError=e.message;}}
 register(value){if(value===this.registered)return;if(value&&!this.shortcuts.register(value,this.toggle))throw Error('Atalho indisponível ou em uso por outro aplicativo. Escolha outro.');if(this.registered)this.shortcuts.unregister(this.registered);this.registered=value;}
 registerMarker(value){if(value===this.registeredMarker)return;if(value&&!this.shortcuts.register(value,this.mark))throw Error('Atalho de marcador indisponível ou em uso por outro aplicativo.');if(this.registeredMarker)this.shortcuts.unregister(this.registeredMarker);this.registeredMarker=value;}
 info(){return {...this.value,registered:this.registered,registeredMarker:this.registeredMarker,error:this.error,markerError:this.markerError};}
 update(update){
  if(!update||Object.keys(update).some(k=>!['shortcut','markerShortcut','userName','popover','microphone','source'].includes(k)))throw Error('Preferência inválida.');
  const next={...this.value,...update};if(!validShortcut(next.shortcut)||!validShortcut(next.markerShortcut)||next.shortcut&&next.shortcut===next.markerShortcut||typeof next.popover!=='boolean'||!['microphone','source'].every(k=>typeof next[k]==='string'&&next[k].length<=1024)||typeof next.userName!=='string'||next.userName.trim().length>100||/[\x00-\x1f]/.test(next.userName))throw Error('Configuração inválida. Use nomes válidos e atalhos distintos com modificador ou tecla F.');
  next.userName=next.userName.trim();const old={shortcut:this.registered,markerShortcut:this.registeredMarker};let changed=false;
  try{if(next.shortcut!==this.value.shortcut||next.markerShortcut!==this.value.markerShortcut){changed=true;this.close();this.register(next.shortcut);this.registerMarker(next.markerShortcut);}privateJSON(this.file,next);}
  catch(e){if(changed){this.close();try{this.register(old.shortcut);this.registerMarker(old.markerShortcut);}catch(restore){this.error=restore.message;}}throw e;}
  this.value=next;this.error='';this.markerError='';return this.info();
 }
 close(){if(this.registered)this.shortcuts.unregister(this.registered);if(this.registeredMarker)this.shortcuts.unregister(this.registeredMarker);this.registered='';this.registeredMarker='';}
}
module.exports={Preferences,validShortcut};
