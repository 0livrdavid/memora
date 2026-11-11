const fs=require('node:fs');
// Signals for review, never a reason to remove words or identify speakers.
function qualityOf(segments,durationMs,audioFiles={}) {
 const reasons=[],counts=new Map();let run=0,longestRun=0,previous='',silentTextSegments=0,outOfRange=0;
 for(const s of segments){
  const text=s.text.trim().replace(/\s+/g,' ').toLocaleLowerCase();
  if(text.length>=8){counts.set(text,(counts.get(text)||0)+1);run=text===previous?run+1:1;longestRun=Math.max(longestRun,run);}else run=0;
  previous=text;if(s.endMs>durationMs+1000)outOfRange++;
  const file=audioFiles[s.source],start=Math.floor(s.startMs*32),end=Math.min(Math.floor(s.endMs*32),Math.floor(durationMs*32));
  if(file&&end-start>=16000){const fd=fs.openSync(file,'r');try{const buffer=Buffer.alloc(32768);let signal=false;for(let pos=start;pos<end&&!signal;){const n=fs.readSync(fd,buffer,0,Math.min(buffer.length,end-pos),44+pos);if(!n)break;signal=buffer.subarray(0,n).some(v=>v!==0);pos+=n;}if(!signal)silentTextSegments++;}finally{fs.closeSync(fd);}}
 }
 const mostRepeated=Math.max(0,...counts.values());
 if(longestRun>=5||(mostRepeated>=5&&mostRepeated/Math.max(1,segments.length)>=0.5))reasons.push('Repetição incomum de texto; pode ser um loop do Whisper ou fala repetida.');
 if(silentTextSegments)reasons.push(`Texto atribuído a ${silentTextSegments} trecho(s) de silêncio digital; possível alucinação.`);
 if(outOfRange)reasons.push('Há timestamps além da duração do áudio.');
 return {needsReview:reasons.length>0,reasons,longestRepeatedRun:longestRun,mostRepeated,silentTextSegments,outOfRange};
}
module.exports={qualityOf};
