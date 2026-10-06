import { ResilientCamera, type CameraState } from './camera'
import { SIG_SIZE, signature, type Signature } from './face-signature'
import type { Detection } from './face-track'

const base = import.meta.env.BASE_URL

/** One analysed frame: every face-like detection (normalised 0..1, y down). */
export interface FaceReading {
  t: number
  detections: Detection[]
}

export type FaceEngineStatus = 'starting' | 'loading' | 'watching' | 'reconnecting' | 'camera-lost' | 'denied' | 'no-camera' | 'no-model'

const WIDTH = 320
const INTERVAL_MS = 80 // ~12 fps

type Detector = { detectForVideo: (src: HTMLCanvasElement, ts: number) => { detections: { boundingBox?: { originX: number; originY: number; width: number; height: number }; categories: { score: number }[] }[] }; close: () => void }

/**
 * Camera -> BlazeFace (short range, MediaPipe Tasks, CPU) on a 320 px copy of
 * the frame, ~12 times a second on the main thread (a few ms each).
 */
export class FaceEngine {
  readonly video: HTMLVideoElement
  private canvas = document.createElement('canvas')
  private ctx = this.canvas.getContext('2d', { willReadFrequently: false })
  private small = Object.assign(document.createElement('canvas'), { width: SIG_SIZE, height: SIG_SIZE })
  private smallCtx = this.small.getContext('2d', { willReadFrequently: true })
  /** Average ms per identity crop + signature (for the debug overlay). */
  idMs = 0
  private camera: ResilientCamera
  private detector: Detector | null = null
  private timer = 0
  private stopped = false
  private lastTs = 0
  status: FaceEngineStatus = 'starting'

  constructor(
    facingMode: 'user' | 'environment',
    private readonly cb: {
      onStatus: (s: FaceEngineStatus) => void
      onStream: (s: MediaStream | null) => void
      onReading: (r: FaceReading) => void
    },
  ) {
    this.video = document.createElement('video')
    this.video.muted = true
    this.video.playsInline = true
    this.video.setAttribute('playsinline', '')
    // Kept in the document (Safari only decodes attached videos reliably), invisible.
    Object.assign(this.video.style, { position: 'fixed', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none', left: '0', top: '0' })
    document.body.appendChild(this.video)
    this.camera = new ResilientCamera({
      facingMode,
      onStream: (s) => {
        this.video.srcObject = s
        if (s) void this.video.play().catch(() => {})
        cb.onStream(s)
      },
      onState: (s) => this.onCamera(s),
    })
  }

  private set(s: FaceEngineStatus) {
    if (this.status === s) return
    this.status = s
    this.cb.onStatus(s)
  }

  private onCamera(s: CameraState) {
    if (s === 'live') this.set(this.detector ? 'watching' : 'loading')
    else if (s === 'reconnecting') this.set('reconnecting')
    else if (s === 'lost') this.set('camera-lost')
    else if (s === 'denied') this.set('denied')
    else if (s === 'missing') this.set('no-camera')
  }

  async start() {
    this.cb.onStatus('starting')
    const model = this.load()
    await this.camera.start()
    if (this.stopped || this.status === 'denied' || this.status === 'no-camera') return
    try {
      this.detector = await model
    } catch (err) {
      console.warn('[face] detector failed', err)
      if (!this.stopped) this.set('no-model')
      return
    }
    if (this.stopped) return this.detector?.close()
    if (this.camera.state === 'live') this.set('watching')
    this.loop()
  }

  private async load(): Promise<Detector> {
    const { FilesetResolver, FaceDetector } = await import('@mediapipe/tasks-vision')
    const fileset = await FilesetResolver.forVisionTasks(`${base}mediapipe`)
    return (await FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${base}models/blaze_face_short_range.tflite`, delegate: 'CPU' },
      runningMode: 'VIDEO',
      minDetectionConfidence: 0.3,
    })) as unknown as Detector
  }

  private loop = () => {
    if (this.stopped) return
    this.timer = window.setTimeout(this.loop, INTERVAL_MS)
    const v = this.video
    if (!this.detector || !this.ctx || this.camera.state !== 'live' || v.readyState < 2 || !v.videoWidth) return
    const w = WIDTH
    const h = Math.round((v.videoHeight / v.videoWidth) * w)
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    this.ctx.drawImage(v, 0, 0, w, h)
    const now = performance.now()
    this.lastTs = Math.max(this.lastTs + 1, Math.round(now))
    const detections: Detection[] = []
    try {
      const res = this.detector.detectForVideo(this.canvas, this.lastTs)
      for (const d of res.detections) {
        const b = d.boundingBox
        if (!b) continue
        const box = { x: b.originX / w, y: b.originY / h, w: b.width / w, h: b.height / h }
        let memo: Signature | null | undefined
        // Lazy: only computed when the tracker asks (this frame, while the canvas still holds it).
        const sig = () => (memo !== undefined ? memo : (memo = this.signatureOf(b.originX, b.originY, b.width, b.height)))
        detections.push({ score: d.categories[0]?.score ?? 0, box, sig })
      }
    } catch (err) {
      console.warn('[face] detect failed', err)
    }
    this.cb.onReading({ t: now, detections })
  }

  /** The central part of the face box (no hair, no background), 32x32. */
  private signatureOf(x: number, y: number, w: number, h: number): Signature | null {
    const c = this.smallCtx
    if (!c) return null
    const t0 = performance.now()
    const sx = Math.max(0, x + w * 0.12)
    const sy = Math.max(0, y + h * 0.08)
    const sw = Math.min(this.canvas.width - sx, w * 0.76)
    const sh = Math.min(this.canvas.height - sy, h * 0.84)
    if (sw < 4 || sh < 4) return null
    c.drawImage(this.canvas, sx, sy, sw, sh, 0, 0, SIG_SIZE, SIG_SIZE)
    const s = signature(c.getImageData(0, 0, SIG_SIZE, SIG_SIZE).data)
    this.idMs = this.idMs ? this.idMs * 0.9 + (performance.now() - t0) * 0.1 : performance.now() - t0
    return s
  }

  retryCamera() {
    this.camera.retryNow()
  }

  dispose() {
    this.stopped = true
    clearTimeout(this.timer)
    this.camera.stop()
    this.detector?.close()
    this.video.srcObject = null
    this.video.remove()
  }
}
