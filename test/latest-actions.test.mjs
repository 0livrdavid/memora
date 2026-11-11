import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
function ui(){
 const nodes={},calls=[];const $=id=>nodes[id]??=( {value:'',hidden:true,setAttribute(k,v){this[k]=v},focus(){this.focused=true}} );$('record-history').value='older';
 const scope={$,config:{latest:{id:'latest',title:'Última',hasTranscript:true}},selectedSession:{id:'older'},busy:false,current:null,latestRenameId:null,
  window:{sonora:{recordReader:async id=>calls.push(['view',id]),recordRename:async(id,title)=>calls.push(['rename',id,title])}},setup:async id=>calls.push(['setup',id]),message:text=>calls.push(['message',text]),controls(){}};
 const code=fs.readFileSync(new URL('../src/recording.js',import.meta.url),'utf8').split('\n').filter(s=>/^\$\('latest-(view|rename|rename-cancel|rename-form)'\)\.(onclick|onsubmit)=/.test(s)).join('\n');
 assert.equal(code.split('\n').length,4);vm.runInNewContext(code,scope);return {scope,nodes,$,calls};
}
test('quick view targets latest transcription even when history selected an older recording',async()=>{
 const {scope,$,calls}=ui();await $('latest-view').onclick();assert.deepEqual(calls,[['view','latest']]);
 scope.busy=true;await $('latest-view').onclick();scope.busy=false;scope.config.latest.hasTranscript=false;await $('latest-view').onclick();assert.equal(calls.length,1);
});
test('quick rename pins latest ID, keeps history selection, supports cancel and cannot submit while busy',async()=>{
 const {scope,$,calls}=ui();$('latest-rename').onclick();assert.equal($('latest-rename-title').value,'Última');assert.equal($('latest-rename-form').hidden,false);assert.equal($('latest-rename-title').focused,true);
 scope.selectedSession={id:'different'};$('latest-rename-title').value='Título novo';scope.busy=true;await $('latest-rename-form').onsubmit({preventDefault(){}});assert.deepEqual(calls,[]);
 scope.busy=false;await $('latest-rename-form').onsubmit({preventDefault(){}});assert.deepEqual(calls.slice(0,2),[['rename','latest','Título novo'],['setup','older']]);assert.equal($('latest-rename-form').hidden,true);
 $('latest-rename').onclick();$('latest-rename-cancel').onclick();assert.equal(scope.latestRenameId,null);assert.equal($('latest-rename-form').hidden,true);
});
