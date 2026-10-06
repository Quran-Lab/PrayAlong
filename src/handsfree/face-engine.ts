import { ResilientCamera, type CameraState } from './camera'
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
        if (b) detections.push({ score: d.categories[0]?.score ?? 0, box: { x: b.originX / w, y: b.originY / h, w: b.width / w, h: b.height / h } })
      }
    } catch (err) {
      console.warn('[face] detect failed', err)
    }
    this.cb.onReading({ t: now, detections })
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
