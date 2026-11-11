import {test} from 'node:test';
import assert from 'node:assert/strict';
import {transcriptBlocks,BLOCK_LIMITS} from '../src/transcript-blocks.mjs';
const part=(startMs=0,endMs=1000,extra={})=>({source:'computer',speakerId:'remote-1',text:'Texto original.',startMs,endMs,...extra});
test('consecutive confident speaker phrases share a block without changing original text, time, words or indexes',()=>{
 const segments=[part(0,1000,{words:[{text:'Texto',startMs:0,endMs:500}]}),part(1200,2300)],before=JSON.stringify(segments),blocks=transcriptBlocks(segments);
 assert.equal(blocks.length,1);assert.equal(blocks[0].startMs,0);assert.equal(blocks[0].endMs,2300);assert.equal(blocks[0].phrases.length,2);
 assert.deepEqual(blocks[0].phrases.map(p=>p.segmentIndex),[0,1]);assert.equal(JSON.stringify(segments),before);assert.deepEqual(blocks[0].phrases[0].words,segments[0].words);
});
test('another speaker, uncertain identity, source change or overlap interrupts grouping',()=>{
 for(const middle of [{speakerId:'remote-2'},{uncertain:true},{source:'microphone'},{origin:{overlap:true}},{origin:{echoRisk:true}},{speakerId:'remote-unknown'},{speakerId:'microphone-uncertain'},{speakerId:undefined}]){
  assert.equal(transcriptBlocks([part(),part(1000,2000,middle),part(2000,3000)]).length,3,JSON.stringify(middle));
 }
 assert.equal(transcriptBlocks([part(),part(500,2000)]).length,2);
 assert.equal(transcriptBlocks([part(),part(0,0)]).length,2);
});
test('uncertain, unknown and source-only phrases never imply speaker continuity',()=>{
 for(const extra of [{uncertain:true},{speakerId:'remote-unknown'},{speakerId:'microphone-uncertain'},{speakerId:undefined}])assert.equal(transcriptBlocks([part(0,1000,extra),part(1000,2000,extra)]).length,2);
 const legacy=transcriptBlocks([{source:'computer',text:'Primeiro. Segundo.',startMs:0,endMs:2000}]);
 assert.equal(legacy.length,2);assert.equal(legacy[0].approximate,true);assert.equal(legacy[1].phrases[0].segmentIndex,0);
});
test('continuous turns are not split at eight phrases, 60 seconds, 1200 characters or a silent pause',()=>{
 const data=Array.from({length:30},(_,i)=>part(i*5000,(i+1)*5000,{text:'a'.repeat(200)})),blocks=transcriptBlocks(data);
 assert.equal(blocks.length,1);assert.equal(blocks[0].phrases.length,30);assert.equal(blocks[0].endMs,150000);
 assert.equal(transcriptBlocks([part(),part(7000,9000)]).length,1);
 assert.equal(transcriptBlocks([part(0,700000),part(700000,710000)]).length,1);
 assert.equal(BLOCK_LIMITS.audioDurationMs,600000);
});
test('channel confidence is not diarization confidence; uniquely attributed approximate words keep warning',()=>{
 assert.equal(transcriptBlocks([part(),part(1000,2000,{origin:{confidence:'uncertain'}})]).length,1);
 const precise=part(0,1000),approx=part(1000,2000,{uncertain:true,approximate:true,alternatives:['remote-1'],origin:{confidence:'uncertain'}});
 const blocks=transcriptBlocks([precise,approx]);assert.equal(blocks.length,1);assert.equal(blocks[0].approximate,true);assert.equal(blocks[0].uncertain,true);
 for(const changes of [{alternatives:[]},{alternatives:['remote-1','remote-2']},{origin:{overlap:true}},{origin:{echoRisk:true}},{approximate:false}])assert.equal(transcriptBlocks([precise,{...approx,...changes}]).length,2);
});
test('equal display names cannot combine different speaker IDs, and order is preserved',()=>{
 const data=[part(2000,3000),part(1000,2000),part(3000,4000,{speakerId:'remote-2'})];
 assert.deepEqual(transcriptBlocks(data).map(b=>b.startMs),[2000,1000,3000]);assert.deepEqual(transcriptBlocks([]),[]);
});
