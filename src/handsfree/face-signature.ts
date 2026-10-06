/**
 * Appearance signature of a face crop, to remember who was locked on
 * (a fallback for a face-embedding model): an HSV colour histogram plus a
 * coarse texture (8x8 grayscale layout and a gradient-orientation histogram). Computed from a
 * 32x32 RGBA crop of the box's central part. Kept in memory only, for one
 * camera session; never stored or sent anywhere.
 */

export const SIG_SIZE = 32
const H_BINS = 16
const S_BINS = 4
const LBP_BINS = 32 // 2x2 cells x 8 orientations

export interface Signature {
  hs: Float32Array // H x S histogram, sums to 1
  gray: Float32Array // 8x8, zero mean, unit length
  lbp: Float32Array // gradient-orientation histogram (2x2 cells x 8), sums to 1
}

/** rgba: SIG_SIZE*SIG_SIZE*4 bytes. */
export function signature(rgba: ArrayLike<number>): Signature {
  const N = SIG_SIZE
  const hs = new Float32Array(H_BINS * S_BINS)
  const g = new Float32Array(N * N)
  for (let i = 0; i < N * N; i++) {
    const r = rgba[i * 4]! / 255
    const gg = rgba[i * 4 + 1]! / 255
    const b = rgba[i * 4 + 2]! / 255
    const max = Math.max(r, gg, b)
    const min = Math.min(r, gg, b)
    const d = max - min
    let h = 0
    if (d > 1e-6) h = max === r ? ((gg - b) / d + 6) % 6 : max === gg ? (b - r) / d + 2 : (r - gg) / d + 4
    const s = max > 0 ? d / max : 0
    g[i] = 0.299 * r + 0.587 * gg + 0.114 * b
    if (max < 0.08) continue // too dark to have a colour
    hs[Math.min(H_BINS - 1, Math.floor((h / 6) * H_BINS)) * S_BINS + Math.min(S_BINS - 1, Math.floor(s * S_BINS))]! += 1
  }
  norm1(hs)
  // 8x8 layout
  const gray = new Float32Array(64)
  const c = N / 8
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) gray[Math.floor(y / c) * 8 + Math.floor(x / c)]! += g[y * N + x]!
  let mean = 0
  for (const v of gray) mean += v / 64
  for (let i = 0; i < 64; i++) gray[i]! -= mean
  norm2(gray)
  // Gradient orientations in 2x2 cells (a tiny HOG): the beard, eyebrows, hairline.
  const lbp = new Float32Array(LBP_BINS)
  for (let y = 1; y < N - 1; y++)
    for (let x = 1; x < N - 1; x++) {
      const gx = g[y * N + x + 1]! - g[y * N + x - 1]!
      const gy = g[(y + 1) * N + x]! - g[(y - 1) * N + x]!
      const m = Math.hypot(gx, gy)
      if (m < 0.02) continue
      const o = Math.floor(((Math.atan2(gy, gx) + Math.PI) / (2 * Math.PI)) * 8) % 8
      const cell = (y < N / 2 ? 0 : 2) + (x < N / 2 ? 0 : 1)
      lbp[cell * 8 + o]! += m
    }
  norm1(lbp)
  return { hs, gray, lbp }
}

function norm1(a: Float32Array) {
  let s = 0
  for (const v of a) s += v
  if (s > 0) for (let i = 0; i < a.length; i++) a[i]! /= s
}
function norm2(a: Float32Array) {
  let s = 0
  for (const v of a) s += v * v
  s = Math.sqrt(s)
  if (s > 0) for (let i = 0; i < a.length; i++) a[i]! /= s
}

/** Pearson correlation. */
function corr(a: Float32Array, b: Float32Array) {
  let ma = 0
  let mb = 0
  for (let i = 0; i < a.length; i++) {
    ma += a[i]!
    mb += b[i]!
  }
  ma /= a.length
  mb /= b.length
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i]! - ma
    const y = b[i]! - mb
    num += x * y
    da += x * x
    db += y * y
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0
}

export function parts(a: Signature, b: Signature) {
  let cos = 0
  for (let i = 0; i < 64; i++) cos += a.gray[i]! * b.gray[i]!
  return { hs: corr(a.hs, b.hs), lbp: corr(a.lbp, b.lbp), gray: cos }
}

export const SIM_WEIGHTS = { hs: 0.45, lbp: 0.35, gray: 0.2 }
/** Same person at or above this (calibrated on face crops: same face 0.84-0.9, other faces <= 0.72, a lamp ~0.15). */
export const SAME_FACE = 0.75

/** 0..1-ish similarity: colour, gradients and layout. */
export function similarity(a: Signature, b: Signature) {
  const p = parts(a, b)
  return SIM_WEIGHTS.hs * p.hs + SIM_WEIGHTS.lbp * p.lbp + SIM_WEIGHTS.gray * p.gray
}

/** Running average of signatures (weights by count, or an EMA with `alpha`). */
export function blend(into: Signature, s: Signature, alpha: number) {
  for (const k of ['hs', 'gray', 'lbp'] as const) {
    const a = into[k]
    const b = s[k]
    for (let i = 0; i < a.length; i++) a[i] = (1 - alpha) * a[i]! + alpha * b[i]!
  }
  norm1(into.hs)
  norm1(into.lbp)
  norm2(into.gray)
}

export const cloneSig = (s: Signature): Signature => ({ hs: new Float32Array(s.hs), gray: new Float32Array(s.gray), lbp: new Float32Array(s.lbp) })
