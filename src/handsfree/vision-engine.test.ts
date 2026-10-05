import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VisionEngine } from './engines/vision'

/** A fake vision worker: answers init, and frames unless told to hang or fail. */
class FakeWorker {
  static all: FakeWorker[] = []
  static mode: 'ok' | 'hang' | 'gpu-lost' = 'ok'
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: ((e: { message: string; preventDefault: () => void }) => void) | null = null
  delegate = ''
  terminated = false
  constructor() {
    FakeWorker.all.push(this)
  }
  postMessage(msg: { type: string; delegate?: string; t?: number; bitmap?: { close(): void } }) {
    queueMicrotask(() => {
      if (msg.type === 'init') {
        this.delegate = msg.delegate!
        this.onmessage?.({ data: { type: 'ready', delegate: msg.delegate, label: `fake ${msg.delegate}` } })
      } else if (FakeWorker.mode === 'ok' || this.delegate === 'CPU')
        this.onmessage?.({ data: { type: 'obs', obs: { t: msg.t, aspect: 4 / 3, body: null, face: null, luma: null, ms: 1 } } })
      else if (FakeWorker.mode === 'gpu-lost') this.onmessage?.({ data: { type: 'error', message: 'WebGL context lost', fatal: false } })
    })
  }
  terminate() {
    this.terminated = true
  }
}

const bitmap = () => ({ close: vi.fn(), width: 640, height: 480 }) as unknown as ImageBitmap

describe('VisionEngine', () => {
  beforeEach(() => {
    FakeWorker.all = []
    FakeWorker.mode = 'ok'
    vi.useFakeTimers()
    vi.stubGlobal('Worker', FakeWorker)
    vi.stubGlobal('window', globalThis)
    vi.stubGlobal('location', { href: 'http://localhost/' })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('answers frames, one at a time', async () => {
    const e = await VisionEngine.create({ base: '/' })
    expect(e.label).toBe('fake GPU')
    const obs = await e.detect(bitmap(), 100)
    expect(obs?.t).toBe(100)
  })

  it('restarts a hung worker on the CPU after the watchdog (20 s for the first frame, 3 s once warm)', async () => {
    FakeWorker.mode = 'hang'
    const e = await VisionEngine.create({ base: '/' })
    // Warm-up: the first frame may take long (shader compilation).
    const first = e.detect(bitmap(), 1)
    await vi.advanceTimersByTimeAsync(19_000)
    expect(e.restarts).toBe(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await first).toBeNull()
    await vi.advanceTimersByTimeAsync(0)
    expect(e.restarts).toBe(1)
    // Warm now (CPU answers); a hang later is caught after 3 s.
    expect((await e.detect(bitmap(), 2))?.t).toBe(2)
    FakeWorker.mode = 'hang'
    FakeWorker.all.at(-1)!.delegate = 'GPU'
    const pending = e.detect(bitmap(), 3)
    await vi.advanceTimersByTimeAsync(3000)
    expect(await pending).toBeNull()
    await vi.advanceTimersByTimeAsync(0)
    expect(FakeWorker.all[0]!.terminated).toBe(true)
    expect(e.delegate).toBe('CPU')
    expect(e.restarts).toBe(2)
    expect((await e.detect(bitmap(), 4))?.t).toBe(4)
  })

  it('answers a failed frame right away and moves off a lost GPU', async () => {
    FakeWorker.mode = 'gpu-lost'
    const e = await VisionEngine.create({ base: '/' })
    expect(await e.detect(bitmap(), 1)).toBeNull() // no 1.5 s wait
    await vi.advanceTimersByTimeAsync(0)
    expect(e.delegate).toBe('CPU')
    expect((await e.detect(bitmap(), 2))?.t).toBe(2)
  })
})
