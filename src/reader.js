import {timestamp} from './phrases.mjs';
import {transcriptBlocks,BLOCK_LIMITS} from './transcript-blocks.mjs';
import {createPlayback} from './reader-playback.mjs';
const $=id=>document.getElementById(id);let currentData,loadGeneration=0,renameId=null,renamePending=false;
const playbackStatus={set textContent(value){$('playback-state').textContent=value;$('playback-stop').hidden=!$('phrase-audio').src;}};
const playback=createPlayback({audio:$('phrase-audio'),status:playbackStatus});
function meetingTitle(title){currentData.title=title;$('reader-title').textContent=title;document.title=title+' · Memora';}
function renameControls(){
 $('reader-rename').disabled=!currentData||renamePending;
 for(const id of ['reader-rename-title','reader-rename-save','reader-rename-cancel'])$(id).disabled=renamePending;
 $('reader-rename-form').setAttribute('aria-busy',String(renamePending));
}
function renameMessage(message='',error=false){const state=$('reader-rename-state');state.textContent=message;state.hidden=!message;state.setAttribute('data-error',String(error));}
function closeRename(focus=true){renameId=null;$('reader-rename-form').hidden=true;$('reader-rename').setAttribute('aria-expanded','false');if(focus)$('reader-rename').focus();}
$('reader-rename').onclick=()=>{
 if(!currentData||renamePending)return;
 renameId=currentData.id;$('reader-rename-title').value=currentData.title;renameMessage();$('reader-rename-form').hidden=false;$('reader-rename').setAttribute('aria-expanded','true');$('reader-rename-title').focus();$('reader-rename-title').select();
};
$('reader-rename-cancel').onclick=()=>{if(!renamePending){closeRename();renameMessage();}};
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&renameId){event.preventDefault();if(!renamePending){closeRename();renameMessage();}}});
$('reader-rename-form').onsubmit=async event=>{
 event.preventDefault();if(!renameId||renamePending)return;
 const id=renameId;renamePending=true;renameControls();renameMessage('Salvando…');
 try{
  const result=await window.reader.rename(id,$('reader-rename-title').value);
  if(currentData?.id!==id||renameId!==id)return;
  meetingTitle(result.title);closeRename(false);renameMessage('Nome da reunião atualizado.');
 }catch(error){if(currentData?.id===id&&renameId===id)renameMessage(error.message,true);}
 finally{renamePending=false;renameControls();if(currentData?.id===id){if(renameId===id)$('reader-rename-title').focus();else $('reader-rename').focus();}}
};
function speakers(data){
 const hasSpeakers=Boolean(data.speakers?.length);$('speaker-settings').hidden=false;
 $('speaker-count').textContent=String(data.speakers?.length||0);
 $('speaker-summary').setAttribute('aria-label','Falantes, '+(data.speakers?.length||0));
 $('speaker-empty').hidden=hasSpeakers;$('speaker-note').hidden=!hasSpeakers;
 $('speaker-empty').textContent=hasSpeakers?'':'Esta transcrição não contém falantes identificados. Se o áudio ainda existir, você pode solicitar uma nova transcrição pelo Histórico com o processamento local padrão.';
 if(!hasSpeakers)$('speaker-state').textContent='';
 const list=$('speaker-list');list.replaceChildren();
 for(const speaker of data.speakers||[]){
  const form=document.createElement('form');form.className='speaker-row';
  const label=document.createElement('label');label.textContent=speaker.id+' · '+speaker.label;
  const input=document.createElement('input');input.value=speaker.name===speaker.label?'':speaker.name;input.placeholder='Nome da pessoa';input.maxLength=100;label.append(input);
  const save=document.createElement('button');save.type='submit';save.textContent='Salvar nome';
  const listen=document.createElement('button');listen.type='button';listen.textContent='Ouvir amostra';let index=0;
  listen.disabled=!data.segments.some(s=>s.speakerId===speaker.id&&data.audioSources.includes(s.source));
  listen.onclick=()=>playback.play('speaker:'+speaker.id+':'+index,speaker.id+' · amostra '+(index+1),async()=>{const sample=await window.reader.sample(data.resultId,speaker.id,index);index=(index+1)%sample.count;return sample;},listen,'Ouvir amostra');
  form.onsubmit=async event=>{event.preventDefault();save.disabled=true;try{await window.reader.name(data.resultId,speaker.id,input.value);await load();$('speaker-state').textContent='Nome salvo nesta gravação.';}catch(e){$('speaker-state').textContent=e.message;}finally{save.disabled=false;}};
  form.append(label,listen,save);list.append(form);
 }
}
function drawMarkers(data){
 $('marker-count').textContent=String(data.markers?.length||0);const list=$('marker-list');list.replaceChildren();
 for(const marker of data.markers||[]){const row=document.createElement('div');row.className='marker-row';const go=document.createElement('button');go.type='button';go.textContent=timestamp(marker.timeMs)+' · '+marker.label;go.onclick=()=>{if(currentData?.id!==data.id)return;const blocks=transcriptBlocks(data.segments);let best=-1,distance=Infinity;blocks.forEach((b,i)=>{const d=marker.timeMs<b.startMs?b.startMs-marker.timeMs:marker.timeMs>b.endMs?marker.timeMs-b.endMs:0;if(d<distance){distance=d;best=i;}});const target=document.getElementById('timeline-'+best);if(target){target.scrollIntoView({block:'center'});target.classList.add('marker-target');setTimeout(()=>target.classList.remove('marker-target'),1500);}};
  const remove=document.createElement('button');remove.type='button';remove.textContent='Remover';remove.setAttribute('aria-label','Remover marcador '+timestamp(marker.timeMs));remove.onclick=async()=>{remove.disabled=true;try{const markers=await window.reader.removeMarker(data.id,marker.id);if(currentData?.id!==data.id)return;data.markers=markers;drawMarkers(data);}catch(e){$('marker-state').textContent=e.message;remove.disabled=false;}};row.append(go,remove);list.append(row);
 }
 if(!list.children.length){const empty=document.createElement('p');empty.className='timing-note';empty.textContent='Nenhum momento marcado nesta gravação.';list.append(empty);}
}
function markerButton(data,block){const button=document.createElement('button');button.type='button';button.className='timeline-marker';button.textContent='☆';button.title='Marcar este momento';button.setAttribute('aria-label','Marcar momento em '+timestamp(block.startMs));button.onclick=async()=>{button.disabled=true;try{const markers=await window.reader.addMarker(data.id,data.revision,block.startMs,'Momento importante');if(currentData?.id===data.id){data.markers=markers;drawMarkers(data);$('marker-state').textContent='Momento marcado.';}}catch(e){$('marker-state').textContent=e.message;}finally{button.disabled=false;}};return button;}
function reviewControl(data,phrase){
 if(!phrase.segmentId||!phrase.speakerId)return null;
 const detail=document.createElement('details');detail.className='segment-review';const summary=document.createElement('summary');summary.textContent=phrase.reviewed?'Falante confirmado · alterar':'Corrigir falante deste trecho';detail.append(summary);
 const form=document.createElement('form');const note=document.createElement('p');note.className='timing-note';note.textContent='Ouça o trecho e confirme a pessoa. Esta correção vale somente para este trecho.';
 const label=document.createElement('label');label.textContent='Falante';const select=document.createElement('select');select.setAttribute('aria-label','Falante deste trecho');const empty=document.createElement('option');empty.value='';empty.textContent='Selecione…';select.append(empty);
 for(const s of data.speakers.filter(s=>!/(unknown|uncertain)/i.test(s.id))){const option=document.createElement('option');option.value=s.id;option.textContent=s.name||s.label;select.append(option);}
 const self=document.createElement('option');self.value='__self';self.textContent=data.defaultUserName?'Sou eu · '+data.defaultUserName:'Sou eu · configure seu nome primeiro';self.disabled=!data.defaultUserName;self.setAttribute('data-self-option','true');select.append(self);
 const other=document.createElement('option');other.value='__new';other.textContent='Outra pessoa…';select.append(other);label.append(select);
 const nameLabel=document.createElement('label');nameLabel.textContent='Nome da pessoa';nameLabel.hidden=true;const name=document.createElement('input');name.maxLength=100;name.setAttribute('aria-label','Nome da pessoa neste trecho');nameLabel.append(name);
 const save=document.createElement('button');save.type='submit';save.textContent='Confirmar este trecho';save.disabled=true;const state=document.createElement('p');state.className='review-state';state.setAttribute('role','status');
 let pending=false;select.onchange=()=>{nameLabel.hidden=select.value!=='__new';save.disabled=!select.value;};
 const apply=async selection=>{if(pending)return;pending=true;save.disabled=true;select.disabled=true;try{await window.reader.review(data.id,data.revision,phrase.segmentId,selection);if(currentData?.id!==data.id)return;await load();$('speaker-state').textContent='Falante atualizado somente neste trecho.';}catch(e){state.textContent=e.message;}finally{pending=false;save.disabled=!select.value;select.disabled=false;}};
 form.onsubmit=event=>{event.preventDefault();if(!select.value)return;void apply(select.value==='__self'?{self:true}:select.value==='__new'?{name:name.value}:{speakerId:select.value});};
 form.append(note,label,nameLabel,save,state);if(phrase.reviewed){const undo=document.createElement('button');undo.type='button';undo.textContent='Restaurar identificação original';undo.onclick=()=>void apply({reset:true});form.append(undo);}detail.append(form);return detail;
}
function sourceName(source){return source==='microphone'?'Microfone':source==='computer'?'Computador':'Áudio';}
function rangeLabel(part){return timestamp(part.startMs)+' a '+timestamp(part.endMs)+(part.approximate?' · limites aproximados':'');}
function compactDuration(ms){
 const seconds=Math.max(0,Math.round((Number(ms)||0)/1000)),minutes=Math.floor(seconds/60),hours=Math.floor(minutes/60);
 if(hours)return hours+' h'+(minutes%60?' '+minutes%60+' min':'');
 return minutes?minutes+' min'+(seconds%60?' '+seconds%60+' s':''):seconds+' s';
}
function timeRange(part,compact=false){
 const time=document.createElement('time');time.textContent=(part.approximate?'~':'')+(compact?timestamp(part.startMs).replace(/^00:/,''):timestamp(part.startMs));
 time.title=rangeLabel(part);
 if(!compact){const end=document.createElement('span');end.className='end';end.textContent=(part.approximate?'~':'')+timestamp(part.endMs);time.append(end);}
 return time;
}
// Keep compact controls in sync with the shared player's pause/cancel lifecycle.
// The underlying audio and IPC still load only an explicit clip, never the session.
function compactControl(button,description){
 let label='▶';
 return {get textContent(){return label;},set textContent(value){label=value;button.textContent=value==='Pausar'?'Ⅱ':value==='Cancelar'?'×':'▶';button.setAttribute('aria-label',(value==='▶'?description:value+' · '+description));button.title=value==='▶'?description:value+' · '+description;},setAttribute(name,value){button.setAttribute(name,value);}};
}
function phraseButton(data,phrase,key){
 const play=document.createElement('button');play.type='button';play.className='phrase-play';play.textContent='▶ Ouvir trecho';
 play.setAttribute('aria-label','Ouvir trecho de '+rangeLabel(phrase));play.setAttribute('aria-pressed','false');
 play.disabled=!data.audioSources.includes(phrase.source)||phrase.endMs<=phrase.startMs;
 play.title=play.disabled?'Áudio deste trecho indisponível':phrase.approximate?'Os limites deste trecho são aproximados.':'Ouvir apenas este trecho';
 play.onclick=()=>playback.play('phrase:'+key,sourceName(phrase.source)+' · '+rangeLabel(phrase),()=>window.reader.phrase(data.revision,phrase.segmentIndex,phrase.startMs,phrase.endMs),play,'▶ Ouvir trecho');return play;
}
function rowButton(data,block,index,name){
 const grouped=block.phrases.length>1,phrase=block.phrases[0];
 const play=document.createElement('button');play.type='button';play.className=(grouped?'block-play':'single-play')+' compact-play';play.textContent='▶';
 const description='Ouvir '+(grouped?'bloco':'trecho')+' de '+name+' · '+rangeLabel(block),control=compactControl(play,description);
 play.setAttribute('aria-label',description);play.setAttribute('aria-pressed','false');
 play.disabled=!data.audioSources.includes(block.source)||block.endMs<=block.startMs||(grouped&&block.endMs-block.startMs>BLOCK_LIMITS.audioDurationMs);
 play.title=!data.audioSources.includes(block.source)?'Áudio deste trecho indisponível':play.disabled?'Bloco acima de 10 minutos. Abra Trechos para ouvir os intervalos disponíveis.':description;
 play.onclick=()=>playback.play((grouped?'block:':'row:')+index,name+' · '+rangeLabel(block),()=>grouped?window.reader.block(data.revision,index):window.reader.phrase(data.revision,phrase.segmentIndex,phrase.startMs,phrase.endMs),control,'▶');
 return play;
}
function reviewReasons(block){
 const reasons=[];
 if(block.uncertain||/(?:unknown|uncertain)/i.test(block.speakerId||''))reasons.push('Identificação do falante incerta');
 if(block.origin?.overlap&&block.origin?.evidenceVersion!==2)reasons.push('Sobreposição de fala nas fontes · não comprova identidade nem eco');
 if(block.origin?.echoRisk&&(block.source==='microphone'||block.origin?.evidenceVersion!==2))reasons.push('Evidência de referência/possível eco no microfone');
 return reasons;
}
window.addEventListener('pagehide',()=>playback.stop());
$('playback-stop').onclick=()=>playback.stop();
async function load(){
 const ticket=++loadGeneration;playback.stop();
 try{
  const data=await window.reader.get();if(ticket!==loadGeneration)return;
  if(currentData&&(currentData.id!==data.id||currentData.resultId!==data.resultId)){$('reader-info').open=false;$('speaker-settings').open=false;}
  if(!currentData||currentData.id!==data.id){closeRename(false);renameMessage();}
  currentData=data;renameControls();
  $('reader-title').textContent=data.title;document.title=data.title+' · Memora';
  const date=new Date(data.startedAt),count=data.speakers?.length||0;
  const meta=date.toLocaleDateString('pt-BR',{day:'numeric',month:'short'}).replace(' de ',' ')+' · '+compactDuration(data.durationMs)+' · '+count+' '+(count===1?'falante':'falantes');
  $('reader-meta').textContent=meta;$('reader-info-summary').setAttribute('aria-label',meta+(data.warning?'. Revisão necessária':'')+'. Informações da transcrição');
  $('reader-details-meta').textContent=date.toLocaleString('pt-BR')+' · Duração da gravação: '+timestamp(data.durationMs||0);
  $('reader-warning').hidden=!data.warning;$('reader-warning').textContent=data.warning||'';$('reader-warning-indicator').hidden=!data.warning;
  $('playback-note').textContent=data.audioSources.length?'O player reproduz somente o trecho ou bloco selecionado, não a gravação inteira. A duração exibida nele é a do áudio selecionado. Blocos de até 10 minutos podem ser ouvidos; os trechos continuam disponíveis individualmente.':'Áudio indisponível nesta gravação. A transcrição continua disponível para leitura.';
  speakers(data);drawMarkers(data);const content=$('reader-content');content.replaceChildren();
  for(const [index,block] of transcriptBlocks(data.segments).entries()){
   const row=document.createElement('section');row.className='phrase transcript-block';row.id='timeline-'+index;
   const timing=document.createElement('div');timing.className='block-timing';timing.append(timeRange(block,true));
   const body=document.createElement('div');body.className='block-body';
   const origin=document.createElement('div');origin.className='origin';
   const name=block.speakerId?(data.speakers.find(s=>s.id===block.speakerId)?.name||block.speakerId):sourceName(block.source);
   const speaker=document.createElement('span');speaker.className='speaker-name';speaker.textContent=name;origin.append(speaker);
   const reasons=reviewReasons(block);
   if(reasons.length){const badge=document.createElement('button');badge.type='button';badge.className='review-badge';badge.onclick=()=>{detail.open=true;detail.querySelector('.segment-review')?.setAttribute('open','');};badge.textContent='Revisar';badge.title=reasons.join(' · ');origin.append(badge);}
   if(block.origin?.evidenceVersion===2&&block.origin.simultaneousSpeech){const together=document.createElement('span');together.className='simultaneous-note';together.textContent='Fala simultânea';origin.append(together);}body.append(origin);timing.append(rowButton(data,block,index,name),markerButton(data,block));
   const detail=document.createElement('details');detail.className='block-segments';
   const summary=document.createElement('summary');summary.textContent='Trechos';summary.title='Tempos e áudio de '+block.phrases.length+' '+(block.phrases.length===1?'trecho':'trechos');detail.append(summary);
   if(reasons.length){const caution=document.createElement('p');caution.className='segment-caution';caution.textContent=reasons.join(' · ');detail.append(caution);}
   let paragraph=null,paragraphLength=0;
   for(const [part,phrase] of block.phrases.entries()){
    if(!paragraph||paragraphLength>=900){paragraph=document.createElement('p');body.append(paragraph);paragraphLength=0;}
    if(paragraphLength)paragraph.append(document.createTextNode(' '));
    const text=document.createElement('span');text.textContent=phrase.text;paragraph.append(text);paragraphLength+=phrase.text.length+1;
    const item=document.createElement('div');item.className='segment-detail';
    const label=document.createElement('span');label.className='segment-label';label.textContent='Trecho '+(part+1);
    item.append(label,timeRange(phrase),phraseButton(data,phrase,index+':'+part));detail.append(item);const review=reviewControl(data,phrase);if(review)detail.append(review);
   }
   body.append(detail);row.append(timing,body);content.append(row);
  }
  $('reader-error').hidden=true;$('reader-error').textContent='';window.readerReady=true;
 }catch(error){if(ticket!==loadGeneration)return;currentData=null;closeRename(false);renameControls();$('reader-error').hidden=false;$('reader-error').textContent=error.message;window.readerReady=true;}
}
$('reader-close').onclick=()=>{playback.stop();window.reader.close();};window.reader.changed(load);
window.reader.profile?.(value=>{if(currentData)currentData.defaultUserName=value.userName;});
window.reader.renamed(value=>{if(currentData?.id===value.id)meetingTitle(value.title);});
window.readerDiagnostics=()=>({passed:$('reader-content').children.length>=2&&!$('reader-error').textContent,blocks:$('reader-content').children.length,grouped:document.querySelectorAll('.block-play').length,phrases:document.querySelectorAll('.phrase-play').length,playable:document.querySelectorAll('.phrase-play:not(:disabled)').length,unavailable:document.querySelectorAll('.phrase-play:disabled').length,hasApproximateTimes:$('reader-content').textContent.includes('~'),width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth});
// Diagnostic uses the isolated generated fixture only; it never opens a capture device.
window.readerPlaybackDiagnostics=async()=>{
 const audio=$('phrase-audio');for(const detail of document.querySelectorAll('.block-segments'))detail.open=true;const buttons=[...document.querySelectorAll('.phrase-play:not(:disabled)')];audio.muted=true;
 const wait=async test=>{const until=Date.now()+5000;while(!test()){if(Date.now()>until)throw Error('Timeout de reprodução');await new Promise(r=>setTimeout(r,25));}};
 buttons[0].click();await wait(()=>!audio.paused&&audio.currentTime>0.05);const progressed=audio.currentTime;buttons[0].click();const paused=audio.paused;
 buttons[0].click();await wait(()=>!audio.paused);buttons[1].click();await wait(()=>!audio.paused&&audio.duration>0&&$('playback-state').textContent.includes('00:00:02'));
 const blockButton=document.querySelector('.block-play');let blockDuration=0;if(blockButton){blockButton.click();await wait(()=>!audio.paused&&$('playback-state').textContent.includes('00:00:06'));blockDuration=audio.duration;}
 const duration=audio.duration;audio.currentTime=duration-0.05;await wait(()=>audio.ended);const ended=audio.ended;playback.stop();for(const detail of document.querySelectorAll('.block-segments'))detail.open=false;
 return {passed:progressed>0&&paused&&ended&&blockDuration===6&&document.querySelectorAll('.phrase-play:disabled').length===1,progressed,paused,ended,duration,blockDuration,unavailable:document.querySelectorAll('.phrase-play:disabled').length};
};
await load();
