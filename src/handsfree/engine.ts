import type { PoseClass, Step } from '@/sequence/types'
import { blocker, type Blocker } from './advice'
import { ResilientCamera, type CameraState } from './camera'
import { classifyPose, torsoLength } from './classify'
import { SequenceDecoder, type Advance, type DecoderStatus, type Evidence, type SegmentKind } from './decoder'
import { createDetrPoseEngine } from './engines/detrpose'
import { createMediaPipeEngine } from './engines/mediapipe'
import type { PoseEngine } from './engines/types'
import { VisionEngine } from './engines/vision'
import type { Measures } from './features'
import { bodyFromCoco, type BodyObs, type Observation } from './observation'
import { Perception } from './pipeline'
import { posterior, type FramePosterior } from './posterior'
import { PoseStabilizer } from './stabilizer'

export const FPS = 15

/** DETRPose joins as a second body engine when a frame takes at most this long. */
const DETR_BUDGET_MS = 150
/** `?engine=mediapipe` (or VITE_POSE_ENGINE=mediapipe) turns the second engine off. */
const DETR_ENABLED = () =>
  typeof navigator !== 'undefined' &&
  'gpu' in navigator &&
  (new URLSearchParams(location.search).get('engine') ?? import.meta.env.VITE_POSE_ENGINE) !== 'mediapipe'

/**
 * For tuning and the end-to-end test (scripts/e2e-handsfree.mjs):
 * `window.__handsFree` holds the latest frame's measures, features,
 * posterior and decoder state, plus a log of camera starts and advances.
 */
const debug: { latest: unknown; log: Record<string, unknown>[] } = { latest: null, log: [] }
if (typeof window !== 'undefined') (window as unknown as { __handsFree?: typeof debug }).__handsFree = debug

export type EngineStatus = 'starting' | 'loading' | 'watching' | 'reconnecting' | 'lost' | 'denied' | 'no-camera' | 'no-model'

export interface Live {
  /** What the decoder believes the person is doing, and what it waits for. */
  decoder: DecoderStatus
  /** The single most likely pose this frame (for the bubble), or null. */
  pose: PoseClass | null
  blocker: Blocker
  calibrated: boolean
  /** Don't let timers cross a posture boundary (sujud with nobody in view). */
  hold: boolean
}

export interface EngineCallbacks {
  onStatus: (s: EngineStatus) => void
  onStream: (s: MediaStream | null) => void
  onLabel: (label: string) => void
  /** ~5 times a second. */
  onLive: (live: Live) => void
  /** A movement was recognised: go to this step (or the next line, index -1). */
  onAdvance: (adv: Advance) => void
  /** The previous engine's pose changes (compat fallback only). */
  onPose: (pose: PoseClass) => void
  /** Every observation, for `?lab&record`. */
  onObservation?: (obs: Observation, post: FramePosterior | null) => void
}

/**
 * Hands-free, end to end and outside React: a resilient camera, the vision
 * worker (body + face), calibrated features, the per-frame classifier and
 * the sequence decoder. If the worker can't run at all, it falls back to
 * the previous main-thread engine (MediaPipe lite + classify.ts).
 */
export class HandsFreeEngine {
  private camera: ResilientCamera
  private video = document.createElement('video')
  private vision: VisionEngine | null = null
  private compat: PoseEngine | null = null
  /** DETRPose, the second body engine, when this device runs it fast enough. */
  private detr: PoseEngine | null = null
  private lastDetr: { t: number; body: BodyObs | null } | null = null
  private detrBusy = false
  private compatStab = new PoseStabilizer()
  private compatTorso: number | undefined
  private perception = new Perception()
  private decoder: SequenceDecoder
  private timer = 0
  private stopped = false
  private lastLive = 0
  private lastMeasures: Measures | null = null
  private lastStanding = false
  private blockerCandidate: { b: Blocker; since: number } = { b: null, since: 0 }
  private shownBlocker: Blocker = null
  private nobodySince: number | null = null
  private phase: 'ready' | 'praying' | 'complete' = 'ready'
  private status: EngineStatus = 'starting'
  /** Recalibrate on the next quiet standing frames (setup). */
  private calibrating = true
  check: CheckRun | null = null

  constructor(
    steps: readonly Step[],
    facingMode: 'user' | 'environment',
    private readonly cb: EngineCallbacks,
  ) {
    this.decoder = new SequenceDecoder(steps)
    this.video.muted = true
    this.video.playsInline = true
    this.camera = new ResilientCamera({
      facingMode,
      onStream: (s) => {
        if (s) debug.log.push({ t: performance.now(), type: 'stream' })
        this.video.srcObject = s
        if (s) void this.video.play().catch(() => {})
        cb.onStream(s)
      },
      onState: (state) => this.onCamera(state),
    })
  }

  private setStatus(s: EngineStatus) {
    if (s === this.status) return
    this.status = s
    this.cb.onStatus(s)
  }

  private onCamera(state: CameraState) {
    if (state === 'denied') return this.setStatus('denied')
    if (state === 'missing') return this.setStatus('no-camera')
    if (state === 'reconnecting') return this.setStatus('reconnecting')
    if (state === 'lost') return this.setStatus('lost')
    if (state === 'live' && (this.vision || this.compat)) this.setStatus('watching')
  }

  async start() {
    this.setStatus('starting')
    await this.camera.start()
    if (this.stopped || this.camera.state !== 'live') return
    this.setStatus('loading')
    try {
      this.vision = await VisionEngine.create({
        pose: 'full',
        face: true,
        onLabel: (l) => this.cb.onLabel(l),
        onRestart: (why) => console.warn('[hands-free] vision restarted:', why),
      })
      this.cb.onLabel(this.vision.label)
    } catch (err) {
      console.warn('[hands-free] vision worker unavailable, using the main-thread engine', err)
      try {
        this.compat = await createMediaPipeEngine()
        this.cb.onLabel(`${this.compat.label} (compatibility)`)
      } catch {
        if (!this.stopped) this.setStatus('no-model')
        return
      }
    }
    if (this.stopped) return this.dispose()
    this.setStatus(this.camera.state === 'live' ? 'watching' : this.camera.state === 'lost' ? 'lost' : 'reconnecting')
    this.loop()
    if (this.vision && DETR_ENABLED()) void this.startDetr()
  }

  /**
   * DETRPose finds the person more reliably when the head is cut off or very
   * close (see docs/hands-free.md, Evaluation). It warms up in the
   * background and joins only if a frame fits the budget on this device.
   */
  private async startDetr() {
    try {
      const engine = await createDetrPoseEngine({ maxFrameMs: DETR_BUDGET_MS, letterbox: false })
      if (this.stopped) return engine.dispose()
      this.detr = engine
      this.cb.onLabel(`${this.vision?.label ?? ''} + ${engine.label}`)
    } catch (err) {
      console.info('[hands-free] second body engine not used:', (err as Error)?.message)
    }
  }

  /** Run DETRPose on this frame without holding up the loop; its latest answer is used for ~250 ms. */
  private feedDetr(t: number) {
    if (!this.detr || this.detrBusy) return
    if (this.detr.healthy === false) {
      // Crashed, or its GPU device was lost: MediaPipe carries on alone.
      console.warn('[hands-free] second body engine failed; continuing with MediaPipe')
      this.detr.dispose()
      this.detr = null
      this.cb.onLabel(this.vision?.label ?? '')
      return
    }
    this.detrBusy = true
    this.detr
      .detect(this.video, t)
      .then((kp) => (this.lastDetr = { t, body: kp ? bodyFromCoco(kp) : null }))
      .catch(() => {})
      .finally(() => (this.detrBusy = false))
  }

  /** Keep the decoder in step with the session (taps, timers, restarts). */
  sync(phase: 'ready' | 'praying' | 'complete', index: number) {
    if (phase === 'ready' && this.phase !== 'ready') this.calibrating = true
    this.phase = phase
    this.decoder.sync(phase, index, performance.now())
  }

  addEvidence(ev: Omit<Evidence, 'at'> & { at?: number }) {
    this.decoder.addEvidence({ ...ev, at: ev.at ?? performance.now() })
  }

  /** Start a fresh standing calibration (setup sheet: "stand on the rug, look at the screen"). */
  recalibrate() {
    this.perception.recalibrate()
    this.calibrating = true
  }

  /** The setup check: a quick ruku and sit, within 10 seconds. */
  startCheck(onDone: (result: CheckResult) => void) {
    this.check = new CheckRun(performance.now(), onDone)
  }

  private loop = async () => {
    if (this.stopped) return
    const started = performance.now()
    if (this.video.readyState >= 2 && this.camera.state === 'live') {
      try {
        await this.frame(started)
      } catch (err) {
        console.warn('[hands-free] frame failed', err)
      }
    }
    if (!this.stopped) this.timer = window.setTimeout(this.loop, Math.max(0, 1000 / FPS - (performance.now() - started)))
  }

  private async frame(t: number) {
    if (this.compat) return this.compatFrame(t)
    if (!this.vision?.ready) return
    this.feedDetr(t)
    const bitmap = await createImageBitmap(this.video)
    const obs = await this.vision.detect(bitmap, t)
    if (this.stopped || !obs) return
    obs.t = t
    if (this.lastDetr && t - this.lastDetr.t < 250) obs.detr = this.lastDetr.body

    // Calibrate while the person stands before the prayer: a rolling window
    // of quiet standing frames (not the setup check's bow and sit).
    const calibrating = this.calibrating && this.phase === 'ready' && !this.check?.active && (!this.perception.ref || this.lastStanding)
    const st = this.decoder.status(t)
    const standing = this.phase === 'praying' && st.current === 'standing'
    const r = this.perception.push(obs, { calibrating, standing })
    const post = posterior(t, r.features, r.measures)
    this.lastMeasures = r.measures
    this.lastStanding = post.conf > 0 && post.p.standing > 0.6
    this.nobodySince = post.present ? null : (this.nobodySince ?? t)
    this.cb.onObservation?.(obs, post)

    if (this.check) this.check.push(post, r.features !== null)
    const adv = this.decoder.push(post)
    debug.latest = { t, measures: r.measures, features: r.features, posterior: post, decoder: this.decoder.status(t), ref: this.perception.ref }
    if (adv) {
      debug.log.push({ t, type: 'advance', index: adv.index, segment: this.decoder.segment, kind: adv.kind, reason: adv.reason })
      this.cb.onAdvance(adv)
    }
    if (t - this.lastLive > 200) this.emitLive(t, post)
  }

  private emitLive(t: number, post: FramePosterior | null) {
    this.lastLive = t
    const decoder = this.decoder.status(t)
    const best = post && post.conf > 0 ? (Object.entries(post.p).sort((a, b) => b[1] - a[1])[0]![0] as PoseClass) : null
    // Framing advice only makes sense while the person stands (before the
    // prayer, qiyam), and only once it has held for a second.
    const expectStanding = (this.phase === 'ready' || decoder.current === 'standing') && (!post || post.conf === 0 || post.p.standing > 0.5)
    const b = blocker(this.lastMeasures, { standing: expectStanding, ref: this.perception.ref, nobodyFor: this.nobodySince === null ? 0 : (t - this.nobodySince) / 1000 })
    if (b !== this.blockerCandidate.b) this.blockerCandidate = { b, since: t }
    if (t - this.blockerCandidate.since >= 1000) this.shownBlocker = b
    this.cb.onLive({
      decoder,
      pose: best,
      blocker: this.shownBlocker,
      calibrated: !!this.perception.ref,
      hold: decoder.lost && decoder.current === 'prostrating',
    })
  }

  /** The previous engine, for devices where the worker can't run. */
  private async compatFrame(t: number) {
    const kp = await this.compat!.detect(this.video, t)
    let changed: PoseClass | null
    if (kp) {
      const reading = classifyPose(kp, this.compatTorso, this.video.videoWidth / Math.max(1, this.video.videoHeight))
      if (reading.pose === 'standing') {
        const len = torsoLength(kp, this.video.videoWidth / Math.max(1, this.video.videoHeight))
        this.compatTorso = this.compatTorso ? this.compatTorso * 0.9 + len * 0.1 : len
      }
      changed = this.compatStab.push(reading.pose, t)
    } else changed = this.compatStab.push(null, t)
    if (changed) this.cb.onPose(changed)
    if (t - this.lastLive > 200) {
      this.lastLive = t
      this.cb.onLive({ decoder: this.decoder.status(t), pose: this.compatStab.current, blocker: kp ? null : 'no-person', calibrated: true, hold: false })
    }
  }

  retryCamera() {
    this.camera.retryNow()
  }

  dispose() {
    this.stopped = true
    clearTimeout(this.timer)
    this.camera.stop()
    this.vision?.dispose()
    this.detr?.dispose()
    this.compat?.dispose()
  }

  async stop() {
    this.dispose()
  }
}

export type CheckResult = { ok: true } | { ok: false; missing: ('bowing' | 'sitting')[] }

/**
 * Setup check: within 10 s, the camera must see a ruku and then sitting
 * (in that order), each held for a few frames.
 */
export class CheckRun {
  private seen = { bowing: 0, sitting: 0 }
  done = false
  get active() {
    return !this.done
  }
  constructor(
    private readonly t0: number,
    private readonly onDone: (r: CheckResult) => void,
  ) {}

  get stage(): 'bowing' | 'sitting' | 'done' {
    return this.seen.bowing < 4 ? 'bowing' : this.seen.sitting < 4 ? 'sitting' : 'done'
  }

  push(post: FramePosterior, calibrated: boolean) {
    if (this.done) return
    if (calibrated && post.conf > 0.3) {
      if (this.stage === 'bowing' && post.p.bowing > 0.6) this.seen.bowing++
      else if (this.stage === 'sitting' && post.p.sitting > 0.6) this.seen.sitting++
    }
    if (this.stage === 'done') return this.finish({ ok: true })
    if (post.t - this.t0 > 10_000) {
      const missing: ('bowing' | 'sitting')[] = []
      if (this.seen.bowing < 4) missing.push('bowing')
      if (this.seen.sitting < 4) missing.push('sitting')
      this.finish({ ok: false, missing })
    }
  }

  private finish(r: CheckResult) {
    this.done = true
    this.onDone(r)
  }
}

export type { SegmentKind }
