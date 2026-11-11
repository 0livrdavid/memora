import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import compatibility from '../src/compatibility.cjs';
const {environmentValue}=compatibility;
test('current environment names override legacy launch settings, including empty values',()=>{
 for(const key of ['ELECTRON','DATA','SMOKE','RECORD_TEST']){
  const current=`MEMORA_${key}`,legacy=`SONORA_${key}`;
  assert.equal(environmentValue(current,{[current]:'new',[legacy]:'old'}),'new');
  assert.equal(environmentValue(current,{[current]:'',[legacy]:'old'}),'');
  assert.equal(environmentValue(current,{[legacy]:'old'}),'old');
  assert.equal(environmentValue(current,{}),undefined);
 }
});
test('recording preload exposes only the current recording bridge',()=>{
 const exposed=[];
 vm.runInNewContext(fs.readFileSync(new URL('../src/preload.cjs',import.meta.url),'utf8'),{
  require:()=>({contextBridge:{exposeInMainWorld:(name,api)=>exposed.push({name,api})},ipcRenderer:{}}),
 });
 assert.deepEqual(exposed.map(item=>item.name),['memoraRecording']);
 assert.equal(typeof exposed[0].api.recordBegin,'function');
 const renderer=fs.readFileSync(new URL('../src/recording.js',import.meta.url),'utf8');
 assert.match(renderer,/window\.memoraRecording\.recordBegin/);
 assert.match(renderer,/new AudioWorkletNode\(context, 'memora-pcm'/);
 assert.match(fs.readFileSync(new URL('../src/pcm-worklet.js',import.meta.url),'utf8'),/registerProcessor\('memora-pcm'/);
});
