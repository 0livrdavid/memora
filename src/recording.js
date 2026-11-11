import {recordingLabel} from './history-format.mjs';
import {waitForCapture,assertCaptureTrack,sourceFingerprint} from './capture-device.mjs';
import {openLevelGraph} from './level-graph.mjs';
import {LevelMonitor} from './level-monitor.mjs';
import {resolveComputer,computerOptions} from './sources.mjs';
const $=id=>document.getElementById(id);
let processingIdentity=null,latestRenameId=null,lastDeviceSignature='',diagnosticStream=null,current=null,selectedSession=null,busy=false,startPending=false,processing=null,manualPending=false,eventRevision=0,config,preferences,cleanupToken=null,shortcutDraft='';
const time=ms=>{const seconds=Math.floor((ms||0)/1000);return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(n=>String(n).padStart(2,'0')).join(':');};
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('pt-BR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'Data não registrada';
const bytes=value=>value<1024*1024?`${(value/1024).toFixed(1)} KB`:`${(value/(value>=1024**3?1024**3:1024**2)).toFixed(1)} ${value>=1024**3?'GB':'MB'}`;
const status={saved:'Salva',completed:'Transcrita','review-needed':'Revisão necessária','needs-setup':'Aguardando transcrição',interrupted:'Interrompida',failed:'Falha na transcrição',cancelled:'Transcrição cancelada',transcribing:'Transcrevendo',recording:'Gravando',cleaned:'Arquivos removidos'};
const message=(text,error=false)=>{$('record-message').textContent=text;$('record-message').classList.toggle('error',error);$('record-message').hidden=!error;};
function shortcutText(value){return value.replace(/CommandOrControl|Command/g,'⌘').replace(/Control/g,'⌃').replace(/Alt/g,'⌥').replace(/Shift/g,'⇧').replace(/\+/g,' ')||'Sem atalho';}
function controls(){
 const armed=Boolean(current?.samples)&&!current?.stopping;$('record-marker').hidden=!current;$('record-mark').disabled=!armed;$('record-mark').title=shortcutText(preferences?.markerShortcut||'');$('menu-panel').classList.toggle('analyzing',Boolean(processing));
 $('record-toggle').disabled=Boolean(current)?!armed:startPending||Boolean(processing?.cancelling)||(busy&&!processing);
 $('record-toggle').classList.toggle('live',Boolean(current));$('record-toggle-label').textContent=current?(current.stopping?'Salvando…':current.samples?'Parar e salvar':'Preparando…'):startPending?(processing?.cancelling?'Encerrando análise…':'Preparando…'):'Iniciar gravação';
 for(const id of ['record-mic','record-source','record-refresh','record-history','shortcut-input','shortcut-save','shortcut-disable'])$(id).disabled=busy||Boolean(current);
 $('latest-view').disabled=busy||Boolean(current)||!config?.latest?.hasTranscript;
 $('latest-rename').disabled=busy||Boolean(current)||!config?.latest;
 $('latest-rename-title').disabled=busy||Boolean(current);$('latest-rename-save').disabled=busy||Boolean(current);
 $('latest-actions').hidden=!config?.latest;
 $('latest-recording').hidden=Boolean(processing)||Boolean(current);document.querySelector('.status-line').hidden=!current;$('footer-status').classList.toggle('sr-only',!current);
 $('record-retry').disabled=busy||Boolean(current)||!selectedSession?.hasAudio;
 $('record-rename').disabled=busy||Boolean(current)||!selectedSession;
 $('record-view').disabled=busy||Boolean(current)||!selectedSession?.hasTranscript;
 $('record-cancel').disabled=Boolean(processing?.cancelling);$('record-cancel').textContent=processing?.cancelling?'Encerrando…':'Encerrar análise';
 if(typeof publishWorkspaceState==='function')publishWorkspaceState();
}
function historySelection(session){selectedSession=session;$('rename-form').hidden=true;$('history-meta').textContent=session?`${recordingLabel(session)} · ${status[session.status]||session.status}${session.hasAudio?'':' · áudio removido'}${session.warning?' · '+session.warning:''}`:'';controls();}
async function setup(preferred=$('record-history').value){
 const revision=eventRevision;config=await window.sonora.recordInfo();preferences=config.preferences;
 if(revision===eventRevision)processing=config.processing; if(!current)busy=Boolean(processing)||manualPending||startPending;renderProcessing();
 const history=$('record-history');history.replaceChildren(new Option(config.sessions.length?'Selecione uma gravação':'Nenhuma gravação salva',''));
 for(const item of config.sessions)history.add(new Option(recordingLabel(item),item.id));
 const selected=config.sessions.find(s=>s.id===preferred)||config.latest;history.value=selected?.id||'';historySelection(selected);
 $('history-count').textContent=String(config.sessions.length);$('history-count').setAttribute('aria-label',`${config.sessions.length} gravações`);
 const latest=config.latest,duration=latest?.durationMs||0;
 $('last-audio-date').textContent=latest?date(latest.startedAt)+' · '+(duration<60000?Math.round(duration/1000)+' s':time(duration).replace(/^00:/,'')):'Nenhuma gravação';
 $('latest-status').textContent=latest?(latest.status==='completed'?'✓ Transcrita':latest.status==='review-needed'?'Revisar':status[latest.status]||latest.status):'';
 $('latest-status').className=latest?.status==='completed'?'ready':latest?.status==='review-needed'?'review':'';
 $('latest-title').textContent=config.latest?.title||'Nenhuma gravação';$('latest-title').hidden=!config.latest;
 if(latestRenameId&&latestRenameId!==config.latest?.id){latestRenameId=null;$('latest-rename-form').hidden=true;}
 $('transcription-profile').textContent=config.ready?'Transcrição automática · large-v3 + falantes':config.problem;
 $('transcription-profile').dataset.backend=config.config.backend;
 $('app-build').textContent='Build '+(config.build?.id||'não identificado');$('mcp-state').textContent=config.mcp?.running?'MCP de leitura ativo · conexão local.':config.mcp?.error||'MCP indisponível neste perfil.';
 shortcutDraft=preferences.shortcut;$('shortcut-input').value=shortcutText(shortcutDraft);$('shortcut-label').textContent=shortcutText(preferences.registered);$('shortcut-state').textContent=preferences.error||'O mesmo atalho inicia e para, mesmo fora do Memora.';$('feedback-enabled').checked=preferences.popover;
 controls();
}
function renderResult(result){if(current&&!current.stopping)return;$('record-state').textContent=`${status[result.status]||result.status} · ${time(result.durationMs)}`;message(result.error||result.warning||(result.status==='transcribing'?result.progress?.phase:'')||(result.status==='completed'?'Transcrição pronta.':result.status==='needs-setup'?'Transcrição indisponível. Confira as configurações.':'Gravação preservada no histórico.'),Boolean(result.error||result.warning)||['failed','interrupted','needs-setup'].includes(result.status));}
function renderProcessing(){
 const box=$('processing');box.hidden=!processing;if(!processing){processingIdentity=null;return;}
 const identity=processing.id+':'+(processing.attempt||'');if(processingIdentity!==identity){$('processing-details').open=false;$('preview-details').open=false;processingIdentity=identity;}
 const p=processing.progress||{},stages=['preparation','transcription','speakers','finalization'],index=stages.indexOf(p.stage);
 $('processing-session').textContent=processing.title||('Gravação · '+(processing.startedAt?date(processing.startedAt):time(processing.durationMs)));
 for(const li of $('processing-stages').children){const i=stages.indexOf(li.dataset.stage);li.classList.toggle('active',i===index);li.classList.toggle('done',i<index);if(i===index)li.setAttribute('aria-current','step');else li.removeAttribute('aria-current');}
 $('processing-phase').textContent=p.phase||'Preparando transcrição local';$('processing-step').textContent=`Etapa ${Math.max(0,index)+1} de 4`;
 const known=p.stage==='transcription'&&Number.isFinite(p.percent);$('processing-progress').setAttribute('aria-label',known?'Áudio percorrido na transcrição':p.phase||'Preparando transcrição');$('processing-percent').textContent=known?p.percent+'% do áudio':'Em andamento';
 if(known)$('processing-progress').value=p.percent;else $('processing-progress').removeAttribute('value');
 $('processing-detail').textContent=known?(p.percent===100?'Áudio transcrito. Alinhamento, falantes e finalização ainda podem estar em andamento.':`${time(p.processedMs)} de ${time(p.totalMs)} nas fontes de áudio.`):p.stage==='speakers'?'Identificação de falantes em andamento. Sem estimativa de percentual.':p.stage==='finalization'?'Organizando e validando o resultado antes de publicar.':'Carregando e preparando os modelos locais.';
 const preview=$('transcript-preview'),nearBottom=preview.scrollHeight-preview.scrollTop-preview.clientHeight<40;preview.replaceChildren();
 for(const item of processing.preview||[]){const line=document.createElement('p'),stamp=document.createElement('span');stamp.className='preview-time';stamp.textContent=time(item.startMs)+' · '+(item.source==='microphone'?'Microfone':'Computador');const text=document.createElement('span');text.textContent=item.text;line.append(stamp,text);preview.append(line);}
 if(!preview.children.length){const empty=document.createElement('p');empty.className='muted';empty.textContent='Os primeiros trechos aparecerão aqui após serem reconhecidos.';preview.append(empty);}
 if(nearBottom)preview.scrollTop=preview.scrollHeight;
}
let refreshFlight=null,forceRefresh=false;
function refresh(options={}){if(!options.onlyIfChanged)forceRefresh=true;if(refreshFlight)return refreshFlight;refreshFlight=refreshSources(options).finally(()=>{refreshFlight=null;});return refreshFlight;}
async function refreshSources({onlyIfChanged=false}={}){
 if(current)return;
 const native=await window.sonora.devices();const inputs=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput'&&!/blackhole|sonora|memora|virtual|perssua|loopback/i.test(d.label));
 if(current)return;
 const signature=sourceFingerprint(native,inputs);
 if(onlyIfChanged&&!forceRefresh&&signature===lastDeviceSignature)return;forceRefresh=false;lastDeviceSignature=signature;
 const fill=(id,list,placeholder,key)=>{const select=$(id),previous=select.dataset.loaded?select.value:preferences[key];select.replaceChildren(new Option(placeholder,''));list.forEach(d=>select.add(new Option(d.label||'Microfone (autorizar ao iniciar)',d.deviceId||d.uid)));if([...select.options].some(o=>o.value===previous))select.value=previous;select.dataset.loaded='true';};
 fill('record-mic',[{label:'Microfone do sistema',deviceId:'default'},...inputs.filter(d=>!['default','communications'].includes(d.deviceId))],'Sem microfone','microphone');
 fill('record-source',computerOptions(native,$('record-source').dataset.loaded?$('record-source').value:preferences.source),'Sem áudio do computador (somente microfone)','source');sourceSummary();
 if(!native.supported)message('Áudio do computador requer macOS 26+. Microfone pode ser usado sozinho.',true);
 monitorSources();publishWorkspaceState();
}
function sourceSummary(){const mic=Boolean($('record-mic').value),system=Boolean($('record-source').value);$('source-summary').textContent=mic&&system?'Microfone + sistema':mic?'Microfone':system?'Áudio do sistema':'Fontes desativadas';$('source-settings').title=[$('record-mic').selectedOptions[0]?.textContent,$('record-source').selectedOptions[0]?.textContent].filter(Boolean).join(' · ');}
const constraints = deviceId => ({ audio: { deviceId: deviceId === 'default' ? undefined : { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
const verifyCapture=async(stream,capture,device)=>{assertCaptureTrack(stream,capture,device);await window.sonora.recordCaptureValidate({uid:capture.uid,generation:capture.generation,sourceUID:capture.sourceUID});};
const captureDevice=capture=>waitForCapture(capture,()=>navigator.mediaDevices.enumerateDevices(),delay=>new Promise(resolve=>setTimeout(resolve,delay)));
async function release(session) {
  session.streams.forEach(stream => stream.getTracks().forEach(track => track.stop()));
  session.nodes.forEach(node => node.disconnect());
  if (session.context && session.context.state !== 'closed') await session.context.close().catch(() => {});
  if (session.native) await window.sonora.recordCaptureStop().catch(() => {});
}
// Metering uses AnalyserNodes only; recording owns a separate, explicitly started graph.
const meterServices={createContext:()=>new AudioContext({sampleRate:16000,sinkId:{type:'none'}}),devices:()=>window.sonora.devices(),startTap:uid=>window.sonora.recordCaptureStart(uid),stopTap:()=>window.sonora.recordCaptureStop(),captureDevice,verifyCapture,getStream:device=>navigator.mediaDevices.getUserMedia(constraints(device)),onEnded:()=>{if(!current){void levelMonitor.stop();$('monitor-state').textContent='Fonte desconectada. Atualize as fontes para retomar a medição.';}}};
let lastMonitorReport=0,monitorMessage='';
function reportMonitor(levels,force=false){if(!force&&Date.now()-lastMonitorReport<1000)return;lastMonitorReport=Date.now();publishWorkspaceState();const graph=levelMonitor.snapshot();window.sonora.monitorStatus({mode:current?'recording':graph.active?'monitoring':monitorMessage.includes('indisponível')||monitorMessage.includes('interrompida')?'error':'idle',message:monitorMessage,levels,graph,ui:{shortcutCollapsed:!$('shortcuts-settings').open,separateWindows:Boolean($('controller-fields').hidden),modelControlsRemoved:!$('transcription-backend')&&!$('whisper-settings'),progressVisible:!$('processing').hidden,previewCount:processing?.preview?.length||0,processingSessionId:processing?.id||'',overflow:document.documentElement.scrollWidth>innerWidth},transcription:{selectedOption:$('transcription-profile').dataset.backend,profileMatches:$('transcription-profile').dataset.backend===config?.config.backend},dom:{microphone:$('level-microphone').value,computer:$('level-computer').value},selection:{microphone:$('record-mic').selectedOptions[0]?.textContent,computer:$('record-source').selectedOptions[0]?.textContent}});}
const levelMonitor=new LevelMonitor(selection=>openLevelGraph(selection,meterServices),{levels:levels=>{for(const key of ['microphone','computer'])$(`level-${key}`).value=levels[key]||0;reportMonitor(levels);},state:text=>{monitorMessage=text;reportMonitor({microphone:$('level-microphone').value,computer:$('level-computer').value},true);if(!current){$('monitor-state').textContent=text;$('footer-status').textContent=text.startsWith('Fontes desativadas')?'Sem gravação · fontes desativadas':text.includes('indisponível')?'Sem gravação · verifique as fontes':'Sem gravação · medição de sinal';}}});
function monitorSources(){if(current)return;if(config?.diagnostic){$('monitor-state').textContent='Medição simulada no diagnóstico · sem acesso a dispositivos';return;}$('monitor-state').textContent='Preparando medição · sem salvar áudio';void levelMonitor.start({microphone:$('record-mic').value,computer:$('record-source').value});}
async function start() {
  if (current || startPending || processing?.cancelling || (busy && !processing)) return;
  if (!$('record-mic').value && !$('record-source').value) { message('Selecione pelo menos uma fonte.', true); return; }
  startPending = true; busy = true; controls();
  let reservation;
  try {
    // The main process confirms and waits for the exact previous job before any capture opens.
    reservation = await window.sonora.recordPrepare();
    if (reservation) await startCapture(reservation.token);
  } catch (error) { message(error.message, true); }
  finally {
    if (reservation) await window.sonora.recordRelease(reservation.token).catch(error => message(error.message, true));
    startPending = false; busy = current ? !current.samples || current.stopping : Boolean(processing) || manualPending; controls();
  }
}
async function startCapture(token) {
  const microphone = $('record-mic').value, computer = $('record-source').value;
  if (!microphone && !computer) { message('Selecione pelo menos uma fonte.', true); return; }
  window.sonora.feedback('starting'); busy = true; controls(); $('record-state').textContent = 'Preparando captura…'; message('Aguardando confirmação das fontes.');
  const session = { streams: [], nodes: [], native: false, context: null, queue: Promise.resolve(), sequence: 0, pending: 0, stopping: false, peak: [0,0], sources: [], failure: null };
  current = session;$('record-marker-state').textContent=''; controls();
  const checkStarting = () => { if (session.stopping || current !== session) throw new Error('Início de captura cancelado.'); };
  try {
    await levelMonitor.stop();checkStarting();$('monitor-state').textContent='Medidores acompanhando a gravação.';
    const computerDevice=computer?resolveComputer(await window.sonora.devices(),computer):null;checkStarting();
    const context = session.context = new AudioContext({ sampleRate: 16000, sinkId: { type: 'none' } });
    if (context.sampleRate !== 16000) throw new Error('O dispositivo não aceitou captura a 16 kHz.');
    await context.audioWorklet.addModule('pcm-worklet.js'); checkStarting();
    const worklet = session.worklet = new AudioWorkletNode(context, 'sonora-pcm', { numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [1] });
    session.nodes.push(worklet);
    for (const [index, key, value, select] of [[0,'microphone',microphone,'record-mic'],[1,'computer',computer,'record-source']]) {
      if (!value) continue;
      let device = value,captureIdentity=null;
      if (key === 'computer') { const capture = await window.sonora.recordCaptureStart(computerDevice.uid); session.native = true;captureIdentity=capture; checkStarting(); device = await captureDevice(capture); checkStarting(); }
      const stream = diagnosticStream || await navigator.mediaDevices.getUserMedia(constraints(device));
      session.streams.push(stream);checkStarting();if(captureIdentity)await verifyCapture(stream,captureIdentity,device);
      const source = context.createMediaStreamSource(stream); session.nodes.push(source); source.connect(worklet, 0, index);
      session.sources.push({ key, label: `${key === 'microphone' ? 'Microfone' : 'Computador'} · ${key==='computer'?computerDevice.label:$(select).selectedOptions[0].textContent}` });
      stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => { if (!session.stopping) stop('Uma fonte de áudio foi desconectada.'); }));
    }
    const created = await window.sonora.recordBegin(session.sources,token); session.id = created.id; checkStarting();
    let confirmed;
    const firstChunk = new Promise(resolve => { confirmed = resolve; });
    worklet.port.onmessage = ({ data }) => {
      if (data.stopped) { session.flushed?.(); return; }
      if (session.failure) return;
      if (++session.pending > 32) { session.failure = 'Armazenamento não acompanhou a captura.'; void stop(session.failure); return; }
      const chunks = {};
      for (const source of session.sources) {
        const index = source.key === 'microphone' ? 0 : 1;
        chunks[source.key] = new Uint8Array(data.channels[index]);
        session.peak[index] = Math.max(session.peak[index], data.peaks[index]);
        $(`level-${source.key}`).value = data.peaks[index];
      }
      const sequence = session.sequence++;
      session.queue = session.queue.then(async () => {
        if (session.failure) return;
        const saved = await window.sonora.recordAppend(session.id, sequence, chunks);
        session.samples = saved.samples; session.pending--; confirmed();
        if (!session.stopping) $('record-state').textContent = `Gravando · ${time(saved.samples / 16)}`;
      }).catch(error => { session.failure = error.message; confirmed(); if (!session.stopping) void stop(error.message); });
    };
    worklet.onprocessorerror = () => { if (!session.stopping) void stop('Processador de áudio interrompido.'); };
    context.onstatechange = () => { if (!session.stopping && context.state === 'suspended') void stop('Captura suspensa pelo sistema.'); };
    worklet.connect(context.destination); await context.resume(); checkStarting();
    let timer;
    try { await Promise.race([firstChunk, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Não chegaram amostras de áudio.')), 8000); })]); } finally { clearTimeout(timer); }
    if (session.failure || session.stopping) return;
    busy = false; window.sonora.recordStatus(true); $('footer-status').textContent = '● Gravando localmente'; controls();
    message('Gravação local ativa. Parar salva no histórico e inicia a transcrição automaticamente.');
    session.silenceTimer = setTimeout(() => {
      if (current === session && computer && session.peak[1] < 0.0001) message('Nenhum sinal do computador detectado. Confira se o som está saindo no dispositivo selecionado. O registro continua.', true);
    }, 6000);
  } catch (error) {
    if (!session.stopping) await stop(error.message);
    else { await release(session); if (session.id) await window.sonora.recordFinish(session.id, error.message).catch(() => {}); }
  }
}
async function stop(error = null,{autoTranscribe=true}={}) {
  const session = current;
  if (!session || session.stopping) return;
  window.sonora.feedback('saving'); session.stopping = true; busy = true; controls(); clearTimeout(session.silenceTimer);
  $('record-state').textContent = 'Finalizando gravação…';
  try {
    if (session.worklet && session.context?.state === 'running') {
      let timer;
      const flushed = new Promise(resolve => { session.flushed = resolve; });
      session.worklet.port.postMessage('stop');
      try { await Promise.race([flushed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Não foi possível finalizar o último bloco de áudio.')), 2000); })]); }
      catch (failure) { error ||= failure.message; } finally { clearTimeout(timer); }
    }
    await release(session); await session.queue;
    window.sonora.recordStatus(false);
    if (session.id) {
      const result = await window.sonora.recordFinish(session.id, error || session.failure,autoTranscribe); renderResult(result);
      // Keep the old capture owned until refresh finishes; a shortcut must not race its cleanup.
      await setup(result.id);
    } else { current = null; $('record-state').textContent = 'Captura não iniciada'; message(error || 'Não foi possível iniciar.', true); window.sonora.feedback('error'); }
  } catch (failure) { message(failure.message, true); }
  finally { current = null; busy = Boolean(processing); window.sonora.recordStatus(false); $('footer-status').textContent = 'Sem captura ativa'; $('level-microphone').value = 0; $('level-computer').value = 0; controls();monitorSources(); }
}
async function toggle(){if(current){if(current.samples&&!current.stopping)await stop();}else await start();}
window.sonoraStopRecording=()=>current?stop():Promise.resolve();
window.sonora.onRecordCaptureEnded(()=>{if(current&&!current.stopping)void stop('Captura do computador interrompida.');else if(!current){void levelMonitor.stop();$('monitor-state').textContent='Medição interrompida. Atualize as fontes para tentar novamente.';}});
window.sonora.onRecordToggle(()=>void toggle());
window.sonora.onRecordUpdate(result=>{eventRevision++;if(result.status==='transcribing'){processing=result.processing||processing;if(!current)busy=true;renderProcessing();}else if(!processing||processing.id===result.id){processing=null;if(!current)busy=manualPending||startPending;renderProcessing();}renderResult(result);controls();if(result.status!=='transcribing'&&!current)void setup(result.id);});
window.sonora.onMarkerAdded?.(marker=>{if(current?.id===marker.sessionId)$('record-marker-state').textContent=marker.count+' marcado(s) · '+time(marker.timeMs);});
$('record-mark').onclick=async()=>{if(!current?.id||current.stopping)return;try{await window.sonora.recordMark();}catch(e){message(e.message,true);}};
$('record-toggle').onclick=toggle;$('record-history').onchange=()=>historySelection(config.sessions.find(s=>s.id===$('record-history').value));
$('record-refresh').onclick=()=>refresh().catch(e=>message(e.message,true));
$('record-folder-open').onclick=()=>window.sonora.recordReveal(selectedSession?.id).catch(e=>message(e.message,true));
async function transcribe(id){if(!id||busy||current)return;manualPending=true;busy=true;controls();try{renderResult(await window.sonora.recordTranscribe(id));await setup(id);}catch(e){message(e.message,true);}finally{manualPending=false;busy=Boolean(processing)||startPending;controls();}}
$('record-retry').onclick=()=>transcribe(selectedSession?.id);$('record-cancel').onclick=async()=>{$('record-cancel').disabled=true;try{await window.sonora.recordCancel();}catch(e){message(e.message,true);controls();}};
$('latest-view').onclick=async()=>{if(config.latest?.hasTranscript&&!busy&&!current)await window.sonora.recordReader(config.latest.id).catch(e=>message(e.message,true));};
$('latest-rename').onclick=()=>{if(!config.latest||busy||current)return;latestRenameId=config.latest.id;$('latest-rename-title').value=config.latest.title;$('latest-rename-form').hidden=false;$('latest-rename-title').focus();};
$('latest-rename-cancel').onclick=()=>{latestRenameId=null;$('latest-rename-form').hidden=true;};
$('latest-rename-form').onsubmit=async event=>{event.preventDefault();if(!latestRenameId||busy||current)return;const id=latestRenameId;try{$('latest-rename-save').disabled=true;await window.sonora.recordRename(id,$('latest-rename-title').value);latestRenameId=null;$('latest-rename-form').hidden=true;await setup($('record-history').value);message('Nome atualizado.');}catch(e){message(e.message,true);}finally{controls();}};
$('record-view').onclick=()=>window.sonora.recordReader(selectedSession.id).catch(e=>message(e.message,true));
$('record-rename').onclick=()=>{$('rename-title').value=selectedSession.title;$('rename-form').hidden=false;$('rename-title').focus();};
$('rename-form').onsubmit=async event=>{event.preventDefault();try{const id=selectedSession.id;await window.sonora.recordRename(id,$('rename-title').value);await setup(id);}catch(e){message(e.message,true);}};
for(const [id,key]of [['record-mic','microphone'],['record-source','source']])$(id).onchange=async()=>{sourceSummary();try{preferences=await window.sonora.preferences({[key]:$(id).value});}catch(e){message(e.message,true);}monitorSources();};
for(const [id,view]of [['source-settings','settings'],['settings-open','settings'],['history-open','history']])$(id).onclick=()=>window.sonora.openWindow(view).catch(e=>message(e.message,true));
window.dismissMemoraPopover=()=>{if($('latest-rename-form').hidden)return false;latestRenameId=null;$('latest-rename-form').hidden=true;$('latest-rename').focus();return true;};
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&window.dismissMemoraPopover())event.preventDefault();});
$('shortcut-input').onkeydown=event=>{if(event.key==='Tab')return;event.preventDefault();if(['Shift','Meta','Alt','Control'].includes(event.key))return;const key=event.code.startsWith('Key')?event.code.slice(3):event.code.startsWith('Digit')?event.code.slice(5):event.code==='Space'?'Space':event.key;shortcutDraft=[event.metaKey?'Command':'',event.ctrlKey?'Control':'',event.altKey?'Alt':'',event.shiftKey?'Shift':'',key].filter(Boolean).join('+');$('shortcut-input').value=shortcutText(shortcutDraft);};
async function setShortcut(value){try{preferences=await window.sonora.preferences({shortcut:value});$('shortcut-label').textContent=shortcutText(preferences.registered);$('shortcut-input').value=shortcutText(preferences.shortcut);$('shortcut-state').textContent=preferences.registered?'Atalho global registrado.':'Atalho desativado.';}catch(e){$('shortcut-state').textContent=e.message;}}
$('shortcut-save').onclick=()=>setShortcut(shortcutDraft);$('shortcut-disable').onclick=()=>setShortcut('');$('feedback-enabled').onchange=()=>window.sonora.preferences({popover:$('feedback-enabled').checked}).catch(e=>message(e.message,true));
async function storage(){const data=await window.sonora.storage();$('storage-total').textContent=bytes(data.total);for(const key of ['audio','transcripts','other','engine'])$('storage-'+key).textContent=bytes(data[key]);$('storage-ram').textContent=`RAM dos processos Electron (não inclui toda a transcrição): ${bytes(data.ram)}. A limpeza libera espaço em disco.`;}
$('cleanup-settings').ontoggle=()=>{if($('cleanup-settings').open)storage().catch(e=>$('cleanup-state').textContent=e.message);};
$('cleanup-preview').onclick=async()=>{try{const plan=await window.sonora.cleanupPreview({date:$('cleanup-date').value,audio:$('cleanup-audio').checked,transcripts:$('cleanup-transcripts').checked});cleanupToken=plan.token;$('cleanup-summary').textContent=`${plan.sessionCount} gravação(ões) · ${plan.fileCount} arquivo(s) · ${bytes(plan.bytes)}`;$('cleanup-detail').textContent=`Até ${plan.date}, inclusive. ${plan.protectedCount} sessão(ões) em uso preservada(s). ${plan.transcripts?'Os tipos selecionados serão removidos.':'Transcrições serão preservadas.'}`;$('cleanup-apply').disabled=!plan.fileCount;$('cleanup-review').hidden=false;$('cleanup-state').textContent='A exclusão exige confirmação na próxima etapa.';}catch(e){$('cleanup-state').textContent=e.message;}};
$('cleanup-cancel').onclick=()=>{cleanupToken=null;$('cleanup-review').hidden=true;};
$('cleanup-apply').onclick=async()=>{if(!cleanupToken)return;$('cleanup-apply').disabled=true;try{const result=await window.sonora.cleanupApply(cleanupToken);$('cleanup-state').textContent=result.cancelled?'Limpeza cancelada.':`${result.files} arquivo(s) removido(s) · ${bytes(result.bytes)}.`;await setup();await storage();}catch(e){$('cleanup-state').textContent=e.message;}finally{cleanupToken=null;$('cleanup-review').hidden=true;}};
for(const id of ['cleanup-date','cleanup-audio','cleanup-transcripts'])$(id).onchange=()=>{cleanupToken=null;$('cleanup-review').hidden=true;};
$('quit').onclick=async()=>{if(current)await stop(null,{autoTranscribe:false});await levelMonitor.stop();window.sonora.quit();};
let resizeFrame;const resizePanel=()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>window.sonora.resize(document.querySelector('header').offsetHeight+Math.min(document.querySelector('main').scrollHeight,640)+document.querySelector('footer').offsetHeight+2));};
new ResizeObserver(resizePanel).observe($('menu-panel'));new MutationObserver(resizePanel).observe($('menu-panel'),{childList:true,subtree:true,attributes:true});resizePanel();
const now=new Date();$('cleanup-date').value=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
await setup();await refresh().catch(e=>message(e.message,true));
window.refreshMemora=()=>setup();
window.refreshMemoraSources=()=>refresh();
window.applyMemoraPreferences=async()=>{await setup();for(const id of ['record-mic','record-source'])delete $(id).dataset.loaded;await refresh();publishWorkspaceState();};
window.sonora.onRefresh(()=>void setup().catch(e=>message(e.message,true)));
publishWorkspaceState();
navigator.mediaDevices.addEventListener('devicechange',()=>{if(!current)void refresh({onlyIfChanged:true}).catch(e=>{$('monitor-state').textContent='Não foi possível atualizar medição: '+e.message;});});
const sourcePoll=setInterval(()=>{if(!current&&!config?.diagnostic)void refresh({onlyIfChanged:true}).catch(e=>{$('monitor-state').textContent='Não foi possível verificar a saída atual: '+e.message;});},2000);
window.addEventListener('beforeunload',()=>{clearInterval(sourcePoll);void levelMonitor.stop();});
window.runInterfaceDiagnostics=async id=>{const collapsed=!$('history').open&&!$('settings').open;const quickAvailable=!$('latest-view').disabled&&!$('latest-rename').disabled;const directActions=$('latest-actions').children.length===2&&$('latest-view').parentElement===$('latest-actions')&&$('latest-rename').parentElement===$('latest-actions');$('latest-rename').click();$('latest-rename-title').value='Planejamento renomeado · exemplo';await $('latest-rename-form').onsubmit({preventDefault(){}});const renamed=config.latest.title==='Planejamento renomeado · exemplo'&&$('latest-title').textContent===config.latest.title;const quickRename=renamed&&!$('history').open&&$('latest-rename-form').hidden;const preview=await window.sonora.cleanupPreview({date:'2020-01-01',audio:true,transcripts:false});await storage();return {passed:collapsed&&renamed&&quickAvailable&&quickRename&&directActions&&preview.fileCount===0&&document.documentElement.scrollWidth<=innerWidth,collapsed,renamed,quickAvailable,quickRename,directActions,cleanupPreview:preview.fileCount,hasLastDate:Boolean($('last-audio-date').textContent),width:innerWidth};};
window.runRecordingDiagnostics=async()=>{if(current||busy)throw Error('Sessão em andamento.');const context=new AudioContext({sinkId:{type:'none'}}),oscillator=context.createOscillator(),destination=context.createMediaStreamDestination();oscillator.connect(destination);oscillator.start();await context.resume();diagnosticStream=destination.stream;$('record-source').value='';$('record-mic').add(new Option('Sinal sintético (sem microfone)','synthetic'));$('record-mic').value='synthetic';try{await start();const confirmed=Boolean(current?.samples);await new Promise(r=>setTimeout(r,350));const marker=await window.sonora.recordMark();const marked=marker.sessionId===current.id&&marker.timeMs>0;await stop();const data=await window.sonora.recordInfo();return {passed:confirmed&&marked&&data.latest.status==='saved'&&!$('record-toggle').disabled,confirmed,status:data.latest.status,samples:data.latest.samples,realCapture:false};}finally{diagnosticStream=null;oscillator.stop();await context.close();$('record-mic').querySelector('option[value="synthetic"]')?.remove();$('record-mic').value='default';sourceSummary();}};

window.runMeterDiagnostics=async()=>{
 if(!config.diagnostic||current)throw Error('Diagnóstico exige perfil isolado e sem gravação.');
 const before=(await window.sonora.recordInfo()).sessions.map(s=>s.id),generator=new AudioContext({sampleRate:16000,sinkId:{type:'none'}}),streams=[];
 for(const amplitude of [.2,.5]){const osc=generator.createOscillator(),gain=generator.createGain(),destination=generator.createMediaStreamDestination();gain.gain.value=amplitude;osc.connect(gain);gain.connect(destination);osc.start();streams.push(destination.stream);}
 let index=0,started=0,stopped=0,levels={},meterState='';const m=new LevelMonitor(selection=>openLevelGraph(selection,{createContext:()=>new AudioContext({sampleRate:16000,sinkId:{type:'none'}}),devices:async()=>({supported:true,devices:[{uid:'synthetic',label:'Som sintético',outputChannels:2,isDefault:true,virtual:false}]}),startTap:async()=>{started++;return {label:'Sintético'};},stopTap:async()=>{stopped++;},captureDevice:async()=> 'synthetic',verifyCapture:()=>{},getStream:async()=>streams[index++]}),{levels:value=>{levels=value;},state:value=>{meterState=value;}});
 try{await generator.resume();await m.start({microphone:'default',computer:'system-default'});const begin=Date.now();while((!levels.microphone||!levels.computer)&&Date.now()-begin<3000)await new Promise(r=>setTimeout(r,50));const peaks={...levels};await m.stop();const after=(await window.sonora.recordInfo()).sessions.map(s=>s.id);return {passed:peaks.microphone>.1&&peaks.computer>.3&&JSON.stringify(before)===JSON.stringify(after)&&started===1&&stopped===1,peaks,meterState,generatorState:generator.state,generatorTime:generator.currentTime,noSessionsCreated:JSON.stringify(before)===JSON.stringify(after),tapStarts:started,tapStops:stopped,streamsEnded:streams.every(s=>s.getTracks().every(t=>t.readyState==='ended')),realCapture:false};}finally{await m.stop();streams.forEach(s=>s.getTracks().forEach(t=>t.stop()));await generator.close();}
};

window.runProcessingDiagnostics=async()=>{
 if(!config.diagnostic||current||processing)throw Error('Diagnóstico exige perfil isolado ocioso.');
 const prior=processing;processing={id:config.latest.id,attempt:'fixture',title:'Reunião de exemplo',startedAt:config.latest.startedAt,durationMs:12000,progress:{stage:'transcription',phase:'Alinhando palavras e tempos',percent:100,processedMs:12000,totalMs:12000},preview:[{source:'computer',startMs:2500,endMs:6000,text:'A equipe vai revisar a proposta amanhã. <script>exemplo</script>'}]};busy=true;renderProcessing();controls();
 const report={visible:!$('processing').hidden,detailsCollapsed:!$('processing-details').open,previewCollapsed:!$('preview-details').open,latestHidden:$('latest-recording').hidden,stepVisible:$('processing-step').textContent==='Etapa 2 de 4',progressOutsideDetails:!$('processing-progress').closest('details'),transcription100StillWorking:$('processing-percent').textContent==='100% do áudio'&&!$('record-cancel').disabled&&!$('record-toggle').disabled,safeText:$('transcript-preview').querySelector('script')===null&&$('transcript-preview').textContent.includes('<script>exemplo</script>'),pendingSpeakers:$('preview-details').textContent.includes('Falantes pendentes'),shortcutCollapsed:!$('shortcuts-settings').open,separateWindows:Boolean($('controller-fields').hidden),modelControlsRemoved:!$('transcription-backend')&&!$('whisper-settings'),noHorizontalOverflow:document.documentElement.scrollWidth<=innerWidth};
 $('processing-details').open=true;$('preview-details').open=true;renderProcessing();report.expansionPersists=$('processing-details').open&&$('preview-details').open;
 processing.progress={stage:'speakers',phase:'Identificando falantes'};renderProcessing();report.unknownProgressHonest=!$('processing-progress').hasAttribute('value')&&$('processing-step').textContent==='Etapa 3 de 4'&&$('processing-percent').textContent==='Em andamento';
 processing.attempt='fixture-new';processing.progress={stage:'transcription',phase:'Alinhando palavras e tempos',percent:65,processedMs:7800,totalMs:12000};renderProcessing();report.newAttemptCollapses=!$('processing-details').open&&!$('preview-details').open;
 processing.cancelling=true;controls();report.cancelProtected=$('record-cancel').disabled&&$('record-cancel').textContent==='Encerrando…';processing.cancelling=false;controls();
 report.passed=Object.values(report).every(Boolean);window.endProcessingDiagnostics=()=>{processing=prior;busy=false;renderProcessing();controls();};return report;
};

// Isolated Electron diagnostic: generated audio only, never getUserMedia or a native tap.
window.runNextRecordingDiagnostics=async()=>{
 if(!config.diagnostic||current||!processing)throw Error('Diagnóstico exige transcrição sintética ativa.');
 const originalId=processing.id,context=new AudioContext({sinkId:{type:'none'}}),oscillator=context.createOscillator(),destination=context.createMediaStreamDestination();
 oscillator.connect(destination);oscillator.start();await context.resume();diagnosticStream=destination.stream;
 const oldMic=$('record-mic').value,oldComputer=$('record-source').value;
 $('record-source').value='';$('record-mic').add(new Option('Sinal sintético (sem microfone)','synthetic-next'));$('record-mic').value='synthetic-next';
 try{
  const enabledDuringAnalysis=!$('record-toggle').disabled;
  await toggle();const afterCancel=await window.sonora.recordInfo();
  const cancelledKeepsAnalysis=!current&&afterCancel.processing?.id===originalId;
  const first=toggle();await toggle();await first;
  const confirmed=Boolean(current?.samples),newId=current?.id,afterStart=await window.sonora.recordInfo();
  const previous=afterStart.sessions.find(s=>s.id===originalId);
  const previousPreserved=previous?.status==='cancelled'&&previous.hasAudio&&previous.hasTranscript;
  const noOverlap=confirmed&&!afterStart.processing&&newId!==originalId;
  await stop();const saved=await window.sonora.recordInfo();
  const savedNewRecording=saved.latest.id===newId&&saved.latest.status==='saved';
  const report={enabledDuringAnalysis,cancelledKeepsAnalysis,confirmed,previousPreserved,noOverlap,savedNewRecording};
  return {...report,passed:Object.values(report).every(Boolean),realCapture:false};
 }finally{
  if(current)await stop(null,{autoTranscribe:false});diagnosticStream=null;oscillator.stop();await context.close();$('record-mic').querySelector('option[value="synthetic-next"]')?.remove();$('record-mic').value=oldMic;$('record-source').value=oldComputer;sourceSummary();
 }
};

function publishWorkspaceState(){
 if(!window.sonora.workspaceState)return;
 const sources={};for(const [id,key]of [['record-mic','microphone'],['record-source','computer']]){const select=$(id);sources[key]={value:select.value,options:[...select.options].map(option=>({value:option.value,label:option.textContent}))};}
 window.sonora.workspaceState({ready:Boolean(config),sourcesReady:Boolean($('record-mic').dataset.loaded),busy:busy||startPending,recording:Boolean(current),sources,levels:{microphone:$('level-microphone').value,computer:$('level-computer').value},message:$('monitor-state').textContent});
}
