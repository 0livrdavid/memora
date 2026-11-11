const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');

const { qualityOf } = require('./transcript-quality.cjs');
const experimental=require('./experimental.cjs');
const {trackProcess,stopProcess}=require('./transcription-process.cjs');
const RATE = 16000;
function wavHeader(bytes) {
  const b = Buffer.alloc(44);
  b.write('RIFF'); b.writeUInt32LE(bytes + 36, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(bytes, 40);
  return b;
}
function privateJSON(file, value) {
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.chmodSync(temporary, 0o600); fs.renameSync(temporary, file);
}
function segmentsFromJSON(data, source) {
  if (!Array.isArray(data.transcription)) throw new Error('JSON incompatível com whisper-cli.');
  return data.transcription.map(item => {
    const start = item.offsets?.from, end = item.offsets?.to;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || typeof item.text !== 'string') throw new Error('Timestamps inválidos do Whisper.');
    return { source, startMs: start, endMs: end, text: item.text.trim() };
  }).filter(item => item.text);
}
class RecordingStore {
  constructor(root, options = {}) {
    this.closed = false; this.recordingReservation = null;
    this.root = root; this.active = null; this.job = null; this.sessions = new Map();
    this.cancelGraceMs = options.cancelGraceMs ?? 5000;
    this.spawn = options.spawn || spawn; this.notify = options.notify || (() => {});
    fs.mkdirSync(root, { recursive: true, mode: 0o700 }); fs.chmodSync(root, 0o700);
    this.configFile = path.join(root, 'whisper-config.json');
    try { this.config = JSON.parse(fs.readFileSync(this.configFile, 'utf8')); } catch { this.config = { binary: '', model: '', language: 'auto', threads: 4 }; }
    // Only this private recordings directory is scanned, never arbitrary user paths.
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-f0-9-]+$/.test(entry.name)) continue;
      try {
        const directory = path.join(root, entry.name), metadata = JSON.parse(fs.readFileSync(path.join(directory, 'session.json'), 'utf8'));
        if (typeof metadata.id !== 'string' || !Array.isArray(metadata.sources) || !metadata.sources.every(s => ['microphone', 'computer'].includes(s.key))) continue;
        if (metadata.status === 'transcribing') { metadata.status='interrupted'; metadata.error='Transcrição interrompida; resultado anterior preservado.';metadata.progress=null;privateJSON(path.join(directory,'session.json'),metadata); }
        if (metadata.status === 'recording') {
          metadata.status = 'interrupted'; metadata.error = 'Execução anterior interrompida; áudio local preservado.';
          const recoveredSamples = [];
          for (const source of metadata.sources) {
            const file = path.join(directory, source.key + '.wav');
            if (fs.existsSync(file)) {
              const bytes = Math.max(0, fs.statSync(file).size - 44);
              recoveredSamples.push(Math.floor(bytes / 2));
              const fd = fs.openSync(file, 'r+'); try { fs.writeSync(fd, wavHeader(bytes), 0, 44, 0); } finally { fs.closeSync(fd); }
            }
          }
          metadata.samples = recoveredSamples.length ? Math.min(...recoveredSamples) : 0;
          metadata.durationMs = metadata.samples / RATE * 1000;
          privateJSON(path.join(directory, 'session.json'), metadata);
        }
        this.sessions.set(metadata.id, { metadata, directory });
      } catch { /* A damaged session is kept on disk for manual recovery. */ }
    }
  }
  list() { return [...this.sessions.values()].map(session => session.metadata).sort((a,b) => String(b.startedAt||'').localeCompare(String(a.startedAt||''))); }
  info() { const sessions = this.list(); return { root: this.root, config: this.config, processing:this.processing(), experimental:experimental.readiness(path.dirname(this.root)), ready: this.checkConfig().ready, problem: this.checkConfig().problem, sessions, latest: sessions[0] || null }; }
  useStandardBackend() {
    // Apply once on application startup, never through a renderer selector.
    if(this.closed||this.recordingReservation||this.active||this.job)throw Error('Aguarde a operação atual terminar.');
    this.configure({backend:'experimental'});
  }
  processing() {
    const job=this.job;if(!job)return null;
    const metadata=this.sessions.get(job.id).metadata;
    return {id:job.id,attempt:job.attempt,cancelling:job.cancelled,title:metadata.title||'',durationMs:metadata.durationMs,startedAt:metadata.startedAt,progress:metadata.progress,preview:job.preview};
  }
  finishAndTranscribe(id,error=null,{automatic=true}={}) {
    const result=this.finish(id,error);
    if(automatic&&!error&&result.samples>0)void this.transcribe(id).catch(failure=>{
      // No automatic retry. Saved audio remains available for manual transcription.
      if(!this.job){const session=this.sessions.get(id);session.metadata.error=failure.message;this.persist(session);this.notify(session.metadata);}
    });
    return {...result};
  }
  checkConfig() {
    if(this.config.backend==='experimental')return experimental.readiness(path.dirname(this.root));
    try {
      for (const [key, mode] of [['binary', fs.constants.X_OK], ['model', fs.constants.R_OK]]) {
        const file = this.config[key];
        if (typeof file !== 'string' || !path.isAbsolute(file) || !fs.statSync(file).isFile()) throw new Error();
        fs.accessSync(file, mode);
      }
      return { ready: true, problem: '' };
    } catch { return { ready: false, problem: 'Whisper não configurado. Use a instalação guiada ou selecione arquivos locais.' }; }
  }
  configure(update) {
    if (this.closed || this.recordingReservation || this.active || this.job) throw new Error('Aguarde a sessão terminar antes de configurar.');
    const config = { ...this.config, ...update };
    if(!['legacy','experimental'].includes(config.backend||'legacy'))throw Error('Backend inválido.');
    if (!['auto', 'pt', 'en', 'es'].includes(config.language) || !Number.isInteger(config.threads) || config.threads < 1 || config.threads > 16) throw new Error('Configuração inválida.');
    for (const key of ['binary', 'model']) if (typeof config[key] !== 'string' || config[key].length > 4096) throw new Error('Caminho inválido.');
    this.config = config; privateJSON(this.configFile, config); return this.info();
  }
  async prepareRecording(confirm) {
    if (this.closed || this.recordingReservation || this.active) return null;
    const reservation = this.recordingReservation = { token: randomUUID(), ready: false };
    const job = this.job;
    try {
      if (job) {
        const snapshot = structuredClone(this.processing());
        if (typeof confirm !== 'function' || !(await confirm(snapshot))) {
          this.releaseRecording(reservation.token); return null;
        }
        if (this.closed || this.recordingReservation !== reservation) return null;
        // A completed job must not be relabelled as cancelled after the dialog.
        if (this.job === job) this.cancel();
        await job.done;
        if(job.termination)await job.termination;
        if(job.completionError)throw job.completionError;
      }
      if (this.closed || this.recordingReservation !== reservation) return null;
      reservation.ready = true;
      return { token: reservation.token };
    } catch (error) { this.releaseRecording(reservation.token); throw error; }
  }
  releaseRecording(token) {
    if (this.recordingReservation?.token !== token) return false;
    this.recordingReservation = null; return true;
  }
  begin(sources, token) {
    const reservation = this.recordingReservation;
    if (this.closed || (reservation ? token !== reservation.token || !reservation.ready : token !== undefined) || this.active || this.job) throw new Error('Já existe uma sessão em andamento.');
    if (!Array.isArray(sources) || sources.length < 1 || sources.length > 2 || new Set(sources.map(s => s.key)).size !== sources.length || !sources.every(s => ['microphone','computer'].includes(s.key) && typeof s.label === 'string' && s.label.length <= 512)) throw new Error('Fontes inválidas.');
    const id = randomUUID(), startedAt = new Date().toISOString();
    const directory = path.join(this.root, startedAt.replace(/[:.]/g, '-') + '-' + id);
    fs.mkdirSync(directory, { mode: 0o700 });
    const metadata = { schemaVersion: 1, id, startedAt, status: 'recording', sampleRate: RATE, sources, samples: 0, durationMs: 0, error: null };
    const files = {};
    try {
      for (const source of sources) {
        const fd = fs.openSync(path.join(directory, source.key + '.wav'), 'wx', 0o600);
        files[source.key] = fd; fs.writeSync(fd, wavHeader(0));
      }
      const active = { metadata, directory, files, sequence: 0 };
      this.persist(active);
      this.active = active; this.sessions.set(id, { metadata, directory });
      if (reservation) this.releaseRecording(reservation.token);
      return { id, directory };
    } catch (error) { for (const fd of Object.values(files)) fs.closeSync(fd); throw error; }
  }
  append(id, sequence, chunks) {
    const session = this.active;
    if (!session || session.metadata.id !== id || sequence !== session.sequence) throw new Error('Sequência de áudio inválida; sessão interrompida.');
    const keys = session.metadata.sources.map(s => s.key);
    if (!chunks || Object.keys(chunks).length !== keys.length) throw new Error('Canais inválidos.');
    const buffers = keys.map(key => {
      const data = chunks[key];
      if (!(data instanceof Uint8Array) || data.byteLength === 0 || data.byteLength > 32768 || data.byteLength % 2) throw new Error('Bloco PCM inválido.');
      return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    });
    if (!buffers.every(b => b.length === buffers[0].length)) throw new Error('Fontes fora de sincronia.');
    if (session.metadata.samples * 2 + buffers[0].length > 0xffffffff - 36) throw new Error('Limite do arquivo WAV atingido. Pare e inicie outra sessão.');
    keys.forEach((key, i) => fs.writeSync(session.files[key], buffers[i]));
    session.metadata.samples += buffers[0].length / 2; session.sequence++;
    return { samples: session.metadata.samples };
  }
  persist(session) { privateJSON(path.join(session.directory, 'session.json'), session.metadata); }
  finish(id, error = null) {
    const session = this.active;
    if (!session || session.metadata.id !== id) throw new Error('Sessão não encontrada.');
    this.active = null;
    for (const [key, fd] of Object.entries(session.files)) {
      try {
        const bytes = Math.max(0, fs.fstatSync(fd).size - 44);
        fs.writeSync(fd, wavHeader(bytes), 0, 44, 0); fs.fsyncSync(fd);
      } finally { fs.closeSync(fd); }
    }
    Object.assign(session.metadata, { endedAt: new Date().toISOString(), durationMs: session.metadata.samples / RATE * 1000, status: error ? 'interrupted' : 'saved', error });
    this.persist(session); return session.metadata;
  }
  async transcribe(id) {
    if (this.closed || this.recordingReservation || this.active || this.job) throw new Error('Já existe uma operação em andamento.');
    const session = this.sessions.get(id); if (!session) throw new Error('Sessão desconhecida.');
    if (session.metadata.audioDeletedAt) throw new Error('O áudio desta sessão foi removido pela limpeza.');
    const checked = this.checkConfig();
    if (!checked.ready) { session.metadata.status = 'needs-setup'; session.metadata.error = checked.problem; this.persist(session); return session.metadata; }
    if (!session.metadata.samples) { session.metadata.status = 'failed'; session.metadata.error = 'A gravação não contém amostras.'; this.persist(session); return session.metadata; }
    // Preserve prior results and metadata before any attempt, including cancellation/failure.
    const attempt = randomUUID(), backup = path.join(session.directory, 'transcript-backups', attempt);
    fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
    for (const name of ['session.json','transcript.json','transcript.txt','speaker-names.json','speaker-review.json']) {
      const file=path.join(session.directory,name);
      if(fs.existsSync(file)){fs.copyFileSync(file,path.join(backup,name),fs.constants.COPYFILE_EXCL);fs.chmodSync(path.join(backup,name),0o600);}
    }
    const job = this.job = { id, attempt, cancelled: false, child: null, preview:[] };
    job.done=new Promise(resolve=>{job.resolveDone=resolve;});
    try {
      session.metadata.progress={stage:'preparation',phase:'Preparando transcrição local',attempt,updatedAt:new Date().toISOString()};
      session.metadata.status = 'transcribing'; session.metadata.error = null; this.persist(session); this.notify({...session.metadata,processing:this.processing()});
      if(job.cancelled)throw Error('Transcrição cancelada.');
      if(this.config.backend==='experimental'){
        const transcript=await experimental.run(this,session,job,attempt);
        if(job.cancelled)throw Error('Transcrição cancelada.');
        const quality=qualityOf(transcript.segments,session.metadata.durationMs,Object.fromEntries(session.metadata.sources.map(s=>[s.key,path.join(session.directory,s.key+'.wav')])));transcript.quality=quality;
        const previous=fs.existsSync(path.join(session.directory,'transcript.json')),name=quality.needsReview&&previous?'transcript-candidate-'+attempt:'transcript';
        // Commit one authoritative JSON atomically; ancillary TXT never drives reads.
        privateJSON(path.join(session.directory,name+'.json'),transcript);
        const tmp=path.join(session.directory,name+'.txt.tmp');fs.writeFileSync(tmp,transcript.segments.map(s=>`[${s.startMs}–${s.endMs}] ${s.speakerId}: ${s.text}`).join('\n'),{mode:0o600});fs.renameSync(tmp,path.join(session.directory,name+'.txt'));
        Object.assign(session.metadata,{status:quality.needsReview?'review-needed':'completed',engine:transcript.engine,quality,transcriptCandidate:name==='transcript'?null:name+'.json',warning:transcript.notices.join(' ')+(quality.needsReview?' '+quality.reasons.join(' ')+(previous?' Resultado anterior preservado; candidata na pasta.':''):''),progress:null});delete session.metadata.transcriptDeletedAt;return session.metadata;
      }
      const segments = [];
      // A new output name per attempt prevents stale results being mistaken for success.
      for (const source of session.metadata.sources) {
        if (job.cancelled) throw new Error('Transcrição cancelada.');
        const prefix = path.join(session.directory, `${source.key}-${attempt}`);
        const args = ['-m', this.config.model, '-f', path.join(session.directory, source.key + '.wav'), '-mc', '0', '-oj', '-of', prefix, '-l', this.config.language, '-t', String(this.config.threads)];
        await new Promise((resolve, reject) => {
          let stderr = '';
          const child = job.child = this.spawn(this.config.binary, args, { cwd: session.directory, shell: false, detached: process.platform !== 'win32', stdio: ['ignore','ignore','pipe'] });
          trackProcess(job,child,process.platform !== 'win32');
          child.stderr?.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-3000); });
          child.on('error', reject);
          child.on('close', code => {
            job.child = null;
            if (job.cancelled) reject(new Error('Transcrição cancelada.'));
            else if (code !== 0) reject(new Error(`Whisper encerrou com código ${code}. ${stderr}`));
            else resolve();
          });
        });
        fs.chmodSync(prefix + '.json', 0o600);
        segments.push(...segmentsFromJSON(JSON.parse(fs.readFileSync(prefix + '.json', 'utf8')), source.key));
      }
      if (job.cancelled) throw new Error('Transcrição cancelada.');
      segments.sort((a,b) => a.startMs - b.startMs);
      const quality=qualityOf(segments,session.metadata.durationMs,Object.fromEntries(session.metadata.sources.map(s=>[s.key,path.join(session.directory,s.key+'.wav')])));
      const transcript={sessionId:id,startedAt:session.metadata.startedAt,sources:session.metadata.sources,quality,segments};
      const timestamp=ms=>new Date(ms).toISOString().slice(11,23);
      const labels=Object.fromEntries(session.metadata.sources.map(s=>[s.key,s.label]));
      const text=segments.map(s=>`[${timestamp(s.startMs)} → ${timestamp(s.endMs)}] ${labels[s.source]}: ${s.text}`).join('\n')+'\n';
      const previous=fs.existsSync(path.join(session.directory,'transcript.json'));
      const name=quality.needsReview&&previous?`transcript-candidate-${attempt}`:'transcript';
      privateJSON(path.join(session.directory,name+'.json'),transcript);
      const temporary=path.join(session.directory,name+'.txt.tmp');fs.writeFileSync(temporary,text,{mode:0o600});fs.renameSync(temporary,path.join(session.directory,name+'.txt'));
      session.metadata.quality=quality;
      session.metadata.transcriptCandidate=name==='transcript'?null:name+'.json';
      session.metadata.warning=quality.needsReview?'Transcrição exige revisão. '+quality.reasons.join(' ')+(previous?' A versão anterior foi preservada; consulte a nova candidata na pasta da gravação.':' Nenhum trecho foi descartado.'):null;
      session.metadata.status=quality.needsReview?'review-needed':'completed';
      delete session.metadata.transcriptDeletedAt;
      session.metadata.engine={name:'whisper.cpp',model:path.basename(this.config.model),language:this.config.language,maxTextContext:0};
    } catch (error) { session.metadata.status = job.cancelled ? 'cancelled' : 'failed'; session.metadata.error = error.message; }
    finally {
      try {
        if(job.termination)await job.termination;
        session.metadata.progress=null;
        // Keep the operation locked until its terminal metadata is durable.
        this.persist(session);
        this.job = null;
        this.notify(session.metadata);
      } catch(error) { job.completionError=error; throw error; }
      finally { job.resolveDone(); }
    }
    return session.metadata;
  }
  cancel() {
    const job = this.job;
    if (!job || job.cancelled) return;
    job.cancelled = true;
    // Start the barrier before notifications or persistence can fail.
    stopProcess(job,this.cancelGraceMs).catch(()=>{});
    const session=this.sessions.get(job.id);session.metadata.progress={...session.metadata.progress,phase:'Encerrando transcrição…'};this.persist(session);this.notify({...session.metadata,processing:this.processing()});
  }
  async shutdown() {
    const job=this.job;this.close();
    if(job?.done)await job.done;
    if(job?.termination)await job.termination;
    if(job?.completionError)throw job.completionError;
  }
  close() {
    this.closed=true;this.recordingReservation=null;
    this.cancel();
    if (this.active) this.finish(this.active.metadata.id, 'Aplicativo encerrado antes de finalizar a sessão.');
  }
}
module.exports = { RecordingStore, wavHeader, segmentsFromJSON, RATE, privateJSON };
