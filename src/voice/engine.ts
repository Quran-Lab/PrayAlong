import type { VoiceError, VoiceStatus } from './types'

/**
 * Microphone -> AudioWorklet -> ASR worker. The 12 MB runtime and the 68 MB
 * model are fetched by the worker (and cached by it), never by the app
 * bundle: on `start()`, or earlier with `prefetchVoiceModel()` so the model
 * is ready before the prayer begins.
 *
 * Audio flows worklet -> worker over a MessagePort, so a busy main thread
 * (the 3D stage) can never drop samples. The main thread only receives tokens.
 */

export type EngineEvent =
  | { type: 'status'; status: VoiceStatus; error?: VoiceError; detail?: string }
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'tokens'; tokens: string[]; at: number; segment: number; decodeMs: number }
  | { type: 'endpoint'; at: number; segment: number }
  /** `lag`: seconds the decoder runs behind the microphone (0 when keeping up; see VoiceEngine.lagSec). */
  | { type: 'level'; rms: number; speech: boolean; at: number; lag: number }

export interface VoiceEngineOptions {
  /** Where the model manifest and parts live. Default: same origin, voice/model/. */
  modelBase?: string
  /** Capture the microphone (false = decoder only, fed with `feed()`). */
  mic?: boolean
  /** Open the microphone only once the model is ready (replay harness). */
  micAfterLoad?: boolean
  /**
   * Browser echo cancellation removes the companion's own voice when it plays
   * from the same device's speakers. On by default; see docs/voice.md.
   */
  echoCancellation?: boolean
  /** Off by default: it eats quiet and whispered speech. */
  noiseSuppression?: boolean
  autoGainControl?: boolean
}

const asset = (path: string) => new URL(path, document.baseURI).href

// [voice] Model: the 160 ms streaming chunk (v31-slim-int8-preopt-c8-1, sha256 e3007fcd...).
// Same line accuracy as 320 ms (voice/model/c16-1/) and the lowest lag. 480 ms is voice/model/.
// See docs/voice.md.
export const DEFAULT_MODEL_BASE: string = import.meta.env.VITE_VOICE_MODEL_URL || 'voice/model/c8-1/'

export function voiceSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof WebAssembly === 'object' &&
    typeof AudioWorkletNode === 'function' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof Worker === 'function'
  )
}

/** A worker loading (or holding) the model before anyone asked to listen. */
interface Spare {
  base: string
  worker: Worker
  ready: Promise<void>
  isReady: boolean
  progress: { loaded: number; total: number } | null
}
let spare: Spare | null = null
const spareListeners = new Set<() => void>()

/**
 * [voice] Start downloading and compiling the speech model now (page open,
 * idle time), so pressing Listen is instant and nothing said after Begin is
 * lost to loading. The next VoiceEngine.start() with the same model adopts
 * this worker. Cached: a second visit only compiles.
 */
export function prefetchVoiceModel(modelBase: string = DEFAULT_MODEL_BASE): Promise<void> | null {
  if (!voiceSupported()) return null
  const base = new URL(modelBase, document.baseURI).href
  if (spare?.base === base) return spare.ready
  spare?.worker.terminate()
  const worker = new Worker(asset('voice/asr-worker.js'))
  const entry: Spare = { base, worker, ready: Promise.resolve(), isReady: false, progress: null }
  entry.ready = new Promise<void>((resolve, reject) => {
    worker.addEventListener('message', (ev: MessageEvent) => {
      const m = ev.data
      if (m.type === 'progress') entry.progress = { loaded: m.loaded, total: m.total }
      else if (m.type === 'ready') {
        entry.isReady = true
        resolve()
        for (const l of spareListeners) l()
      } else if (m.type === 'error') reject(Object.assign(new Error(m.message), { code: m.code as VoiceError }))
    })
    worker.addEventListener('error', (ev) => reject(Object.assign(new Error(ev.message || 'worker failed'), { code: 'engine-failed' as VoiceError })))
  })
  entry.ready.catch(() => {
    // Start() will try again (and report the error) itself.
    if (spare === entry) spare = null
    worker.terminate()
  })
  worker.postMessage({ type: 'init', modelBase: base })
  spare = entry
  return entry.ready
}

/**
 * Prefetch when the browser is idle, unless the person asked to save data or
 * the device is short of memory (the model takes about 200 MB once loaded).
 */
export function prefetchVoiceModelWhenIdle(modelBase?: string): () => void {
  const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number }
  if (nav.connection?.saveData || (nav.deviceMemory !== undefined && nav.deviceMemory < 2)) return () => {}
  const run = () => void prefetchVoiceModel(modelBase)?.catch(() => {})
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(run, { timeout: 4000 })
    return () => w.cancelIdleCallback?.(id)
  }
  const id = window.setTimeout(run, 1500)
  return () => window.clearTimeout(id)
}

/** Whether a prefetched model is ready to listen with. */
export function voiceModelPrefetched(): boolean {
  return !!spare?.isReady
}

/** Called when a prefetched model becomes ready. */
export function onVoiceModelReady(listener: () => void): () => void {
  spareListeners.add(listener)
  return () => spareListeners.delete(listener)
}

export class VoiceEngine {
  status: VoiceStatus = 'idle'
  error?: VoiceError
  /**
   * Seconds between opening the microphone and the first sample reaching the
   * worker (audio captured in between is not decoded). The replay harness
   * uses it to line the worker's audio clock up with a fake-capture file.
   */
  micLeadSec = 0
  /** Total decoding time and audio decoded so far (real-time factor = decodeMs / 1000 / audioSec), from the last finish(). */
  decodeStats = { decodeMs: 0, audioSec: 0 }
  private micOpenedAt = 0
  /** Seconds the decoder runs behind the microphone (a starved CPU: the 3D stage, a weak laptop). */
  lagSec = 0
  private lagBase = Infinity
  private worker: Worker | null = null
  private ctx: AudioContext | null = null
  private media: MediaStream | null = null
  private node: AudioWorkletNode | null = null
  private listeners = new Set<(e: EngineEvent) => void>()
  private pending = new Map<number, () => void>()
  private recordings = new Map<number, (r: { pcm: Int16Array; sampleRate: number; startAt: number }) => void>()
  private nextId = 1
  private ready: Promise<void> | null = null

  on(listener: (e: EngineEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(e: EngineEvent) {
    for (const l of this.listeners) l(e)
  }

  private setStatus(status: VoiceStatus, error?: VoiceError, detail?: string) {
    this.status = status
    this.error = error
    this.emit({ type: 'status', status, error, detail })
  }

  /** Load the recogniser and (unless `mic: false`) open the microphone. */
  async start(opts: VoiceEngineOptions = {}): Promise<void> {
    if (this.status === 'loading' || this.status === 'listening') return
    const mic = opts.mic ?? true
    if (!voiceSupported() && mic) return this.setStatus('error', 'unsupported')
    this.setStatus('loading')
    this.lagBase = Infinity
    this.lagSec = 0
    // Created inside the user's click so it is allowed to start.
    if (mic) this.ctx = new AudioContext({ latencyHint: 'interactive' })
    // The permission prompt goes up while the model downloads, unless asked not to.
    const micPromise = mic && !opts.micAfterLoad ? this.openMic(opts) : Promise.resolve(null)
    try {
      await Promise.all([this.loadWorker(opts.modelBase ?? DEFAULT_MODEL_BASE), micPromise])
      if (mic && opts.micAfterLoad) await this.openMic(opts)
      if (mic) await this.connectMic()
      this.micLeadSec = (performance.now() - this.micOpenedAt) / 1000
      this.setStatus('listening')
    } catch (err) {
      const e = err as Error & { code?: VoiceError }
      this.teardown()
      this.setStatus('error', e.code ?? 'engine-failed', e.message)
    }
  }

  private loadWorker(modelBase: string): Promise<void> {
    if (this.ready) return this.ready
    // A prefetched worker for this model: take it over (it may still be loading).
    const base = new URL(modelBase, document.baseURI).href
    const adopted = spare?.base === base ? spare : null
    if (adopted) spare = null
    const worker = adopted?.worker ?? new Worker(asset('voice/asr-worker.js'))
    this.worker = worker
    if (adopted?.progress) this.emit({ type: 'progress', ...adopted.progress })
    this.ready = new Promise<void>((resolve, reject) => {
      if (adopted) adopted.ready.then(resolve, reject)
      worker.onmessage = (ev: MessageEvent) => {
        const m = ev.data
        switch (m.type) {
          case 'ready':
            resolve()
            break
          case 'error':
            reject(Object.assign(new Error(m.message), { code: m.code as VoiceError }))
            break
          case 'progress':
            this.emit({ type: 'progress', loaded: m.loaded, total: m.total })
            break
          case 'tokens':
            this.emit({ type: 'tokens', tokens: m.tokens, at: m.at, segment: m.segment, decodeMs: m.decodeMs })
            break
          case 'endpoint':
            this.emit({ type: 'endpoint', at: m.at, segment: m.segment })
            break
          case 'level': {
            // Wall clock minus the worker's audio clock, against its best value
            // so far: how far decoding has fallen behind the microphone.
            const d = performance.now() / 1000 - m.at
            this.lagBase = Math.min(this.lagBase, d)
            this.lagSec = d - this.lagBase
            this.emit({ type: 'level', rms: m.rms, speech: m.speech, at: m.at, lag: this.lagSec })
            break
          }
          case 'recording':
            this.recordings.get(m.id)?.({ pcm: m.pcm, sampleRate: m.sampleRate, startAt: m.startAt })
            this.recordings.delete(m.id)
            break
          case 'ack':
          case 'finished':
            if (typeof m.decodeMs === 'number') this.decodeStats = { decodeMs: m.decodeMs, audioSec: m.audioSec }
            this.pending.get(m.id)?.()
            this.pending.delete(m.id)
            break
        }
      }
      worker.onerror = (ev) => reject(Object.assign(new Error(ev.message || 'worker failed'), { code: 'engine-failed' as VoiceError }))
    })
    if (!adopted) worker.postMessage({ type: 'init', modelBase: base })
    return this.ready
  }

  private async openMic(opts: VoiceEngineOptions) {
    try {
      this.micOpenedAt = performance.now()
      this.media = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: opts.echoCancellation ?? true,
          noiseSuppression: opts.noiseSuppression ?? false,
          autoGainControl: opts.autoGainControl ?? true,
        },
      })
    } catch (err) {
      const name = (err as DOMException).name
      const code: VoiceError = name === 'NotFoundError' || name === 'OverconstrainedError' ? 'mic-missing' : 'mic-denied'
      throw Object.assign(new Error(name), { code })
    }
  }

  private async connectMic() {
    const ctx = this.ctx!
    await ctx.audioWorklet.addModule(asset('voice/capture-worklet.js'))
    const source = ctx.createMediaStreamSource(this.media!)
    const node = new AudioWorkletNode(ctx, 'prayalong-capture', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1 })
    const channel = new MessageChannel()
    node.port.postMessage({ port: channel.port1 }, [channel.port1])
    this.worker!.postMessage({ type: 'port', port: channel.port2 }, [channel.port2])
    source.connect(node)
    this.node = node
    if (ctx.state === 'suspended') await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 300))])
    // Started without a click (e.g. from a URL flag): Chrome keeps the context
    // suspended until the first interaction, so resume it then.
    if (ctx.state === 'suspended') {
      const resume = () => {
        void ctx.resume().catch(() => {})
        for (const t of ['pointerdown', 'keydown', 'touchend']) window.removeEventListener(t, resume, true)
      }
      for (const t of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(t, resume, true)
    }
  }

  /**
   * Companion speaking: replace the microphone with silence in the worker so
   * the follower never tracks the app's own voice. Cheap to toggle per line.
   */
  setGate(on: boolean) {
    this.worker?.postMessage({ type: 'gate', on })
  }

  /**
   * Opt-in session recording: the worker keeps the raw microphone (before the
   * companion gate) at 16 kHz. Nothing leaves the device; take it with
   * takeRecording() and save it locally.
   */
  setRecording(on: boolean) {
    this.worker?.postMessage({ type: 'record', on })
  }

  /** The audio recorded so far (16-bit PCM, 16 kHz) and the worker clock at its start. */
  takeRecording(clear = false): Promise<{ pcm: Int16Array; sampleRate: number; startAt: number }> {
    const id = this.nextId++
    return new Promise((resolve) => {
      if (!this.worker) return resolve({ pcm: new Int16Array(0), sampleRate: 16000, startAt: 0 })
      this.recordings.set(id, resolve)
      this.worker.postMessage({ type: 'take', id, clear })
    })
  }

  /** Feed audio directly (lab replay, tests). Resolves once decoded. */
  feed(samples: Float32Array, rate: number): Promise<void> {
    const id = this.nextId++
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.worker?.postMessage({ type: 'audio', samples, rate, id }, [samples.buffer])
    })
  }

  /** Flush the current utterance (zero samples, then inputFinished). */
  finish(): Promise<void> {
    const id = this.nextId++
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.worker?.postMessage({ type: 'finish', id })
      // A dead worker must not hang the caller.
      setTimeout(() => {
        this.pending.delete(id)
        resolve()
      }, 5000)
    })
  }

  private teardown() {
    this.node?.disconnect()
    this.node = null
    for (const t of this.media?.getTracks() ?? []) t.stop()
    this.media = null
    void this.ctx?.close().catch(() => {})
    this.ctx = null
    this.worker?.terminate()
    this.worker = null
    this.ready = null
    for (const resolve of this.pending.values()) resolve()
    this.pending.clear()
  }

  stop() {
    this.teardown()
    this.setStatus('idle')
  }
}
