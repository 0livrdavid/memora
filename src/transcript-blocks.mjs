import {phrases} from './phrases.mjs';

// Presentation only: no rewriting of stored segments or identity inferred from source.
// Visual turns have no arbitrary sentence/character cap. Audio remains bounded separately.
export const BLOCK_LIMITS=Object.freeze({audioDurationMs:600000});
function reliable(phrase){
 if(phrase.identity?.version===2)return Boolean(phrase.speakerId)&&!/(?:unknown|uncertain)/i.test(phrase.speakerId)&&!phrase.identity.uncertain&&!phrase.uncertain;
 if(typeof phrase.speakerId!=='string'||!phrase.speakerId||/(?:unknown|uncertain)/i.test(phrase.speakerId)||
  phrase.origin?.overlap||phrase.origin?.echoRisk)return false;
 // Older remote results conflated approximate timing with speaker uncertainty. Only
 // the recorded unique diarization candidate can disambiguate that specific case.
 if(phrase.uncertain)return phrase.source==='computer'&&phrase.approximate&&
  phrase.alternatives?.length===1&&phrase.alternatives[0]===phrase.speakerId;
 return true;
}
export function transcriptBlocks(segments){
 const blocks=[];
 for(const phrase of phrases(segments)){
  const block=blocks.at(-1),previous=block?.phrases.at(-1);
  const merge=block&&reliable(previous)&&reliable(phrase)&&
   block.speakerId===phrase.speakerId&&block.source===phrase.source&&
   phrase.startMs>=previous.endMs;
  if(merge){block.phrases.push(phrase);block.endMs=phrase.endMs;block.characters+=1+phrase.text.length;block.approximate||=phrase.approximate;block.uncertain||=phrase.uncertain;}
  else blocks.push({source:phrase.source,speakerId:phrase.speakerId,startMs:phrase.startMs,endMs:phrase.endMs,
   approximate:phrase.approximate,uncertain:phrase.uncertain,origin:phrase.origin,characters:phrase.text.length,phrases:[phrase]});
 }
 return blocks;
}
