"""Observe WhisperX verbose output without changing inference calls or VAD windows.
Only a provisional, bounded preview is emitted. The normal return value remains authoritative.
"""
import contextlib
import io
import math
import re

class PreviewSink(io.TextIOBase):
    def __init__(self, emit, source, duration_ms, completed_ms, total_ms):
        self.emit = emit
        self.source = source
        self.duration_ms = duration_ms
        self.completed_ms = completed_ms
        self.total_ms = total_ms
        self.buffer = ''
        self.discard = False
        self.processed_ms = 0
        self.seen = 0

    def writable(self): return True
    def write(self, text):
        for part in text.splitlines(keepends=True):
            if not self.discard:
                self.buffer += part
                if len(self.buffer) > 32768:
                    self.buffer = ''; self.discard = True
            if part.endswith('\n'):
                if not self.discard: self.line(self.buffer.rstrip('\r\n'))
                self.buffer = ''; self.discard = False
        return len(text)

    def line(self, line):
        match = re.fullmatch(r'Transcript: \[([0-9.]+) --> ([0-9.]+)\] (.*)', line)
        if not match: return
        try: start, end = float(match[1])*1000, float(match[2])*1000
        except ValueError: return
        if not (math.isfinite(start) and math.isfinite(end) and 0 <= start <= end <= self.duration_ms+200): return
        self.processed_ms = max(self.processed_ms, min(end, self.duration_ms))
        self.seen += 1
        self.emit({'stage':'transcription', 'phase':'Transcrevendo '+('microfone' if self.source=='microphone' else 'computador'),
            'processedMs':round(self.completed_ms+self.processed_ms), 'totalMs':round(self.total_ms),
            'preview':{'source':self.source,'startMs':round(start),'endMs':round(end),'text':match[3][:2000]}})

def transcribe_with_preview(model, audio, source, language, emit, completed_ms, total_ms):
    duration_ms = len(audio)/16000*1000
    sink = PreviewSink(emit, source, duration_ms, completed_ms, total_ms)
    with contextlib.redirect_stdout(sink):
        result = model.transcribe(audio, batch_size=2, language=language, verbose=True)
    # Compatibility fallback: expose returned raw segments only after this source finishes.
    # Never split/retranscribe the audio to manufacture streaming progress.
    if not sink.seen:
        for segment in result['segments']:
            sink.line(f"Transcript: [{segment['start']} --> {segment['end']}] {segment['text']}")
    emit({'stage':'transcription','phase':'Fonte transcrita · '+('microfone' if source=='microphone' else 'computador'),
          'processedMs':round(completed_ms+duration_ms),'totalMs':round(total_ms)})
    return result
