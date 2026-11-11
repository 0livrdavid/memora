const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen, session, nativeTheme, dialog, shell, globalShortcut } = require('electron');
const path=require('node:path'),fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const {environmentValue}=require('./compatibility.cjs');
const {CaptureBridge}=require('./native.cjs');
const {RecordingStore,privateJSON}=require('./recordings.cjs');
const {parseRequest,performRequest}=require('./transcribe-request.cjs');
let actionsReady;const actionGate=new Promise(resolve=>{actionsReady=resolve;});
const {readBuild}=require('./app-build.cjs');
let runtimeBuild;
const {Library}=require('./library.cjs');
const {start:startMCP}=require('./mcp.cjs');
let mcp,mcpStatus={running:false};
const {Preferences}=require('./preferences.cjs');
const {MonitorStatus}=require('./monitor-status.cjs');
process.umask(0o077);app.setName('Memora');
const smoke=Boolean(environmentValue('MEMORA_SMOKE'));
const base=environmentValue('MEMORA_DATA')||path.join(__dirname,'../.local');
app.setPath('userData',smoke?path.join(base,'smoke-profile'):base);
const page=name=>pathToFileURL(path.join(__dirname,name)).href;
const capture=new CaptureBridge();
let panel,tray,notice,reader,readerId,readerFingerprint,store,library,preferences,monitorStatus,noticeTimer,recording=false,modalDepth=0;
const workspaceWindows=new Map();let panelState={ready:false},workspaceUpdateKey='';
function workspaceChanged(){for(const win of workspaceWindows.values())if(!win.isDestroyed())win.webContents.send('workspace:changed');}
function syncDock(){if(!reader&&workspaceWindows.size===0)app.dock?.hide();}
function refreshLibrary(ids,renamed){if(panel&&!panel.isDestroyed())panel.webContents.send('record:refresh');workspaceChanged();if(reader&&!reader.isDestroyed()&&(!ids||ids.includes(readerId))){readerFingerprint=null;if(renamed?.id===readerId)reader.webContents.send('reader:renamed',{id:renamed.id,title:renamed.title});else reader.webContents.send('reader:changed');}}
async function openWorkspace(view){
 if(!['history','settings'].includes(view))throw Error('Janela inválida.');
 let win=workspaceWindows.get(view);if(win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.show();win.focus();return win;}
 const area=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea,width=Math.min(view==='history'?1020:960,area.width),height=Math.min(view==='history'?650:700,area.height);
 win=new BrowserWindow({x:Math.round(area.x+(area.width-width)/2),y:Math.round(area.y+(area.height-height)/2),width,height,minWidth:view==='history'?700:620,minHeight:500,show:false,resizable:true,minimizable:true,maximizable:true,fullscreenable:false,skipTaskbar:false,title:'Memora · '+(view==='history'?'Histórico':'Configurações'),titleBarStyle:'hiddenInset',trafficLightPosition:{x:18,y:20},backgroundColor:'#fafafc',webPreferences:webPreferences('workspace-preload.cjs')});
 workspaceWindows.set(view,win);secure(win,'workspace.html');win.on('close',()=>{if(workspaceWindows.get(view)===win)workspaceWindows.delete(view);});win.on('closed',()=>{if(workspaceWindows.get(view)===win)workspaceWindows.delete(view);syncDock();});
 await app.dock?.show();await win.loadFile(path.join(__dirname,'workspace.html'),{query:{view}});if(!win.isDestroyed()){win.show();win.focus();}return win;
}
function requireWorkspace(event){for(const [view,win] of workspaceWindows)if(!win.isDestroyed()&&win.webContents===event.sender)return {view,win};throw Error('Janela inválida.');}
function requireIdleWorkspace(requireSources=true){if((requireSources&&!panelState.ready)||panelState.busy||panelState.recording||store.active||store.job)throw Error('Aguarde a gravação ou análise terminar.');}

const webPreferences=preload=>({preload:path.join(__dirname,preload),contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false});
function secure(win,name){win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(e,url)=>{if(url!==page(name))e.preventDefault();});}
function allSpaces(win){win.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true,skipTransformProcessType:true});win.setHiddenInMissionControl(true);}
function info(){return {...store.info(),diagnostic:smoke,sessions:library.list(),latest:library.list()[0]||null,build:runtimeBuild,mcp:mcpStatus,preferences:preferences.info()};}
function markMoment(){const marker=library.annotations.markActive();if(panel&&!panel.isDestroyed())panel.webContents.send('record:marker-added',marker);workspaceChanged();feedback('marked');return marker;}
function updateTray(){if(!tray||tray.isDestroyed())return;tray.setTitle(recording?'● REC':'');tray.setToolTip(recording?'Memora · gravando localmente':'Memora · pronto para gravar');}
function position(win){const anchor=tray.getBounds(),area=screen.getDisplayNearestPoint({x:anchor.x,y:anchor.y}).workArea;const [w,h]=win.getSize();win.setPosition(Math.round(Math.max(area.x,Math.min(anchor.x+anchor.width/2-w/2,area.x+area.width-w))),Math.round(Math.max(area.y,Math.min(anchor.y+anchor.height+6,area.y+area.height-h))));}
function showPanel(){if(!panel||panel.isDestroyed())return;allSpaces(panel);position(panel);panel.show();panel.focus();}
function feedback(phase){
 const texts={'marker-error':['Não foi possível marcar','A gravação continua. Confira o espaço disponível.'],marked:['Momento marcado','O horário foi salvo nesta gravação.'],starting:['Iniciando gravação','Aguardando confirmação das fontes.'],started:['Gravação iniciada','Áudio salvo somente neste Mac.'],saving:['Finalizando gravação','Salvando os últimos trechos…'],saved:['Gravação salva','Disponível no histórico para transcrever depois.'],error:['Gravação interrompida','Confira a mensagem no Memora.']};
 if(!preferences.value.popover||!texts[phase])return;position(notice);notice.webContents.send('feedback',texts[phase]);notice.showInactive();clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>notice.hide(),phase==='starting'?5000:3000);
}
async function modal(action){modalDepth++;try{return await action();}finally{modalDepth--;}}
function restoreReader(){
 if(!reader||reader.isDestroyed())return false;
 if(reader.isMinimized())reader.restore();reader.show();reader.focus();return true;
}
function activateMemora(){if(restoreReader())return;const win=[...workspaceWindows.values()].find(value=>!value.isDestroyed());if(win){if(win.isMinimized())win.restore();win.show();win.focus();}else showPanel();}
async function openReader(id){
 const data=library.transcript(id),fingerprint=JSON.stringify([data.revision,data.title,data.speakers,data.audioSources,data.warning,data.markers]);const changed=readerId!==id||readerFingerprint!==fingerprint;readerId=id;readerFingerprint=fingerprint;
 if(reader&&!reader.isDestroyed()){if(changed)reader.webContents.send('reader:changed');restoreReader();return;}
 const area=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
 const width=Math.min(1000,area.width),height=Math.min(760,area.height);
 reader=new BrowserWindow({x:Math.round(area.x+(area.width-width)/2),y:Math.round(area.y+(area.height-height)/2),width,height,minWidth:640,minHeight:500,show:false,resizable:true,minimizable:true,maximizable:true,skipTaskbar:false,fullscreenable:false,title:'Memora · Transcrição',backgroundColor:'#fafafa',webPreferences:webPreferences('reader-preload.cjs')});
 // The reader is an ordinary window on its own desktop, unlike the menu popover.
 secure(reader,'reader.html');reader.on('closed',()=>{reader=null;readerId=null;readerFingerprint=null;syncDock();});
 const win=reader;await app.dock?.show();if(win.isDestroyed())return;await win.loadFile(path.join(__dirname,'reader.html'));if(!win.isDestroyed())restoreReader();
}
async function dispatchTranscriptionRequest(argv){
 let id;try{id=parseRequest(argv);}catch{console.error('Solicitação local de transcrição inválida.');return;}if(!id)return;
 await actionGate;const file=path.join(app.getPath('userData'),'transcription-request.json'),started=Date.now();
 try{if(store.active||store.job){const e=Error('BUSY');e.code='BUSY';throw e;}privateJSON(file,{sessionId:id,phase:'accepted',backend:store.config.backend,startedAt:new Date(started).toISOString()});showPanel();const result=await performRequest(store,id);privateJSON(file,{sessionId:id,phase:'finished',backend:store.config.backend,status:result.status,elapsedSeconds:(Date.now()-started)/1000,finishedAt:new Date().toISOString()});}
 catch(error){privateJSON(file,{sessionId:id,phase:'refused',code:['BUSY','EXPERIMENTAL_NOT_SELECTED','UNKNOWN_SESSION','INVALID_SESSION'].includes(error.code)?error.code:'FAILED',at:new Date().toISOString()});}
}
if(!app.requestSingleInstanceLock())app.quit();else{
 app.on('second-instance',(_event,argv)=>{if(argv.some(a=>a.startsWith('--memora-transcribe-experimental')))void dispatchTranscriptionRequest(argv);else activateMemora();});
 app.on('activate',activateMemora);
 app.whenReady().then(async()=>{
  runtimeBuild=readBuild(app);nativeTheme.themeSource='light';app.dock?.hide();
  store=new RecordingStore(path.join(app.getPath('userData'),'recordings'),{notify:metadata=>{if(panel&&!panel.isDestroyed()&&!panel.webContents.isDestroyed())panel.webContents.send('record:update',metadata);const key=metadata.id+':'+metadata.status;if(metadata.status!=='transcribing'||key!==workspaceUpdateKey){workspaceUpdateKey=key;workspaceChanged();}}});
  store.useStandardBackend();
  monitorStatus=new MonitorStatus(path.join(app.getPath('userData'),'monitor-status.json'));
  library=new Library(store,path.join(app.getPath('userData'),'whisper'));
  if(!smoke){try{mcp=await startMCP(library,path.join(app.getPath('userData'),'memora-mcp.sock'));mcpStatus={running:true,transport:'stdio via private local socket'};}catch{mcpStatus={running:false,error:'MCP local indisponível. Confira se outra instância está aberta.'};}}
  const shortcutAdapter=smoke?{register:()=>true,unregister:()=>{}}:globalShortcut;
  preferences=new Preferences(path.join(app.getPath('userData'),'preferences.json'),shortcutAdapter,()=>panel?.webContents.send('record:toggle'),()=>{try{markMoment();}catch{feedback('marker-error');}});
  session.defaultSession.setPermissionCheckHandler((contents,permission)=>contents===panel?.webContents&&['media','speaker-selection'].includes(permission));
  session.defaultSession.setPermissionRequestHandler((contents,permission,callback)=>callback(contents===panel?.webContents&&['media','speaker-selection'].includes(permission)));
  panel=new BrowserWindow({type:'panel',width:380,height:300,show:false,frame:false,resizable:false,fullscreenable:false,minimizable:false,maximizable:false,skipTaskbar:true,transparent:true,backgroundColor:'#00000000',vibrancy:'menu',visualEffectState:'active',hasShadow:true,webPreferences:webPreferences('preload.cjs')});
  secure(panel,'index.html');allSpaces(panel);
  panel.on('close',e=>{if(!app.isQuitting){e.preventDefault();panel.hide();}});const closeOnBlur=()=>{if(!modalDepth)panel.hide();};panel.on('blur',closeOnBlur);
  panel.webContents.on('before-input-event',(e,input)=>{if(input.key==='Escape'){e.preventDefault();if(input.type==='keyDown')void panel.webContents.executeJavaScript('window.dismissMemoraPopover?.() === true').then(handled=>{if(!handled&&!panel.isDestroyed())panel.hide();}).catch(()=>{if(!panel.isDestroyed())panel.hide();});}});
  notice=new BrowserWindow({type:'panel',width:300,height:94,show:false,frame:false,resizable:false,focusable:false,skipTaskbar:true,alwaysOnTop:true,webPreferences:webPreferences('feedback-preload.cjs')});secure(notice,'feedback.html');allSpaces(notice);await notice.loadFile(path.join(__dirname,'feedback.html'));
  tray=new Tray(icon());updateTray();tray.on('click',()=>panel.isVisible()?panel.hide():showPanel());tray.on('right-click',()=>tray.popUpContextMenu(Menu.buildFromTemplate([{label:'Abrir Memora',click:showPanel},{label:'Voltar à transcrição',enabled:Boolean(reader&&!reader.isDestroyed()),click:restoreReader},{label:'Iniciar / parar gravação',click:()=>panel.webContents.send('record:toggle')},{type:'separator'},{label:'Encerrar Memora',click:()=>app.quit()}])));
  const handler=(name,fn)=>ipcMain.handle(`record:${name}`,(event,...args)=>{if(event.sender!==panel.webContents)throw Error('Janela inválida.');return fn(...args);});
  handler('info',info);handler('mark-moment',()=>markMoment());handler('preferences',update=>preferences.update(update));
  handler('devices',()=>capture.request('list'));handler('capture-start',uid=>{if(typeof uid!=='string'||uid.length>512)throw Error('Dispositivo inválido.');return capture.request('start',uid);});handler('capture-stop',()=>capture.request('stop'));handler('capture-validate',identity=>{if(!identity||Object.keys(identity).some(k=>!['uid','generation','sourceUID'].includes(k))||Object.values(identity).some(v=>typeof v!=='string'||v.length>512))throw Error('Identidade inválida.');return capture.request('validate',undefined,identity);});
  handler('prepare',()=>store.prepareRecording(async processing=>{
   showPanel();
   const result=await modal(()=>dialog.showMessageBox(panel,{type:'question',title:'Iniciar nova gravação',message:'Deseja interromper a transcrição atual para iniciar outra gravação?',detail:`${processing.title||'A gravação anterior'} está em análise. A tentativa atual será encerrada e a prévia provisória não será concluída. O áudio, os arquivos e qualquer transcrição já salva serão preservados. Você poderá transcrever novamente pelo Histórico; o processamento recomeça, não continua de onde parou. A nova gravação só começa depois que a análise encerrar.`,buttons:['Cancelar','Interromper e gravar'],defaultId:0,cancelId:0,noLink:true}));
   return result.response===1;
  }));
  handler('release',token=>store.releaseRecording(token));
  handler('begin',(sources,token)=>store.begin(sources,token));handler('append',(id,sequence,chunks)=>store.append(id,sequence,chunks));
  handler('finish',(id,error,automatic=true)=>{if(typeof automatic!=='boolean')throw Error('Opção inválida.');const result=store.finishAndTranscribe(id,typeof error==='string'?error.slice(0,2000):null,{automatic:automatic&&!smoke});recording=false;updateTray();feedback(error?'error':'saved');return result;});
  handler('transcribe',id=>store.transcribe(id));handler('cancel',()=>store.cancel());
  handler('rename',(id,title)=>{const result=library.rename(id,title);refreshLibrary([id]);return result;});handler('reader',id=>openReader(id));
  handler('storage',()=>({...library.storage(),ram:app.getAppMetrics().reduce((n,m)=>n+(m.memory?.workingSetSize||0)*1024,0)}));
  handler('cleanup-preview',options=>library.preview(options));
  const cleanupApply=async(token,parent=panel)=>{const result=await library.confirm(token,async plan=>{const result=await modal(()=>dialog.showMessageBox(parent,{type:'warning',title:'Confirmar limpeza do Memora',message:`Excluir permanentemente ${plan.files.length} arquivo(s) de ${plan.sessions.length} gravação(ões)?`,detail:`Até ${plan.date}, inclusive. Tipos: ${[plan.audio?'áudio':'',plan.transcripts?'transcrições':''].filter(Boolean).join(' e ')}. Metadados do histórico e modelos serão preservados. Esta operação não pode ser desfeita.`,buttons:['Cancelar','Excluir arquivos'],defaultId:0,cancelId:0,noLink:true}));return result.response===1;});if(!result.cancelled&&result.transcripts&&result.ids.includes(readerId))reader?.close();if(!result.cancelled)refreshLibrary(result.ids);return result;};handler('cleanup-apply',cleanupApply);

  handler('reveal',async id=>{const target=id?library.session(id).directory:store.root;const error=await shell.openPath(target);if(error)throw Error(error);});
  ipcMain.handle('workspace:open',(event,view)=>{if(event.sender!==panel.webContents)throw Error('Janela inválida.');return openWorkspace(view).then(()=>true);});
  const workspaceHandler=(name,fn)=>ipcMain.handle('workspace:'+name,(event,...args)=>{const context=requireWorkspace(event);return fn(context,...args);});
  workspaceHandler('info',({view})=>({...info(),view,panelState}));
  workspaceHandler('tags',(_context,id,tags)=>{requireIdleWorkspace();const result=library.annotations.tags(id,tags);refreshLibrary([id]);return result;});
  workspaceHandler('reader',(_context,id)=>openReader(id));
  workspaceHandler('rename',(_context,id,title)=>{requireIdleWorkspace();const result=library.rename(id,title);refreshLibrary([id]);return result;});
  workspaceHandler('transcribe',async(_context,id)=>{requireIdleWorkspace();showPanel();return store.transcribe(id);});
  workspaceHandler('reveal',async(_context,id)=>{const target=id?library.session(id).directory:store.root;const error=await shell.openPath(target);if(error)throw Error(error);});
  workspaceHandler('preferences',async({view},update)=>{if(view!=='settings')throw Error('Janela inválida.');if(Object.keys(update||{}).some(key=>key!=='popover'))requireIdleWorkspace();const result=preferences.update(update);if(update.userName!==undefined&&reader&&!reader.isDestroyed())reader.webContents.send('reader:profile',{userName:result.userName});await panel.webContents.executeJavaScript('window.applyMemoraPreferences()');workspaceChanged();return result;});
  workspaceHandler('refresh-sources',async({view})=>{if(view!=='settings')throw Error('Janela inválida.');requireIdleWorkspace(false);await panel.webContents.executeJavaScript('window.refreshMemoraSources()');return true;});
  workspaceHandler('storage',()=>({...library.storage(),ram:app.getAppMetrics().reduce((n,m)=>n+(m.memory?.workingSetSize||0)*1024,0)}));
  workspaceHandler('cleanup-preview',({view},options)=>{if(view!=='settings')throw Error('Janela inválida.');return library.preview(options);});
  workspaceHandler('cleanup-apply',({view,win},token)=>{if(view!=='settings')throw Error('Janela inválida.');return cleanupApply(token,win);});
  ipcMain.on('workspace:close',event=>{try{requireWorkspace(event).win.close();}catch{}});
  ipcMain.on('panel:state',(event,value)=>{if(event.sender!==panel.webContents||!value||typeof value!=='object')return;panelState=value;for(const win of workspaceWindows.values())if(!win.isDestroyed())win.webContents.send('workspace:state',panelState);});
  ipcMain.handle('reader:rename',(event,id,title)=>{if(!reader||event.sender!==reader.webContents)throw Error('Janela inválida.');if(id!==readerId)throw Error('A reunião mudou. Abra Renomear novamente.');requireIdleWorkspace(false);const result=library.rename(id,title);refreshLibrary([id],result);return result;});
  ipcMain.handle('reader:get',event=>{if(!reader||event.sender!==reader.webContents)throw Error('Janela inválida.');return {...library.transcript(readerId),defaultUserName:preferences.info().userName};});
  ipcMain.handle('reader:review',(event,id,revision,segmentId,selection)=>{if(!reader||event.sender!==reader.webContents||id!==readerId)throw Error('Janela inválida.');requireIdleWorkspace(false);const result=library.annotations.review(readerId,revision,segmentId,selection,preferences.info().userName);workspaceChanged();readerFingerprint=null;return {...result,defaultUserName:preferences.info().userName};});
  ipcMain.handle('reader:marker-add',(event,id,revision,timeMs,label)=>{if(!reader||event.sender!==reader.webContents||id!==readerId)throw Error('Janela inválida.');const data=library.transcript(readerId);if(data.revision!==revision)throw Error('A transcrição mudou. Reabra o marcador.');library.annotations.addMarker(readerId,timeMs,label);workspaceChanged();return library.annotations.notes(readerId).markers;});
  ipcMain.handle('reader:marker-remove',(event,sessionId,id)=>{if(!reader||event.sender!==reader.webContents||sessionId!==readerId)throw Error('Janela inválida.');const result=library.annotations.removeMarker(readerId,id);workspaceChanged();return result;});
  ipcMain.handle('reader:block',(event,...args)=>{if(!reader||event.sender!==reader.webContents)throw Error('Janela inválida.');return library.block(readerId,...args);});
  ipcMain.handle('reader:phrase',(event,...args)=>{if(!reader||event.sender!==reader.webContents)throw Error('Janela inválida.');return library.phrase(readerId,...args);});
  ipcMain.handle('reader:name',(event,...args)=>{if(!reader||event.sender!==reader.webContents)throw Error('Janela inválida.');return library.nameSpeaker(readerId,...args);});
  ipcMain.handle('reader:sample',(event,...args)=>{if(!reader||event.sender!==reader.webContents)throw Error('Janela inválida.');return library.sample(readerId,...args);});
  ipcMain.on('reader:close',event=>{if(reader&&event.sender===reader.webContents)reader.close();});
  ipcMain.on('monitor:status',(event,value)=>{if(event.sender!==panel.webContents)return;try{monitorStatus.update(value,{recording:Boolean(store.active),transcribing:Boolean(store.job),backend:store.config.backend||'legacy',backendReady:store.checkConfig().ready,buildId:runtimeBuild?.id,bundlePath:runtimeBuild?.bundle});}catch(error){console.error('Falha no diagnóstico de níveis:',error.message);}});
  ipcMain.on('record:status',(event,value)=>{if(event.sender!==panel.webContents)return;recording=value===true;updateTray();if(recording)feedback('started');});
  ipcMain.on('record:feedback',(event,phase)=>{if(event.sender===panel.webContents&&['starting','saving','error'].includes(phase))feedback(phase);});
  ipcMain.on('panel:resize',(event,height)=>{if(event.sender!==panel.webContents||!Number.isFinite(height))return;const area=screen.getDisplayNearestPoint(tray.getBounds()).workArea;const desired=Math.min(area.height-12,Math.max(240,Math.ceil(height)+1));if(panel.getSize()[1]!==desired)panel.setSize(380,desired);if(panel.isVisible())position(panel);});
  ipcMain.on('app:quit',event=>{if(event.sender===panel.webContents)app.quit();});
  capture.onExit=()=>{if(!panel.isDestroyed())panel.webContents.send('record:capture-ended');};
  panel.webContents.on('render-process-gone',()=>{store.close();capture.close();recording=false;updateTray();});
  panel.webContents.on('console-message',(_event,details)=>console.log('renderer:',details.message));
  await panel.loadFile(path.join(__dirname,'index.html'));actionsReady();if(!smoke)void dispatchTranscriptionRequest(process.argv);console.log('Memora iniciado · Electron',process.versions.electron);console.log('ATALHO',JSON.stringify({registered:preferences.info().registered,error:preferences.info().error,simulated:smoke}));
  if(smoke){try{
   const startupHidden=!panel.isVisible();showPanel();await panel.webContents.executeJavaScript("new Promise((resolve,reject)=>{const start=Date.now();const poll=()=>window.runInterfaceDiagnostics?resolve():Date.now()-start>10000?reject(Error('Interface não carregou')):setTimeout(poll,50);poll();})");
   console.log('SMOKE_STAGE fixture');const id=createFixture();await panel.webContents.executeJavaScript('window.refreshMemora()');
   console.log('SMOKE_STAGE interface');const report=await panel.webContents.executeJavaScript(`window.runInterfaceDiagnostics(${JSON.stringify(id)})`,true);
   library.rename(id,'Reunião de exemplo');await panel.webContents.executeJavaScript('window.refreshMemora()');
   await panel.webContents.executeJavaScript("document.getElementById('transcription-profile').textContent='Transcrição automática · large-v3 + falantes';document.getElementById('record-message').textContent='Transcrição pronta.';");
   await panel.webContents.executeJavaScript("document.getElementById('latest-rename').click()");panel.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});panel.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await new Promise(r=>setTimeout(r,100));report.renameEscape=panel.isVisible()&&await panel.webContents.executeJavaScript("document.getElementById('latest-rename-form').hidden&&document.activeElement.id==='latest-rename'");panel.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});panel.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await new Promise(r=>setTimeout(r,100));report.panelEscape=!panel.isVisible();showPanel();
   console.log('SMOKE_STAGE meter');report.meter=await panel.webContents.executeJavaScript('window.runMeterDiagnostics()',true);
   if(environmentValue('MEMORA_RECORD_TEST')){report.recording=await panel.webContents.executeJavaScript('window.runRecordingDiagnostics()',true);report.nextRecording=await runInterruptionSmoke();}
   console.log('SMOKE_STAGE processing');report.processing=await panel.webContents.executeJavaScript('window.runProcessingDiagnostics()',true);await new Promise(r=>setTimeout(r,120));fs.writeFileSync(path.join(app.getPath('userData'),'processing.png'),(await panel.webContents.capturePage()).toPNG());await panel.webContents.executeJavaScript("document.getElementById('processing-details').open=true;document.getElementById('preview-details').open=true");await new Promise(r=>setTimeout(r,120));fs.writeFileSync(path.join(app.getPath('userData'),'processing-expanded.png'),(await panel.webContents.capturePage()).toPNG());await panel.webContents.executeJavaScript('window.endProcessingDiagnostics()');
   showPanel();const original=panel.isVisible();panel.emit('blur');report.popover={startupHidden,wasVisible:original,closesOutside:!panel.isVisible(),allSpaces:panel.isVisibleOnAllWorkspaces()};panel.removeListener('blur',closeOnBlur);showPanel();await new Promise(r=>setTimeout(r,150));
   if(environmentValue('MEMORA_RECORD_TEST')){report.feedback=await notice.webContents.executeJavaScript("document.getElementById('feedback-title').textContent");fs.writeFileSync(path.join(app.getPath('userData'),'feedback.png'),(await notice.webContents.capturePage()).toPNG());}
   fs.writeFileSync(path.join(app.getPath('userData'),'panel.png'),(await panel.webContents.capturePage()).toPNG());
   console.log('SMOKE_STAGE workspaces');report.workspaces=await runWorkspaceSmoke();
   await openReader(id);await reader.webContents.executeJavaScript("new Promise(resolve=>{const poll=()=>window.readerReady?resolve():setTimeout(poll,20);poll();})");report.reader=await reader.webContents.executeJavaScript('window.readerDiagnostics()');fs.writeFileSync(path.join(app.getPath('userData'),'reader.png'),(await reader.webContents.capturePage()).toPNG());report.readerWindow={maximized:reader.isMaximized(),fullscreen:reader.isFullScreen(),allSpaces:reader.isVisibleOnAllWorkspaces(),minimizable:reader.isMinimizable(),dock:app.dock?.isVisible(),bounds:reader.getBounds(),workArea:screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea};
   console.log('SMOKE_STAGE reader');report.readerRename=await runReaderRenameSmoke(id);
   report.organization=await require('./organization-smoke.cjs')({smoke,store,library,preferences,id,openReader,getReader:()=>reader,openWorkspace,directory:app.getPath('userData')});console.log('SMOKE_ORGANIZATION',JSON.stringify(report.organization));
   report.playback=await reader.webContents.executeJavaScript('window.readerPlaybackDiagnostics()',true);
   reader.minimize();await new Promise(r=>setTimeout(r,450));const minimized=reader.isMinimized();app.emit('activate');await new Promise(r=>setTimeout(r,250));report.readerRestore={minimized,restored:!reader.isMinimized()&&reader.isVisible(),sameSession:readerId===id};
   reader.unmaximize();reader.setSize(640,650);await new Promise(r=>setTimeout(r,100));report.readerNarrow=await reader.webContents.executeJavaScript('window.readerDiagnostics()');fs.writeFileSync(path.join(app.getPath('userData'),'reader-narrow.png'),(await reader.webContents.capturePage()).toPNG());
   await reader.webContents.executeJavaScript("for(const detail of document.querySelectorAll('.block-segments'))detail.open=true");await new Promise(r=>setTimeout(r,100));report.readerExpanded=await reader.webContents.executeJavaScript('window.readerDiagnostics()');fs.writeFileSync(path.join(app.getPath('userData'),'reader-expanded.png'),(await reader.webContents.capturePage()).toPNG());
   library.rename(id,'Leitor atualizado após renomear');await openReader(id);await new Promise(r=>setTimeout(r,150));report.readerRefresh=await reader.webContents.executeJavaScript("document.getElementById('reader-title').textContent==='Leitor atualizado após renomear'");
   reader.close();await openReader(id);report.readerReopened={open:Boolean(reader&&!reader.isDestroyed()),maximized:reader.isMaximized(),fullscreen:reader.isFullScreen()};
   report.shortcut={...preferences.info(),registrationSimulated:true};report.realCapture=false;fs.writeFileSync(path.join(app.getPath('userData'),'smoke.json'),JSON.stringify(report,null,2));console.log('SMOKE',JSON.stringify(report));capture.close();app.exit(report.organization.passed&&report.readerRename.passed&&report.workspaces.passed&&report.passed&&report.renameEscape&&report.panelEscape&&report.processing.passed&&report.meter.passed&&report.reader.passed&&!report.readerNarrow.overflow&&!report.readerExpanded.overflow&&report.readerRefresh&&report.playback.passed&&report.readerRestore.minimized&&report.readerRestore.restored&&!report.readerWindow.maximized&&!report.readerWindow.allSpaces&&(!report.recording||report.recording.passed)&&(!report.nextRecording||report.nextRecording.passed)&&Object.values(report.popover).every(Boolean)?0:1);
  }catch(error){console.error(error);capture.close();app.exit(1);}}
 }).catch(error=>{console.error(error);app.exit(1);});
}
function createFixture(){const fixture=store.begin([{key:'microphone',label:'Áudio de exemplo (sem microfone)'}]);const data=Buffer.alloc(32000*12);for(let i=0;i<16000*12;i++)data.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/16000)*1000),i*2);for(let offset=0,sequence=0;offset<data.length;offset+=32000)store.append(fixture.id,sequence++,{microphone:data.subarray(offset,offset+32000)});store.finish(fixture.id);const s=store.sessions.get(fixture.id);s.metadata.title='Planejamento da semana · exemplo';s.metadata.status='completed';store.persist(s);fs.writeFileSync(path.join(s.directory,'transcript.json'),JSON.stringify({resultId:'smoke-blocks',speakers:[{id:'local-fixture',label:'Falante 1'},{id:'remote-fixture',label:'Falante 2'}],segments:[{source:'microphone',speakerId:'local-fixture',startMs:0,endMs:2000,text:'Vamos organizar as prioridades.'},{source:'microphone',speakerId:'local-fixture',startMs:2200,endMs:6000,text:'Cada etapa terá uma pessoa responsável.'},{source:'computer',speakerId:'remote-fixture',uncertain:true,startMs:6200,endMs:12000,text:'Podemos começar pela revisão da proposta e depois confirmar as pendências.'}]}),{mode:0o600});return fixture.id;}
async function runReaderRenameSmoke(id){
 if(!smoke||store.active||store.job)throw Error('Diagnóstico exige perfil isolado ocioso.');
 const saved=library.session(id),title=library.transcript(id).title,files=['microphone.wav','transcript.json'],before=files.map(file=>fs.readFileSync(path.join(saved.directory,file))),report={};
 const history=await openWorkspace('history');await history.webContents.executeJavaScript("new Promise(resolve=>{const poll=()=>window.workspaceReady?resolve():setTimeout(poll,20);poll();})");
 const date=new Date(saved.metadata.startedAt),day=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
 await history.webContents.executeJavaScript(`window.selectWorkspaceFixture(${JSON.stringify(day)})`);restoreReader();
 const evaluate=code=>reader.webContents.executeJavaScript(code,true),settle=()=>new Promise(resolve=>setTimeout(resolve,200));
 report.edit=await evaluate(`(()=>{const $=id=>document.getElementById(id);$('reader-rename').click();return !$('reader-rename-form').hidden&&document.activeElement.id==='reader-rename-title'&&$('reader-rename-title').selectionEnd===$('reader-rename-title').value.length;})()`);
 await settle();fs.writeFileSync(path.join(app.getPath('userData'),'reader-rename.png'),(await reader.webContents.capturePage()).toPNG());
 report.cancel=await evaluate(`(()=>{const $=id=>document.getElementById(id);$('reader-rename-title').value='Não salvar';$('reader-rename-cancel').click();return $('reader-rename-form').hidden&&document.activeElement.id==='reader-rename';})()`);
 report.escape=await evaluate(`(()=>{const $=id=>document.getElementById(id);$('reader-rename').click();window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return $('reader-rename-form').hidden&&document.activeElement.id==='reader-rename';})()`);
 report.invalid=await evaluate(`(async()=>{const $=id=>document.getElementById(id);$('reader-rename').click();$('reader-rename-title').value='   ';await $('reader-rename-form').onsubmit({preventDefault(){}});return !$('reader-rename-form').hidden&&$('reader-rename-state').dataset.error==='true'&&!$('reader-rename-save').disabled;})()`);
 const newTitle='Reunião <img> · revisão no leitor';
 await evaluate(`(async()=>{const audio=document.getElementById('phrase-audio');audio.muted=true;window.renameSmokeBlock=document.querySelector('.transcript-block');document.querySelector('.block-segments').open=true;document.querySelector('.block-play').click();const until=Date.now()+5000;while(audio.paused||!audio.currentTime){if(Date.now()>until)throw Error('Timeout de reprodução');await new Promise(resolve=>setTimeout(resolve,25));}})()`);
 report.saved=await evaluate(`(async()=>{const $=id=>document.getElementById(id);$('reader-rename-title').value=${JSON.stringify(newTitle)};await $('reader-rename-form').onsubmit({preventDefault(){}});return $('reader-rename-form').hidden&&$('reader-title').textContent===${JSON.stringify(newTitle)}&&!$('reader-title').querySelector('img')&&document.title===${JSON.stringify(newTitle+' · Memora')};})()`);
 await settle();const latestTitle=library.list()[0].title;report.panel=await panel.webContents.executeJavaScript(`document.getElementById('latest-title').textContent===${JSON.stringify(latestTitle)}&&Array.from(document.getElementById('record-history').options).some(option=>option.value===${JSON.stringify(id)}&&option.textContent.includes(${JSON.stringify(newTitle)}))`);report.history=await history.webContents.executeJavaScript(`document.querySelector('[data-id="${id}"] .recording-title')?.textContent===${JSON.stringify(newTitle)}`);
 report.readerStatePreserved=await evaluate(`(()=>{const preserved=window.renameSmokeBlock===document.querySelector('.transcript-block')&&document.querySelector('.block-segments').open&&!document.getElementById('phrase-audio').paused;document.getElementById('playback-stop').click();document.querySelector('.block-segments').open=false;delete window.renameSmokeBlock;return preserved;})()`);
 report.persisted=JSON.parse(fs.readFileSync(path.join(saved.directory,'session.json'))).title===newTitle;
 report.stale=await evaluate(`window.reader.rename('stale-session','Não salvar').then(()=>false,error=>error.message.includes('reunião mudou'))`);
 const prior=panelState;try{panelState={...panelState,busy:true};report.busy=await evaluate(`window.reader.rename(${JSON.stringify(id)},'Não salvar').then(()=>false,error=>error.message.includes('Aguarde'))`);}finally{panelState=prior;}
 const [width,height]=reader.getSize();reader.setSize(640,650);await evaluate("document.getElementById('reader-rename').click()");await settle();report.narrow=await evaluate('document.documentElement.scrollWidth<=innerWidth');fs.writeFileSync(path.join(app.getPath('userData'),'reader-rename-narrow.png'),(await reader.webContents.capturePage()).toPNG());await evaluate("document.getElementById('reader-rename-cancel').click()");reader.setSize(width,height);
 report.filesUnchanged=files.every((file,index)=>before[index].equals(fs.readFileSync(path.join(saved.directory,file))));
 library.rename(id,title);refreshLibrary([id]);await settle();history.close();restoreReader();report.passed=Object.values(report).every(Boolean);return report;
}
async function runWorkspaceSmoke(){
 if(!smoke||store.active||store.job)throw Error('Diagnóstico exige perfil isolado ocioso.');
 const {randomUUID}=require('node:crypto');
 const day='2026-11-09',fixtures={day};
 const make=(key,title,hour,hasTranscript,hasAudio)=>{
  let entry=[...store.sessions.values()].find(value=>value.metadata.windowFixture===key);
  if(!entry){const id=randomUUID(),directory=path.join(store.root,'window-fixture-'+id);fs.mkdirSync(directory,{recursive:true,mode:0o700});entry={directory,metadata:{schemaVersion:1,id,windowFixture:key,sampleRate:16000,samples:192000,sources:[{key:'microphone',label:'Sinal sintético'}]}};store.sessions.set(id,entry);}
  Object.assign(entry.metadata,{title,startedAt:new Date(2026,10,9,hour,0).toISOString(),durationMs:12000,status:hasTranscript?'completed':hasAudio?'saved':'cleaned'});store.persist(entry);
  if(hasTranscript)fs.writeFileSync(path.join(entry.directory,'transcript.json'),JSON.stringify({segments:[{source:'microphone',startMs:0,endMs:12000,text:'Conteúdo fictício para testar as janelas.'}]}),{mode:0o600});
  if(hasAudio&&!fs.existsSync(path.join(entry.directory,'microphone.wav'))){const {wavHeader}=require('./recordings.cjs'),bytes=Buffer.alloc(384000);fs.writeFileSync(path.join(entry.directory,'microphone.wav'),Buffer.concat([wavHeader(bytes.length),bytes]),{mode:0o600});}
  fixtures[key]=entry.metadata.id;
 };
 make('transcribed','Planejamento da semana',9,true,true);make('noTranscript','Ideias para o projeto',11,false,true);make('noAudio','Registro sem arquivos',15,false,false);
 const waitReady=win=>win.webContents.executeJavaScript("new Promise((resolve,reject)=>{const start=Date.now();const poll=()=>window.workspaceReady?resolve():Date.now()-start>10000?reject(Error('Janela não carregou')):setTimeout(poll,25);poll();})");
 const snap=async(win,file)=>{await new Promise(resolve=>setTimeout(resolve,120));fs.writeFileSync(path.join(app.getPath('userData'),file),(await win.webContents.capturePage()).toPNG());};
 const history=await openWorkspace('history');await waitReady(history);
 const historyResult=await history.webContents.executeJavaScript(`window.exerciseWorkspace(${JSON.stringify(fixtures)})`,true);
 historyResult.readerOpened=readerId===fixtures.transcribed;historyResult.singleWindow=history===await openWorkspace('history');historyResult.normalWindow=!history.isVisibleOnAllWorkspaces()&&history.isMinimizable()&&!history.isFullScreen();
 await history.webContents.executeJavaScript(`window.selectWorkspaceFixture(${JSON.stringify(day)})`);await snap(history,'history.png');
 history.setSize(700,540);await snap(history,'history-narrow.png');historyResult.narrow=await history.webContents.executeJavaScript('window.workspaceDiagnostics()');
 await history.webContents.executeJavaScript("window.selectWorkspaceFixture('2001-01-02')");await snap(history,'history-empty.png');
 const settings=await openWorkspace('settings');await waitReady(settings);const settingsResult=await settings.webContents.executeJavaScript('window.exerciseWorkspace()',true);await snap(settings,'settings.png');
 settings.setSize(620,600);await snap(settings,'settings-narrow.png');settingsResult.narrow=await settings.webContents.executeJavaScript('window.workspaceDiagnostics()');
 await settings.webContents.executeJavaScript("document.getElementById('cleanup-settings').open=true;document.getElementById('cleanup-settings').scrollIntoView()");await snap(settings,'cleanup.png');
 settingsResult.noCaptureAPI=await settings.webContents.executeJavaScript("!window.memoraRecording&&!('recordBegin' in window.memora)&&!('recordCaptureStart' in window.memora)");
 history.minimize();await new Promise(resolve=>setTimeout(resolve,200));await openWorkspace('history');historyResult.restore=!history.isMinimized()&&history.isVisible();
 const closed=Promise.all([settings,history].map(win=>new Promise(resolve=>{win.once('closed',resolve);win.close();})));await closed;const reopened=await openWorkspace('history');await waitReady(reopened);historyResult.reopens=reopened!==history;reopened.close();
 return {history:historyResult,settings:settingsResult,passed:historyResult.passed&&historyResult.readerOpened&&historyResult.singleWindow&&historyResult.normalWindow&&historyResult.narrow.noOverflow&&historyResult.restore&&historyResult.reopens&&settingsResult.passed&&settingsResult.narrow.noOverflow&&settingsResult.noCaptureAPI,realCapture:false};
}
async function runInterruptionSmoke(){
 if(!smoke||store.active||store.job)throw Error('Diagnóstico exige perfil isolado ocioso.');
 const id=createFixture(),session=store.sessions.get(id),priorConfig={...store.config},priorSpawn=store.spawn,priorDialog=dialog.showMessageBox;
 const audio=fs.readFileSync(path.join(session.directory,'microphone.wav')),transcript=fs.readFileSync(path.join(session.directory,'transcript.json'));
 const model=path.join(app.getPath('userData'),'fixture-model');fs.writeFileSync(model,'diagnostic only');
 let prompts=0,child,readyResolve;const ready=new Promise(resolve=>{readyResolve=resolve;});
 store.configure({backend:'legacy',binary:process.execPath,model});
 store.spawn=(_binary,_args,options)=>{child=require('node:child_process').spawn(process.execPath,['-e',"process.on('SIGTERM',()=>setTimeout(()=>process.exit(0),80));console.error('READY');setInterval(()=>{},1000)"],{...options,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});child.stderr.on('data',()=>readyResolve());return child;};
 dialog.showMessageBox=async(_parent,options)=>{if(options.message!=='Deseja interromper a transcrição atual para iniciar outra gravação?'||options.defaultId!==0||options.cancelId!==0||!options.detail.includes('preservados'))throw Error('Confirmação incompleta.');prompts++;await new Promise(resolve=>setTimeout(resolve,80));return {response:prompts===1?0:1};};
 const job=store.transcribe(id);job.catch(()=>{});
 try{
  await ready;await panel.webContents.executeJavaScript('window.refreshMemora()');
  console.log('SMOKE_STAGE interface');const report=await panel.webContents.executeJavaScript('window.runNextRecordingDiagnostics()',true);await job;
  report.previousFilesUnchanged=audio.equals(fs.readFileSync(path.join(session.directory,'microphone.wav')))&&transcript.equals(fs.readFileSync(path.join(session.directory,'transcript.json')));
  report.twoPromptsOnly=prompts===2;report.processExited=child.exitCode!==null||child.signalCode!==null;report.confirmationResponsesSimulated=true;
  report.passed=report.passed&&report.previousFilesUnchanged&&report.twoPromptsOnly&&report.processExited;return report;
 }finally{
  if(store.job){store.cancel();await job;}dialog.showMessageBox=priorDialog;store.spawn=priorSpawn;store.configure(priorConfig);await panel.webContents.executeJavaScript('window.refreshMemora()');
 }
}
let captureShutdown=false;
app.on('before-quit',event=>{if(captureShutdown)return;event.preventDefault();app.isQuitting=true;try{monitorStatus?.update({mode:'closed',message:'Aplicativo encerrado'},{recording:Boolean(store?.active)});}catch{}mcp?.close();preferences?.close();clearTimeout(noticeTimer);void Promise.all([capture.close(),store?.shutdown()]).finally(()=>{captureShutdown=true;app.quit();});});
process.on('exit',()=>{mcp?.close();store?.close();capture.close();});app.on('window-all-closed',()=>{});
function icon(){const size=36,pixels=Buffer.alloc(size*size*4);for(let x=0;x<size;x++)for(let y=0;y<size;y++)if([[5,9],[12,20],[19,28],[26,15]].some(([left,h])=>x>=left&&x<left+4&&Math.abs(y-18)<=h/2))pixels[(y*size+x)*4+3]=255;const image=nativeImage.createFromBitmap(pixels,{width:size,height:size,scaleFactor:2});image.setTemplateImage(true);return image;}
