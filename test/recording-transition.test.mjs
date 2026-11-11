import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{RecordingStore}=require('../src/recordings.cjs');
const sources=[{key:'microphone',label:'Fixture'}];
function deferred(){let resolve;return {promise:new Promise(r=>resolve=r),get resolve(){return resolve;}};}
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'memora-transition-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=new RecordingStore(path.join(root,'recordings'),{cancelGraceMs:100});
 const model=path.join(root,'model');fs.writeFileSync(model,'fixture');store.configure({binary:process.execPath,model});
 const recording=store.begin(sources);store.append(recording.id,0,{microphone:new Uint8Array(32000).fill(1)});store.finish(recording.id);
 const preserved={};for(const [name,content]of Object.entries({'transcript.json':'{"segments":[]}','transcript.txt':'Prior text','speaker-names.json':'{"name":"Fixture"}'}))fs.writeFileSync(path.join(recording.directory,name),content);
 for(const name of ['microphone.wav','transcript.json','transcript.txt','speaker-names.json'])preserved[name]=fs.readFileSync(path.join(recording.directory,name));
 let child,args,kills=0;
 store.spawn=(_bin,a)=>{args=a;child=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{kills++;queueMicrotask(()=>child.emit('close',null));};return child;};
 const complete=()=>{fs.writeFileSync(args[args.indexOf('-of')+1]+'.json',JSON.stringify({transcription:[{offsets:{from:0,to:300},text:'New fixture'}]}));child.emit('close',0);};
 return {store,recording,preserved,complete,get child(){return child},get kills(){return kills}};
}
test('declining confirmation preserves running job; reservation blocks all competing entry points',async t=>{
 const f=fixture(t),{store,recording}=f,done=store.transcribe(recording.id),answer=deferred();
 const pending=store.prepareRecording(snapshot=>{assert.equal(snapshot.id,recording.id);snapshot.preview.push('mutation');return answer.promise;});
 assert.deepEqual(store.processing().preview,[]);
 assert.equal(await store.prepareRecording(()=>{throw Error('must not prompt')}),null);
 assert.throws(()=>store.begin(sources),/andamento/);assert.throws(()=>store.configure({language:'en'}),/terminar/);
 await assert.rejects(store.transcribe(recording.id),/andamento/);
 assert.equal(store.releaseRecording('wrong'),false);answer.resolve(false);assert.equal(await pending,null);
 assert.equal(f.kills,0);assert.equal(store.job.cancelled,false);f.complete();await done;
});
test('confirmation cancels only its captured job and preserves WAV, text, names and backups',async t=>{
 const f=fixture(t),{store,recording,preserved}=f,done=store.transcribe(recording.id);
 const result=await store.prepareRecording(async()=>true);assert.ok(result.token);assert.equal((await done).status,'cancelled');assert.equal(f.kills,1);
 for(const [name,data]of Object.entries(preserved))assert.deepEqual(fs.readFileSync(path.join(recording.directory,name)),data);
 const backup=path.join(recording.directory,'transcript-backups',fs.readdirSync(path.join(recording.directory,'transcript-backups'))[0]);
 for(const name of ['transcript.json','transcript.txt','speaker-names.json'])assert.deepEqual(fs.readFileSync(path.join(backup,name)),preserved[name]);
 assert.throws(()=>store.begin(sources),/andamento/);assert.throws(()=>store.begin([],result.token),/inválidas/);
 const next=store.begin(sources,result.token);assert.notEqual(next.id,recording.id);assert.throws(()=>store.begin(sources,result.token),/andamento/);store.finish(next.id);
 assert.throws(()=>store.begin(sources,result.token),/andamento/);
});
test('natural completion during confirmation stays completed and never receives cancellation',async t=>{
 const f=fixture(t),{store,recording}=f,done=store.transcribe(recording.id),answer=deferred();
 const pending=store.prepareRecording(()=>answer.promise);f.complete();assert.equal((await done).status,'completed');answer.resolve(true);
 const result=await pending;assert.ok(result.token);assert.equal(f.kills,0);assert.equal(store.sessions.get(recording.id).metadata.status,'completed');store.releaseRecording(result.token);
});
test('dialog failures release reservation; missing confirmation never cancels',async t=>{
 const f=fixture(t),{store,recording}=f,done=store.transcribe(recording.id);
 await assert.rejects(store.prepareRecording(()=>{throw Error('dialog failed')}),/dialog failed/);assert.equal(store.recordingReservation,null);
 assert.equal(await store.prepareRecording(),null);assert.equal(f.kills,0);f.complete();await done;
 const result=await store.prepareRecording();assert.ok(result.token);assert.equal(store.releaseRecording(result.token),true);assert.equal(store.releaseRecording(result.token),false);
});
test('close invalidates pending confirmation and shutdown waits for cancellation',async t=>{
 const f=fixture(t),{store,recording}=f,done=store.transcribe(recording.id),answer=deferred();
 const pending=store.prepareRecording(()=>answer.promise);await store.shutdown();await done;answer.resolve(true);assert.equal(await pending,null);
 assert.equal(await store.prepareRecording(),null);assert.throws(()=>store.begin(sources),/andamento/);assert.equal(store.recordingReservation,null);
});
test('begin persistence failure retains reservation without a phantom active session',async t=>{
 const {store}=fixture(t),result=await store.prepareRecording(),persist=store.persist;
 store.persist=()=>{throw Error('disk fixture failure')};assert.throws(()=>store.begin(sources,result.token),/disk fixture/);assert.equal(store.active,null);
 store.persist=persist;const next=store.begin(sources,result.token);store.finish(next.id);
});
test('cancellation waits for resistant descendant even after process leader closes', {skip:process.platform==='win32',timeout:10000},async t=>{
 const {store,recording}=fixture(t),ready=deferred();let childPID;
 store.spawn=(_binary,_args,options)=>{
   const grandchild="process.on('SIGTERM',()=>{});console.log(process.pid);setInterval(()=>{},1000)";
   const script=`const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:['ignore','pipe','ignore']});c.stdout.once('data',b=>{console.error(b.toString().trim());c.stdout.destroy();});setInterval(()=>{},1000);`;
   const child=spawn(process.execPath,['-e',script],options);
   child.stderr.once('data',b=>{childPID=Number(b.toString().trim());ready.resolve();});return child;
 };
 const done=store.transcribe(recording.id);await ready.promise;const group=store.job.process.pid;
 t.after(()=>{try{process.kill(-group,'SIGKILL')}catch{}});
 const start=Date.now(),result=await store.prepareRecording(async()=>true);
 assert.ok(Date.now()-start>=90);assert.ok(result.token);assert.equal((await done).status,'cancelled');
 assert.throws(()=>process.kill(childPID,0),{code:'ESRCH'});assert.throws(()=>process.kill(-group,0),{code:'ESRCH'});
});
test('terminal persistence failure blocks a new recording after confirmed cancellation',async t=>{
 const f=fixture(t),{store,recording}=f,done=store.transcribe(recording.id);
 const rejection=assert.rejects(done,/terminal disk failure/),persist=store.persist;
 store.persist=function(session){if(session.metadata.status==='cancelled')throw Error('terminal disk failure');return persist.call(this,session);};
 await assert.rejects(store.prepareRecording(async()=>true),/terminal disk failure/);await rejection;
 assert.ok(store.job);assert.equal(store.recordingReservation,null);assert.throws(()=>store.begin(sources),/andamento/);
 await assert.rejects(store.prepareRecording(async()=>true),/terminal disk failure/);
 assert.equal(JSON.parse(fs.readFileSync(path.join(recording.directory,'session.json'))).status,'transcribing');
});
test('cancellation during preparation notification never spawns a late child',async t=>{
 const {store,recording}=fixture(t);let spawned=0;
 store.spawn=()=>{spawned++;throw Error('late process must not start')};
 store.notify=()=>{if(store.job&&!store.job.cancelled)store.cancel();};
 const result=await store.transcribe(recording.id);assert.equal(result.status,'cancelled');assert.equal(spawned,0);assert.equal(store.job,null);
});
test('leader is reaped before group probe, avoiding macOS zombie EPERM without ignoring denied probes',async()=>{
 const {trackProcess,stopProcess}=require('../src/transcription-process.cjs');
 const child=new EventEmitter();child.pid=123456789;const job={};trackProcess(job,child,true);
 const originalKill=process.kill,signals=[];
 process.kill=(pid,signal)=>{assert.equal(pid,-child.pid);signals.push(signal);if(signal==='SIGTERM'){setTimeout(()=>child.emit('close',null),15);return true;}if(signal===0){if(!job.process.closed)throw Object.assign(Error('zombie probe'),{code:'EPERM'});throw Object.assign(Error('gone'),{code:'ESRCH'});}return true;};
 try {await stopProcess(job,100);assert.deepEqual(signals,['SIGTERM',0]);}finally{process.kill=originalKill;}
});
test('a denied group probe after leader close still fails closed',async()=>{
 const {trackProcess,stopProcess}=require('../src/transcription-process.cjs');
 const child=new EventEmitter();child.pid=123456789;const job={};trackProcess(job,child,true);
 const originalKill=process.kill,originalError=console.error;console.error=()=>{};
 process.kill=(_pid,signal)=>{if(signal==='SIGTERM'){queueMicrotask(()=>child.emit('close',null));return true;}throw Object.assign(Error('probe denied'),{code:'EPERM'});};
 try {await assert.rejects(stopProcess(job,100),{code:'EPERM'});}finally{process.kill=originalKill;console.error=originalError;}
});
