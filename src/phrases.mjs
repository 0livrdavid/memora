export function phrases(segments){
 return segments.flatMap((segment,segmentIndex)=>{
  if(segment.speakerId)return [{...segment,segmentIndex,approximate:Boolean(segment.approximate)}];
  const parts=segment.text.trim().split(/(?<=[.!?])\s+(?=[\p{Lu}\d])/u).filter(Boolean);
  const weights=parts.map(text=>text.split(/\s+/).length),total=weights.reduce((a,b)=>a+b,0);let offset=0;
  return parts.map((text,i)=>{const startMs=i===0?segment.startMs:segment.startMs+(segment.endMs-segment.startMs)*offset/total;offset+=weights[i];const endMs=i===parts.length-1?segment.endMs:segment.startMs+(segment.endMs-segment.startMs)*offset/total;return {text,segmentIndex,source:segment.source,startMs,endMs,approximate:parts.length>1};});
 });
}
export function timestamp(ms){const seconds=Math.max(0,Math.floor(ms/1000));return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(n=>String(n).padStart(2,'0')).join(':');}
