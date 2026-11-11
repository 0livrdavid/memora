import sys, pathlib, unittest, hashlib
import numpy as np
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'src'))
from source_origin import SourceOrigin
from speaker_assignment import speaker_for
RATE=16000

def signal(seed,n=RATE*4):
 r=np.random.default_rng(seed);x=np.convolve(r.normal(0,1,n),np.array([1,2,3,2,1])/9,'same');return (x/np.std(x)*.08).astype(np.float32)
def delayed(x,ms):
 d=round(ms*RATE/1000)
 return np.concatenate([np.zeros(d),x[:-d]]) if d else x.copy()
class EvidenceTests(unittest.TestCase):
 def evidence(self,mic,remote,t=1.6):return SourceOrigin({'microphone':mic,'computer':remote},{'microphone':{'segments':[{'start':t,'end':t+.15}]},'computer':{'segments':[{'start':t,'end':t+.15}]}}).evidence('microphone',t,t+.15)
 def test_headphones_equal_energy_double_talk_keeps_origin_separate_and_names_unknown(self):
  e=self.evidence(signal(1),signal(2));self.assertTrue(e['simultaneousSpeech']);self.assertTrue(e['energyAmbiguous']);self.assertFalse(e['echoRisk']);self.assertEqual(e['identityEvidence'],'none')
  for source in ['microphone','computer']:
   speaker,identity,_=speaker_for(source,1.6,1.75,[{'start':1.4,'end':2.,'speaker':1}],e)
   self.assertFalse(identity['uncertain']);self.assertFalse(identity['knownPerson'])
 def test_sample_accurate_delay_search_covers_sub_10ms_and_longer_delays(self):
  ref=signal(3)
  for delay in [5,60,250,480]:
   with self.subTest(delay=delay):
    e=self.evidence(delayed(ref,delay)*.25,ref);self.assertTrue(e['echoRisk']);self.assertAlmostEqual(e['reference']['lagMs'],delay,delta=.2);self.assertEqual(e['reference']['state'],'reference-dominant')
 def test_speaker_output_echo_never_invalidates_unique_computer_diarization(self):
  ref=signal(5);e=self.evidence(delayed(ref,60)*.3,ref)
  _,local,_=speaker_for('microphone',1.6,1.75,[{'start':1.,'end':2.,'speaker':1}],e)
  _,remote,_=speaker_for('computer',1.6,1.75,[{'start':1.,'end':2.,'speaker':2}],e)
  self.assertTrue(local['uncertain']);self.assertFalse(remote['uncertain'])
 def test_double_talk_with_echo_has_residual_but_is_not_automatically_named(self):
  ref=signal(7);local=signal(8);e=self.evidence(local+delayed(ref,250)*.7,ref)
  self.assertGreater(e['reference']['residualRatio'],.5);self.assertEqual(e['identityEvidence'],'none')
 def test_short_local_interruption_is_retained_in_original_pcm(self):
  ref=signal(9);local=np.zeros_like(ref);local[round(1.6*RATE):round(1.68*RATE)]=signal(10)[:round(.08*RATE)]
  mic=delayed(ref,60)*.3+local;before=mic.copy();self.evidence(mic,ref);np.testing.assert_array_equal(mic,before);self.assertGreater(np.sum(local*local),0)
 def test_two_local_people_use_distinct_source_scoped_diarization_ids(self):
  turns=[{'start':0,'end':1.,'speaker':1},{'start':1.,'end':2.,'speaker':2}];e={'reference':{'state':'unavailable'}}
  a,ia,_=speaker_for('microphone',.1,.5,turns,e);b,ib,_=speaker_for('microphone',1.1,1.5,turns,e)
  self.assertNotEqual(a,b);self.assertFalse(ia['knownPerson']);self.assertFalse(ib['knownPerson'])
 def test_multiple_remote_candidates_remain_uncertain_even_without_channel_overlap(self):
  turns=[{'start':0,'end':2,'speaker':1},{'start':0,'end':2,'speaker':2}];_,identity,choices=speaker_for('computer',.1,.5,turns,{'reference':{'state':'low-reference-match'}});self.assertTrue(identity['uncertain']);self.assertEqual(len(choices),2)
 def test_volume_changes_do_not_become_identity(self):
  ref=signal(11)
  for gain in [.05,.3,1.5]:
   e=self.evidence(delayed(ref,60)*gain,ref);self.assertTrue(e['echoRisk']);self.assertEqual(e['identityEvidence'],'none')
 def test_noise_and_clipping_are_not_claimed_as_known_people(self):
  for mic in [signal(12)+signal(13)*2,np.clip(signal(14)*10,-.5,.5)]:
   e=self.evidence(mic,signal(15));_,i,_=speaker_for('microphone',1.6,1.8,[{'start':1,'end':3,'speaker':1}],e);self.assertFalse(i['knownPerson'])
 def test_changing_delay_is_uncertain_near_transition_and_does_not_mutate_channels(self):
  ref=signal(16);mic=delayed(ref,60)*.3;mic[RATE*2:]=delayed(ref,250)[RATE*2:]*.3;original=hashlib.sha256(mic.tobytes()).hexdigest();analyzer=SourceOrigin({'microphone':mic,'computer':ref},{})
  self.assertAlmostEqual(analyzer.evidence('microphone',1.1,1.2)['reference']['lagMs'],60,delta=.2);self.assertAlmostEqual(analyzer.evidence('microphone',3.1,3.2)['reference']['lagMs'],250,delta=.2);self.assertEqual(hashlib.sha256(mic.tobytes()).hexdigest(),original)
 def test_short_boundary_or_silent_windows_do_not_produce_a_person(self):
  for mic in [np.zeros(1000,dtype=np.float32),signal(17,1000)]:
   e=SourceOrigin({'microphone':mic,'computer':np.zeros_like(mic)},{}).evidence('microphone',0,.04);self.assertEqual(e['reference']['state'],'unavailable');self.assertEqual(e['identityEvidence'],'none')
if __name__=='__main__':unittest.main()
