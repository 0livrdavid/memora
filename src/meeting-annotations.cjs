const fs=require('node:fs'),path=require('node:path');const {randomUUID,createHash}=require('node:crypto');
function read(file,empty){try{const s=fs.lstatSync(file);if(!s.isFile()||s.size>2*1024*1024)throw Error('Anotações inválidas.');const value=JSON.parse(fs.readFileSync(file,'utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch(e){if(e.code==='ENOENT')return structuredClone(empty);throw Error('Não foi possível ler as anotações desta gravação. O arquivo existente foi preservado.');}}
function write(file,data){if(fs.existsSync(file)&&!fs.lstatSync(file).isFile())throw Error('Arquivo de anotações inválido.');const tmp=file+'.'+randomUUID()+'.tmp';let fd;try{fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(data,null,2));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(tmp,file);}catch(e){if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(tmp);}catch{}throw e;}}
const emptyNotes={schemaVersion:1,tags:[],markers:[]},emptyReview={schemaVersion:1,byRevision:{}};
function cleanText(value,max,label){if(typeof value!=='string'||value.trim().length>max||/[\x00-\x1f]/.test(value))throw Error(label+' inválido.');return value.normalize('NFKC').trim().replace(/\s+/g,' ');}
function normalizeTags(tags){if(!Array.isArray(tags)||tags.length>16)throw Error('Use até 16 etiquetas.');const seen=new Set();return tags.map(t=>cleanText(t,40,'Etiqueta')).filter(t=>{if(t.length>40)throw Error('Etiqueta inválida.');const key=t.toLocaleLowerCase('pt-BR');if(!t||seen.has(key))return false;seen.add(key);return true;});}
class MeetingAnnotations{
 constructor(library){this.library=library;}
 file(id,name){return path.join(this.library.session(id).directory,name);}
 notes(id){const value=read(this.file(id,'annotations.json'),emptyNotes);if(value.schemaVersion!==1||!Array.isArray(value.tags)||!Array.isArray(value.markers)||value.markers.length>1000||value.markers.some(m=>!m||typeof m.id!=='string'||!m.id||!Number.isFinite(m.timeMs)||m.timeMs<0||typeof m.label!=='string'||m.label.length>120))throw Error('Formato de anotações inválido.');normalizeTags(value.tags);return value;}
 metadata(id){try{const n=this.notes(id);return {tags:normalizeTags(n.tags),markerCount:n.markers.length};}catch(error){return {tags:[],markerCount:0,annotationWarning:error.message};}}
 tags(id,tags){if(this.library.protected(id))throw Error('Aguarde a gravação ou análise terminar.');const n=this.notes(id);n.tags=normalizeTags(tags);write(this.file(id,'annotations.json'),n);return n.tags;}
 addMarker(id,timeMs,label='Momento importante',{active=false}={}){
  const l=this.library,s=l.session(id);if(l.protected(id)&&!(active&&l.store.active?.metadata.id===id))throw Error('Aguarde a análise terminar.');
  const duration=active?l.store.active.metadata.samples/16:s.metadata.durationMs;
  if(!Number.isFinite(timeMs)||timeMs<0||!Number.isFinite(duration)||timeMs>duration)throw Error('Tempo do marcador inválido.');
  label=cleanText(label,120,'Nome do marcador')||'Momento importante';const n=this.notes(id);const duplicate=n.markers.find(m=>Math.abs(m.timeMs-timeMs)<250&&m.label===label);if(duplicate)return duplicate;if(n.markers.length>=1000)throw Error('Limite de 1000 marcadores nesta gravação.');
  const marker={id:randomUUID(),timeMs:Math.floor(timeMs),label,createdAt:new Date().toISOString()};n.markers.push(marker);n.markers.sort((a,b)=>a.timeMs-b.timeMs);write(this.file(id,'annotations.json'),n);return marker;
 }
 markActive(label){const a=this.library.store.active;if(!a||!a.metadata.samples)throw Error('Inicie uma gravação antes de marcar um momento.');const marker=this.addMarker(a.metadata.id,a.metadata.samples/16,label,{active:true});return {...marker,sessionId:a.metadata.id,count:this.notes(a.metadata.id).markers.length};}
 removeMarker(id,markerId){if(this.library.protected(id))throw Error('Aguarde a gravação ou análise terminar.');const n=this.notes(id);if(!n.markers.some(m=>m.id===markerId))throw Error('Marcador desatualizado.');n.markers=n.markers.filter(m=>m.id!==markerId);write(this.file(id,'annotations.json'),n);return n.markers;}
 reviews(id){const v=read(this.file(id,'speaker-review.json'),emptyReview);if(v.schemaVersion!==1||!v.byRevision||typeof v.byRevision!=='object'||Array.isArray(v.byRevision)||Object.values(v.byRevision).some(r=>!r||!Array.isArray(r.speakers)||r.speakers.some(s=>!s||typeof s.id!=='string'||typeof s.name!=='string')||!r.corrections||typeof r.corrections!=='object'||Array.isArray(r.corrections)||Object.values(r.corrections).some(c=>!c||typeof c.speakerId!=='string')))throw Error('Revisões inválidas.');return v;}
 decorate(data,rawRevision){
  let n,r;try{n=this.notes(data.id);}catch(e){n=structuredClone(emptyNotes);data.warning=[data.warning,e.message].filter(Boolean).join(' ');}try{r=this.reviews(data.id).byRevision[rawRevision]||{speakers:[],corrections:{}};}catch(e){r={speakers:[],corrections:{}};data.warning=[data.warning,e.message].filter(Boolean).join(' ');}const names=this.library.speakerNames(data.id,data.resultId);
  data.markers=n.markers;data.tags=normalizeTags(n.tags);data.rawRevision=rawRevision;
  data.speakers.push(...(r.speakers||[]).filter(s=>!data.speakers.some(x=>x.id===s.id)).map(s=>({...s,name:names[s.id]||s.name||s.label})));
  data.segments=data.segments.map(s=>{const c=r.corrections?.[s.segmentId];return c&&data.speakers.some(x=>x.id===c.speakerId)?{...s,originalSpeakerId:s.speakerId,originalUncertain:Boolean(s.uncertain),speakerId:c.speakerId,uncertain:false,identity:{...(s.identity||{}),version:2,uncertain:false,knownPerson:true,evidence:'user-confirmed'},reviewed:true,reviewedAt:c.reviewedAt}:s;});
  data.revision=createHash('sha256').update(rawRevision+JSON.stringify(r)).digest('hex');return data;
 }
 review(id,revision,segmentId,selection,userName=''){
  if(this.library.protected(id))throw Error('Aguarde a gravação ou análise terminar.');const data=this.library.transcript(id);if(data.revision!==revision)throw Error('A transcrição mudou. Reabra o trecho antes de corrigir.');const segment=data.segments.find(s=>s.segmentId===segmentId);if(!segment)throw Error('Trecho desatualizado.');
  if(!selection||typeof selection!=='object'||Object.keys(selection).some(k=>!['speakerId','self','name','reset'].includes(k)))throw Error('Correção inválida.');
  const all=this.reviews(id),r=all.byRevision[data.rawRevision]||={speakers:[],corrections:{}};
  if(selection.reset===true)delete r.corrections[segmentId];
  else{
   let speakerId=selection.speakerId;
   if(selection.self===true){const name=cleanText(userName,100,'Nome padrão');if(!name)throw Error('Defina seu nome nas configurações antes de confirmar este trecho.');let self=r.speakers.find(s=>s.self&&s.name===name);if(!self){self={id:'confirmed-self-'+randomUUID(),label:name,name,self:true,source:segment.source,manual:true};r.speakers.push(self);}speakerId=self.id;}
   else if(selection.name!==undefined){const name=cleanText(selection.name,100,'Nome');if(!name)throw Error('Informe o nome da pessoa.');const person={id:'confirmed-speaker-'+randomUUID(),label:name,name,source:segment.source,manual:true};r.speakers.push(person);speakerId=person.id;}
   else if(!data.speakers.some(s=>s.id===speakerId))throw Error('Falante inválido.');
   r.corrections[segmentId]={speakerId,reviewedAt:new Date().toISOString(),confirmedBy:'user'};
  }
  write(this.file(id,'speaker-review.json'),all);return this.library.transcript(id);
 }
}
module.exports={MeetingAnnotations,normalizeTags};
