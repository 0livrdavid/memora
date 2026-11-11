export function recordingLabel(item,{locale='pt-BR',timeZone}={}){
 const format=value=>{if(typeof value!=='string'||!value.trim()||!Number.isFinite(Date.parse(value)))return null;return new Intl.DateTimeFormat(locale,{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',...(timeZone?{timeZone}:{})}).format(new Date(value));};
 const duration=Number.isFinite(item.durationMs)&&item.durationMs>=0?(()=>{const s=Math.floor(item.durationMs/1000);return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(n=>String(n).padStart(2,'0')).join(':');})():'duração indisponível';
 const end=format(item.endedAt),invalidOrder=end&&format(item.startedAt)&&Date.parse(item.endedAt)<Date.parse(item.startedAt);
 return `${format(item.startedAt)||'Início não registrado'} → ${invalidOrder?'fim inconsistente':end||(item.status==='recording'?'em andamento':'fim não registrado')} · ${duration}${item.title?' · '+item.title:''}`;
}
