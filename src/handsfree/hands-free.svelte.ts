import type { PoseClass } from '@/sequence/types'
import { classifyPose, torsoLength } from './classify'
import { createDetrPoseEngine } from './engines/detrpose'
import { createMediaPipeEngine } from './engines/mediapipe'
import type { PoseEngine } from './engines/types'
import { PoseStabilizer } from './stabilizer'
import { KP, type Framing, type HandsFreeStatus, type Keypoint } from './types'

const FPS = 15
const DEMO_KEYS: Record<string, PoseClass> = { '1': 'hands-raised', '2': 'standing', '3': 'bowing', '4': 'prostrating', '5': 'sitting' }

type EngineChoice = { id: 'mediapipe' } | { id: 'detrpose'; maxFrameMs?: number }

/** A frame budget for DETRPose to be the default (~8 fps or better). */
const DETRPOSE_BUDGET_MS = 120

/**
 * Engine order. Tracking starts right away with MediaPipe (GPU via WebGL,
 * then CPU); on WebGPU devices DETRPose — the stronger model — warms up in
 * the background and takes over if a frame fits the budget. Force either
 * with `?engine=` or VITE_POSE_ENGINE. DETRPose on WebAssembly is the last
 * resort.
 */
const forcedEngine = () => new URLSearchParams(location.search).get('engine') ?? import.meta.env.VITE_POSE_ENGINE

function engineOrder(): EngineChoice[] {
  const wanted = forcedEngine()
  if (wanted === 'detrpose') return [{ id: 'detrpose' }, { id: 'mediapipe' }]
  return [{ id: 'mediapipe' }, { id: 'detrpose' }]
}

/** Upgrade to DETRPose on WebGPU in the background (unless an engine is forced). */
const shouldUpgrade = () => !forcedEngine() && 'gpu' in navigator

async function startEngine(): Promise<PoseEngine> {
  let lastError: unknown
  for (const choice of engineOrder()) {
    try {
      return choice.id === 'mediapipe' ? await createMediaPipeEngine() : await createDetrPoseEngine({ maxFrameMs: choice.maxFrameMs })
    } catch (err) {
      lastError = err
      console.warn(`[hands-free] ${choice.id} unavailable`, err)
    }
  }
  throw lastError
}

function framingOf(kp: Keypoint[] | null): Framing {
  if (!kp) return 'none'
  const needed = [KP.leftShoulder, KP.rightShoulder, KP.leftHip, KP.rightHip, KP.leftKnee, KP.rightKnee, KP.leftAnkle, KP.rightAnkle]
  const seen = needed.filter((i) => {
    const p = kp[i]!
    return (p.v ?? 1) > 0.5 && p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1
  }).length
  return seen >= 7 ? 'full' : seen >= 3 ? 'partial' : 'none'
}

/**
 * Camera → pose engine → pose class → calm, stable pose changes.
 * Falls back gracefully: GPU → CPU, MediaPipe ⇄ DETRPose, and finally to
 * timed guidance (status says why). Demo mode skips the camera entirely.
 */
export class HandsFree {
  status = $state<HandsFreeStatus>('off')
  stream = $state.raw<MediaStream | null>(null)
  pose = $state<PoseClass | null>(null)
  framing = $state<Framing>('none')
  engineLabel = $state<string | null>(null)
  /** Latest COCO-17 keypoints, for drawing the body in the camera preview. */
  keypoints = $state.raw<Keypoint[] | null>(null)
  facingMode = $state<'user' | 'environment'>('user')
  private attempt = $state(0)
  private stabilizer = new PoseStabilizer()

  /** Set by the app: a stable pose change. */
  onPose: (pose: PoseClass) => void = () => {}

  private emit(p: PoseClass | null, t: number) {
    const changed = this.stabilizer.push(p, t)
    if (changed) {
      this.pose = changed
      this.onPose(changed)
    }
  }

  /** Demo: act out a pose as if the camera had seen it held for a moment. */
  actOut = (p: PoseClass) => {
    const t0 = performance.now()
    for (let i = 0; i <= 12; i++) this.emit(p, t0 + i * 60)
  }

  retry = () => this.attempt++
  flip = () => (this.facingMode = this.facingMode === 'user' ? 'environment' : 'user')

  /** Follow the session's switches. Call once from the root component. */
  connect(get: () => { enabled: boolean; demo: boolean }) {
    // Demo mode
    $effect(() => {
      const { enabled, demo } = get()
      if (!enabled || !demo) return
      this.stabilizer.reset()
      this.status = 'demo'
      this.framing = 'full'
      const onKey = (e: KeyboardEvent) => {
        const p = DEMO_KEYS[e.key]
        if (p && !(e.target as HTMLElement).closest('input, textarea')) this.actOut(p)
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
    })

    // Camera mode
    $effect(() => {
      const { enabled, demo } = get()
      const facingMode = this.facingMode
      void this.attempt
      if (!enabled || demo) {
        if (!enabled) {
          this.status = 'off'
          this.pose = null
        }
        return
      }
      return this.runCamera(facingMode)
    })
  }

  private runCamera(facingMode: 'user' | 'environment') {
    this.stabilizer.reset()
    let cancelled = false
    let media: MediaStream | null = null
    let engine: PoseEngine | null = null
    let timer = 0
    let standingTorso: number | undefined
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true

    const loop = async () => {
      if (cancelled || !engine) return
      const started = performance.now()
      if (video.readyState >= 2) {
        try {
          const kp = await engine.detect(video, started)
          if (cancelled) return
          const framing = framingOf(kp)
          this.framing = framing
          this.keypoints = kp
          if (kp) {
            const reading = classifyPose(kp, standingTorso)
            // For tuning (and Raufa's CV work): the latest raw reading.
            ;(window as unknown as { __handsFree?: unknown }).__handsFree = { engine: engine.id, keypoints: kp, reading, standingTorso }
            if (reading.pose === 'standing') {
              const len = torsoLength(kp)
              standingTorso = standingTorso ? standingTorso * 0.9 + len * 0.1 : len
            }
            this.emit(reading.pose, started)
          } else {
            ;(window as unknown as { __handsFree?: unknown }).__handsFree = { engine: engine.id, keypoints: null }
            this.emit(null, started)
          }
        } catch (err) {
          console.warn('[hands-free] frame failed', err)
        }
      }
      timer = window.setTimeout(loop, Math.max(0, 1000 / FPS - (performance.now() - started)))
    }

    ;(async () => {
      if (!navigator.mediaDevices?.getUserMedia) return (this.status = 'no-camera')
      this.status = 'starting'
      try {
        media = await navigator.mediaDevices.getUserMedia({
          video: { facingMode, width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        })
      } catch (err) {
        if (cancelled) return
        const name = (err as DOMException)?.name
        return (this.status = name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'no-camera')
      }
      if (cancelled) return media.getTracks().forEach((t) => t.stop())
      this.stream = media
      video.srcObject = media
      await video.play().catch(() => {})
      this.status = 'loading'
      try {
        engine = await startEngine()
      } catch {
        if (!cancelled) this.status = 'no-model'
        return
      }
      if (cancelled) return engine.dispose()
      this.engineLabel = engine.label
      this.status = 'watching'
      loop()

      // Tracking already works; now try the stronger model on WebGPU and
      // switch over only if this device runs it fast enough.
      if (shouldUpgrade() && engine.id !== 'detrpose') {
        createDetrPoseEngine({ maxFrameMs: DETRPOSE_BUDGET_MS })
          .then((stronger) => {
            if (cancelled) return stronger.dispose()
            const previous = engine
            engine = stronger
            previous?.dispose()
            this.engineLabel = stronger.label
          })
          .catch((err) => console.info('[hands-free] staying on', engine?.label, '—', err?.message))
      }
    })()

    return () => {
      cancelled = true
      clearTimeout(timer)
      engine?.dispose()
      media?.getTracks().forEach((t) => t.stop())
      this.stream = null
      this.keypoints = null
      this.framing = 'none'
    }
  }
}

export const handsFree = new HandsFree()
