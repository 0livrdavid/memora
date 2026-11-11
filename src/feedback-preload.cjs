const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('feedback',{onChange:fn=>ipcRenderer.on('feedback',(_event,value)=>fn(value))});
