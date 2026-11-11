const {contextBridge,ipcRenderer}=require('electron');
const invoke=(name,...args)=>ipcRenderer.invoke(`record:${name}`,...args);
contextBridge.exposeInMainWorld('memoraRecording',{
 openWindow:view=>ipcRenderer.invoke('workspace:open',view),workspaceState:value=>ipcRenderer.send('panel:state',value),onRefresh:fn=>ipcRenderer.on('record:refresh',fn),
 recordMark:()=>invoke('mark-moment'),onMarkerAdded:fn=>ipcRenderer.on('record:marker-added',(_event,value)=>fn(value)),
 recordInfo:()=>invoke('info'),preferences:update=>invoke('preferences',update),
 devices:()=>invoke('devices'),recordCaptureStart:uid=>invoke('capture-start',uid),recordCaptureStop:()=>invoke('capture-stop'),recordCaptureValidate:identity=>invoke('capture-validate',identity),
 recordPrepare:()=>invoke('prepare'),recordRelease:token=>invoke('release',token),recordBegin:(sources,token)=>invoke('begin',sources,token),recordAppend:(id,sequence,chunks)=>invoke('append',id,sequence,chunks),recordFinish:(id,error,automatic=true)=>invoke('finish',id,error,automatic),recordTranscribe:id=>invoke('transcribe',id),recordCancel:()=>invoke('cancel'),
 recordRename:(id,title)=>invoke('rename',id,title),recordReader:id=>invoke('reader',id),recordReveal:id=>invoke('reveal',id),storage:()=>invoke('storage'),cleanupPreview:options=>invoke('cleanup-preview',options),cleanupApply:token=>invoke('cleanup-apply',token),
 onRecordUpdate:fn=>ipcRenderer.on('record:update',(_event,value)=>fn(value)),onRecordCaptureEnded:fn=>ipcRenderer.on('record:capture-ended',fn),onRecordToggle:fn=>ipcRenderer.on('record:toggle',fn),
 monitorStatus:value=>ipcRenderer.send('monitor:status',value),
 recordStatus:value=>ipcRenderer.send('record:status',value),feedback:phase=>ipcRenderer.send('record:feedback',phase),resize:height=>ipcRenderer.send('panel:resize',height),quit:()=>ipcRenderer.send('app:quit')
});
