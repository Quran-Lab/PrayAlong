/// <reference lib="webworker" />
/**
 * Hands-free vision, off the main thread: MediaPipe Pose Landmarker (body,
 * with per-landmark visibility) and Face Landmarker (face box, head yaw and
 * pitch) on the same frame, plus a tiny luma grid. Posts one Observation per
 * frame. The main thread (engines/vision.ts) owns restarts and the watchdog.
 */
import type { FaceLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision'
import { eulerFromMatrix, LUMA_H, LUMA_W, type FaceObs, type Observation, type Point } from './observation'

export type VisionIn =
  | {
      type: 'init'
      /** Page-relative base URL of the app (models and wasm live under it). */
      base: string
      pose: 'full' | 'lite' | 'heavy' | null
      face: boolean
      delegate: 'GPU' | 'CPU'
      /** Detection / presence / tracking thresholds for the body (default 0.2: crops and close-ups are the norm here, and visibility tells what to trust). */
      minConf?: number
    }
  | { type: 'frame'; bitmap: ImageBitmap; t: number }

export type VisionOut =
  | { type: 'ready'; delegate: 'GPU' | 'CPU'; label: string }
  | { type: 'obs'; obs: Observation }
  | { type: 'error'; message: string; fatal: boolean }

let pose: PoseLandmarker | null = null
let face: FaceLandmarker | null = null
let poseKind: 'full' | 'lite' | 'heavy' | null = null
let lastTs = 0
let busy = false
const grid = new OffscreenCanvas(LUMA_W, LUMA_H)
const gctx = grid.getContext('2d', { willReadFrequently: true })!

const post = (msg: VisionOut) => (self as unknown as Worker).postMessage(msg)

// MediaPipe loads its wasm glue with `self.import(url)` in module workers
// and expects it to set `self.ModuleFactory`, which it then clears. A
// module only runs once, so the second task (face after pose) would find
// nothing: put the factory back from the module's default export. The
// import is built with Function so the bundler leaves it alone.
const importUrl = new Function('u', 'return import(u)') as (u: string) => Promise<{ default?: unknown }>
;(self as unknown as { import: (u: string) => Promise<void> }).import = async (u: string) => {
  const mod = await importUrl(u)
  ;(self as unknown as { ModuleFactory?: unknown }).ModuleFactory = mod.default
}

async function init(msg: Extract<VisionIn, { type: 'init' }>) {
  try {
    const { FilesetResolver, PoseLandmarker, FaceLandmarker } = await import('@mediapipe/tasks-vision')
    // `true`: the ES-module build of the wasm loader (module workers can't importScripts).
    const fileset = await FilesetResolver.forVisionTasks(`${msg.base}mediapipe`, true)
    const canvas = msg.delegate === 'GPU' ? new OffscreenCanvas(1, 1) : undefined
    poseKind = msg.pose
    if (msg.pose)
      pose = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${msg.base}models/pose_landmarker_${msg.pose}.task`, delegate: msg.delegate },
        canvas,
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: msg.minConf ?? 0.2,
        minPosePresenceConfidence: msg.minConf ?? 0.2,
        minTrackingConfidence: msg.minConf ?? 0.2,
      })
    if (msg.face)
      face = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${msg.base}models/face_landmarker.task`, delegate: msg.delegate },
        canvas,
        runningMode: 'VIDEO',
        numFaces: 1,
        minFaceDetectionConfidence: 0.35,
        minFacePresenceConfidence: 0.35,
        minTrackingConfidence: 0.35,
        outputFacialTransformationMatrixes: true,
      })
    const parts = [msg.pose && `Pose ${msg.pose}`, msg.face && 'Face'].filter(Boolean).join(' + ')
    post({ type: 'ready', delegate: msg.delegate, label: `MediaPipe ${parts} · ${msg.delegate === 'GPU' ? 'GPU' : 'CPU'}` })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err), fatal: true })
  }
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4

function frame(bitmap: ImageBitmap, t: number) {
  if (busy) return bitmap.close()
  busy = true
  const started = performance.now()
  try {
    // Timestamps must strictly increase for VIDEO mode.
    lastTs = Math.max(lastTs + 1, Math.round(t))
    const obs: Observation = { t, aspect: bitmap.width / bitmap.height, body: null, face: null, luma: null, ms: 0 }

    gctx.drawImage(bitmap, 0, 0, LUMA_W, LUMA_H)
    const d = gctx.getImageData(0, 0, LUMA_W, LUMA_H).data
    obs.luma = Array.from({ length: LUMA_W * LUMA_H }, (_, i) => Math.round(0.299 * d[i * 4]! + 0.587 * d[i * 4 + 1]! + 0.114 * d[i * 4 + 2]!))

    if (pose) {
      const res = pose.detectForVideo(bitmap, lastTs)
      const lm = res.landmarks[0]
      if (lm)
        obs.body = {
          engine: poseKind === 'lite' ? 'mp-lite' : poseKind === 'heavy' ? 'mp-heavy' : 'mp-full',
          points: lm.map((p): Point => ({ x: r4(p.x), y: r4(p.y), v: r4(p.visibility ?? 1) })),
        }
    }
    if (face) {
      const res = face.detectForVideo(bitmap, lastTs)
      const lm = res.faceLandmarks[0]
      if (lm) {
        let x0 = 1, y0 = 1, x1 = 0, y1 = 0
        for (const p of lm) {
          x0 = Math.min(x0, p.x)
          y0 = Math.min(y0, p.y)
          x1 = Math.max(x1, p.x)
          y1 = Math.max(y1, p.y)
        }
        const m = res.facialTransformationMatrixes?.[0]?.data
        const e = m ? eulerFromMatrix(m) : { yaw: 0, pitch: 0, roll: 0 }
        const P = (i: number): [number, number] => [r4(lm[i]!.x), r4(lm[i]!.y)]
        const f: FaceObs = {
          box: { x: r4(x0), y: r4(y0), w: r4(x1 - x0), h: r4(y1 - y0) },
          yaw: Math.round(e.yaw * 10) / 10,
          pitch: Math.round(e.pitch * 10) / 10,
          roll: Math.round(e.roll * 10) / 10,
          nose: P(1),
          chin: P(152),
          forehead: P(10),
          eyes: [...P(33), ...P(263)] as [number, number, number, number],
        }
        obs.face = f
      }
    }
    obs.ms = Math.round(performance.now() - started)
    post({ type: 'obs', obs })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err), fatal: false })
  } finally {
    bitmap.close()
    busy = false
  }
}

self.onmessage = (e: MessageEvent<VisionIn>) => {
  const msg = e.data
  if (msg.type === 'init') void init(msg)
  else frame(msg.bitmap, msg.t)
}
