import {isOwnCapture} from './sources.mjs';
export function captureLabelMatches(actual,expected){return typeof actual==='string'&&typeof expected==='string'&&expected.length>0&&(actual===expected||actual.startsWith(expected+' ('));}
export async function waitForCapture(capture,enumerate,wait,{attempts=40}={}){
 if(!capture||typeof capture.label!=='string'||!capture.label)throw Error('Identidade da entrada temporária inválida.');
 for(let i=0;i<attempts;i++){
  const devices=await enumerate();const matches=devices.filter(d=>d.kind==='audioinput'&&captureLabelMatches(d.label,capture.label));
  if(matches.length>1)throw Error('Mais de uma entrada corresponde à captura atual. Atualize as fontes antes de iniciar.');
  if(matches.length===1&&matches[0].deviceId)return matches[0].deviceId;
  await wait(100);
 }
 throw Error('A entrada temporária atual não foi publicada. Atualize as fontes; nenhuma entrada antiga foi usada.');
}
export function assertCaptureTrack(stream,capture,deviceId){
 const track=stream.getAudioTracks()[0],settings=track?.getSettings?.();
 if(!track||!captureLabelMatches(track.label,capture.label)||settings?.deviceId&&settings.deviceId!==deviceId)throw Error('A entrada de áudio mudou durante a preparação. A captura antiga foi recusada; atualize as fontes.');
}
export function sourceFingerprint(native,inputs){
 const outputs=native.devices.filter(d=>!isOwnCapture(d)&&(!d.virtual||d.outputChannels>0)).map(d=>[d.uid,d.inputChannels||0,d.outputChannels||0,d.isDefault, d.sampleRate||0]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
 const microphones=inputs.map(d=>[d.deviceId,d.label]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
 return JSON.stringify([native.supported,outputs,microphones]);
}
