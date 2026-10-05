import type { PoseClass, Posture, Step } from '@/sequence/types'
import { baseline, changeLLR, knowsMovement } from './change'
import type { FeatureVec } from './features'
import type { FramePosterior } from './posterior'

/**
 * Sequence-aware decoding. The prayer's order is known, so instead of
 * asking "which pose is this?" every frame, the decoder only weighs the
 * current movement against the next one (and, to recover a missed
 * movement, the one after). Evidence accumulates CUSUM-style: a change is
 * accepted once the next posture has clearly out-scored the current one
 * for long enough, and never before the current posture has lasted its
 * minimum time. Voice events (takbir, tasmi', salam, a finished line) add
 * evidence through the same channel (`addEvidence`).
 */

/** What the camera can see in a segment: a pose class, or a salam head turn. */
export type SegmentKind = PoseClass | 'salam-right' | 'salam-left'

export interface Segment {
  /** First and last step index (inclusive). */
  start: number
  end: number
  posture: Posture
  kind: SegmentKind
}

export function kindOf(step: Step): SegmentKind {
  if (step.posture === 'salam-right' || step.posture === 'salam-left') return step.posture
  return step.pose
}

/** Consecutive steps the camera can't tell apart form one segment (qiyam's many lines, the salawat after tashahhud). */
export function segmentsOf(steps: readonly Step[]): Segment[] {
  const out: Segment[] = []
  steps.forEach((s, i) => {
    const prev = out.at(-1)
    const kind = kindOf(s)
    if (prev && prev.kind === kind && (prev.posture === s.posture || kind === 'sitting')) prev.end = i
    else out.push({ start: i, end: i, posture: s.posture, kind })
  })
  return out
}

export type VoiceKind = 'takbir' | 'tasmi' | 'salam' | 'lineDone'

export interface Evidence {
  kind: VoiceKind
  /** 0..1 */
  confidence: number
  /** ms, on the same clock as the camera frames (performance.now()). */
  at: number
}

export interface Advance {
  /** The step to go to (-1 with reason 'line': the next line of the same posture). */
  index: number
  reason: 'camera' | 'catch-up' | 'voice' | 'line'
  /** The segment kind moved into. */
  kind: SegmentKind
}

export interface DecoderStatus {
  /** What the decoder is waiting for, or null when the prayer is complete. */
  expected: SegmentKind | null
  /** The posture of the next segment (for labels: ruku, i'tidal, sujud...). */
  expectedPosture: Posture | null
  /** 0..1: how close the evidence for the next movement is to the threshold. */
  progress: number
  /** No usable view of the person for `lostAfter` seconds. */
  lost: boolean
  /** The current segment's kind (what the decoder believes the person is doing). */
  current: SegmentKind | null
}

export interface DecoderTuning {
  /** Evidence needed to accept the next movement, by the kind being entered. */
  threshold: Record<SegmentKind, number>
  /** Minimum time in the current segment before leaving it, seconds, by its kind. */
  minDwell: Record<SegmentKind, number>
  /** Per-frame cap on evidence (log-likelihood-ratio units). */
  clip: number
  /** Evidence lost per frame when it doesn't keep coming. */
  drift: number
  /** Catch-up needs this many times the normal threshold. */
  catchUp: number
  /** Seconds without anyone in view before the decoder reports it's lost. */
  lostAfter: number
  /** Head turn from neutral (shoulder widths) that counts as a salam, at least... */
  turn: number
  /** ...and at least this many times the head's wander while sitting still. */
  turnZ: number
  /** Weights of the two kinds of evidence: the per-frame class, and the change from the posture's own baseline. */
  wClass: number
  wChange: number
  /** Allow catch-up over a missed movement. */
  catchUpOn: boolean
  /** Change evidence (per frame) above which the body counts as moving the expected way. */
  moveMin: number
  /** Class evidence only counts while the body moves the expected way (off: class evidence alone, for tests). */
  requireMovement: boolean
  /** A posture's baseline starts this long (s) after entering it (the arriving movement settles). */
  baselineFrom: number
}

export const DEFAULT_TUNING: DecoderTuning = {
  threshold: { 'hands-raised': 21, standing: 21, bowing: 21, prostrating: 21, sitting: 21, 'salam-right': 18, 'salam-left': 18 },
  minDwell: { 'hands-raised': 0.4, standing: 1.0, bowing: 1.0, prostrating: 1.2, sitting: 0.8, 'salam-right': 0.6, 'salam-left': 0.6 },
  clip: 2.5,
  drift: 1,
  catchUp: 1.8,
  lostAfter: 8,
  turn: 0.2,
  turnZ: 5,
  wClass: 1,
  wChange: 1,
  catchUpOn: false,
  moveMin: 0.5,
  requireMovement: true,
  baselineFrom: 0.5,
}

const EPS = 0.01
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))

export class SequenceDecoder {
  private segs: Segment[]
  private stepSeg: number[] = []
  /** Current segment; -1 = before the prayer (waiting for the opening takbir). */
  private k = -1
  private enteredAt = -Infinity
  private e1 = 0
  private e2 = 0
  private lastSeen = -Infinity
  private lastT = -Infinity
  /** Neutral head direction while sitting, and the first salam's peak turn. */
  private neutralTurn: number | null = null
  private neutralYaw: number | null = null
  private neutralTurns: { t: number; v: number }[] = []
  private turnStats = { thr: Infinity }
  private peakTurn = 0
  private peakYaw = 0
  private voice: Evidence[] = []
  /** Features seen since entering the current segment (for its baseline). */
  private history: { t: number; f: FeatureVec }[] = []
  private complete = false
  tuning: DecoderTuning

  constructor(steps: readonly Step[], tuning: Partial<DecoderTuning> = {}) {
    this.segs = segmentsOf(steps)
    this.segs.forEach((s, i) => {
      for (let j = s.start; j <= s.end; j++) this.stepSeg[j] = i
    })
    this.tuning = {
      ...DEFAULT_TUNING,
      ...tuning,
      threshold: { ...DEFAULT_TUNING.threshold, ...tuning.threshold },
      minDwell: { ...DEFAULT_TUNING.minDwell, ...tuning.minDwell },
    }
  }

  get segments(): readonly Segment[] {
    return this.segs
  }

  /** The segment the decoder is in (-1 before the prayer). */
  get segment() {
    return this.k
  }

  /**
   * Tell the decoder where the session is (after its own advances, a tap,
   * a timer, or a restart). `t` in ms.
   */
  sync(phase: 'ready' | 'praying' | 'complete', index: number, t: number) {
    const k = phase === 'ready' ? -1 : phase === 'complete' ? this.segs.length - 1 : (this.stepSeg[index] ?? -1)
    this.complete = phase === 'complete'
    if (k !== this.k) this.enter(k, t)
  }

  private enter(k: number, t: number) {
    const was = this.kindAt(this.k)
    this.k = k
    this.enteredAt = t
    this.e1 = 0
    this.e2 = 0
    this.history = []
    const now = this.kindAt(k)
    if (now === 'salam-right' && was !== 'salam-right') this.peakTurn = this.peakYaw = 0
    if (now !== 'sitting' && now !== 'salam-right' && now !== 'salam-left') {
      this.neutralTurn = this.neutralYaw = null
      this.neutralTurns = []
      this.turnStats = { thr: Infinity }
    }
  }

  private kindAt(k: number): SegmentKind | null {
    if (k < 0) return 'standing'
    return this.segs[k]?.kind ?? null
  }

  status(t: number): DecoderStatus {
    const next = this.complete ? null : this.kindAt(this.k + 1)
    const H = next ? this.tuning.threshold[next] : 1
    return {
      expected: next,
      expectedPosture: this.complete ? null : (this.segs[this.k + 1]?.posture ?? null),
      progress: Math.max(0, Math.min(1, this.e1 / H)),
      lost: t - this.lastSeen > this.tuning.lostAfter * 1000,
      current: this.kindAt(this.k),
    }
  }

  /**
   * Probability that the head is turned away from the neutral sitting
   * direction: either way, the same way as the first salam, or the
   * opposite way. Directions are learned from the first salam itself, so a
   * mirrored camera can't swap right and left.
   */
  private turned(post: FramePosterior, mode: 'any' | 'same' | 'opposite') {
    const part = (value: number, neutral: number | null, peak: number, thr: number) => {
      if (!Number.isFinite(value) || neutral === null) return NaN
      const d = value - neutral
      const soft = thr * 0.25
      if (mode === 'any') return sigmoid((Math.abs(d) - thr) / soft)
      if (!peak) return NaN
      return sigmoid(((mode === 'same' ? 1 : -1) * Math.sign(peak) * d - thr) / soft)
    }
    const pb = part(post.turn, this.neutralTurn, this.peakTurn, this.turnThreshold())
    const pf = part(post.faceYaw, this.neutralYaw, this.peakYaw, 28)
    if (Number.isFinite(pb) && Number.isFinite(pf)) return 0.6 * pb + 0.4 * pf
    if (Number.isFinite(pb)) return pb
    if (Number.isFinite(pf)) return pf
    return 0.5
  }

  /**
   * How far the nose must move to count as a turn: a minimum, or several
   * times how much it wandered over the last few seconds of sitting (some
   * views and faces are much noisier than others).
   */
  private turnThreshold() {
    return this.turnStats.thr
  }

  /**
   * The neutral head direction and its noise from the sitting frames 4 s to
   * 1 s ago: a salam is a quick turn (under a second), while detections can
   * drift slowly over a long tashahhud. Frozen once the first salam starts.
   */
  private updateTurnStats(t: number) {
    const xs = this.neutralTurns.filter((h) => h.t >= t - 4000 && h.t <= t - 1000).map((h) => h.v)
    // Not before a second of quiet sitting has shown how much this head wanders.
    if (xs.length < 15) {
      this.turnStats = { thr: Infinity }
      this.neutralTurn = null
      return
    }
    const sorted = xs.slice().sort((p, q) => p - q)
    const med = sorted[sorted.length >> 1]!
    const mad = sorted.map((v) => Math.abs(v - med)).sort((p, q) => p - q)[sorted.length >> 1]!
    // The spread too: some heads flip between two positions (a robust MAD misses that).
    const mean = xs.reduce((p, q) => p + q, 0) / xs.length
    const sd = Math.sqrt(xs.reduce((p, q) => p + (q - mean) ** 2, 0) / xs.length)
    this.neutralTurn = med
    this.turnStats = { thr: Math.max(this.tuning.turn, this.tuning.turnZ * 1.4826 * mad, 3 * sd) }
  }

  /** Log-likelihood of a segment kind for this frame. */
  private ll(kind: SegmentKind, post: FramePosterior, role: 'current' | 'next') {
    const p = post.p
    // In the first salam, anything but a turn the other way (back to the
    // middle included) is still "not the second salam yet".
    if (kind === 'salam-right')
      return Math.log(p.sitting * (role === 'next' ? this.turned(post, 'any') : 1 - this.turned(post, 'opposite')) + EPS)
    if (kind === 'salam-left') return Math.log(p.sitting * this.turned(post, 'opposite') + EPS)
    // While waiting for the salam, a turned head is not "still sitting".
    if (kind === 'sitting' && role === 'current' && this.kindAt(this.k + 1) === 'salam-right')
      return Math.log(p.sitting * (1 - this.turned(post, 'any')) + EPS)
    return Math.log(p[kind as PoseClass] + EPS)
  }

  /** Track the neutral head while sitting and the first salam's direction. */
  private observeHead(post: FramePosterior) {
    const cur = this.kindAt(this.k)
    if (cur === 'sitting') {
      if (post.p.sitting > 0.5 && Number.isFinite(post.turn)) {
        this.neutralTurns.push({ t: post.t, v: post.turn })
        while (this.neutralTurns.length && this.neutralTurns[0]!.t < post.t - 4500) this.neutralTurns.shift()
      }
      this.updateTurnStats(post.t)
      if (post.p.sitting > 0.5 && Number.isFinite(post.faceYaw) && (this.neutralYaw === null || Math.abs(post.faceYaw - this.neutralYaw) < 12))
        this.neutralYaw = this.neutralYaw === null ? post.faceYaw : this.neutralYaw + (post.faceYaw - this.neutralYaw) * 0.05
    }
    if (cur === 'salam-right') {
      if (Number.isFinite(post.turn) && this.neutralTurn !== null) {
        const d = post.turn - this.neutralTurn
        if (Math.abs(d) > Math.abs(this.peakTurn)) this.peakTurn = d
      }
      if (Number.isFinite(post.faceYaw) && this.neutralYaw !== null) {
        const d = post.faceYaw - this.neutralYaw
        if (Math.abs(d) > Math.abs(this.peakYaw)) this.peakYaw = d
      }
    }
  }

  addEvidence(ev: Evidence) {
    this.voice.push(ev)
    if (this.voice.length > 20) this.voice.shift()
  }

  /** Voice that supports entering `kind` now: its total confidence, consumed. */
  private voiceBonus(kind: SegmentKind, t: number): number {
    let bonus = 0
    const nextPosture = this.segs[this.k + 1]?.posture
    this.voice = this.voice.filter((ev) => {
      if (t - ev.at > 2500) return false
      if (ev.at > t + 500 || ev.kind === 'lineDone') return true
      const fits =
        (ev.kind === 'takbir' && kind !== 'salam-right' && kind !== 'salam-left' && nextPosture !== 'itidal') ||
        (ev.kind === 'tasmi' && nextPosture === 'itidal') ||
        (ev.kind === 'salam' && (kind === 'salam-right' || kind === 'salam-left'))
      if (!fits) return true
      bonus += ev.confidence
      return false
    })
    return bonus
  }

  /** Feed one frame. Returns the step to move to, if a movement was recognised. */
  push(post: FramePosterior): Advance | null {
    const t = post.t
    const frames = Number.isFinite(this.lastT) ? Math.max(0.2, Math.min(3, (t - this.lastT) / (1000 / 15))) : 1
    this.lastT = t
    if (post.present || post.conf > 0) this.lastSeen = t
    if (this.complete) return null
    const T = this.tuning
    const cur = this.kindAt(this.k)!
    const nextSeg = this.segs[this.k + 1]
    if (!nextSeg) return this.lineDone(t)
    this.observeHead(post)

    const next = nextSeg.kind
    const llCur = this.ll(cur, post, 'current')
    const llNext = this.ll(next, post, 'next')
    // How the body moved away from this posture's own baseline (the
    // settled frames since entering it, up to 0.6 s ago).
    const salam = cur.startsWith('salam') || next.startsWith('salam')
    let chg = 0
    // Hands coming down after the opening takbir: raised vs lowered hands is a
    // strong per-frame contrast, and the takbir is too short for a baseline.
    let moved = salam || !T.requireMovement || cur === 'hands-raised'
    if (post.f) {
      this.history.push({ t, f: post.f })
      if (this.history.length > 150) this.history.shift()
      const base = baseline(this.history.filter((h) => h.t >= this.enteredAt + T.baselineFrom * 1000 && h.t <= t - 600).slice(-45).map((h) => h.f))
      if (base && !salam && knowsMovement(cur, next)) {
        chg = changeLLR(cur, next, post.f, base)
        moved = chg > T.moveMin
      }
    } else if (!post.present && post.conf > 0) moved = true // the nobody-in-view sujud cue: no features to compare
    // A posture that is merely held, however it looks, never moves the
    // prayer on: the class evidence only counts while the body is seen to
    // move away from this posture's own baseline, the way the next movement does.
    const classTerm = moved ? llNext - llCur : Math.min(0, llNext - llCur)
    const x1 = Math.max(-T.clip, Math.min(T.clip, post.conf * (T.wClass * classTerm + T.wChange * chg)))
    this.e1 = Math.max(0, this.e1 + (x1 - T.drift) * frames)

    const lost = t - this.lastSeen > T.lostAfter * 1000
    const vb = this.voiceBonus(next, t)
    // Voice is half the way while the camera sees the person; when it can't
    // see anyone, a confident voice event (>= 0.6) is enough on its own.
    if (vb > 0) this.e1 += T.threshold[next] * (lost && vb >= 0.6 ? 1.05 : 0.5 * Math.min(1, vb))

    const dwell = (t - this.enteredAt) / 1000
    const canLeave = dwell >= T.minDwell[cur]
    if (canLeave && this.e1 >= T.threshold[next]) return this.advance(this.k + 1, t, vb > 0 && x1 <= 0 ? 'voice' : 'camera')

    // Catch-up: the movement after next is clearly there (the next one was missed).
    const skip = this.segs[this.k + 2]
    if (T.catchUpOn && skip && skip.kind !== cur && skip.kind !== next && !skip.kind.startsWith('salam')) {
      const x2 = Math.max(-T.clip, Math.min(T.clip, post.conf * (this.ll(skip.kind, post, 'next') - Math.max(llCur, llNext))))
      this.e2 = Math.max(0, this.e2 + (x2 - T.drift) * frames)
      if (canLeave && this.e2 >= T.catchUp * T.threshold[skip.kind]) return this.advance(this.k + 2, t, 'catch-up')
    } else this.e2 = 0

    return this.lineDone(t)
  }

  /** A "line done" voice event moves to the next line inside the same posture. */
  private lineDone(t: number): Advance | null {
    const ev = this.voice.find((e) => e.kind === 'lineDone' && t - e.at <= 1500 && e.confidence >= 0.6)
    if (!ev) return null
    this.voice = this.voice.filter((e) => e !== ev)
    return { index: -1, reason: 'line', kind: this.kindAt(this.k)! }
  }

  private advance(k: number, t: number, reason: Advance['reason']): Advance {
    const seg = this.segs[k]!
    this.enter(k, t)
    return { index: seg.start, reason, kind: seg.kind }
  }
}
