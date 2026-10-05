import type { Observation } from '../observation'
import type { VisionIn, VisionOut } from '../vision-worker'

export interface VisionOptions {
  pose?: 'full' | 'lite' | 'heavy' | null
  face?: boolean
  minConf?: number
  /** Start on the GPU (WebGL in the worker) and fall back to the CPU. */
  delegate?: 'GPU' | 'CPU'
  /** Restart the worker if it hasn't answered for this long (ms). */
  watchdogMs?: number
  /** How long model downloads may take (ms). */
  loadTimeoutMs?: number
  /** Override the page-relative base (tests, eval). */
  base?: string
  onLabel?: (label: string) => void
  onRestart?: (reason: string) => void
}

/**
 * Client for vision-worker.ts. One frame in flight at a time; errors come
 * back immediately (never waits out a timeout); a crashed, hung or
 * GPU-lost worker is replaced by a fresh one on the CPU.
 */
export class VisionEngine {
  label = ''
  delegate: 'GPU' | 'CPU'
  private worker: Worker | null = null
  private inflight: { resolve: (o: Observation | null) => void; t: number; timer: number } | null = null
  private disposed = false
  /** The first frames after a (re)start compile GPU shaders and can take seconds. */
  private warm = false
  private restarting: Promise<void> | null = null
  restarts = 0

  private constructor(private readonly opts: VisionOptions) {
    this.delegate = opts.delegate ?? 'GPU'
  }

  static async create(opts: VisionOptions = {}) {
    const engine = new VisionEngine(opts)
    try {
      await engine.boot(engine.delegate)
    } catch (err) {
      if (engine.delegate === 'CPU') throw err
      console.warn('[vision] GPU delegate failed, using CPU', err)
      engine.delegate = 'CPU'
      await engine.boot('CPU')
    }
    return engine
  }

  private boot(delegate: 'GPU' | 'CPU') {
    this.worker?.terminate()
    const worker = new Worker(new URL('../vision-worker.ts', import.meta.url), { type: 'module' })
    this.worker = worker
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('vision models took too long to load')), this.opts.loadTimeoutMs ?? 90_000)
      worker.onmessage = (e: MessageEvent<VisionOut>) => {
        const msg = e.data
        if (msg.type === 'ready') {
          clearTimeout(timer)
          this.warm = false
          this.label = msg.label
          this.opts.onLabel?.(msg.label)
          worker.onmessage = (ev: MessageEvent<VisionOut>) => this.onMessage(ev.data)
          resolve()
        } else if (msg.type === 'error') {
          clearTimeout(timer)
          worker.terminate()
          reject(new Error(msg.message))
        }
      }
      worker.onerror = (e) => {
        clearTimeout(timer)
        worker.terminate()
        reject(new Error(e.message || 'vision worker failed to start'))
      }
      const base = this.opts.base ?? new URL(import.meta.env.BASE_URL, location.href).href
      const init: VisionIn = { type: 'init', base, pose: this.opts.pose === undefined ? 'full' : this.opts.pose, face: this.opts.face ?? true, delegate, minConf: this.opts.minConf }
      worker.postMessage(init)
    }).then(() => {
      worker.onerror = (e) => {
        e.preventDefault()
        void this.restart(`worker crashed: ${e.message}`)
      }
    })
  }

  private onMessage(msg: VisionOut) {
    if (msg.type === 'obs') {
      this.warm = true
      return this.settle(msg.obs)
    }
    if (msg.type === 'error') {
      this.settle(null)
      // A GPU that was lost (or any fatal error): start over on the CPU.
      if (msg.fatal || /context lost|device lost|webgl/i.test(msg.message)) void this.restart(msg.message)
    }
  }

  private settle(obs: Observation | null) {
    const f = this.inflight
    if (!f) return
    clearTimeout(f.timer)
    this.inflight = null
    f.resolve(obs)
  }

  /** Restart on the CPU (once on the GPU first if it has never failed). */
  restart(reason: string): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.restarting) return this.restarting
    console.warn('[vision] restarting:', reason)
    this.restarts++
    this.opts.onRestart?.(reason)
    this.settle(null)
    this.delegate = 'CPU'
    this.restarting = this.boot('CPU')
      .catch((err) => console.warn('[vision] restart failed', err))
      .finally(() => (this.restarting = null))
    return this.restarting
  }

  get ready() {
    return !!this.worker && !this.restarting && !this.disposed
  }

  /** Process one frame; resolves null when the frame was dropped or failed. Takes ownership of the bitmap. */
  detect(bitmap: ImageBitmap, t: number): Promise<Observation | null> {
    if (!this.ready || this.inflight) {
      bitmap.close()
      return Promise.resolve(null)
    }
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        // Watchdog: no answer at all for this long means the worker is stuck.
        this.settle(null)
        void this.restart('no result from the vision worker')
      }, this.warm ? (this.opts.watchdogMs ?? 3000) : Math.max(this.opts.watchdogMs ?? 3000, 20_000))
      this.inflight = { resolve, t, timer }
      const msg: VisionIn = { type: 'frame', bitmap, t }
      this.worker!.postMessage(msg, [bitmap])
    })
  }

  dispose() {
    this.disposed = true
    this.settle(null)
    this.worker?.terminate()
    this.worker = null
  }
}
