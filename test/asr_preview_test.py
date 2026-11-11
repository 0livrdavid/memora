import sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from asr_preview import PreviewSink, transcribe_with_preview
class Tests(unittest.TestCase):
 def test_observes_without_rechunking_or_mutating_return(self):
  events=[];audio=range(16000*40);result={'segments':[{'start':0,'end':20,'text':'Olá'},{'start':20,'end':40,'text':'Fim'}]}
  class Model:
   def transcribe(self,value,**kwargs):
    assert value is audio and kwargs=={'batch_size':2,'language':'pt','verbose':True}
    print('Transcript: [0.0 --> 20.0] Olá')
    assert len(events)==1 # Delivered before transcription call returns.
    print('Transcript: [20.0 --> 40.0] Fim')
    return result
  self.assertIs(transcribe_with_preview(Model(),audio,'computer','pt',events.append,40000,80000),result)
  self.assertEqual(events[0]['processedMs'],60000)
  self.assertEqual(events[-1]['processedMs'],80000)
  self.assertNotIn('speakerId',events[0]['preview'])
 def test_compatibility_fallback_only_after_source_returns(self):
  events=[];raw={'segments':[{'start':0,'end':1,'text':'Fallback'}]}
  class Model:
   def transcribe(self,*args,**kwargs):
    assert not events
    return raw
  self.assertIs(transcribe_with_preview(Model(),range(16000),'microphone','pt',events.append,0,1000),raw)
  self.assertEqual(events[0]['preview']['text'],'Fallback')
 def test_split_output_malformed_and_oversized_lines(self):
  events=[];s=PreviewSink(events.append,'computer',1000,0,1000)
  for char in 'Transcript: [0.0 --> 1.0] Ação\n':s.write(char)
  self.assertEqual(events[0]['preview']['text'],'Ação')
  s.write('Transcript: [0 --> 99] Invalid\n');s.write('x'*40000+'\n');s.write('Transcript: [0 --> 1] Recuperou\n')
  self.assertEqual(len(events),2)
if __name__=='__main__':unittest.main()
