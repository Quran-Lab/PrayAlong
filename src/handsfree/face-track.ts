/**
 * Lock on to one face and ignore everything else (lamps, posters, other
 * people). Pure: feed every frame's detections with a timestamp (ms).
 *
 *  - Unlocked: a face is confirmed when a detection with score >= 0.8 and
 *    height >= 8% of the frame stays at a stable position for >= 0.6 s.
 *  - Locked: only detections that match the track count (IoU >= 0.3, or
 *    centre distance < 0.6 x box size, and height within 0.5x..2x). The track
 *    follows them with an EMA (and the last matched box, for real movement).
 *  - Lost for > 4 s outside sujud: unlock; re-locking needs the same
 *    confirmation. In sujud the track is kept; a lone strong face of the
 *    right size held for 0.4 s anywhere also counts as the person coming back.
 */

export interface Box {
  x: number
  y: number
  w: number
  h: number
}
export interface Detection {
  score: number
  box: Box
}

export interface TrackFrame {
  t: number
  /** A detection matching the locked track this frame. */
  visible: boolean
  cy?: number
  h?: number
}

export const TRACK_DEFAULTS = {
  lockScore: 0.8,
  lockMinH: 0.08,
  lockMs: 600,
  /**
   * A confirming candidate may miss this many frames in a row without
   * restarting (counted in frames, not ms, so a slow, busy laptop still locks).
   */
  maxMisses: 1,
  /** ...and needs at least this many hits. */
  minHits: 4,
  matchIoU: 0.3,
  matchDist: 0.6,
  sizeMin: 0.5,
  sizeMax: 2,
  minScore: 0.5,
  ema: 0.35,
  unlockMs: 4000,
  sujudReentryMs: 400,
}
export type TrackOptions = typeof TRACK_DEFAULTS

const cx = (b: Box) => b.x + b.w / 2
const cy = (b: Box) => b.y + b.h / 2

export function iou(a: Box, b: Box) {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.w, b.x + b.w)
  const y2 = Math.min(a.y + a.h, b.y + b.h)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const union = a.w * a.h + b.w * b.h - inter
  return union > 0 ? inter / union : 0
}

function near(ref: Box, d: Box, o: Pick<TrackOptions, 'matchIoU' | 'matchDist' | 'sizeMin' | 'sizeMax'>) {
  const ratio = d.h / ref.h
  if (ratio < o.sizeMin || ratio > o.sizeMax) return false
  if (iou(ref, d) >= o.matchIoU) return true
  const size = Math.max(ref.w, ref.h)
  return Math.hypot(cx(ref) - cx(d), cy(ref) - cy(d)) < o.matchDist * size
}

export class FaceTracker {
  readonly opts: TrackOptions
  /** The locked track (smoothed), or null. */
  track: (Box & { id: number }) | null = null
  /** The last matched raw box. */
  private lastBox: Box | null = null
  private lastMatchAt = -Infinity
  private nextId = 1
  private cand: { box: Box; since: number; misses: number; hits: number } | null = null
  private reentry: { box: Box; since: number; misses: number; hits: number } | null = null
  /**
   * Things that look like faces but sat still somewhere else while the real
   * face was tracked (a lamp, a poster): never used to lock or to come back.
   */
  private distractors: { box: Box; last: number }[] = []
  /** Detections ignored this frame (for the debug overlay). */
  ignored: Detection[] = []
  matched: Detection | null = null

  constructor(opts: Partial<TrackOptions> = {}) {
    this.opts = { ...TRACK_DEFAULTS, ...opts }
  }

  get locked() {
    return this.track !== null
  }

  push(t: number, dets: readonly Detection[], { sujud = false } = {}): TrackFrame {
    const o = this.opts
    this.ignored = []
    this.matched = null
    const all = dets

    if (this.track && !sujud && t - this.lastMatchAt > o.unlockMs) this.unlock()

    dets = dets.filter((d) => !this.isDistractor(d.box, t) || (this.track && near(this.track, d.box, o)))
    if (!this.track) {
      this.confirm(t, dets)
      this.ignored = all.filter((d) => d !== this.matched)
      return { t, visible: false }
    }

    // Locked: only matching detections count.
    const tr = this.track
    let best: Detection | null = null
    for (const d of dets) {
      if (d.score < o.minScore) continue
      if (!(near(tr, d.box, o) || (this.lastBox && near(this.lastBox, d.box, o)))) continue
      if (!best || d.score > best.score) best = d
    }

    // In sujud: the person may come back up anywhere; one strong face of the right size, held, will do.
    if (!best && sujud) {
      const strong = dets.filter((d) => d.score >= o.lockScore && d.box.h / tr.h >= o.sizeMin && d.box.h / tr.h <= o.sizeMax)
      if (strong.length === 1) {
        const d = strong[0]!
        if (this.reentry && near(this.reentry.box, d.box, o)) {
          this.reentry.box = d.box
          this.reentry.misses = 0
          this.reentry.hits++
        } else this.reentry = { box: d.box, since: t, misses: 0, hits: 1 }
        if (t - this.reentry.since >= o.sujudReentryMs && this.reentry.hits >= 3) {
          Object.assign(tr, d.box)
          best = d
        }
      } else if (this.reentry && ++this.reentry.misses > o.maxMisses) this.reentry = null
    } else if (best) this.reentry = null

    if (!best) {
      this.ignored = [...all]
      return { t, visible: false }
    }
    const a = o.ema
    tr.x += a * (best.box.x - tr.x)
    tr.y += a * (best.box.y - tr.y)
    tr.w += a * (best.box.w - tr.w)
    tr.h += a * (best.box.h - tr.h)
    this.lastBox = best.box
    this.lastMatchAt = t
    this.matched = best
    // Anything else seen at the same time as the real face is a distractor.
    for (const d of all) if (d !== best && d.score >= o.minScore) this.remember(d.box, t)
    this.ignored = all.filter((d) => d !== best)
    return { t, visible: true, cy: cy(best.box), h: best.box.h }
  }

  private confirm(t: number, dets: readonly Detection[]) {
    const o = this.opts
    const strong = dets.filter((d) => d.score >= o.lockScore && d.box.h >= o.lockMinH)
    // Continue the current candidate if it is still there, else start on the biggest strong face.
    let pick: Detection | undefined
    if (this.cand) pick = strong.find((d) => near(this.cand!.box, d.box, { ...o, sizeMin: 0.75, sizeMax: 1.33, matchDist: 0.35 }))
    if (pick) {
      this.cand!.box = pick.box
      this.cand!.misses = 0
      this.cand!.hits++
    } else if (this.cand && ++this.cand.misses <= o.maxMisses) {
      // one missed frame: keep waiting
    } else {
      const big = [...strong].sort((p, q) => q.box.h * q.score - p.box.h * p.score)[0]
      this.cand = big ? { box: big.box, since: t, misses: 0, hits: 1 } : null
      pick = big
    }
    if (pick) this.matched = pick
    if (this.cand && pick && t - this.cand.since >= o.lockMs && this.cand.hits >= o.minHits) {
      this.track = { ...pick.box, id: this.nextId++ }
      this.lastBox = pick.box
      this.lastMatchAt = t
      this.cand = null
    }
  }

  private isDistractor(b: Box, t: number) {
    return this.distractors.some((d) => t - d.last < 120_000 && iou(d.box, b) >= 0.3)
  }

  private remember(b: Box, t: number) {
    const hit = this.distractors.find((d) => iou(d.box, b) >= 0.3)
    if (hit) {
      hit.box = b
      hit.last = t
    } else if (this.distractors.length < 16) this.distractors.push({ box: b, last: t })
  }

  unlock() {
    this.track = null
    this.lastBox = null
    this.cand = null
    this.reentry = null
  }
}
