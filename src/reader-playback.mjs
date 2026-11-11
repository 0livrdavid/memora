// One local clip at a time. Generations prevent late IPC replies from playing.
export function createPlayback({audio,status,makeURL=bytes=>URL.createObjectURL(new Blob([bytes],{type:'audio/wav'})),releaseURL=url=>URL.revokeObjectURL(url)}){
 let generation=0,url=null,active=null,pending=false;
 function label(text){if(active?.button){active.button.textContent=text;active.button.setAttribute('aria-pressed',String(text==='Pausar'));}}
 function stop(){generation++;pending=false;audio.pause();audio.removeAttribute('src');audio.load();if(url)releaseURL(url);url=null;label(active?.label||'▶ Ouvir frase');active=null;status.textContent='';}
 async function play(key,title,request,button,buttonLabel='▶ Ouvir frase'){
  if(active?.key===key){
   if(pending){stop();return;}
   if(!audio.paused){audio.pause();label('▶ Continuar');return;}
   if(url&&!audio.ended){const ticket=generation;try{await audio.play();if(ticket===generation)label('Pausar');}catch(e){if(ticket===generation){stop();status.textContent='Não foi possível reproduzir: '+e.message;}}return;}
  }
  stop();const ticket=generation;active={key,button,label:buttonLabel};pending=true;label('Cancelar');status.textContent='Preparando '+title+'…';
  try{
   const clip=await request();if(ticket!==generation)return;
   url=makeURL(clip.audio);audio.src=url;status.textContent=title+(clip.truncated?' · áudio termina antes do fim indicado':'');
   await audio.play();if(ticket!==generation)return;pending=false;label('Pausar');
  }catch(e){if(ticket!==generation)return;stop();status.textContent='Não foi possível reproduzir: '+e.message;}
 }
 audio.addEventListener('ended',()=>{label(active?.label||'▶ Ouvir frase');});
 audio.addEventListener('pause',()=>{if(active&&!pending&&!audio.ended)label('▶ Continuar');});
 audio.addEventListener('play',()=>{if(active)label('Pausar');});
 audio.addEventListener('error',()=>{if(!url)return;stop();status.textContent='Falha ao reproduzir o áudio. Tente novamente.';});
 return {play,stop};
}
