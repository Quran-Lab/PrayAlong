import type { PoseClass } from '@/sequence/types'
import type { FeatureVec, Measures } from './features'
import model from './posture-model.json'

export const POSE_CLASSES: readonly PoseClass[] = ['standing', 'hands-raised', 'bowing', 'prostrating', 'sitting']

export type ClassProbs = Record<PoseClass, number>

/** One frame's evidence, fused from the body and face engines. */
export interface FramePosterior {
  t: number
  p: ClassProbs
  /**
   * How much to trust this frame (0..1). 0 when nobody is seen; lower when
   * only the face (or only the luma cue) is available.
   */
  conf: number
  /** Someone is in view (body or face). */
  present: boolean
  /** Raw head-turn measure (nose towards the worshipper's right, shoulder widths), NaN if unknown. */
  turn: number
  /** Face yaw in degrees when the face model sees a face, else NaN. */
  faceYaw: number
  /** The calibrated features (for the decoder's change model), when available. */
  f?: FeatureVec | null
}

interface Model {
  features: string[]
  mean: number[]
  std: number[]
  clip: number
  classes: string[]
  /** Dense layers, W as [out][in]; ReLU between them, softmax at the end. */
  layers: { W: number[][]; b: number[] }[]
}

let M = model as Model

/** Swap the classifier (evaluation: a model that never saw this person). */
export function usePostureModel(m: unknown) {
  M = m as Model
}

const uniform = (): ClassProbs => ({ standing: 0.2, 'hands-raised': 0.2, bowing: 0.2, prostrating: 0.2, sitting: 0.2 })

/**
 * The fitted per-frame classifier (scripts/eval/fit.py): standardized
 * calibrated body features plus a missing flag for each, through a small
 * softmax network.
 */
export function bodyProbs(f: FeatureVec): ClassProbs {
  const n = M.features.length
  let x = new Array<number>(2 * n)
  M.features.forEach((name, i) => {
    const v = f[name as keyof FeatureVec]
    const ok = Number.isFinite(v)
    x[i] = ok ? Math.max(-M.clip, Math.min(M.clip, (v - M.mean[i]!) / M.std[i]!)) : 0
    x[n + i] = ok ? 0 : 1
  })
  M.layers.forEach((layer, li) => {
    const last = li === M.layers.length - 1
    x = layer.W.map((w, o) => {
      const a = w.reduce((s, wi, i) => s + wi * x[i]!, layer.b[o]!)
      return last ? a : Math.max(0, a)
    })
  })
  const z = x
  const mx = Math.max(...z)
  const e = z.map((zi) => Math.exp(zi - mx))
  const sum = e.reduce((s, v) => s + v, 0)
  const p = uniform()
  M.classes.forEach((c, i) => (p[c as PoseClass] = e[i]! / sum))
  return p
}

/**
 * Face only (the body model lost the person): the head's height still
 * separates standing from sitting, and a visible face rules out sujud.
 */
function faceProbs(f: FeatureVec): ClassProbs {
  const d = f.headDy
  const sitLike = 1 / (1 + Math.exp(-(d - 1.0) / 0.25))
  return { standing: 0.45 * (1 - sitLike), 'hands-raised': 0.05, bowing: 0.3 * (1 - sitLike) + 0.05, prostrating: 0.02, sitting: 0.6 * sitLike + 0.03 }
}

export function posterior(t: number, f: FeatureVec | null, m: Measures): FramePosterior {
  const base = { t, turn: m.turn, faceYaw: m.faceYaw, f }
  if (!f) return { ...base, p: uniform(), conf: 0, present: m.body || m.face }
  if (m.body) {
    // Trust grows with how well the head and shoulders are seen. A body
    // lost in sujud still has its shoulders.
    const conf = Math.max(0.35, Math.min(1, 0.4 * m.headVis + 0.6 * m.shVis))
    return { ...base, p: bodyProbs(f), conf, present: true }
  }
  if (m.face) return { ...base, p: faceProbs(f), conf: 0.35, present: true }
  // Nobody found. Something big and close filling the bottom of the frame
  // (a prostration right at the laptop) is still a cue.
  if (f.lumaBottom > 0.09) return { ...base, p: { ...uniform(), prostrating: 0.8, standing: 0.05, 'hands-raised': 0.05, bowing: 0.05, sitting: 0.05 }, conf: 0.4, present: false }
  return { ...base, p: uniform(), conf: 0, present: false }
}
