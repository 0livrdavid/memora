"""Channel/reference evidence only. Does not identify people or modify source PCM.
NCC searches every sample (FFT) within +/-500 ms; cached 0.5 s contexts bound cost.
Linear residual statistics are diagnostic, not an enabled echo canceller.
"""
import numpy as np

class SourceOrigin:
    def __init__(self, audio, aligned, sample_rate=16000):
        self.audio=audio;self.rate=sample_rate;self.cache={};self.speech={}
        for source,result in aligned.items():
            intervals=[]
            for segment in result.get('segments',[]):
                for word in segment.get('words') or [segment]:
                    start=word.get('start',segment.get('start',0));end=word.get('end',segment.get('end',start))
                    if end>start:intervals.append((start,end))
            self.speech[source]=intervals
    def _samples(self,source,start,end):
        return self.audio[source][max(0,int(start*self.rate)):max(0,int(end*self.rate))]
    @staticmethod
    def _rms(x):return float(np.sqrt(np.mean(x*x))) if len(x) and np.all(np.isfinite(x)) else 0.
    def _reference(self,center):
        key=max(0,int(center*2))
        if key in self.cache:return self.cache[key]
        result={'state':'unavailable','correlation':None,'lagMs':None,'linearFitR2':None,'residualRatio':None,'gain':None}
        if 'microphone' not in self.audio or 'computer' not in self.audio:return result
        mid=key*.5+.25;lo=max(0,mid-.5);hi=min(len(self.audio['microphone'])/self.rate,mid+.5)
        x=np.asarray(self._samples('microphone',lo,hi),dtype=np.float64);n=len(x);delay=round(.5*self.rate);left=max(0,round(lo*self.rate)-delay);right=min(len(self.audio['computer']),round(hi*self.rate)+delay)
        y=np.asarray(self.audio['computer'][left:right],dtype=np.float64)
        if n<self.rate*.25 or len(y)<n or not np.all(np.isfinite(x)) or not np.all(np.isfinite(y)):self.cache[key]=result;return result
        x=x-x.mean();xx=float(np.dot(x,x));
        if xx/n<1e-8:result['state']='quiet';self.cache[key]=result;return result
        size=1<<(len(y)+n-2).bit_length()
        dots=np.fft.irfft(np.fft.rfft(y,size)*np.fft.rfft(x[::-1],size),size)[n-1:len(y)]
        sums=np.concatenate(([0.],np.cumsum(y)));squares=np.concatenate(([0.],np.cumsum(y*y)));means=(sums[n:]-sums[:-n])/n;energies=np.maximum(0,squares[n:]-squares[:-n]-n*means*means)
        denominator=np.sqrt(xx*energies);scores=np.divide(dots,denominator,out=np.zeros_like(dots),where=denominator>1e-9);scores[energies/n<1e-6]=0
        best=int(np.argmax(np.abs(scores)));correlation=min(1.,abs(float(scores[best])));gain=float(dots[best]/energies[best]) if energies[best]>1e-9 else 0.
        residual=float(np.sqrt(max(0,1-correlation*correlation)));lag=(round(lo*self.rate)-(left+best))/self.rate*1000
        # Reference relation and concurrent speech are independent dimensions.
        state='reference-dominant' if correlation>=.85 and residual<=.4 else 'reference-component' if correlation>=.4 else 'low-reference-match'
        result.update(state=state,correlation=round(correlation,5),lagMs=round(lag,3),linearFitR2=round(correlation**2,5),residualRatio=round(residual,5),gain=round(gain,5))
        self.cache[key]=result;return result
    def evidence(self,source,start,end):
        other='computer' if source=='microphone' else 'microphone';center=(start+end)/2;lo=max(0,center-.4);hi=center+.4
        own=self._rms(self._samples(source,lo,hi));second=self._rms(self._samples(other,lo,hi)) if other in self.audio else 0.
        concurrent=any(min(end,b)>max(start,a) for a,b in self.speech.get(other,[]));own_speech=any(min(end,b)>max(start,a) for a,b in self.speech.get(source,[]))
        reference=self._reference(center);echo=reference['state'] in ['reference-dominant','reference-component'];margin=20*np.log10(max(own,1e-8)/max(second,1e-8))
        supported=own>.0056 and (other not in self.audio or reference['state']=='low-reference-match')
        return dict(evidenceVersion=2,source=source,identityEvidence='none',confidence='source-only' if other not in self.audio else 'probable' if supported else 'uncertain',localCandidate=bool(source=='microphone' and supported),overlap=bool(concurrent),simultaneousSpeech=bool(concurrent),ownSpeech=bool(own_speech),echoRisk=bool(echo),energyAmbiguous=bool(own>.0056 and second>.0056 and abs(margin)<12),rms=round(own,6),otherRms=round(second,6),energyMarginDb=round(float(margin),3),reference=reference)
