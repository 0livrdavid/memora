import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../src/recording.js',import.meta.url),'utf8');
function fixture(){
 const calls=[],nodes={},$=id=>nodes[id]??={value:'default',classList:{toggle(){}},setAttribute(){}};
 const context=vm.createContext({$,preferences:{markerShortcut:'CommandOrControl+Shift+M'},shortcutText:value=>value,current:null,startPending:false,processing:{id:'old',attempt:'a'},busy:true,manualPending:false,config:{latest:{hasTranscript:true}},selectedSession:null,
 document:{querySelector:()=>({})},message:(...args)=>calls.push(['message',...args]),
 window:{sonora:{recordPrepare:async()=>{calls.push(['prepare']);return {token:'token'}},recordRelease:async token=>calls.push(['release',token])}},startCapture:async token=>calls.push(['capture',token])});
 vm.runInContext(source.slice(source.indexOf('function controls(){'),source.indexOf('function historySelection')),context);
 vm.runInContext(source.slice(source.indexOf('async function start() {'),source.indexOf('async function startCapture(')),context);
 vm.runInContext(source.slice(source.indexOf('async function toggle(){'),source.indexOf('window.sonoraStopRecording=')),context);
 return {context,calls,$,start:()=>vm.runInContext('start()',context),toggle:()=>vm.runInContext('toggle()',context),controls:()=>vm.runInContext('controls()',context)};
}
test('record remains enabled during analysis and reserves before opening capture',async()=>{
 const {calls,$,start,controls}=fixture();controls();assert.equal($('record-toggle').disabled,false);await start();assert.deepEqual(calls,[['prepare'],['capture','token'],['release','token']]);
});
test('cancel confirmation never opens capture, releases pending UI, preserves processing',async()=>{
 const {context,calls,start,$}=fixture();context.window.sonora.recordPrepare=async()=>null;await start();assert.deepEqual(calls,[]);assert.equal(context.processing.id,'old');assert.equal(context.startPending,false);assert.equal($('record-toggle').disabled,false);
});
test('repeated clicks or shortcut while confirmation pending trigger only one request',async()=>{
 const {context,calls,start,toggle,$}=fixture();let resolve;context.window.sonora.recordPrepare=()=>{calls.push(['prepare']);return new Promise(r=>{resolve=r})};const first=start();assert.equal($('record-toggle').disabled,true);await start();await toggle();assert.deepEqual(calls,[['prepare']]);resolve({token:'one'});await first;assert.deepEqual(calls,[['prepare'],['capture','one'],['release','one']]);
});
test('capture failure releases reservation and restores UI rather than stranding the next attempt',async()=>{
 const {context,calls,start}=fixture();context.startCapture=async()=>{throw Error('Source unavailable')};await start();assert.deepEqual(calls,[['prepare'],['message','Source unavailable',true],['release','token']]);assert.equal(context.startPending,false);
});
test('no selected source does not interrupt analysis or prompt',async()=>{
 const {calls,start,$}=fixture();$('record-mic').value='';$('record-source').value='';await start();assert.deepEqual(calls,[['message','Selecione pelo menos uma fonte.',true]]);
});
test('already stopping analysis blocks repeated requests until final state arrives',async()=>{
 const {context,calls,start,controls,$}=fixture();context.processing.cancelling=true;controls();assert.equal($('record-toggle').disabled,true);await start();assert.deepEqual(calls,[]);
});
test('only the two requested direct actions are present; transcription retry stays in history',()=>{
 const html=fs.readFileSync(new URL('../src/index.html',import.meta.url),'utf8');const actions=html.match(/<div id="latest-actions"[^>]*>(.*?)<\/div>/)[1];assert.equal((actions.match(/<button/g)||[]).length,2);assert.match(actions,/id="latest-view"[^>]*>Ver transcrição<\/button><button id="latest-rename"[^>]*>Renomear/);assert.doesNotMatch(html,/id="latest-(more|menu)"/);assert.match(html,/id="record-retry"/);
});

test('a finishing capture remains owned while its history refresh is pending',async()=>{
 const {context,toggle,calls}=fixture();const old={stopping:false,samples:100,streams:[],nodes:[]};context.current=old;
 let finishRefresh;context.setup=()=>new Promise(resolve=>{finishRefresh=resolve});context.release=async()=>{};context.clearTimeout=()=>{};context.monitorSources=()=>{};context.renderResult=()=>{};
 context.window.sonora.feedback=()=>{};context.window.sonora.recordStatus=()=>{};context.window.sonora.recordFinish=async()=>({id:'old'});old.id='old';
 vm.runInContext(source.slice(source.indexOf('async function stop('),source.indexOf('async function toggle(){')),context);
 const stopping=vm.runInContext('stop()',context);while(!finishRefresh)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(context.current,old);await toggle();assert.deepEqual(calls,[]);finishRefresh();await stopping;assert.equal(context.current,null);
});
