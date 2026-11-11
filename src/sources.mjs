export const DEFAULT_OUTPUT='system-default';
export function isOwnCapture(device){return device.ownedCapture===true||typeof device.uid==='string'&&/^local\.sonora\.capture(?:\.|$)/.test(device.uid);}
export function captureOutputs(native){return native.supported?native.devices.filter(d=>typeof d.uid==='string'&&d.uid.length>0&&d.outputChannels>0&&!isOwnCapture(d)):[];}
export function resolveComputer(native,selection){
 if(!selection)return null;
 const devices=captureOutputs(native);
 const device=selection===DEFAULT_OUTPUT?devices.find(d=>d.isDefault):devices.find(d=>d.uid===selection);
 if(!device)throw Error('A saída do computador selecionada está indisponível. Escolha uma saída disponível em Configurações ou desative explicitamente o áudio do computador. Entradas de captura do próprio Memora não podem ser usadas como saída.');
 return device;
}
export function computerOptions(native,selection){
 const devices=captureOutputs(native),current=devices.find(d=>d.isDefault);
 const options=[{deviceId:DEFAULT_OUTPUT,label:current?`Saída atual do sistema · ${current.label}${current.virtual?' (virtual)':''}`:'Saída atual indisponível'}];
 for(const d of devices)options.push({deviceId:d.uid,label:d.label+(d.virtual?' (virtual)':'')});
 if(selection&&!options.some(d=>d.deviceId===selection))options.push({deviceId:selection,label:'Saída selecionada desconectada · escolha outra'});
 return options;
}
