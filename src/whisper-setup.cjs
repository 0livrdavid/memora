const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const SOURCE = { name: 'whisper-v1.9.5.tar.gz', bytes: 9626464, sha256: 'ff1a9053feb509ff9d7729703355541ae9690073a6b1c40eb692c962e0dc1720', url: 'https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/refs/tags/v1.9.5' };
const MODEL = { name: 'ggml-base.bin', bytes: 147951465, sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.bin' };
async function digest(file) { const hash = crypto.createHash('sha256'); await pipeline(fs.createReadStream(file), hash); return hash.digest('hex'); }
async function valid(file, item) { try { return fs.statSync(file).size === item.bytes && await digest(file) === item.sha256; } catch { return false; } }
class WhisperSetup {
  constructor(root, options = {}) {
    this.root = root; this.notify = options.notify || (() => {}); this.downloadOverride = options.download;
    this.buildOverride = options.build; this.source = options.source || SOURCE; this.model = options.model || MODEL;
    this.child = null; this.running = false; this.aborted = false;
    fs.mkdirSync(root, { recursive: true, mode: 0o700 }); fs.chmodSync(root, 0o700);
    this.state = { phase: 'idle', message: 'Whisper ainda não instalado pelo Memora.', progress: 0 };
  }
  plan() { return { supported: process.platform === 'darwin' && ['arm64','x64'].includes(process.arch), model: 'base multilíngue', modelBytes: this.model.bytes, sourceBytes: this.source.bytes, totalBytes: this.model.bytes + this.source.bytes, sources: [this.source.url, this.model.url], state: this.state, running: this.running }; }
  update(phase, message, progress = null) { this.state = { phase, message, progress }; this.notify(this.plan()); }
  checkCancelled() { if (this.aborted) throw new Error('Instalação cancelada. Gravações preservadas.'); }
  async installed() {
    try {
      const receipt = JSON.parse(fs.readFileSync(path.join(this.root, 'installed.json'), 'utf8'));
      const binary = path.join(this.root, 'engine/build/bin/whisper-cli'), model = path.join(this.root, this.model.name);
      if (receipt.sourceSHA256 !== this.source.sha256 || receipt.modelSHA256 !== this.model.sha256 || !await valid(model, this.model) || await digest(binary) !== receipt.binarySHA256) return null;
      fs.accessSync(binary, fs.constants.X_OK); return { binary, model, language: 'pt' };
    } catch { return null; }
  }
  async run(binary, args, onLine = () => {}, maxOutput = 3000) {
    this.checkCancelled();
    return new Promise((resolve, reject) => {
      let log = '';
      const child = this.child = spawn(binary, args, { shell: false, detached: process.platform !== 'win32', stdio: ['ignore','pipe','pipe'] });
      const collect = chunk => { const value = chunk.toString(); log = (log + value).slice(-maxOutput); onLine(value); };
      child.stdout.on('data', collect); child.stderr.on('data', collect);
      child.once('error', reject);
      child.once('close', code => { if (this.child === child) this.child = null; clearTimeout(this.killTimer); if (this.aborted) reject(new Error('Instalação cancelada.')); else if (code !== 0) reject(new Error(`Falha ao preparar Whisper (${code}). ${log}`)); else resolve(log); });
    });
  }
  async obtain(item, label) {
    const file = path.join(this.root, item.name), part = file + '.part';
    if (await valid(file, item)) return file;
    this.checkCancelled();
    fs.rmSync(part, { force: true });
    this.update('downloading', `Baixando ${label}…`, 0);
    const timer = setInterval(() => { try { this.update('downloading', `Baixando ${label}…`, Math.min(1, fs.statSync(part).size / item.bytes)); } catch {} }, 300);
    try {
      if (this.downloadOverride) await this.downloadOverride(item, part, this);
      else await this.run('/usr/bin/curl', ['--fail','--location','--silent','--show-error','--proto','=https','--proto-redir','=https','--connect-timeout','30','--max-time','900','--output',part,item.url]);
      this.checkCancelled(); this.update('verifying', `Verificando integridade de ${label}…`);
      if (!await valid(part, item)) throw new Error(`Integridade de ${label} inválida. Tente novamente.`);
      fs.chmodSync(part, 0o600); fs.renameSync(part, file); return file;
    } finally { clearInterval(timer); fs.rmSync(part, { force: true }); }
  }
  async build(source) {
    const cmake = ['/opt/homebrew/bin/cmake','/usr/local/bin/cmake','/usr/bin/cmake'].find(file => fs.existsSync(file));
    if (!cmake) throw new Error('CMake não encontrado. Instale CMake pelo site oficial ou Homebrew e tente novamente. A seleção manual continua disponível.');
    await this.run('/usr/bin/xcrun', ['--find','clang']);
    const engine = path.join(this.root, 'engine'); fs.mkdirSync(engine, { recursive: true, mode: 0o700 });
    const listing = await this.run('/usr/bin/tar', ['-tzf',source], () => {}, 10000000);
    // Archive is pinned by SHA-256. Reject unexpected traversal even before extraction.
    if (listing.split('\n').some(entry => entry && (entry.startsWith('/') || entry.split('/').includes('..')))) throw new Error('Arquivo de instalação inválido.');
    await this.run('/usr/bin/tar', ['-xzf',source,'--strip-components=1','-C',engine]);
    this.update('building', 'Preparando Whisper para este Mac. Pode levar alguns minutos…');
    await this.run(cmake, ['-S',engine,'-B',path.join(engine,'build'),'-DCMAKE_BUILD_TYPE=Release','-DBUILD_SHARED_LIBS=OFF','-DWHISPER_BUILD_TESTS=OFF','-DWHISPER_CURL=OFF','-DGGML_METAL=ON','-DGGML_METAL_EMBED_LIBRARY=ON']);
    await this.run(cmake, ['--build',path.join(engine,'build'),'--target','whisper-cli','--config','Release','-j','4'], line => {
      const matches = [...line.matchAll(/\[\s*(\d+)%\]/g)]; if (matches.length) this.update('building','Preparando Whisper para este Mac…',Number(matches.at(-1)[1]) / 100);
    });
    return path.join(engine,'build/bin/whisper-cli');
  }
  async install() {
    if (this.running) throw new Error('Já existe uma instalação em andamento.');
    this.running = true; this.aborted = false;
    try {
      const existing = await this.installed(); if (existing) { this.update('ready','Whisper local instalado e verificado.',1); return existing; }
      if (!this.plan().supported && !this.buildOverride) throw new Error('Instalação guiada disponível para macOS Intel e Apple Silicon. Use a seleção manual.');
      const source = await this.obtain(this.source,'engine (código oficial)');
      this.checkCancelled(); this.update('building','Preparando engine local…');
      let binary;
      const built = path.join(this.root,'engine-built.json');
      try { const receipt = JSON.parse(fs.readFileSync(built,'utf8')); const candidate = path.join(this.root,'engine/build/bin/whisper-cli'); if (receipt.sourceSHA256 === this.source.sha256 && await digest(candidate) === receipt.binarySHA256) binary = candidate; } catch {}
      if (!binary) binary = this.buildOverride ? await this.buildOverride(source,this) : await this.build(source);
      this.checkCancelled(); await this.run(binary,['--help']);
      const binarySHA256 = await digest(binary);
      fs.writeFileSync(built,JSON.stringify({ sourceSHA256:this.source.sha256,binarySHA256 }),{ mode:0o600 });
      const model = await this.obtain(this.model,'modelo base multilíngue'); this.checkCancelled();
      const receipt = { version:'1.9.5',sourceSHA256:this.source.sha256,modelSHA256:this.model.sha256,binarySHA256,installedAt:new Date().toISOString() };
      fs.writeFileSync(path.join(this.root,'installed.json'),JSON.stringify(receipt,null,2),{ mode:0o600 });
      this.update('ready','Whisper local instalado e selecionado.',1);
      return { binary, model, language:'pt' };
    } catch (error) { this.update(this.aborted ? 'cancelled' : 'error',error.message); throw error; }
    finally { this.running = false; this.notify(this.plan()); }
  }
  signal(child, signal) {
    if (!child) return;
    try { if (process.platform !== 'win32') process.kill(-child.pid, signal); else child.kill(signal); } catch (error) { if (error.code !== 'ESRCH') child.kill(signal); }
  }
  cancel() {
    if (!this.running || this.aborted) return;
    this.aborted = true; const child = this.child; this.signal(child, 'SIGTERM');
    this.killTimer = setTimeout(() => { if (this.child === child) this.signal(child, 'SIGKILL'); }, 5000); this.killTimer.unref();
  }
}
module.exports = { WhisperSetup, SOURCE, MODEL, digest, valid };
