import type { FeatureVec } from './features'
import model from './change-model.json'

/**
 * The change model (scripts/eval/fit.py): for each kind of movement
 * ("standing>bowing", "sitting>prostrating", ...), how the features move
 * away from the posture just left, and how much they wander while a
 * posture is held. Changes are measured within one person and one camera
 * placement, so they hold across people far better than absolute values
 * (a hijab, a beard or a tilted laptop shift the absolute values, not the
 * change when the head drops into sujud).
 */
interface ChangeModel {
  features: string[]
  transitions: Record<string, { mu: (number | null)[]; s1: (number | null)[] }>
  noise: Record<string, number[]>
}

let M = model as ChangeModel

/** Swap the change model (evaluation: a model that never saw this person). */
export function useChangeModel(m: unknown) {
  M = m as ChangeModel
}
const CLIP = 3

/** Per-feature baseline (median) of a set of feature vectors. */
export function baseline(frames: readonly FeatureVec[]): number[] | null {
  if (frames.length < 5) return null
  return M.features.map((name) => {
    const xs = frames.map((f) => f[name as keyof FeatureVec]).filter(Number.isFinite).sort((a, b) => a - b)
    return xs.length >= 3 ? xs[xs.length >> 1]! : NaN
  })
}

const logN = (x: number, mu: number, s: number) => -0.5 * ((x - mu) / s) ** 2 - Math.log(s)

/**
 * Log-likelihood ratio that this frame shows the movement `from > to`
 * (rather than still `from`), given the baseline of the posture being left.
 * 0 when the model doesn't know this movement or nothing is measurable.
 */
export function changeLLR(from: string, to: string, f: FeatureVec, base: readonly number[]): number {
  const tr = M.transitions[`${from}>${to}`]
  const noise = M.noise[from]
  if (!tr || !noise) return 0
  let sum = 0
  let n = 0
  M.features.forEach((name, i) => {
    const mu = tr.mu[i]
    const s1 = tr.s1[i]
    const x = f[name as keyof FeatureVec]
    if (mu == null || s1 == null || !Number.isFinite(x) || !Number.isFinite(base[i]!)) return
    const d = x - base[i]!
    sum += Math.max(-CLIP, Math.min(CLIP, logN(d, mu, s1) - logN(d, 0, noise[i]!)))
    n++
  })
  // The features are strongly correlated (the head and shoulders move
  // together): count them as about two independent ones.
  return n ? (sum / n) * Math.min(n, 2) : 0
}

export const knowsMovement = (from: string, to: string) => !!M.transitions[`${from}>${to}`]
