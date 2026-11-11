"""Offline meeting analysis. Source audio is read-only; outputs belong to one attempt.
Nemotron-3 model: NVIDIA OpenMDW 1.1, retained in existing approved cache.
No speaker biometrics, no automatic network access or credentials.
"""
import os
os.umask(0o077)
import argparse,json,time,wave,gc,hashlib,socket,subprocess,sys
from asr_preview import transcribe_with_preview
from source_origin import SourceOrigin
from speaker_assignment import speaker_for
from pathlib import Path
p=argparse.ArgumentParser()
for key in ['session','output','cache','nemo','model','language','attempt']:p.add_argument('--'+key,required=True)
a=p.parse_args();out=Path(a.output);session=Path(a.session);cache=Path(a.cache)
# Hard offline boundary, including dependencies that ignore HF flags.
def blocked(*args,**kwargs):raise OSError('Network disabled for Memora offline worker')
socket.socket.connect=blocked;socket.create_connection=blocked
os.environ.update(HF_HOME=str(cache),HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_IMPLICIT_TOKEN='1',HF_HUB_DISABLE_TELEMETRY='1',PYANNOTE_METRICS_ENABLED='0')
def save(name,data):
 f=out/name;t=out/(name+'.tmp');t.write_text(json.dumps(data,ensure_ascii=False));t.replace(f)
protocol_stdout=sys.stdout
def emit(event):
 event.update(sessionId=session.name[-36:],attempt=a.attempt)
 print('MEMORA_PROGRESS '+json.dumps(event,ensure_ascii=False),file=protocol_stdout,flush=True)
def progress(phase,stage='preparation',**fields):emit({'phase':phase,'stage':stage,**fields})
def read(source):
 f=session/(source+'.wav')
 if f.is_symlink():raise ValueError('Invalid source')
 with wave.open(str(f)) as w:
  if (w.getnchannels(),w.getsampwidth(),w.getframerate())!=(1,2,16000):raise ValueError('Unsupported PCM')
  return np.frombuffer(w.readframes(w.getnframes()),dtype='<i2').astype(np.float32)/32768
try:
 progress('Preparando modelos locais')
 if hashlib.sha256(Path(a.model).read_bytes()).hexdigest()!='08456d9e22cd9a323c0364d98375f3746d6e68507ebb705cd46438c534c7a3a1':raise ValueError('Model integrity mismatch')
 progress('Carregando WhisperX large-v3 local');import numpy as np;import whisperx,torch
 torch.set_num_threads(4);meta=json.loads((session/'session.json').read_text());sources=[s['key'] for s in meta['sources']];audio={s:read(s) for s in sources};raw={};aligned={};turns={}
 model=whisperx.load_model('large-v3','cpu',compute_type='int8',language=a.language,vad_method='silero',download_root=str(cache/'asr'),threads=4)
 completed_ms=0;total_ms=sum(len(x)/16000*1000 for x in audio.values())
 for source in sources:
  progress('Transcrevendo '+('microfone' if source=='microphone' else 'computador'),'transcription',processedMs=round(completed_ms),totalMs=round(total_ms))
  raw[source]=transcribe_with_preview(model,audio[source],source,a.language,emit,completed_ms,total_ms);save('raw-'+source+'.json',raw[source]);completed_ms+=len(audio[source])/16000*1000
 del model;gc.collect();progress('Alinhando palavras e tempos','transcription',processedMs=round(total_ms),totalMs=round(total_ms))
 aligner,metadata=whisperx.load_align_model(language_code=a.language,device='cpu',model_dir=str(cache/'alignment'))
 for source in sources:
  aligned[source]=whisperx.align(raw[source]['segments'],aligner,metadata,audio[source],'cpu',return_char_alignments=False);save('aligned-'+source+'.json',aligned[source])
 del aligner;gc.collect()
 for source in sources:
  progress('Identificando falantes · '+('microfone' if source=='microphone' else 'computador'),'speakers')
  target='remote-turns.json' if source=='computer' else 'microphone-turns.json'
  with open(os.devnull,'wb') as quiet:
   subprocess.run([a.nemo,'diarize',str(session/(source+'.wav')),'--model',a.model,'--preset','v3-offline','--device','metal','--format','json','--output',str(out/target)],check=True,stdout=quiet,stderr=quiet)
  turns[source]=json.loads((out/target).read_text())['segments']
 origin=SourceOrigin(audio,aligned).evidence
 progress('Organizando falas e tempos','finalization');segments=[];speakers={};unplaced=0
 for source in sources:
  for segment in aligned[source]['segments']:
   words=segment.get('words',[])
   # Preserve every recognized token, including words without alignment; flag approximate timing.
   if not words:words=[{'word':segment['text'],'start':segment['start'],'end':segment['end'],'approximate':True}]
   for w in words:
    s=w.get('start',segment['start']);e=w.get('end',segment['end']);approx='start' not in w or 'end' not in w or w.get('approximate',False)
    if not (0<=s<=e<=len(audio[source])/16000+.2):s=segment['start'];e=segment['end'];approx=True
    evidence=origin(source,s,e);speaker,identity,alternatives=speaker_for(source,s,e,turns.get(source,[]),evidence);uncertain=identity['uncertain']
    label=('Microfone '+speaker.replace('microphone-','') if source=='microphone' else 'Remoto '+speaker.replace('remote-',''))
    if speaker.endswith('unknown'):label=('Microfone' if source=='microphone' else 'Computador')+' · falante incerto'
    speakers.setdefault(speaker,{'id':speaker,'label':label,'source':source})
    item={'source':source,'speakerId':speaker,'text':w['word'],'startMs':round(s*1000),'endMs':round(e*1000),'uncertain':bool(uncertain),'approximate':bool(approx),'origin':evidence,'identity':identity,'alternatives':alternatives,'words':[{'text':w['word'],'startMs':round(s*1000),'endMs':round(e*1000),'approximate':bool(approx)}]};segments.append(item)
 # Stable IDs refer to this result only. Never transfer identities across retranscription.
 segments.sort(key=lambda x:(x['startMs'],x['source'],x['endMs']));blocks=[]
 for word in segments:
  previous=blocks[-1] if blocks else None
  merge=previous and all(previous[k]==word[k] for k in ['speakerId','source','uncertain']) and word['startMs']-previous['endMs']<900 and word['endMs']-previous['startMs']<18000 and not previous['text'].rstrip().endswith(('.','!','?')) and word['origin']['echoRisk']==previous['origin']['echoRisk']
  if merge:previous['text']+=' '+word['text'];previous['endMs']=max(previous['endMs'],word['endMs']);previous['words']+=word['words'];previous['approximate']|=word['approximate']
  else:blocks.append(word)
 result={'schemaVersion':2,'resultId':a.attempt,'sessionId':meta['id'],'startedAt':meta['startedAt'],'sources':meta['sources'],'engine':{'name':'whisperx-nemotron-experimental','asr':'WhisperX large-v3 CPU INT8','diarizer':'NVIDIA Nemotron-3 Q8_0 Metal','language':a.language,'remoteOnly':False,'diarizedSources':sources,'originEvidenceVersion':2,'preset':'v3-offline','license':'OpenMDW-1.1','sourceIdentity':'origin is evidence, not biometric identity'},'speakers':list(speakers.values()),'segments':blocks,'quality':{'needsReview':False,'reasons':[]},'notices':['Confira nomes por amostra. Diarização identifica grupos por fonte, não pessoas conhecidas. Simultaneidade, evidência de referência/eco e tempos aproximados são independentes. Nenhum nome é atribuído automaticamente.','Nemotron v0.2.0 usa pós-processamento padrão; respostas curtas podem não ser detectadas.'],'originalAudioSHA256':{s:hashlib.sha256((session/(s+'.wav')).read_bytes()).hexdigest() for s in sources}}
 save('result.json',result);progress('Validando resultado final','finalization')
except Exception as error:
 save('failure.json',{'type':type(error).__name__,'message':'Offline analysis failed; previous transcript and audio preserved.','lines':[f.lineno for f in __import__('traceback').extract_tb(error.__traceback__)]});raise SystemExit(1)
