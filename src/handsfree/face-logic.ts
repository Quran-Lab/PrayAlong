import type { Posture, Step } from '@/sequence/types'

/**
 * Face-presence following: the camera only ever does three things.
 *
 *  a) the face disappears in the posture before a sujud   -> go down into sujud
 *  b) the face comes back while in sujud                  -> rise to what follows
 *  c) the face jumps up / shrinks / leaves the top in ruku -> rise to i'tidal
 *
 * Everything else stays with the voice and the timers. The camera never
 * moves backwards, never skips more than one posture, and never moves
 * within a second of any other move (its own, the voice's, a tap).
 *
 * Pure and clock-free: feed it frames with timestamps (ms) and tell it where
 * the session is with `sync`. See face-logic.test.ts.
 */

export interface FaceFrame {
  /** ms, monotonic */
  t: number
  /** A face with score >= minScore and height >= minHeight. */
  visible: boolean
  /** Box centre y and height, normalised to the frame (0 = top). */
  cy?: number
  h?: number
}

export type FaceMoveReason = 'sujud-down' | 'sujud-up' | 'ruku-rise'
export interface FaceMove {
  index: number
  reason: FaceMoveReason
  at: number
}

export type FaceState = 'unknown' | 'found' | 'lost'

export const FACE_DEFAULTS = {
  /** Absent this long, continuously: the face is lost. */
  lostMs: 600,
  /** Present this long, continuously: the face is found. */
  foundMs: 350,
  /** The face must have been there this long in the posture before it is lost (sujud entry). */
  dwellMs: 800,
  /** No camera move within this long after any move. */
  guardMs: 1000,
  /** Ruku: the face rose by this much of the frame height... */
  riseCy: 0.12,
  /** ...or shrank to this fraction of its ruku height... */
  shrinkTo: 0.7,
  /** ...or its last box touched the top edge (box top <= this) before it vanished... */
  topEdge: 0.05,
  /** ...held this long. */
  riseMs: 300,
  /** Ruku reference: frames from this window before now (ms ago, from..to). */
  baseFromMs: 3000,
  baseToMs: 500,
  baseMinFrames: 4,
  /** No face for this long while standing: say so, once. */
  noFaceMs: 8000,
}
export type FaceOptions = typeof FACE_DEFAULTS

const STANDING: ReadonlySet<Posture> = new Set(['takbir', 'qiyam', 'itidal'])

function nextChange(steps: readonly Step[], from: number): number {
  const posture = steps[from]?.posture
  for (let i = from + 1; i < steps.length; i++) if (steps[i]!.posture !== posture) return i
  return -1
}

/** Which of the three movements (if any) the camera follows out of this step. */
export function cameraRule(steps: readonly Step[], index: number): { rule: 'a' | 'b' | 'c'; target: number } | null {
  const here = steps[index]
  if (!here) return null
  const target = nextChange(steps, index)
  if (target < 0) return null
  const there = steps[target]!.posture
  if (here.posture === 'sujud') return { rule: 'b', target }
  if (here.posture === 'ruku' && there === 'itidal') return { rule: 'c', target }
  if (there === 'sujud') return { rule: 'a', target }
  return null
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

export class FaceFollower {
  readonly opts: FaceOptions
  state: FaceState = 'unknown'
  /** When `state` last changed. */
  stateAt = 0
  /** The no-face hint (shown at most once per follower). */
  hint: 'no-face' | null = null
  hintCount = 0
  lastMove: FaceMove | null = null

  private steps: readonly Step[] = []
  private praying = false
  private index = -1
  private enteredAt = -Infinity
  private lastMoveAt = -Infinity
  // raw run tracking for hysteresis
  private presentSince: number | null = null
  private absentSince: number | null = null
  // per-step evidence
  private sawLost = false
  private lostAfterFound = false
  private foundAfterLost = false
  // ruku
  private ruku: { t: number; cy: number; h: number }[] = []
  private lastSeen: { t: number; cy: number; h: number } | null = null
  private risingSince: number | null = null
  private lastSeenAt: number | null = null
  private startedAt: number | null = null

  constructor(opts: Partial<FaceOptions> = {}) {
    this.opts = { ...FACE_DEFAULTS, ...opts }
  }

  /** Where the session is. A change not made by the camera counts as another move. */
  sync(phase: 'ready' | 'praying' | 'complete', index: number, steps: readonly Step[], t: number) {
    this.steps = steps
    this.praying = phase === 'praying'
    if (index !== this.index) this.enter(index, t)
  }

  private enter(index: number, t: number) {
    this.index = index
    this.enteredAt = t
    this.lastMoveAt = t
    this.sawLost = this.state === 'lost'
    this.lostAfterFound = false
    this.foundAfterLost = false
    this.ruku = []
    this.risingSince = null
  }

  private setState(s: FaceState, t: number) {
    if (s === this.state) return
    const prev = this.state
    const prevAt = this.stateAt
    this.state = s
    this.stateAt = t
    if (s === 'found') {
      if (this.sawLost) this.foundAfterLost = true
    } else if (s === 'lost') {
      // Down into sujud only after the face was steadily there in this posture
      // (so a face that just left the top while rising from ruku is not a sujud).
      const presentFrom = Math.max(prevAt, this.enteredAt)
      const presentTo = this.absentSince ?? t
      if (prev === 'found' && presentTo - presentFrom >= this.opts.dwellMs) this.lostAfterFound = true
      this.sawLost = true
    }
  }

  push(f: FaceFrame): FaceMove | null {
    const o = this.opts
    const t = f.t
    this.startedAt ??= t
    // Hysteresis
    if (f.visible) {
      this.absentSince = null
      this.presentSince ??= t
      if (t - this.presentSince >= o.foundMs) this.setState('found', t)
      this.lastSeenAt = t
      if (f.cy !== undefined && f.h !== undefined) this.lastSeen = { t, cy: f.cy, h: f.h }
      if (this.hint) this.hint = null
    } else {
      this.presentSince = null
      this.absentSince ??= t
      if (t - this.absentSince >= o.lostMs) this.setState('lost', t)
    }

    const step = this.steps[this.index]
    if (!this.praying || !step) return null

    // One quiet note when the face has not been seen for a while in a standing step.
    if (!f.visible && this.hintCount === 0 && STANDING.has(step.posture) && t - (this.lastSeenAt ?? this.startedAt) > o.noFaceMs) {
      this.hint = 'no-face'
      this.hintCount++
    }

    const rule = cameraRule(this.steps, this.index)
    if (!rule) return null

    let fire = false
    if (rule.rule === 'a') {
      fire = this.state === 'lost' && this.lostAfterFound
    } else if (rule.rule === 'b') {
      fire = this.state === 'found' && this.foundAfterLost
    } else {
      fire = this.rukuRise(f)
    }
    if (!fire || t - this.lastMoveAt < o.guardMs) return null
    const move: FaceMove = { index: rule.target, reason: rule.rule === 'a' ? 'sujud-down' : rule.rule === 'b' ? 'sujud-up' : 'ruku-rise', at: t }
    this.lastMove = move
    this.enter(rule.target, t)
    return move
  }

  private rukuRise(f: FaceFrame): boolean {
    const o = this.opts
    const t = f.t
    const base = this.ruku.filter((p) => p.t >= t - o.baseFromMs && p.t <= t - o.baseToMs)
    let cond = false
    if (base.length >= o.baseMinFrames) {
      const cy0 = median(base.map((p) => p.cy))
      const h0 = median(base.map((p) => p.h))
      if (f.visible && f.cy !== undefined && f.h !== undefined) {
        cond = cy0 - f.cy > o.riseCy || f.h < h0 * o.shrinkTo
      } else if (!f.visible && this.lastSeen && t - this.lastSeen.t <= 600) {
        // Left through the top: the last box touched the top edge.
        cond = this.lastSeen.cy - this.lastSeen.h / 2 <= o.topEdge && this.lastSeen.t >= this.enteredAt
      }
    }
    if (f.visible && f.cy !== undefined && f.h !== undefined) {
      this.ruku.push({ t, cy: f.cy, h: f.h })
      if (this.ruku.length > 120) this.ruku.splice(0, this.ruku.length - 120)
    }
    if (!cond) {
      this.risingSince = null
      return false
    }
    this.risingSince ??= t
    return t - this.risingSince >= o.riseMs
  }

  /** For the debug overlay. */
  get debug() {
    return { state: this.state, index: this.index, enteredAt: this.enteredAt, lastMoveAt: this.lastMoveAt, lostAfterFound: this.lostAfterFound, foundAfterLost: this.foundAfterLost }
  }
}
