const fs=require('node:fs'),path=require('node:path');
const text=(value,max=300)=>typeof value==='string'?value.slice(0,max):'';
const number=(value,max=1e12)=>Number.isFinite(value)&&value>=0?Math.min(value,max):0;
class MonitorStatus{
 constructor(file,{clock=Date.now,pid=process.pid}={}){this.file=file;this.clock=clock;this.pid=pid;this.last=-Infinity;this.mode='';}
 update(value,actual={}){
  if(!value||typeof value!=='object'||JSON.stringify(value).length>8000)return false;
  const mode=['monitoring','preparing','idle','error','closed','recording'].includes(value.mode)?value.mode:'error';
  const now=this.clock();if(now-this.last<1000&&mode===this.mode)return false;
  const g=value.graph||{},m=g.metrics||{};
  // Explicit whitelist. Audio buffers, transcript content and arbitrary keys are never persisted.
  const result={at:new Date(now).toISOString(),pid:this.pid,mode,recording:actual.recording===true,transcribing:actual.transcribing===true,transcription:{backend:['legacy','experimental'].includes(actual.backend)?actual.backend:'unknown',selectedOption:['legacy','experimental'].includes(value.transcription?.selectedOption)?value.transcription.selectedOption:'unknown',ready:actual.backendReady===true,profileMatches:value.transcription?.profileMatches===true,buildId:text(actual.buildId,120),bundlePath:text(actual.bundlePath,1024)},message:text(value.message),levels:{microphone:number(value.levels?.microphone,1),computer:number(value.levels?.computer,1)},dom:{microphone:number(value.dom?.microphone,1),computer:number(value.dom?.computer,1)},selection:{microphone:text(value.selection?.microphone),computer:text(value.selection?.computer)},graph:{active:g.active===true,revision:number(g.revision),contextState:text(m.contextState,30),contextTime:number(m.contextTime),sources:Array.isArray(m.sources)?m.sources.slice(0,2).map(s=>({key:['microphone','computer'].includes(s.key)?s.key:'unknown',label:text(s.label),sampleRate:number(s.sampleRate,384000),channelCount:number(s.channelCount,64),muted:s.muted===true,readyState:text(s.readyState,20),windows:number(s.windows),nonzeroWindows:number(s.nonzeroWindows),zeroWindows:number(s.zeroWindows),tapUID:text(s.tapUID),sourceUID:text(s.sourceUID)})):[]}};
  result.ui={separateWindows:value.ui?.separateWindows===true,shortcutCollapsed:value.ui?.shortcutCollapsed===true,cleanupInHistory:value.ui?.cleanupInHistory===true,modelControlsRemoved:value.ui?.modelControlsRemoved===true,progressVisible:value.ui?.progressVisible===true,previewCount:number(value.ui?.previewCount,60),processingSessionId:/^[a-f0-9-]{36}$/.test(value.ui?.processingSessionId||'')?value.ui.processingSessionId:'',overflow:value.ui?.overflow===true};
  fs.mkdirSync(path.dirname(this.file),{recursive:true,mode:0o700});const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(result,null,2),{mode:0o600});fs.chmodSync(tmp,0o600);fs.renameSync(tmp,this.file);this.last=now;this.mode=mode;return true;
 }
}
module.exports={MonitorStatus};
