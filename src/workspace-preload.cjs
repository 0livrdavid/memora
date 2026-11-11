const {contextBridge,ipcRenderer}=require('electron');
const invoke=(name,...args)=>ipcRenderer.invoke('workspace:'+name,...args);
contextBridge.exposeInMainWorld('memora',{
 tags:(id,tags)=>invoke('tags',id,tags),info:()=>invoke('info'),rename:(id,title)=>invoke('rename',id,title),reader:id=>invoke('reader',id),transcribe:id=>invoke('transcribe',id),reveal:id=>invoke('reveal',id),
 preferences:update=>invoke('preferences',update),refreshSources:()=>invoke('refresh-sources'),storage:()=>invoke('storage'),cleanupPreview:options=>invoke('cleanup-preview',options),cleanupApply:token=>invoke('cleanup-apply',token),
 changed:fn=>ipcRenderer.on('workspace:changed',()=>fn()),state:fn=>ipcRenderer.on('workspace:state',(_event,value)=>fn(value)),close:()=>ipcRenderer.send('workspace:close')
});
