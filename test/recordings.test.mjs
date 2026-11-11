import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { RecordingStore } = require('../src/recordings.cjs');
function fixture(t, spawn) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sonora-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new RecordingStore(path.join(directory, 'recordings'), { spawn });
  const model = path.join(directory, 'modelo com espaço.bin'); fs.writeFileSync(model, 'fixture');
  const configure = () => store.configure({ binary: process.execPath, model });
  return { store, directory, configure };
}
const sources = [{ key: 'microphone', label: 'Microfone teste' }, { key: 'computer', label: 'Computador teste' }];
function saved(store) {
  const session = store.begin(sources);
  store.append(session.id, 0, { microphone: Uint8Array.from([1,0,2,0]), computer: Uint8Array.from([3,0,4,0]) });
  store.finish(session.id); return session;
}
test('PCM independente, sequência, cabeçalho final e permissões privadas', t => {
  const { store } = fixture(t);
  const session = store.begin(sources);
  assert.throws(() => store.append(session.id, 1, {}), /Sequência/);
  assert.throws(() => store.append(session.id, 0, { microphone: new Uint8Array(3), computer: new Uint8Array(3) }), /PCM/);
  store.append(session.id, 0, { microphone: Uint8Array.from([1,0,2,0]), computer: Uint8Array.from([3,0,4,0]) });
  const result = store.finish(session.id);
  assert.equal(result.durationMs, 0.125);
  for (const [key, first] of [['microphone',1],['computer',3]]) {
    const file = path.join(session.directory, key + '.wav'), wav = fs.readFileSync(file);
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF'); assert.equal(wav.readUInt32LE(40), 4);
    assert.equal(wav.readUInt32LE(24), 16000); assert.equal(wav.readInt16LE(44), first);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
  assert.equal(fs.statSync(session.directory).mode & 0o777, 0o700);
  assert.throws(() => store.append(session.id, 1, {}));
});
test('sem engine/modelo, preserva WAV e informa configuração pendente', async t => {
  const { store } = fixture(t, () => { throw new Error('não deveria executar'); });
  const session = saved(store), result = await store.transcribe(session.id);
  assert.equal(result.status, 'needs-setup'); assert.ok(fs.existsSync(path.join(session.directory, 'computer.wav')));
  assert.equal(fs.existsSync(path.join(session.directory, 'transcript.txt')), false);
});
test('contrato whisper-cli, ordenação temporal e rotulagem por fonte', async t => {
  const calls = [];
  const { store, configure } = fixture(t, (binary, args, options) => {
    calls.push({ binary, args, options });
    const child = new EventEmitter(); child.stderr = new EventEmitter();
    const key = args[args.indexOf('-f') + 1].includes('microphone') ? 'microphone' : 'computer';
    fs.writeFileSync(args[args.indexOf('-of') + 1] + '.json', JSON.stringify({ transcription: [{ offsets: { from: key === 'computer' ? 0 : 1000, to: 2000 }, text: key }] }));
    queueMicrotask(() => child.emit('close', 0)); return child;
  });
  configure(); const session = store.begin(sources);
  for(let i=0;i<2;i++)store.append(session.id,i,{microphone:new Uint8Array(32000).fill(1),computer:new Uint8Array(32000).fill(2)});
  store.finish(session.id);
  assert.equal((await store.transcribe(session.id)).status, 'completed');
  assert.equal(calls.length, 2); assert.equal(calls[0].options.shell, false);
  assert.ok(calls[0].args.includes('-oj')); assert.ok(calls[0].args.includes('auto'));
  const transcript = JSON.parse(fs.readFileSync(path.join(session.directory, 'transcript.json')));
  assert.equal(transcript.segments[0].source, 'computer'); assert.equal(transcript.segments[1].startMs, 1000);
  assert.match(fs.readFileSync(path.join(session.directory, 'transcript.txt'), 'utf8'), /00:00:01.000.*Microfone teste/);
});
test('JSON ausente/malformado falha sem reaproveitar saída antiga; permite tentar novamente', async t => {
  let valid = true;
  const { store, configure } = fixture(t, (_binary, args) => {
    const child = new EventEmitter(); child.stderr = new EventEmitter();
    if (valid) fs.writeFileSync(args[args.indexOf('-of') + 1] + '.json', JSON.stringify({ transcription: [] }));
    queueMicrotask(() => child.emit('close', 0)); return child;
  });
  configure(); const session = saved(store);
  assert.equal((await store.transcribe(session.id)).status, 'completed');
  valid = false;
  assert.equal((await store.transcribe(session.id)).status, 'failed');
  assert.ok(fs.existsSync(path.join(session.directory, 'microphone.wav')));
  valid = true; assert.equal((await store.transcribe(session.id)).status, 'completed');
});
test('cancelamento sinaliza subprocesso e não inicia o segundo canal', async t => {
  let kills = 0, calls = 0;
  const { store, configure } = fixture(t, () => {
    calls++; const child = new EventEmitter(); child.stderr = new EventEmitter();
    child.kill = signal => { assert.equal(signal, 'SIGTERM'); kills++; queueMicrotask(() => child.emit('close', null)); };
    return child;
  });
  configure(); const session = saved(store), promise = store.transcribe(session.id);
  assert.throws(() => store.begin(sources), /andamento/);
  store.cancel(); assert.equal((await promise).status, 'cancelled'); assert.equal(kills, 1); assert.equal(calls, 1);
});
test('reinício recupera WAV de sessão interrompida sem iniciar transcrição', t => {
  const { store } = fixture(t);
  const session = store.begin(sources);
  store.append(session.id, 0, { microphone: Uint8Array.from([1,0]), computer: Uint8Array.from([2,0]) });
  Object.values(store.active.files).forEach(fd => fs.closeSync(fd)); store.active = null;
  const recovered = new RecordingStore(store.root);
  assert.equal(recovered.info().latest.status, 'interrupted');
  assert.equal(recovered.info().latest.samples, 1);
  assert.equal(recovered.info().latest.durationMs, 0.0625);
  assert.equal(fs.readFileSync(path.join(session.directory, 'computer.wav')).readUInt32LE(40), 2);
});
test('AudioWorklet gera PCM little-endian, downmix estéreo e flush sem amostras após parar', () => {
  let Processor; const events = [];
  class Base { constructor() { this.port = { postMessage: value => events.push(value) }; } }
  vm.runInNewContext(fs.readFileSync(new URL('../src/pcm-worklet.js', import.meta.url), 'utf8'), { AudioWorkletProcessor: Base, registerProcessor: (_name, cls) => { Processor = cls; } });
  const processor = new Processor(), mic = new Float32Array(128).fill(0.5), left = new Float32Array(128).fill(1), right = new Float32Array(128).fill(-0.5);
  processor.process([[mic], [left, right]], [[new Float32Array(128)]]);
  processor.port.onmessage({ data: 'stop' });
  assert.equal(events[0].channels[0].byteLength, 256);
  assert.equal(new DataView(events[0].channels[0]).getInt16(0, true), 16384);
  assert.equal(new DataView(events[0].channels[1]).getInt16(0, true), 8192);
  assert.equal(events[1].stopped, true);
  processor.process([[mic]], [[new Float32Array(128)]]); assert.equal(events.length, 2);
});


test('histórico preserva múltiplas gravações sem Whisper após reinício e permite transcrever uma anterior', async t => {
  const { store } = fixture(t, () => { throw new Error('Whisper não deve executar ao gravar'); });
  const first = saved(store), second = saved(store);
  assert.equal(store.list().length, 2);
  assert.equal(store.list().every(session => session.status === 'saved'), true);
  const reopened = new RecordingStore(store.root);
  assert.deepEqual(new Set(reopened.info().sessions.map(session => session.id)), new Set([first.id, second.id]));
  assert.equal((await reopened.transcribe(first.id)).status, 'needs-setup');
  assert.equal(reopened.list().find(session => session.id === second.id).status, 'saved');
  for (const session of [first, second]) assert.ok(fs.existsSync(path.join(session.directory, 'microphone.wav')));
});


test('falha da engine preserva sessão antiga e não impede nova gravação independente', async t => {
  let calls = 0;
  const { store, configure } = fixture(t, () => {
    calls++; const child = new EventEmitter(); child.stderr = new EventEmitter();
    queueMicrotask(() => { child.stderr.emit('data', Buffer.from('fixture: modelo incompatível')); child.emit('close', 1); });
    return child;
  });
  configure(); const first = saved(store);
  assert.equal(calls, 0);
  assert.equal((await store.transcribe(first.id)).status, 'failed');
  const second = saved(store);
  assert.equal(calls, 1);
  assert.equal(store.list().find(session => session.id === second.id).status, 'saved');
  const reopened = new RecordingStore(store.root);
  assert.equal(reopened.list().length, 2);
  assert.equal(reopened.list().find(session => session.id === first.id).status, 'failed');
  assert.ok(fs.existsSync(path.join(first.directory, 'microphone.wav')));
  assert.ok(fs.existsSync(path.join(second.directory, 'computer.wav')));
});
