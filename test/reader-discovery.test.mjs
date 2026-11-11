import {transcriptBlocks,BLOCK_LIMITS} from '../src/transcript-blocks.mjs';
import{test}from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import os from'node:os';import path from'node:path';import vm from'node:vm';import{createRequire}from'node:module';import{preferredBundle}from'../scripts/app-bundle.mjs';import{createPlayback}from'../src/reader-playback.mjs';const require=createRequire(import.meta.url),{readBuild}=require('../src/app-build.cjs');
class E{constructor(){this.open=false;this.children=[];this.textContent='';this.hidden=false;this.value='';this.plays=0;this.pauses=0;this.style={};this.paused=true;this.listeners={};}addEventListener(k,f){this.listeners[k]=f}setAttribute(k,v){this[k]=v}append(...x){this.children.push(...x)}replaceChildren(...x){this.children=x}removeAttribute(k){this[k]=''}focus(){this.focused=true}select(){this.selected=true}load(){}pause(){this.pauses++;this.paused=true}play(){this.plays++;this.paused=false;return Promise.resolve()}}
async function reader(initial,options={}){const html=fs.readFileSync(new URL('../src/reader.html',import.meta.url),'utf8'),nodes={};for(const m of html.matchAll(/id="([^"]+)"/g))nodes[m[1]]=new E();let data=initial,changed,renamed,requests=[],names=[],renames=[],listeners={},revoked=0;const context=vm.createContext({transcriptBlocks,BLOCK_LIMITS,createPlayback:options=>createPlayback({...options,makeURL:()=> 'blob:fixture',releaseURL:()=>revoked++}),document:{getElementById:id=>nodes[id],createElement:()=>new E(),createTextNode:text=>Object.assign(new E(),{textContent:text}),documentElement:{scrollWidth:700}},innerWidth:700,URL:{createObjectURL:()=> 'blob:fixture',revokeObjectURL:()=>revoked++},Blob:class{},phrases:s=>s,timestamp:ms=>String(ms),window:{addEventListener:(event,fn)=>listeners[event]=fn,reader:{rename:async(id,title)=>{renames.push([id,title]);if(options.rename)return options.rename(id,title);if(!title.trim()||title.trim().length>160)throw Error('Use um nome de 1 a 160 caracteres.');data={...data,title:title.trim()};renamed({id,title:data.title});return {id,title:data.title};},get:async()=>structuredClone(data),close(){},renamed:f=>renamed=f,changed:f=>changed=f,block:async(...x)=>{requests.push(['block',...x]);return {audio:new Uint8Array(44)};},phrase:async(...x)=>{requests.push(['phrase',...x]);return {audio:new Uint8Array(44)};},sample:async(...x)=>{requests.push(x);return{audio:new Uint8Array(44),count:2,startMs:0}},name:async(...x)=>{names.push(x);data.speakers.find(s=>s.id===x[1]).name=x[2];}}}});const source=fs.readFileSync(new URL('../src/reader.js',import.meta.url),'utf8').replace(/^import .*?;\n/gm,'');await vm.runInContext('(async()=>{'+source+'})()',context);return{nodes,requests,names,renames,listeners,get title(){return context.document.title},get revoked(){return revoked},async change(next){data=next;await changed();}};}
const legacy=()=>({id:'fixture',title:'Fixture',startedAt:new Date().toISOString(),durationMs:3000,resultId:'legacy',revision:'rev',audioSources:['computer'],speakers:[],segments:[{source:'computer',text:'Texto fixture',startMs:0,endMs:1000}]}),diarized=()=>({...legacy(),resultId:'diarized-result',speakers:[{id:'remote-1',name:'Remoto 1',label:'Remoto 1'}],segments:[{source:'computer',speakerId:'remote-1',text:'Texto fixture',startMs:0,endMs:1000,uncertain:false}]});
test('legacy transcript keeps speaker details collapsed and never starts processing or playback',async()=>{const ui=await reader(legacy());assert.equal(ui.nodes['speaker-settings'].hidden,false);assert.equal(ui.nodes['speaker-settings'].open,false);assert.equal(ui.nodes['speaker-count'].textContent,'0');assert.equal(ui.nodes['speaker-empty'].hidden,false);assert.match(ui.nodes['speaker-empty'].textContent,/processamento local padrão/);assert.equal(ui.nodes['speaker-list'].children.length,0);assert.equal(ui.nodes['phrase-audio'].plays,0);assert.equal(ui.requests.length,0);assert.equal(ui.names.length,0);});
test('diarized transcript exposes naming with user-triggered multiple samples and correct result scope',async()=>{const ui=await reader(diarized());assert.equal(ui.nodes['speaker-settings'].hidden,false);assert.equal(ui.nodes['speaker-empty'].hidden,true);assert.equal(ui.nodes['speaker-list'].children.length,1);assert.equal(ui.nodes['phrase-audio'].plays,0);const form=ui.nodes['speaker-list'].children[0];await form.children[1].onclick();await form.children[1].onclick();assert.deepEqual(ui.requests.map(a=>a[2]),[0,1]);assert.equal(ui.nodes['phrase-audio'].plays,2);form.children[0].children[0].value='Pessoa fixture';await form.onsubmit({preventDefault(){}});assert.equal(ui.names.length,1);assert.deepEqual(Array.from(ui.names[0]),['diarized-result','remote-1','Pessoa fixture']);});
test('switching to transcript without speakers stops old audio and shows the explanation',async()=>{const ui=await reader(diarized());await ui.nodes['speaker-list'].children[0].children[1].onclick();const before=ui.nodes['phrase-audio'].pauses;await ui.change(legacy());assert.ok(ui.nodes['phrase-audio'].pauses>before);assert.equal(ui.nodes['speaker-list'].children.length,0);assert.equal(ui.nodes['speaker-empty'].hidden,false);assert.equal(ui.revoked,1);});
test('instance build metadata reports actual bundle path and launcher prefers only matching installed project',t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'memora-build-info-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const installed=path.join(root,'Applications/Memora.app'),resources=path.join(installed,'Contents/Resources/app');fs.mkdirSync(resources,{recursive:true});const meta={build:'2026-10-30-speaker-discovery',entry:path.join(root,'src/main.cjs'),data:path.join(root,'.local')};fs.writeFileSync(path.join(resources,'memora-build.json'),JSON.stringify(meta));const app={getPath:()=>path.join(installed,'Contents/MacOS/Electron'),getAppPath:()=>resources,getVersion:()=> '0.1.0'};assert.deepEqual(readBuild(app),{id:meta.build,bundle:installed,version:'0.1.0'});assert.equal(preferredBundle(root,installed),installed);meta.entry='/other-project/src/main.cjs';fs.writeFileSync(path.join(resources,'memora-build.json'),JSON.stringify(meta));assert.equal(preferredBundle(root,installed),path.join(root,'.local/macos/Memora.app'));meta.build='<invalid>';fs.writeFileSync(path.join(resources,'memora-build.json'),JSON.stringify(meta));assert.equal(readBuild(app).id,'desenvolvimento');});
test('experimental result without speakers does not incorrectly tell user to switch backend',async()=>{const data=legacy();data.engine={name:'whisperx-nemotron-experimental'};const ui=await reader(data);assert.match(ui.nodes['speaker-empty'].textContent,/não contém falantes/);assert.doesNotMatch(ui.nodes['speaker-empty'].textContent,/selecione Configurações/);assert.equal(ui.nodes['phrase-audio'].plays,0);});

function elements(node,predicate){return [...(predicate(node)?[node]:[]),...node.children.flatMap(child=>elements(child,predicate))];}
test('grouped reader renders one name and range, keeps text and exposes individual timestamps and clips',async()=>{
 const data=diarized();data.segments.push({...data.segments[0],text:'Segundo trecho.',startMs:1200,endMs:2200});const ui=await reader(data),content=ui.nodes['reader-content'];
 assert.equal(content.children.length,1);const origins=elements(content,n=>n.className==='origin');assert.equal(origins.length,1);assert.equal(origins[0].children[0].textContent,'Remoto 1');
 const details=elements(content,n=>n.className==='block-segments');assert.equal(details.length,1);assert.equal(details[0].children[0].textContent,'Trechos');assert.equal(details[0].open,false);assert.equal(details[0].children[0].title,'Tempos e áudio de 2 trechos');
 const block=elements(content,n=>n.className?.split(' ').includes('block-play'))[0];await block.onclick();assert.deepEqual(Array.from(ui.requests[0]),['block','rev',0]);
 const clips=elements(content,n=>n.className==='phrase-play');assert.equal(clips.length,2);await clips[1].onclick();assert.deepEqual(Array.from(ui.requests[1]),['phrase','rev',1,1200,2200]);assert.equal(block.textContent,'▶');
 data.audioSources=[];await ui.change(data);assert.equal(elements(content,n=>n.className?.split(' ').includes('block-play'))[0].disabled,true);assert.ok(elements(content,n=>n.className==='phrase-play').every(n=>n.disabled));
});


test('reader starts with compact information, speaker count, player before speakers and no session playback',async()=>{
 const data=diarized();data.durationMs=12000;const ui=await reader(data);
 assert.equal(ui.nodes['reader-info'].open,false);assert.equal(ui.nodes['speaker-settings'].open,false);
 assert.equal(ui.nodes['speaker-count'].textContent,'1');assert.match(ui.nodes['reader-meta'].textContent,/12 s · 1 falante$/);
 assert.match(ui.nodes['playback-note'].textContent,/somente o trecho ou bloco selecionado, não a gravação inteira/);
 assert.match(ui.nodes['playback-note'].textContent,/10 minutos/);
 assert.equal(ui.nodes['phrase-audio'].src,'');assert.equal(ui.nodes['phrase-audio'].plays,0);assert.equal(ui.nodes['playback-stop'].hidden,true);
 const html=fs.readFileSync(new URL('../src/reader.html',import.meta.url),'utf8');
 assert.ok(html.indexOf('id="playback"')<html.indexOf('id="speaker-settings"'));
 assert.match(html,/<strong>Memora<\/strong>/);assert.match(html,/id="reader-close"[^>]*>Fechar<\/button>/);
 assert.doesNotMatch(html,/<audio[^>]*\s(?:src|autoplay)=/);
});

test('single blocks keep original text and closed Trechos with exact playable interval',async()=>{
 const data=diarized();data.segments[0].text='<script>untrusted</script> Texto original.';
 const before=JSON.stringify(data),ui=await reader(data),content=ui.nodes['reader-content'];
 assert.equal(JSON.stringify(data),before);assert.equal(content.children.length,1);
 const details=elements(content,n=>n.className==='block-segments');assert.equal(details.length,1);assert.equal(details[0].open,false);
 assert.equal(details[0].children[0].textContent,'Trechos');assert.equal(details[0].children[0].title,'Tempos e áudio de 1 trecho');
 const text=elements(content,n=>n.textContent===data.segments[0].text);assert.equal(text.length,1);assert.equal(text[0].children.length,0);
 const row=elements(content,n=>n.className?.split(' ').includes('single-play'))[0];assert.equal(row.textContent,'▶');
 await row.onclick();assert.deepEqual(Array.from(ui.requests[0]),['phrase','rev',0,0,1000]);assert.equal(row.textContent,'Ⅱ');assert.equal(row['aria-pressed'],'true');assert.match(row['aria-label'],/^Pausar · Ouvir trecho/);
 assert.equal(ui.nodes['playback-stop'].hidden,false);await row.onclick();assert.equal(row.textContent,'▶');assert.equal(row['aria-pressed'],'false');
 ui.nodes['playback-stop'].onclick();assert.equal(row.textContent,'▶');assert.equal(ui.nodes['playback-stop'].hidden,true);
 const clip=elements(content,n=>n.className==='phrase-play')[0];await clip.onclick();assert.deepEqual(Array.from(ui.requests.at(-1)),['phrase','rev',0,0,1000]);
});

test('review badges expose uncertainty and preserve original warning details without expanding the page',async()=>{
 const data=diarized();data.warning='Revisão necessária: confira o áudio.';data.segments[0].uncertain=true;data.segments[0].origin={overlap:true,echoRisk:true};
 const ui=await reader(data),content=ui.nodes['reader-content'];
 assert.equal(ui.nodes['reader-info'].open,false);assert.equal(ui.nodes['reader-warning-indicator'].hidden,false);
 assert.equal(ui.nodes['reader-warning'].hidden,false);assert.equal(ui.nodes['reader-warning'].textContent,data.warning);
 const badge=elements(content,n=>n.className==='review-badge')[0];assert.equal(badge.textContent,'Revisar');
 assert.match(badge.title,/incerta/);assert.match(badge.title,/Sobreposição/);assert.match(badge.title,/eco/);
 const caution=elements(content,n=>n.className==='segment-caution')[0];assert.equal(caution.textContent,badge.title);
 assert.equal(elements(content,n=>n.className==='block-segments')[0].open,false);
});

test('long blocks disable only their whole-block action and missing audio preserves all text',async()=>{
 const data=diarized();data.segments.push({...data.segments[0],text:'Último trecho.',startMs:610000,endMs:612000});
 const ui=await reader(data),content=ui.nodes['reader-content'];
 const block=elements(content,n=>n.className?.split(' ').includes('block-play'))[0];assert.equal(block.disabled,true);assert.match(block.title,/10 minutos/);
 assert.ok(elements(content,n=>n.className==='phrase-play').every(n=>!n.disabled));
 data.audioSources=[];await ui.change(data);assert.match(ui.nodes['playback-note'].textContent,/Áudio indisponível/);
 assert.ok(elements(content,n=>n.className==='phrase-play').every(n=>n.disabled));
 assert.ok(elements(content,n=>n.textContent==='Último trecho.').length);assert.equal(ui.nodes['phrase-audio'].plays,0);
});

test('naming refresh keeps current disclosures open but changing result folds them and stops playback',async()=>{
 const data=diarized(),ui=await reader(data);ui.nodes['speaker-settings'].open=true;ui.nodes['reader-info'].open=true;
 const form=ui.nodes['speaker-list'].children[0];form.children[0].children[0].value='Pessoa fixture';await form.onsubmit({preventDefault(){}});
 assert.equal(ui.nodes['speaker-settings'].open,true);assert.equal(ui.nodes['reader-info'].open,true);
 assert.equal(elements(ui.nodes['reader-content'],n=>n.className==='speaker-name')[0].textContent,'Pessoa fixture');
 await ui.change(legacy());assert.equal(ui.nodes['speaker-settings'].open,false);assert.equal(ui.nodes['reader-info'].open,false);
 assert.equal(ui.nodes['speaker-count'].textContent,'0');assert.equal(ui.nodes['phrase-audio'].src,'');
});


test('meeting rename is visible, selects current title, persists safely and keeps speaker names unchanged',async()=>{
 const data=diarized(),before=JSON.stringify(data),ui=await reader(data),n=ui.nodes;
 assert.equal(n['reader-rename'].disabled,false);n['reader-rename'].onclick();assert.equal(n['reader-rename-form'].hidden,false);assert.equal(n['reader-rename-title'].value,'Fixture');assert.equal(n['reader-rename-title'].selected,true);
 n['reader-rename-title'].value='  Reunião <img> / equipe  ';await n['reader-rename-form'].onsubmit({preventDefault(){}});
 assert.deepEqual(ui.renames,[['fixture','  Reunião <img> / equipe  ']]);assert.equal(n['reader-title'].textContent,'Reunião <img> / equipe');assert.equal(ui.title,'Reunião <img> / equipe · Memora');assert.equal(n['reader-rename-form'].hidden,true);assert.equal(n['reader-rename'].focused,true);assert.match(n['reader-rename-state'].textContent,/atualizado/);assert.equal(JSON.stringify(data),before);assert.equal(ui.names.length,0);assert.equal(ui.requests.length,0);
});
test('cancel and Escape close meeting rename without writes; invalid title stays editable',async()=>{
 const ui=await reader(legacy()),n=ui.nodes;
 n['reader-rename'].onclick();n['reader-rename-title'].value='Cancelado';n['reader-rename-cancel'].onclick();assert.equal(n['reader-rename-form'].hidden,true);assert.deepEqual(ui.renames,[]);
 n['reader-rename'].onclick();let prevented=false;ui.listeners.keydown({key:'Escape',preventDefault(){prevented=true}});assert.equal(prevented,true);assert.equal(n['reader-rename-form'].hidden,true);assert.deepEqual(ui.renames,[]);
 n['reader-rename'].onclick();n['reader-rename-title'].value='   ';await n['reader-rename-form'].onsubmit({preventDefault(){}});assert.equal(n['reader-rename-form'].hidden,false);assert.equal(n['reader-rename-save'].disabled,false);assert.equal(n['reader-rename-state']['data-error'],'true');assert.equal(n['reader-title'].textContent,'Fixture');assert.equal(n['reader-rename-title'].focused,true);
});
test('meeting rename rejects duplicate submits and cannot rename another session after navigation',async()=>{
 let finish;const ui=await reader(legacy(),{rename:(id,title)=>new Promise(resolve=>finish=()=>resolve({id,title}))}),n=ui.nodes;
 n['reader-rename'].onclick();n['reader-rename-title'].value='Somente primeira';const request=n['reader-rename-form'].onsubmit({preventDefault(){}});
 assert.equal(n['reader-rename-save'].disabled,true);assert.equal(n['reader-rename-cancel'].disabled,true);await n['reader-rename-form'].onsubmit({preventDefault(){}});n['reader-rename-cancel'].onclick();assert.equal(n['reader-rename-form'].hidden,false);assert.equal(ui.renames.length,1);
 await ui.change({...legacy(),id:'other',title:'Outra reunião'});assert.equal(n['reader-rename-form'].hidden,true);assert.equal(n['reader-rename-state'].hidden,true);finish();await request;assert.equal(n['reader-title'].textContent,'Outra reunião');assert.equal(n['reader-rename'].disabled,false);assert.equal(n['reader-rename-state'].hidden,true);
 n['reader-rename'].onclick();await ui.change({...legacy(),id:'third',title:'Terceira reunião'});await n['reader-rename-form'].onsubmit({preventDefault(){}});assert.equal(ui.renames.length,1);
});
test('reader meeting rename IPC validates sender and displayed ID, checks idle and broadcasts the updated title',()=>{
 const source=fs.readFileSync(new URL('../src/main.cjs',import.meta.url),'utf8').split('\n').find(line=>line.includes("ipcMain.handle('reader:rename'"));
 const sender={},calls=[];let handler,busy=false;const context={ipcMain:{handle:(_name,fn)=>handler=fn},reader:{webContents:sender},readerId:'session-a',requireIdleWorkspace:needSources=>{calls.push(['idle',needSources]);if(busy)throw Error('busy')},library:{rename:(id,title)=>{calls.push(['rename',id,title]);return {id,title}}},refreshLibrary:(ids,result)=>calls.push(['refresh',Array.from(ids),result])};vm.runInNewContext(source,context);
 assert.throws(()=>handler({sender:{}},'session-a','No'),/Janela inválida/);assert.throws(()=>handler({sender},'session-b','No'),/reunião mudou/);assert.deepEqual(calls,[]);
 busy=true;assert.throws(()=>handler({sender},'session-a','No'),/busy/);busy=false;calls.length=0;assert.deepEqual(handler({sender},'session-a','Novo'),{id:'session-a',title:'Novo'});assert.deepEqual(calls,[['idle',false],['rename','session-a','Novo'],['refresh',['session-a'],{id:'session-a',title:'Novo'}]]);
 const preload=fs.readFileSync(new URL('../src/reader-preload.cjs',import.meta.url),'utf8');assert.match(preload,/rename:\(id,title\)=>ipcRenderer.invoke\('reader:rename',id,title\)/);
});

test('renaming only the meeting title keeps active audio and expanded transcript details intact',async()=>{
 const ui=await reader(diarized()),n=ui.nodes,block=n['reader-content'].children[0],detail=elements(block,value=>value.className==='block-segments')[0];detail.open=true;n['reader-info'].open=true;n['speaker-settings'].open=true;
 await elements(block,value=>value.className==='phrase-play')[0].onclick();const pauses=n['phrase-audio'].pauses;
 n['reader-rename'].onclick();n['reader-rename-title'].value='Novo título';await n['reader-rename-form'].onsubmit({preventDefault(){}});
 assert.equal(n['reader-content'].children[0],block);assert.equal(detail.open,true);assert.equal(n['phrase-audio'].paused,false);assert.equal(n['phrase-audio'].pauses,pauses);assert.equal(n['reader-info'].open,true);assert.equal(n['speaker-settings'].open,true);
});
