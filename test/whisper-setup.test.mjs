import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { WhisperSetup } = require('../src/whisper-setup.cjs');
const { RecordingStore } = require('../src/recordings.cjs');
function fixture(t, download) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'memora-setup-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const buffers = { 'source.tar.gz': Buffer.from('pinned source fixture'), 'base.bin': Buffer.from('pinned model fixture') };
  const item = name => ({ name, bytes:buffers[name].length,sha256:crypto.createHash('sha256').update(buffers[name]).digest('hex'),url:'https://example.invalid/'+name });
  let builds=0, downloads=0;
  const options={ source:item('source.tar.gz'),model:item('base.bin'),download:async(item,part,setup)=>{downloads++;if(download)await download(item,part,setup,buffers);else fs.writeFileSync(part,buffers[item.name]);},build:async()=>{builds++;const binary=path.join(root,'engine/build/bin/whisper-cli');fs.mkdirSync(path.dirname(binary),{recursive:true});fs.writeFileSync(binary,'#!/bin/sh\nexit 0\n',{mode:0o700});return binary;} };
  const setup=new WhisperSetup(root,options);
  return { root,setup,options,buffers,stats:()=>({builds,downloads}) };
}
test('instalação guiada verifica integridade, elimina parcial e persiste seleção após reabrir',async t=>{
 const {root,setup,options,stats}=fixture(t);fs.writeFileSync(path.join(root,'source.tar.gz.part'),'download incompleto');
 const result=await setup.install();assert.equal(setup.state.phase,'ready');assert.equal(fs.existsSync(path.join(root,'source.tar.gz.part')),false);
 const store=new RecordingStore(path.join(root,'recordings'));store.configure(result);
 assert.deepEqual(new RecordingStore(store.root).config,{...result,threads:4});assert.equal(stats().builds,1);
 const second=new WhisperSetup(root,options);assert.deepEqual(await second.installed(),result);await second.install();assert.equal(stats().builds,1);assert.equal(stats().downloads,2);
});
test('erro/hash inválido não seleciona modelo; retry reutiliza engine e obtém modelo íntegro',async t=>{
 let broken=true;
 const {setup,root,stats}=fixture(t,async(item,part,_setup,buffers)=>fs.writeFileSync(part,broken&&item.name==='base.bin'?Buffer.from('bad'):buffers[item.name]));
 await assert.rejects(setup.install(),/Integridade/);assert.equal(await setup.installed(),null);assert.equal(fs.existsSync(path.join(root,'base.bin.part')),false);assert.equal(stats().builds,1);
 broken=false;await setup.install();assert.equal(stats().builds,1);assert.ok(await setup.installed());
});
test('cancelamento preserva gravação e permite repetir configuração',async t=>{
 let cancel=true;
 const {setup,root}=fixture(t,async(item,part,instance,buffers)=>{fs.writeFileSync(part,buffers[item.name]);if(cancel)instance.cancel();});
 const store=new RecordingStore(path.join(root,'recordings'));const session=store.begin([{key:'microphone',label:'PCM fixture'}]);
 await assert.rejects(setup.install(),/cancelada/);assert.equal(setup.state.phase,'cancelled');assert.equal(setup.running,false);
 store.append(session.id,0,{microphone:Uint8Array.from([1,0])});assert.equal(store.finish(session.id).status,'saved');
 assert.equal(new RecordingStore(store.root).list().length,1);assert.equal(await setup.installed(),null);
 cancel=false;await setup.install();assert.equal(setup.state.phase,'ready');assert.equal(store.config.binary,'');
});
test('falha de rede preserva histórico; modelo adulterado após instalação é rejeitado',async t=>{
 let fail=true;
 const {setup,root}=fixture(t,async(item,part,_instance,buffers)=>{fs.writeFileSync(part,Buffer.from('partial'));if(fail)throw new Error('Rede indisponível');fs.writeFileSync(part,buffers[item.name]);});
 await assert.rejects(setup.install(),/Rede/);assert.equal(fs.existsSync(path.join(root,'source.tar.gz.part')),false);
 fail=false;const paths=await setup.install();fs.appendFileSync(paths.model,'alterado');assert.equal(await setup.installed(),null);
});
