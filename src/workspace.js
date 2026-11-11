import {localDay,dayDate,monthDays,shiftMonth,groupDays,dayLabel,sessionStatus} from './history-calendar.mjs';
const $=id=>document.getElementById(id),api=window.memora;
const mode=new URLSearchParams(location.search).get('view')==='settings'?'settings':'history';
let data,groups=new Map(),selectedDay=null,month='',selectedId=null,renameId=null,pending=false,refreshRevision=0,shortcutDraft='',shortcutDirty=false,tagFilter='',markerDraft='',markerDirty=false,cleanupToken=null,panelState={ready:false};
const bytes=value=>value<1024**2?`${(value/1024).toFixed(1)} KB`:`${(value/(value>=1024**3?1024**3:1024**2)).toFixed(1)} ${value>=1024**3?'GB':'MB'}`;
const duration=ms=>ms<60000?`${Math.round((ms||0)/1000)} s`:`${Math.round(ms/60000)} min`;
const shortcutText=value=>(value||'').replace(/CommandOrControl|Command/g,'⌘').replace(/Control/g,'⌃').replace(/Alt/g,'⌥').replace(/Shift/g,'⇧').replace(/\+/g,' ')||'Sem atalho';
const error=value=>{$('workspace-error').textContent=value?.message||value||'';$('workspace-error').hidden=!value;};
const selected=()=>data?.sessions.find(session=>session.id===selectedId);
const locked=()=>pending||!panelState.ready||panelState.busy||panelState.recording||Boolean(data?.processing)||Boolean(data?.active);
async function action(operation){if(pending)return;pending=true;error('');controls();try{return await operation();}catch(e){error(e);return null;}finally{pending=false;controls();}}
function controls(){
 const session=selected(),blocked=locked();
 $('record-view').disabled=blocked||!session?.hasTranscript;$('record-rename').disabled=blocked||!session;$('record-retry').disabled=blocked||!session?.hasAudio;
 $('record-retry').textContent=session?.hasTranscript?'Transcrever novamente':'Transcrever selecionada';
 for(const id of ['record-mic','record-source','record-refresh','shortcut-input','shortcut-save','shortcut-disable','marker-shortcut-input','marker-shortcut-save','marker-shortcut-disable','user-name','user-name-save','record-tags','tags-save','rename-title','rename-save'])$(id).disabled=blocked;
 for(const id of ['record-mic','record-source'])$(id).disabled=blocked||!panelState.sourcesReady;
 $('record-refresh').disabled=pending||panelState.busy||panelState.recording||Boolean(data?.processing);
 $('feedback-enabled').disabled=pending||!data;
}
function drawCalendar(focusKey){
 $('calendar-month').textContent=dayDate(month+'-01').toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
 $('calendar-days').replaceChildren();
 for(const key of monthDays(month)){
  if(!key){$('calendar-days').append(document.createElement('span'));continue;}
  const button=document.createElement('button'),count=groups.get(key)?.length||0;
  button.className='calendar-day'+(count?' has-recordings':'')+(key===localDay(new Date())?' today':'');button.dataset.day=key;button.textContent=String(Number(key.slice(-2)));button.setAttribute('aria-pressed',String(key===selectedDay));button.setAttribute('aria-label',`${dayLabel(key)} de ${key.slice(0,4)}, ${count} ${count===1?'gravação':'gravações'}`);
  if(key===localDay(new Date()))button.setAttribute('aria-current','date');
  button.onclick=()=>selectDay(key,true);
  button.onkeydown=event=>{const offset={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[event.key];if(offset!==undefined){event.preventDefault();const next=dayDate(key);next.setDate(next.getDate()+offset);selectDay(localDay(next),true);}};
  $('calendar-days').append(button);
 }
 $('undated-recordings').hidden=!groups.has('');if(focusKey)$('calendar-days').querySelector(`[data-day="${focusKey}"]`)?.focus();
}
function selectDay(key,focus=false){selectedDay=key;if(key)month=key.slice(0,7);selectedId=groups.get(key)?.[0]?.id||null;closeRename(false);drawCalendar(focus?key:null);drawDay();}
function drawSelection(){
 const session=selected();if(document.activeElement!==$('record-tags'))$('record-tags').value=(session?.tags||[]).join(', ');$('tags-form').hidden=!session;$('selected-title').textContent=session?.title||'Selecione uma gravação';
 $('selection-state').textContent=!session?'':session.status==='transcribing'?(session.progress?.phase||'Análise em andamento. Acompanhe pelo painel principal.'):!session.hasTranscript?(session.hasAudio?'Ainda não há transcrição. Você pode transcrever esta gravação.':'Sem transcrição e sem áudio disponível. Os metadados foram preservados.'):!session.hasAudio?'Áudio removido. A transcrição continua disponível.':session.warning||session.error||'';
 controls();
}
function drawDay(){
 const sessions=groups.get(selectedDay)||[];if(!sessions.some(session=>session.id===selectedId))selectedId=sessions[0]?.id||null;
 $('day-title').textContent=dayLabel(selectedDay);$('day-count').textContent=`${sessions.length} ${sessions.length===1?'gravação':'gravações'}`;
 $('recording-list').replaceChildren();$('recording-list').hidden=!sessions.length;$('day-empty').hidden=Boolean(sessions.length);
 for(const session of sessions){
  const row=document.createElement('button');row.className='recording-row';row.dataset.id=session.id;row.setAttribute('aria-pressed',String(session.id===selectedId));
  const time=document.createElement('span');time.className='recording-time';time.textContent=localDay(session.startedAt)?new Date(session.startedAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'—';
  const copy=document.createElement('span');copy.className='recording-copy';const title=document.createElement('span');title.className='recording-title';title.textContent=session.title;const meta=document.createElement('span');meta.className='recording-meta';const sources=(session.sources||[]).map(source=>source.key==='microphone'?'Microfone':source.key==='computer'?'sistema':source.label).filter(Boolean);meta.textContent=duration(session.durationMs)+' · '+(sources.join(' + ')||'Fontes não registradas');copy.append(title,meta);if(session.tags?.length){const tags=document.createElement('span');tags.className='recording-tags';tags.textContent=session.tags.map(t=>'#'+t).join(' · ');copy.append(tags);}if(session.markerCount){const markers=document.createElement('span');markers.className='recording-tags';markers.textContent='☆ '+session.markerCount+' marcador(es)';copy.append(markers);}
  const status=document.createElement('span');status.className='recording-status'+(session.status==='review-needed'?' review':session.hasTranscript?' ready':'');status.textContent=(session.hasTranscript&&session.status!=='review-needed'?'✓ ':'')+sessionStatus(session);
  const chevron=document.createElement('span');chevron.className='recording-chevron';chevron.textContent='›';chevron.setAttribute('aria-hidden','true');row.append(time,copy,status,chevron);
  row.setAttribute('aria-label',`${session.title}, ${time.textContent}, ${sessionStatus(session)}. ${session.hasTranscript?'Abrir transcrição':'Ver opções'}`);
  row.onfocus=()=>{if(renameId&&renameId!==session.id)closeRename(false);selectedId=session.id;for(const item of $('recording-list').children)item.setAttribute('aria-pressed',String(item===row));drawSelection();};
  row.onclick=()=>{selectedId=session.id;drawSelection();if(session.hasTranscript&&!locked())void action(()=>api.reader(session.id));};
  $('recording-list').append(row);
 }
 drawSelection();
}
function drawState(state){
 panelState=state||panelState;
 for(const [id,key] of [['record-mic','microphone'],['record-source','computer']]){
  const source=panelState.sources?.[key];if(source){const node=$(id),signature=JSON.stringify(source.options);if(node.dataset.options!==signature){node.replaceChildren(...source.options.map(option=>new Option(option.label,option.value)));node.dataset.options=signature;}node.value=source.value;}
  $(`level-${key}`).value=panelState.levels?.[key]||0;
 }
 $('monitor-state').textContent=panelState.message||'Somente medição · sem salvar áudio';controls();
}
function drawSettings(){
 const p=data.preferences;if(document.activeElement!==$('user-name'))$('user-name').value=p.userName||'';if(!markerDirty){markerDraft=p.markerShortcut||'';$('marker-shortcut-input').value=shortcutText(markerDraft);}$('marker-shortcut-state').textContent=p.markerError||'Atalho disponível somente durante uma gravação.';if(!shortcutDirty){shortcutDraft=p.shortcut;$('shortcut-input').value=shortcutText(shortcutDraft);}
 $('feedback-enabled').checked=p.popover;$('shortcut-state').textContent=p.error||'O atalho funciona mesmo fora do Memora.';
 $('transcription-profile').textContent=data.ready?'Transcrição automática · large-v3 + falantes':data.problem;
 $('app-build').textContent='Build '+(data.build?.id||'desenvolvimento');$('mcp-state').textContent=data.mcp?.running?'MCP de leitura ativo · conexão local.':data.mcp?.error||'MCP indisponível neste perfil.';
 drawState(data.panelState);
}
async function refresh(){const revision=++refreshRevision;try{const next=await api.info();if(revision!==refreshRevision)return;data=next;panelState=next.panelState||panelState;const tags=[...new Map(data.sessions.flatMap(s=>s.tags||[]).map(tag=>[tag.toLocaleLowerCase('pt-BR'),tag])).values()].sort((a,b)=>a.localeCompare(b,'pt-BR'));$('tag-filter').replaceChildren(new Option('Todas as etiquetas',''),...tags.map(tag=>new Option(tag,tag)));if(tagFilter&&!tags.includes(tagFilter))tagFilter='';$('tag-filter').value=tagFilter;groups=groupDays(data.sessions.filter(s=>!tagFilter||s.tags?.some(t=>t.toLocaleLowerCase('pt-BR')===tagFilter.toLocaleLowerCase('pt-BR'))));if(selectedDay===null){selectedDay=groups.has(localDay(new Date()))?localDay(new Date()):([...groups.keys()].filter(Boolean).sort().at(-1)??(groups.has('')?'':localDay(new Date())));month=(selectedDay||localDay(new Date())).slice(0,7);selectedId=groups.get(selectedDay)?.[0]?.id||null;}if(renameId&&!data.sessions.some(session=>session.id===renameId))closeRename(false);if(mode==='history'){const focusedDay=document.activeElement?.dataset.day,focusedId=document.activeElement?.dataset.id;drawCalendar();drawDay();if(focusedDay)$('calendar-days').querySelector(`[data-day="${focusedDay}"]`)?.focus();else if(focusedId)$('recording-list').querySelector(`[data-id="${focusedId}"]`)?.focus();}else drawSettings();controls();}catch(e){error(e);}}
function closeRename(focus=true){renameId=null;$('rename-form').hidden=true;if(focus)$('record-rename').focus();}
$('window-title').textContent='Memora · '+(mode==='history'?'Histórico':'Configurações');document.title=$('window-title').textContent;$(mode+'-page').hidden=false;
$('tag-filter').onchange=async()=>{tagFilter=$('tag-filter').value;selectedDay=null;await refresh();};
$('tags-form').onsubmit=event=>{event.preventDefault();if(locked()||!selected())return;const id=selectedId,tags=$('record-tags').value.split(',').map(t=>t.trim()).filter(Boolean);void action(async()=>{await api.tags(id,tags);await refresh();$('tags-state').textContent='Etiquetas salvas.';});};
$('window-close').onclick=()=>api.close();document.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();if(renameId)closeRename();else api.close();}});
$('month-previous').onclick=()=>{month=shiftMonth(month,-1);drawCalendar();};$('month-next').onclick=()=>{month=shiftMonth(month,1);drawCalendar();};$('calendar-today').onclick=()=>selectDay(localDay(new Date()),true);$('undated-recordings').onclick=()=>selectDay('');
$('record-folder-open').onclick=()=>action(()=>api.reveal(selectedId));$('record-view').onclick=()=>{if(!locked()&&selected()?.hasTranscript)void action(()=>api.reader(selectedId));};
$('record-rename').onclick=()=>{if(locked()||!selected())return;renameId=selectedId;$('rename-title').value=selected().title;$('rename-form').hidden=false;$('rename-title').focus();};$('rename-cancel').onclick=()=>closeRename();
$('rename-form').onsubmit=event=>{event.preventDefault();if(locked()||!renameId)return;const id=renameId;void action(async()=>{await api.rename(id,$('rename-title').value);closeRename();await refresh();});};
$('record-retry').onclick=()=>{if(!locked()&&selected()?.hasAudio)void action(async()=>{await api.transcribe(selectedId);await refresh();});};
for(const [id,key] of [['record-mic','microphone'],['record-source','source']])$(id).onchange=()=>{const value=$(id).value;void action(async()=>{try{await api.preferences({[key]:value});}finally{await refresh();}});};
$('record-refresh').onclick=()=>action(async()=>{await api.refreshSources();await refresh();});
$('shortcut-input').onkeydown=event=>{if(event.key==='Tab'||event.key==='Escape')return;event.preventDefault();if(['Shift','Meta','Alt','Control'].includes(event.key))return;const key=event.code.startsWith('Key')?event.code.slice(3):event.code.startsWith('Digit')?event.code.slice(5):event.code==='Space'?'Space':event.key;shortcutDraft=[event.metaKey?'Command':'',event.ctrlKey?'Control':'',event.altKey?'Alt':'',event.shiftKey?'Shift':'',key].filter(Boolean).join('+');shortcutDirty=true;$('shortcut-input').value=shortcutText(shortcutDraft);};
const setShortcut=value=>action(async()=>{await api.preferences({shortcut:value});shortcutDirty=false;await refresh();$('shortcut-state').textContent=value?'Atalho global registrado.':'Atalho desativado.';});
$('shortcut-save').onclick=()=>setShortcut(shortcutDraft);$('shortcut-disable').onclick=()=>setShortcut('');$('feedback-enabled').onchange=()=>action(async()=>{try{await api.preferences({popover:$('feedback-enabled').checked});}finally{await refresh();}});
$('marker-shortcut-input').onkeydown=event=>{if(['Tab','Escape'].includes(event.key))return;event.preventDefault();if(['Shift','Meta','Alt','Control'].includes(event.key))return;const key=event.code.startsWith('Key')?event.code.slice(3):event.code.startsWith('Digit')?event.code.slice(5):event.code==='Space'?'Space':event.key;markerDraft=[event.metaKey?'Command':'',event.ctrlKey?'Control':'',event.altKey?'Alt':'',event.shiftKey?'Shift':'',key].filter(Boolean).join('+');markerDirty=true;$('marker-shortcut-input').value=shortcutText(markerDraft);};
const saveMarkerShortcut=value=>action(async()=>{await api.preferences({markerShortcut:value});markerDirty=false;await refresh();});
$('marker-shortcut-save').onclick=()=>saveMarkerShortcut(markerDraft);$('marker-shortcut-disable').onclick=()=>saveMarkerShortcut('');
$('user-name-form').onsubmit=event=>{event.preventDefault();if(locked())return;void action(async()=>{await api.preferences({userName:$('user-name').value});await refresh();$('user-name-state').textContent='Nome padrão salvo neste Mac.';});};
async function storage(){const result=await api.storage();$('storage-total').textContent=bytes(result.total);$('storage-recoverable').textContent='Previsão de espaço recuperável: '+bytes(result.recoverableBytes)+'. '+result.estimateNote;$('storage-protected').textContent='Em uso: '+bytes(result.protectedBytes)+' · sem permissão de escrita: '+bytes(result.unwritableBytes)+'.';for(const key of ['audio','transcripts','other','engine'])$('storage-'+key).textContent=bytes(result[key]);$('storage-ram').textContent=`RAM dos processos Electron (não inclui toda a transcrição): ${bytes(result.ram)}. A limpeza libera espaço em disco.`;}
$('cleanup-date').value=localDay(new Date());$('cleanup-settings').ontoggle=()=>{if($('cleanup-settings').open)void storage().catch(e=>$('cleanup-state').textContent=e.message);};
function clearPlan(){cleanupToken=null;$('cleanup-review').hidden=true;}
for(const id of ['cleanup-date','cleanup-audio','cleanup-transcripts'])$(id).onchange=clearPlan;$('cleanup-cancel').onclick=clearPlan;
$('cleanup-preview').onclick=()=>action(async()=>{clearPlan();const plan=await api.cleanupPreview({date:$('cleanup-date').value,audio:$('cleanup-audio').checked,transcripts:$('cleanup-transcripts').checked});cleanupToken=plan.token;$('cleanup-summary').textContent=`${plan.sessionCount} gravação(ões) · ${plan.fileCount} arquivo(s) · ${bytes(plan.bytes)} em arquivos · previsão: ${bytes(plan.recoverableBytes)}`;$('cleanup-detail').textContent=`Até ${plan.date}, inclusive. ${plan.estimateNote} ${plan.unwritableCount} arquivo(s) sem permissão excluído(s) da previsão. ${plan.protectedCount} sessão(ões) em uso preservada(s). ${plan.transcripts?'Os tipos selecionados serão removidos.':'Transcrições serão preservadas.'}`;$('cleanup-apply').disabled=!plan.fileCount;$('cleanup-review').hidden=false;$('cleanup-state').textContent='A exclusão exige confirmação na próxima etapa.';});
$('cleanup-apply').onclick=()=>{if(!cleanupToken)return;const token=cleanupToken;void action(async()=>{$('cleanup-apply').disabled=true;try{const result=await api.cleanupApply(token);$('cleanup-state').textContent=result.cancelled?'Limpeza cancelada.':`${result.files} arquivo(s) removido(s) · ${bytes(result.bytes)}.`;await refresh();await storage();}finally{clearPlan();}});};
api.changed(()=>void refresh());api.state(drawState);await refresh();
window.workspaceReady=true;
// Only enabled by the isolated diagnostic profile. No fixtures or UI mutations reach user data.
window.workspaceDiagnostics=async()=>{if(!data?.diagnostic)throw Error('Perfil de diagnóstico necessário.');return {mode,noOverflow:document.documentElement.scrollWidth<=innerWidth,ordinaryPage:!document.querySelector('#record-toggle'),sourcesDisabled:locked(),selectedDay,selectedId,rows:$('recording-list').children.length,settingsSections:!$('capture-info').open&&!$('cleanup-settings').open&&!$('app-information').open,calendarDayCount:$('calendar-days').children.length};};
window.exerciseWorkspace=async fixture=>{
 if(!data?.diagnostic)throw Error('Perfil de diagnóstico necessário.');
 const settle=async()=>{const start=Date.now();while(pending&&Date.now()-start<4000)await new Promise(resolve=>setTimeout(resolve,10));if(pending)throw Error('Operação não encerrou.');await new Promise(resolve=>setTimeout(resolve,40));};
 const result={};
 if(mode==='history'){
  selectDay('2001-01-02');result.emptyDay=$('day-empty').hidden===false&&$('record-view').disabled&&$('record-rename').disabled&&$('record-retry').disabled;
  const prior=month;$('month-previous').click();$('month-next').click();result.monthNavigation=prior===month;
  selectDay(fixture.day,true);result.calendarKeyboardFocus=document.activeElement.dataset.day===fixture.day;
  const dayButton=document.activeElement;dayButton.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));result.arrowNavigation=document.activeElement.dataset.day!==fixture.day;selectDay(fixture.day);
  const row=id=>$('recording-list').querySelector(`[data-id="${id}"]`);
  row(fixture.noTranscript).focus();row(fixture.noTranscript).click();await settle();result.noTranscript=$('record-view').disabled&&!$('record-retry').disabled&&$('selection-state').textContent.includes('Ainda não');
  row(fixture.noAudio).focus();row(fixture.noAudio).click();await settle();result.noAudio=$('record-view').disabled&&$('record-retry').disabled&&$('selection-state').textContent.includes('sem áudio');
  row(fixture.transcribed).focus();$('record-rename').click();$('rename-title').value='   ';$('rename-form').requestSubmit();await settle();result.renameError=!$('workspace-error').hidden&&!$('rename-form').hidden;
  $('rename-title').value='Nome <img> seguro';$('rename-form').requestSubmit();await settle();await refresh();result.renameSaved=selected()?.title==='Nome <img> seguro'&&!$('recording-list').querySelector('img')&&$('rename-form').hidden;
  await api.rename(fixture.transcribed,'Planejamento da semana');await refresh();row(fixture.transcribed).focus();await refresh();result.focusPreserved=document.activeElement.dataset.id===fixture.transcribed;
  $('record-rename').click();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));result.renameEscape=$('rename-form').hidden&&document.activeElement.id==='record-rename';
  row(fixture.transcribed).focus();row(fixture.transcribed).click();await settle();result.readerAction=!pending&&$('workspace-error').hidden;
  result.safeText=!$('recording-list').querySelector('script');
 }else{
  const previous={...data.preferences};
  $('shortcut-input').dispatchEvent(new KeyboardEvent('keydown',{key:'a',code:'KeyA',bubbles:true}));$('shortcut-save').click();await settle();result.shortcutError=!$('workspace-error').hidden&&(await api.info()).preferences.shortcut===previous.shortcut;
  $('shortcut-input').dispatchEvent(new KeyboardEvent('keydown',{key:'F8',code:'F8',bubbles:true}));$('shortcut-save').click();await settle();result.shortcutSaved=(await api.info()).preferences.shortcut==='F8';$('shortcut-disable').click();await settle();result.shortcutDisabled=(await api.info()).preferences.shortcut==='';
  await api.preferences({shortcut:previous.shortcut});await refresh();
  $('record-mic').value='';$('record-mic').dispatchEvent(new Event('change'));await settle();result.sourceSaved=(await api.info()).preferences.microphone===''&&$('record-mic').value==='';
  await api.preferences({microphone:previous.microphone});await refresh();
  $('feedback-enabled').click();await settle();result.popoverSaved=(await api.info()).preferences.popover!==previous.popover;await api.preferences({popover:previous.popover});await refresh();
  const priorState=panelState;drawState({...priorState,ready:false,busy:false,recording:false});result.sourceRecoveryEnabled=!$('record-refresh').disabled;drawState({...priorState,sourcesReady:false});result.deviceFailureKeepsHistory=!locked()&&$('record-mic').disabled&&$('record-source').disabled&&!$('record-refresh').disabled;drawState(priorState);
  drawState({...priorState,busy:true,recording:true});result.recordingProtected=$('record-mic').disabled&&$('record-source').disabled&&$('record-refresh').disabled;drawState(priorState);
  $('cleanup-settings').open=true;await storage();$('cleanup-date').value='2001-01-02';$('cleanup-preview').click();await settle();result.cleanupPreview=!$('cleanup-review').hidden&&$('cleanup-apply').disabled;
  $('cleanup-audio').checked=false;$('cleanup-audio').dispatchEvent(new Event('change'));result.cleanupInvalidated=$('cleanup-review').hidden;$('cleanup-audio').checked=true;$('cleanup-date').value=localDay(new Date());$('cleanup-settings').open=false;
  result.preferencesRestored=JSON.stringify((await api.info()).preferences)===JSON.stringify(previous);error('');
 }
 result.noOverflow=document.documentElement.scrollWidth<=innerWidth;result.passed=Object.values(result).every(Boolean);return result;
};
window.selectWorkspaceFixture=async day=>{if(!data?.diagnostic)throw Error('Perfil de diagnóstico necessário.');await refresh();selectDay(day);};
