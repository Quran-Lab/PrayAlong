// Microphone (AudioWorklet, 16 kHz) → asr-worker (sherpa-onnx WASM, Quran Lab Zipformer v3.1 int8).
// The model (73 MB) loads once per visit and then stays in the HTTP cache. `gate(false)` drops audio
// while PrayAlong itself is playing, so the qari from the speaker never counts as the learner.
const RATE = 16000
const FRAME = 800

const at = (path: string) => new URL(path, document.baseURI).href

export class AsrClient {
  onTokens: (tokens: string[], final: boolean) => void = () => {}
  onActivity: (speech: boolean, rms: number) => void = () => {}
  private ctx: AudioContext | null = null
  private media: MediaStream | null = null
  private open = true
  private buf = new Float32Array(0)

  private constructor(private worker: Worker) {}

  static create(onProgress: (p: number) => void): Promise<AsrClient> {
    const w = new Worker(at('asr-app/asr-worker.js'))
    const c = new AsrClient(w)
    return new Promise((resolve, reject) => {
      w.onmessage = (e) => {
        const m = e.data
        if (m.type === 'ready') {
          w.onmessage = (ev) => c.handle(ev.data)
          resolve(c)
        } else if (m.type === 'state') onProgress(m.progress)
        else if (m.type === 'error') {
          w.terminate()
          reject(new Error(m.message))
        }
      }
      w.onerror = (e) => {
        w.terminate()
        reject(new Error(e.message || 'ASR worker failed'))
      }
      w.postMessage({ type: 'init', base: at('asr').replace(/\/$/, '') })
    })
  }

  private handle(m: { type: string; tokens?: string[]; final?: boolean; speech?: boolean; rms?: number }) {
    if (m.type === 'transcript') this.onTokens(m.tokens!, !!m.final)
    else if (m.type === 'activity') this.onActivity(!!m.speech, m.rms ?? 0)
  }

  async startMic() {
    this.media = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: true },
    })
    this.ctx = new AudioContext({ sampleRate: RATE })
    await this.ctx.audioWorklet.addModule(at('asr-app/pcm-worklet.js'))
    await this.ctx.resume()
    const src = this.ctx.createMediaStreamSource(this.media)
    const node = new AudioWorkletNode(this.ctx, 'pa-pcm-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
    const sink = this.ctx.createGain()
    sink.gain.value = 0
    const ratio = this.ctx.sampleRate / RATE
    node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => this.push(downsample(new Float32Array(e.data), ratio))
    src.connect(node)
    node.connect(sink)
    sink.connect(this.ctx.destination)
  }

  /** false: drop audio (PrayAlong is playing). */
  gate(open: boolean) {
    this.open = open
    if (!open) this.buf = new Float32Array(0)
  }

  private push(s: Float32Array) {
    if (!this.open) return
    const m = new Float32Array(this.buf.length + s.length)
    m.set(this.buf)
    m.set(s, this.buf.length)
    let o = 0
    while (m.length - o >= FRAME) {
      this.send(m.slice(o, o + FRAME))
      o += FRAME
    }
    this.buf = m.slice(o)
  }

  private send(frame: Float32Array) {
    this.worker.postMessage({ type: 'audio', samples: frame.buffer }, [frame.buffer])
  }

  /** Test without a microphone: stream an audio file to the ASR at `speed`× real time. */
  async feedUrl(url: string, speed = 4) {
    const ac = new AudioContext()
    const ab = await ac.decodeAudioData(await (await fetch(url)).arrayBuffer())
    await ac.close()
    const s = downsample(ab.getChannelData(0), ab.sampleRate / RATE)
    for (let o = 0; o < s.length; o += FRAME) {
      this.send(s.slice(o, o + FRAME))
      if ((o / FRAME) % 10 === 9) await new Promise((r) => setTimeout(r, (10 * FRAME * 1000) / RATE / speed))
    }
    for (let i = 0; i < 20; i++) this.send(new Float32Array(FRAME)) // trailing silence ends the utterance
  }

  reset() {
    this.worker.postMessage({ type: 'reset' })
  }

  async stop() {
    this.media?.getTracks().forEach((t) => t.stop())
    await this.ctx?.close().catch(() => {})
    this.worker.postMessage({ type: 'stop' })
  }
}

function downsample(x: Float32Array, ratio: number): Float32Array {
  if (Math.abs(ratio - 1) < 1e-6) return x
  const n = Math.floor(x.length / ratio)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio)
    const b = Math.max(a + 1, Math.floor((i + 1) * ratio))
    let t = 0
    for (let j = a; j < b; j++) t += x[j] ?? 0
    out[i] = t / (b - a)
  }
  return out
}
