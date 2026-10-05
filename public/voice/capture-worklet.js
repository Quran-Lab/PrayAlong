/*
 * PrayAlong voice: microphone capture (AudioWorklet).
 *
 * Collects mono render quanta into ~100 ms batches and posts them over a
 * MessagePort that goes straight to the ASR worker, so audio never waits on
 * the main thread (which is busy rendering the 3D companion). Runs at the
 * context's native rate; sherpa-onnx resamples to 16 kHz itself.
 */
class PrayAlongCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.out = null;
    this.size = Math.round(sampleRate / 10);
    this.buf = new Float32Array(this.size);
    this.fill = 0;
    this.port.onmessage = (e) => {
      if (e.data && e.data.port) this.out = e.data.port;
    };
  }

  process(inputs) {
    const input = inputs[0];
    const ch = input && input[0];
    if (!ch || !this.out) return true;
    let i = 0;
    while (i < ch.length) {
      const n = Math.min(ch.length - i, this.size - this.fill);
      this.buf.set(ch.subarray(i, i + n), this.fill);
      this.fill += n;
      i += n;
      if (this.fill === this.size) {
        const samples = this.buf;
        this.out.postMessage({ samples, rate: sampleRate }, [samples.buffer]);
        this.buf = new Float32Array(this.size);
        this.fill = 0;
      }
    }
    return true;
  }
}

registerProcessor("prayalong-capture", PrayAlongCapture);
