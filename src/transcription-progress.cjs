const {StringDecoder}=require('node:string_decoder');
const STAGES=['preparation','transcription','speakers','finalization'];
function acceptProgress(store,session,job,attempt,event){
 if(store.job!==job||job.cancelled||!event||typeof event!=='object'||event.sessionId!==undefined&&event.sessionId!==session.metadata.id||event.attempt!==undefined&&event.attempt!==attempt)return false;
 if(typeof event.phase!=='string'||!event.phase||event.phase.length>120)return false;
 const stage=STAGES.includes(event.stage)?event.stage:'preparation';
 const progress={stage,phase:event.phase,attempt,updatedAt:new Date().toISOString()};
 const expectedTotal=session.metadata.durationMs*session.metadata.sources.length;
 if(stage==='transcription'&&Number.isFinite(event.processedMs)&&Number.isFinite(event.totalMs)&&event.totalMs>0&&Math.abs(event.totalMs-expectedTotal)<=session.metadata.sources.length&&event.processedMs>=0&&event.processedMs<=event.totalMs){
  progress.processedMs=Math.max(job.processedMs||0,event.processedMs);job.processedMs=progress.processedMs;progress.totalMs=event.totalMs;progress.percent=Math.floor(progress.processedMs/event.totalMs*100);
 }
 const p=event.preview;
 if(stage==='transcription'&&p&&session.metadata.sources.some(s=>s.key===p.source)&&typeof p.text==='string'&&p.text.trim()&&Number.isFinite(p.startMs)&&Number.isFinite(p.endMs)&&p.startMs>=0&&p.startMs<=p.endMs&&p.endMs<=session.metadata.durationMs+200){
  job.preview.push({source:p.source,startMs:p.startMs,endMs:p.endMs,text:p.text.slice(0,2000)});
  while(job.preview.length>60||job.preview.reduce((n,x)=>n+x.text.length,0)>24000)job.preview.shift();
 }
 session.metadata.progress=progress;store.persist(session);store.notify({...session.metadata,processing:store.processing()});return true;
}
function progressLines(onEvent){
 const decoder=new StringDecoder('utf8');let line='',discard=false;
 return data=>{for(const char of decoder.write(data)){if(char==='\n'){if(!discard&&line.startsWith('MEMORA_PROGRESS '))try{onEvent(JSON.parse(line.slice(16)));}catch{}line='';discard=false;}else if(!discard){line+=char;if(line.length>32768){line='';discard=true;}}}};
}
module.exports={STAGES,acceptProgress,progressLines};
