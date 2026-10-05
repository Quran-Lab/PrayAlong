// From ATQAN (quran-pcm-capture-worklet.js): post raw PCM frames to the main thread.
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0]?.[0]
    if (ch?.length) {
      const s = ch.slice()
      this.port.postMessage(s.buffer, [s.buffer])
    }
    return true
  }
}
registerProcessor('pa-pcm-capture', PcmCapture)
