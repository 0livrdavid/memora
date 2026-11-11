import {assertCaptureTrack} from './capture-device.mjs';
import {resolveComputer} from './sources.mjs';
async function closeGraph(session,services){session.streams.forEach(s=>s.getTracks().forEach(t=>t.stop()));session.nodes.forEach(n=>n.disconnect());if(session.context&&session.context.state!=='closed')await session.context.close().catch(()=>{});if(session.native)await services.stopTap().catch(()=>{});}
export async function openLevelGraph(selection,services){
 const session={streams:[],nodes:[],native:false,context:null},analysers={},errors=[];
 try{
  const context=session.context=services.createContext();
  // sinkId:none is silent but still pulls the graph; zero-gain tails may be pruned.

  for(const [key,value] of Object.entries(selection)){
   if(!value)continue;
   let stream,ownsTap=false;
   try{
    let device=value,captureIdentity=null;
    if(key==='computer'){const selected=resolveComputer(await services.devices(),value);const capture=await services.startTap(selected.uid);session.native=true;ownsTap=true;captureIdentity=capture;device=await services.captureDevice(capture);}
    stream=await services.getStream(device);session.streams.push(stream);if(captureIdentity)await (services.verifyCapture||assertCaptureTrack)(stream,captureIdentity,device);
    const source=context.createMediaStreamSource(stream),analyser=context.createAnalyser();analyser.fftSize=2048;source.connect(analyser);analyser.connect(context.destination);session.nodes.push(source,analyser);
    analysers[key]={node:analyser,data:new Float32Array(analyser.fftSize),stream,captureIdentity,windows:0,nonzeroWindows:0,zeroWindows:0};
    stream.getAudioTracks().forEach(track=>track.addEventListener('ended',()=>{services.onEnded?.(key)}));
   }catch(error){stream?.getTracks().forEach(track=>track.stop());if(ownsTap){await services.stopTap().catch(()=>{});session.native=false;}errors.push((key==='computer'?'Computador':'Microfone')+': '+error.message);}
  }
  if(!Object.keys(analysers).length){await closeGraph(session,services);return {read:()=>({microphone:0,computer:0}),close:async()=>{},message:errors.length?'Medição indisponível · '+errors.join(' · '):'Fontes desativadas · sem salvar'};}
  await context.resume();
  const baseMessage=errors.length?'Medição parcial · '+errors.join(' · '):'Somente medição · sem salvar áudio';
  return {status:()=>analysers.computer?.zeroWindows>=60?baseMessage+' · Computador sem sinal: pode ser silêncio ou fonte parada. Atualize as fontes se há áudio tocando.':baseMessage,diagnostics:()=>({contextState:context.state,contextTime:context.currentTime,sources:Object.entries(analysers).map(([key,a])=>{const track=a.stream.getAudioTracks()[0],settings=track.getSettings();return {key,tapUID:a.captureIdentity?.uid,sourceUID:a.captureIdentity?.sourceUID,label:track.label,sampleRate:settings.sampleRate,channelCount:settings.channelCount,muted:track.muted,readyState:track.readyState,windows:a.windows,nonzeroWindows:a.nonzeroWindows,zeroWindows:a.zeroWindows};})}),read:()=>{if(context.state!=='running')throw Error('Medição suspensa pelo sistema. Atualize as fontes.');return Object.fromEntries(['microphone','computer'].map(key=>{const a=analysers[key];let peak=0;if(a&&context.state==='running'){a.node.getFloatTimeDomainData(a.data);for(const sample of a.data)peak=Math.max(peak,Math.abs(sample));a.windows++;if(peak>0){a.nonzeroWindows++;a.zeroWindows=0;}else a.zeroWindows++;}return [key,peak];}));},close:()=>closeGraph(session,services),message:errors.length?'Medição parcial · '+errors.join(' · '):'Somente medição · sem salvar áudio'};
 }catch(error){await closeGraph(session,services);throw error;}
}
