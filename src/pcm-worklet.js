// Two independent mono inputs, resampled by AudioContext to 16 kHz.
// No monitoring: outputs remain silent. Only an explicit stop flushes the tail.
class PCMRecorder extends AudioWorkletProcessor {
  constructor() {
    super(); this.chunks = [[], []]; this.count = 0; this.accepting = true;
    this.port.onmessage = ({ data }) => {
      if (data === 'stop') { this.accepting = false; this.flush(); this.port.postMessage({ stopped: true }); }
    };
  }
  flush() {
    if (!this.count) return;
    const channels = this.chunks.map(values => {
      const data = new ArrayBuffer(values.length * 2), view = new DataView(data);
      values.forEach((sample, i) => view.setInt16(i * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true));
      return data;
    });
    const peaks = this.chunks.map(values => values.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0));
    this.port.postMessage({ channels, peaks }, channels);
    this.chunks = [[], []]; this.count = 0;
  }
  process(inputs, outputs) {
    if (!this.accepting) return true;
    const frames = outputs[0]?.[0]?.length || 128;
    for (let frame = 0; frame < frames; frame++) {
      for (let channel = 0; channel < 2; channel++) {
        const input = inputs[channel] || [];
        let value = 0;
        for (const samples of input) value += samples[frame] || 0;
        this.chunks[channel].push(input.length ? value / input.length : 0);
      }
      this.count++;
    }
    if (this.count >= 4096) this.flush();
    return true;
  }
}
registerProcessor('sonora-pcm', PCMRecorder);
