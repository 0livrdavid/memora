const {MeetingAnnotations}=require('./meeting-annotations.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const {privateJSON,wavHeader}=require('./recordings.cjs');
const {qualityOf}=require('./transcript-quality.cjs');
const audioName = name => ['microphone.wav','computer.wav'].includes(name);
const transcriptName = name => ['speaker-review.json','speaker-review.json.tmp','speaker-names.json','speaker-names.json.tmp','transcript.json.tmp','transcript.txt.tmp'].includes(name) || /^transcript-candidate-[a-f0-9-]+\.(json|txt)(?:\.tmp)?$/.test(name) || ['transcript.json','transcript.txt'].includes(name) || /^(microphone|computer)-[a-f0-9-]+\.json(?:\.tmp)?$/.test(name);
function plainFile(file) { try { return fs.lstatSync(file).isFile(); } catch { return false; } }
function bytesIn(directory) {
  let total = 0;
  try { for (const item of fs.readdirSync(directory,{withFileTypes:true})) { const file=path.join(directory,item.name); if (item.isDirectory()) total+=bytesIn(file); else if(item.isFile()) total+=fs.statSync(file).size; } } catch {}
  return total;
}
function meetingFiles(directory){
 const result=[];function walk(dir,relative=''){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const name=relative?relative+'/'+e.name:e.name,file=path.join(dir,e.name);if(e.isSymbolicLink())continue;if(e.isFile()){if(!relative&&(audioName(e.name)||transcriptName(e.name)))result.push(name);else if(relative&&(/^(analysis-[a-f0-9-]+)$/.test(relative)&&/^(result|raw-(microphone|computer)|aligned-(microphone|computer)|remote-turns|microphone-turns|source-evidence|failure)\.json(?:\.tmp)?$/.test(e.name)||/^transcript-backups\/[a-f0-9-]+$/.test(relative)&&['transcript.json','transcript.txt','speaker-names.json','speaker-review.json'].includes(e.name)))result.push(name);}else if(e.isDirectory()&&(!relative&&(/^(analysis-[a-f0-9-]+|transcript-backups)$/.test(e.name))||relative==='transcript-backups'&&/^[a-f0-9-]+$/.test(e.name)))walk(file,name);}}walk(directory);return result;
}
function titleOf(metadata) { return metadata.title || (typeof metadata.startedAt==='string'&&Number.isFinite(Date.parse(metadata.startedAt))?`Gravação de ${new Date(metadata.startedAt).toLocaleString('pt-BR')}`:'Gravação sem data de início'); }
function cutoffOf(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Informe uma data válida.');
  const [y,m,d]=date.split('-').map(Number), value=new Date(y,m-1,d);
  if(value.getFullYear()!==y||value.getMonth()!==m-1||value.getDate()!==d) throw new Error('Data inválida.');
  return new Date(y,m-1,d+1).getTime();
}
class Library {
  constructor(store,engineRoot) { this.store=store;this.engineRoot=engineRoot;this.plans=new Map();this.annotations=new MeetingAnnotations(this); }
  session(id) { const session=this.store.sessions.get(id);if(!session)throw new Error('Gravação não encontrada.');if(!fs.lstatSync(session.directory).isDirectory()||path.dirname(fs.realpathSync(session.directory))!==fs.realpathSync(this.store.root))throw new Error('Diretório de sessão inválido.');return session; }
  protected(id) { return this.store.active?.metadata.id===id || this.store.job?.id===id; }
  list() { return this.store.list().map(metadata=>{const {directory}=this.session(metadata.id);return {...metadata,...this.annotations.metadata(metadata.id),title:titleOf(metadata),hasAudio:metadata.sources.some(s=>plainFile(path.join(directory,s.key+'.wav'))),hasTranscript:!metadata.transcriptDeletedAt&&plainFile(path.join(directory,'transcript.json'))};}); }
  rename(id,title) {
    if(this.protected(id))throw new Error('Aguarde a sessão terminar para renomear.');
    if(typeof title!=='string'||!title.trim()||title.trim().length>160||/[\x00-\x1f]/.test(title))throw new Error('Use um nome de 1 a 160 caracteres.');
    const session=this.session(id);session.metadata.title=title.trim();this.store.persist(session);return this.list().find(s=>s.id===id);
  }
  speakerNames(id,resultId){const session=this.session(id);try{const file=path.join(session.directory,'speaker-names.json');if(!plainFile(file))return {};const names=JSON.parse(fs.readFileSync(file));return names.byResult?.[resultId]||{};}catch{return {};}}
  nameSpeaker(id,resultId,speakerId,name){if(this.protected(id))throw Error('Aguarde a análise terminar.');const data=this.transcript(id);if(data.resultId!==resultId||!data.speakers.some(s=>s.id===speakerId))throw Error('Falante ou resultado desatualizado.');if(typeof name!=='string'||name.trim().length>100||/[\x00-\x1f]/.test(name))throw Error('Nome inválido.');const session=this.session(id),file=path.join(session.directory,'speaker-names.json');let saved={schemaVersion:1,byResult:{}};if(plainFile(file))saved=JSON.parse(fs.readFileSync(file));saved.byResult[resultId]||={};if(name.trim())saved.byResult[resultId][speakerId]=name.trim();else delete saved.byResult[resultId][speakerId];privateJSON(file,saved);return this.transcript(id);}
  sample(id,resultId,speakerId,index=0){const data=this.transcript(id);if(data.resultId!==resultId||!Number.isInteger(index)||index<0||index>2)throw Error('Amostra inválida.');const candidates=data.segments.filter(s=>s.speakerId===speakerId&&!s.uncertain&&s.endMs-s.startMs>=500).sort((a,b)=>Math.min(6000,b.endMs-b.startMs)-Math.min(6000,a.endMs-a.startMs)||a.startMs-b.startMs).slice(0,3);const item=candidates[index];if(!item)throw Error('Sem amostra clara disponível. Confira os trechos incertos na transcrição.');const file=path.join(this.session(id).directory,item.source+'.wav');if(!plainFile(file))throw Error('O áudio foi removido pela limpeza.');const fd=fs.openSync(file,'r');try{const header=Buffer.alloc(44);fs.readSync(fd,header,0,44,0);if(header.toString('ascii',0,4)!=='RIFF'||header.readUInt32LE(24)!==16000)throw Error('Áudio incompatível.');const start=Math.max(0,Math.floor(item.startMs*16)),samples=Math.min(Math.ceil((item.endMs-item.startMs)*16),96000),available=Math.max(0,Math.floor((fs.fstatSync(fd).size-44)/2)-start),bytes=Buffer.alloc(Math.min(samples,available)*2);fs.readSync(fd,bytes,0,bytes.length,44+start*2);return {audio:Uint8Array.from(Buffer.concat([wavHeader(bytes.length),bytes])),startMs:item.startMs,endMs:item.startMs+bytes.length/32,count:candidates.length};}finally{fs.closeSync(fd);}}
  phrase(id,revision,segmentIndex,startMs,endMs){
    const data=this.transcript(id);
    if(revision!==data.revision)throw Error('A transcrição mudou. Reabra a gravação antes de ouvir.');
    const segment=Number.isInteger(segmentIndex)&&data.segments[segmentIndex];
    if(!segment||!['microphone','computer'].includes(segment.source)||!Number.isFinite(startMs)||!Number.isFinite(endMs)||startMs<segment.startMs||endMs>segment.endMs||endMs<=startMs)throw Error('Trecho inválido.');
    if(endMs-startMs>600000)throw Error('Este trecho excede 10 minutos. Abra o áudio pela pasta da gravação.');
    return this.audioClip(id,segment.source,startMs,endMs);
  }
  async block(id,revision,blockIndex){
    const {transcriptBlocks,BLOCK_LIMITS}=await import('./transcript-blocks.mjs'),data=this.transcript(id);
    if(revision!==data.revision)throw Error('A transcrição mudou. Reabra a gravação antes de ouvir.');
    const block=Number.isInteger(blockIndex)&&blockIndex>=0&&transcriptBlocks(data.segments)[blockIndex];
    if(!block||block.phrases.length<2||!['microphone','computer'].includes(block.source)||block.endMs<=block.startMs)throw Error('Bloco inválido.');
    if(block.endMs-block.startMs>BLOCK_LIMITS.audioDurationMs)throw Error('Este bloco excede 10 minutos. Abra os tempos para ouvir cada trecho.');
    return this.audioClip(id,block.source,block.startMs,block.endMs);
  }
  audioClip(id,source,startMs,endMs){
    const file=path.join(this.session(id).directory,source+'.wav');
    if(!plainFile(file))throw Error('O áudio desta origem não está mais disponível. A transcrição foi preservada.');
    const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    try{
      const header=Buffer.alloc(44),size=fs.fstatSync(fd).size;
      if(fs.readSync(fd,header,0,44,0)!==44||header.toString('ascii',0,4)!=='RIFF'||header.toString('ascii',8,16)!=='WAVEfmt '||header.readUInt32LE(16)!==16||header.readUInt16LE(20)!==1||header.readUInt16LE(22)!==1||header.readUInt32LE(24)!==16000||header.readUInt16LE(32)!==2||header.readUInt16LE(34)!==16||header.toString('ascii',36,40)!=='data')throw Error('Formato de áudio incompatível.');
      const available=Math.floor(Math.min(size-44,header.readUInt32LE(40))/2),start=Math.floor(startMs*16),end=Math.min(available,Math.ceil(endMs*16));
      if(start>=end)throw Error('Não há áudio neste intervalo. Confira os tempos da transcrição.');
      const bytes=Buffer.alloc((end-start)*2);if(fs.readSync(fd,bytes,0,bytes.length,44+start*2)!==bytes.length)throw Error('O áudio mudou durante a leitura. Tente novamente.');
      return {audio:Uint8Array.from(Buffer.concat([wavHeader(bytes.length),bytes])),startMs:start/16,endMs:end/16,source,truncated:end<Math.ceil(endMs*16)};
    }finally{fs.closeSync(fd);}
  }
  transcript(id) {
    const session=this.session(id),file=path.join(session.directory,'transcript.json');
    if(session.metadata.transcriptDeletedAt||!plainFile(file))throw new Error('Esta gravação ainda não tem transcrição.');
    if(fs.statSync(file).size>32*1024*1024)throw new Error('Transcrição grande demais para esta visualização. Abra a pasta da sessão.');
    const raw=fs.readFileSync(file,'utf8'),data=JSON.parse(raw);
    const rawRevision=createHash('sha256').update(raw).digest('hex'),revision=rawRevision,resultId=data.resultId||'legacy';
    if(!Array.isArray(data.segments))throw new Error('Formato de transcrição inválido.');
    const quality=data.quality||qualityOf(data.segments.filter(s=>typeof s.text==='string'&&Number.isFinite(s.startMs)&&Number.isFinite(s.endMs)),session.metadata.durationMs);
    const output={revision,audioSources:['microphone','computer'].filter(key=>plainFile(path.join(session.directory,key+'.wav'))),resultId,speakers:(data.speakers||[]).map(s=>({...s,name:this.speakerNames(id,resultId)[s.id]||s.label})),engine:data.engine||session.metadata.engine,warning:session.metadata.warning||(quality.needsReview?'Transcrição exige revisão. '+quality.reasons.join(' '):null),id,title:titleOf(session.metadata),startedAt:session.metadata.startedAt,durationMs:session.metadata.durationMs,sources:session.metadata.sources,segments:data.segments.map((s,i)=>({...s,segmentId:'seg-'+rawRevision.slice(0,24)+'-'+i})).filter(s=>typeof s.text==='string'&&Number.isFinite(s.startMs)&&Number.isFinite(s.endMs)&&s.startMs>=0&&s.endMs>=s.startMs).map(s=>({...s,source:s.source,text:s.text,startMs:s.startMs,endMs:s.endMs}))};
    return this.annotations.decorate(output,rawRevision);
  }
  cleanupFile(id,name){
    const target=path.join(this.session(id).directory,name);
    if(!plainFile(target)||fs.realpathSync(target)!==path.join(fs.realpathSync(this.session(id).directory),name))return null;
    try{fs.accessSync(target,fs.constants.W_OK);fs.accessSync(path.dirname(target),fs.constants.W_OK|fs.constants.X_OK);}catch{return null;}
    const stat=fs.lstatSync(target);return {id,name,size:stat.size,ino:stat.ino,mtimeMs:stat.mtimeMs,blocks:stat.blocks,nlink:stat.nlink,recoverableBytes:stat.nlink===1?stat.blocks*512:0};
  }
  storage() {
    let audio=0,transcripts=0,recoverableBytes=0,protectedBytes=0,unwritableBytes=0;
    for(const value of this.store.sessions.values())for(const name of meetingFiles(this.session(value.metadata.id).directory)){
      const file=path.join(value.directory,name);if(!plainFile(file))continue;
      if(this.protected(value.metadata.id)){protectedBytes+=fs.statSync(file).size;continue;}
      const eligible=this.cleanupFile(value.metadata.id,name);if(!eligible){unwritableBytes+=fs.statSync(file).size;continue;}
      if(audioName(name))audio+=eligible.size;else transcripts+=eligible.size;recoverableBytes+=eligible.recoverableBytes;
    }
    const p=require('./experimental.cjs').paths(path.dirname(this.store.root));
    const recordings=bytesIn(this.store.root),engine=bytesIn(this.engineRoot)+bytesIn(path.dirname(path.dirname(p.python)))+bytesIn(p.cache)+bytesIn(path.dirname(path.dirname(p.nemo)))+(plainFile(p.model)?fs.statSync(p.model).size:0);
    return {audio,transcripts,other:Math.max(0,recordings-audio-transcripts-protectedBytes-unwritableBytes),engine,total:audio+transcripts,recoverableBytes,protectedBytes,unwritableBytes,estimateNote:'Estimativa por blocos alocados. Espaço compartilhado pelo APFS pode reduzir a liberação real.'};
  }
  preview({date,audio,transcripts}={}) {
    const cutoff=cutoffOf(date);if(typeof audio!=='boolean'||typeof transcripts!=='boolean'||(!audio&&!transcripts))throw new Error('Selecione áudio e/ou transcrição.');
    const files=[],sessions=[];let protectedCount=0,unwritableCount=0;
    for(const value of this.store.sessions.values()){
      const session=this.session(value.metadata.id);
      if(!(Date.parse(session.metadata.startedAt)<cutoff))continue;
      if(this.protected(session.metadata.id)){protectedCount++;continue;}
      const selected=[];
      for(const name of meetingFiles(session.directory)){
        if(!((audio&&audioName(name))||(transcripts&&!audioName(name))))continue;
        const file=path.join(session.directory,name);if(!plainFile(file))continue;
        const eligible=this.cleanupFile(session.metadata.id,name);if(!eligible){unwritableCount++;continue;}selected.push(eligible);
      }
      if(selected.length){files.push(...selected);sessions.push({id:session.metadata.id,title:titleOf(session.metadata)});}
    }
    const token=randomUUID(),plan={token,date,audio,transcripts,files,sessions,protectedCount,expiresAt:Date.now()+5*60*1000};
    for(const [key,p]of this.plans)if(p.expiresAt<Date.now())this.plans.delete(key);
    this.plans.set(token,plan);
    return {token,date,audio,transcripts,sessionCount:sessions.length,fileCount:files.length,bytes:files.reduce((n,f)=>n+f.size,0),recoverableBytes:files.reduce((n,f)=>n+f.recoverableBytes,0),estimateNote:'Estimativa por blocos alocados; compartilhamento do APFS pode reduzir o espaço efetivamente liberado.',unwritableCount,protectedCount,sessions};
  }
  async confirm(token,ask) {
    const plan=this.plans.get(token);if(!plan||plan.expiresAt<Date.now())throw new Error('Revisão expirada. Revise novamente.');if(!plan.files.length)throw new Error('Nenhum arquivo selecionado.');
    if(!await ask(plan)){this.plans.delete(token);return {cancelled:true};}
    return this.apply(token);
  }
  apply(token) {
    const plan=this.plans.get(token);this.plans.delete(token);
    if(!plan||plan.expiresAt<Date.now())throw new Error('A revisão expirou. Revise a limpeza novamente.');
    for(const file of plan.files){
      if(this.protected(file.id))throw new Error('Uma sessão entrou em uso. Revise novamente; nada foi apagado.');
      const base=this.session(file.id).directory,target=path.join(base,file.name);if(fs.realpathSync(target)!==path.join(fs.realpathSync(base),file.name))throw Error('Os arquivos mudaram. Revise novamente; nada foi apagado.');
      if(!plainFile(target))throw new Error('Os arquivos mudaram. Revise novamente; nada foi apagado.');
      if(!this.cleanupFile(file.id,file.name))throw Error('As permissões mudaram. Revise novamente; nada foi apagado.');const stat=fs.lstatSync(target);if(stat.size!==file.size||stat.ino!==file.ino||stat.mtimeMs!==file.mtimeMs)throw new Error('Os arquivos mudaram. Revise novamente; nada foi apagado.');
    }
    for(const item of plan.sessions){const selected=meetingFiles(this.session(item.id).directory).filter(name=>((plan.audio&&audioName(name))||(plan.transcripts&&!audioName(name)))&&this.cleanupFile(item.id,name)).sort();const reviewed=plan.files.filter(f=>f.id===item.id).map(f=>f.name).sort();if(JSON.stringify(selected)!==JSON.stringify(reviewed))throw Error('Os arquivos mudaram. Revise novamente; nada foi apagado.');}
    let bytes=0,files=0;
    for(const item of plan.sessions){
      const session=this.session(item.id);let touched=false;
      try {for(const file of plan.files.filter(f=>f.id===item.id)) { fs.unlinkSync(path.join(session.directory,file.name));bytes+=file.size;files++;touched=true; }}
      finally {if(touched){if(plan.audio)session.metadata.audioDeletedAt=new Date().toISOString();if(plan.transcripts){session.metadata.transcriptDeletedAt=new Date().toISOString();session.metadata.warning=null;session.metadata.transcriptCandidate=null;session.metadata.quality=null;session.metadata.status=session.metadata.sources.some(s=>plainFile(path.join(session.directory,s.key+'.wav')))?'saved':'cleaned';}this.store.persist(session);}}
    }
    return {files,bytes,sessionCount:plan.sessions.length,ids:plan.sessions.map(s=>s.id),transcripts:plan.transcripts};
  }
}
module.exports={Library,cutoffOf,audioName,transcriptName,bytesIn};
