const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const path = require('node:path');
class CaptureBridge {
  constructor({spawnChild=spawn,closeTimeout=2500}={}) { this.spawnChild=spawnChild;this.closeTimeout=closeTimeout;this.child=null;this.closing=null;this.serial=0;this.pending=new Map();this.onExit=()=>{}; }
  launch() {
    if(this.child)return;
    const child=this.spawnChild(path.join(__dirname,'../.local/sonora-capture'),[],{stdio:['pipe','pipe','pipe']});
    this.child=child;
    child.stderr.on('data',chunk=>console.error('CoreAudio:',chunk.toString().slice(0,1000)));
    child.stdin.on('error',()=>{});
    createInterface({input:child.stdout}).on('line',line=>{
      try{const reply=JSON.parse(line),request=this.pending.get(reply.id);if(!request)return;clearTimeout(request.timer);this.pending.delete(reply.id);if(reply.error)request.reject(Error(reply.error));else request.resolve(reply.result);}catch(error){console.error('Resposta nativa inválida:',error.message);}
    });
    child.once('error',error=>{this.lastError=error;});
    child.once('close',()=>{
      if(this.child!==child)return;
      this.child=null;
      for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(Error(this.lastError?.message||'A captura nativa foi encerrada.'));}
      this.pending.clear();this.lastError=null;
      if(!this.closing)this.onExit();
    });
  }
  async request(command,uid,identity) {
    if(this.closing)await this.closing;
    this.launch();
    return new Promise((resolve,reject)=>{
      const id=++this.serial;
      const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('O macOS não respondeu à captura. Verifique a autorização de gravação de áudio.'));void this.close();},20000);
      this.pending.set(id,{resolve,reject,timer});
      this.child.stdin.write(JSON.stringify({id,command,uid,identity})+'\n');
    });
  }
  close() {
    if(this.closing)return this.closing;
    const child=this.child;if(!child)return Promise.resolve();
    // Await cleanup/exit before allowing a new helper. The native lease also covers crashes.
    this.closing=new Promise(resolve=>{
      const timer=setTimeout(()=>{if(this.child===child)child.kill('SIGKILL');},this.closeTimeout);
      child.once('close',()=>{clearTimeout(timer);resolve();});
      child.kill('SIGTERM');
    }).finally(()=>{this.closing=null;});
    return this.closing;
  }
}
module.exports={CaptureBridge};
