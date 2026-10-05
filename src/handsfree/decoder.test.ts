import { describe, expect, it } from 'vitest'
import { buildSequence } from '@/sequence/build'
import type { PoseClass } from '@/sequence/types'
import { SequenceDecoder, segmentsOf, type Advance } from './decoder'
import type { FramePosterior } from './posterior'

const steps = buildSequence('fajr').steps
const segs = segmentsOf(steps)

/**
 * These tests feed class probabilities only (no features), so they use the
 * class-evidence decoder with the original, livelier thresholds; the
 * shipped tuning is checked end to end by scripts/eval.
 */
const T = {
  requireMovement: false,
  catchUpOn: true,
  drift: 0.25,
  turn: 0.38,
  turnZ: 0,
  threshold: { 'hands-raised': 7, standing: 7, bowing: 7, prostrating: 7, sitting: 7, 'salam-right': 6, 'salam-left': 6 },
}
const decoder = () => new SequenceDecoder(steps, T)

function post(t: number, cls: PoseClass | null, opts: { sure?: number; turn?: number; conf?: number } = {}): FramePosterior {
  const sure = opts.sure ?? 0.9
  const p = { standing: 0, 'hands-raised': 0, bowing: 0, prostrating: 0, sitting: 0 }
  for (const k of Object.keys(p) as PoseClass[]) p[k] = cls ? (k === cls ? sure : (1 - sure) / 4) : 0.2
  return { t, p, conf: cls ? (opts.conf ?? 1) : 0, present: !!cls, turn: opts.turn ?? 0, faceYaw: NaN }
}

/** Feed `seconds` of frames at 15 fps; returns the advances. */
function feed(d: SequenceDecoder, clock: { t: number }, seconds: number, cls: PoseClass | null, opts?: Parameters<typeof post>[2]) {
  const out: Advance[] = []
  for (let i = 0; i < seconds * 15; i++) {
    clock.t += 1000 / 15
    const a = d.push(post(clock.t, cls, opts))
    if (a) out.push(a)
  }
  return out
}

describe('segmentsOf', () => {
  it('groups a two-rak‘ah prayer into its movements', () => {
    expect(segs.map((s) => s.posture)).toEqual([
      'takbir', 'qiyam', 'ruku', 'itidal', 'sujud', 'jalsah', 'sujud',
      'qiyam', 'ruku', 'itidal', 'sujud', 'jalsah', 'sujud', 'tashahhud', 'salam-right', 'salam-left',
    ])
    expect(segs.at(-3)!.kind).toBe('sitting')
    expect(segs.at(-2)!.kind).toBe('salam-right')
  })
})

describe('SequenceDecoder', () => {
  it('follows a whole prayer, one movement at a time', () => {
    const d = decoder()
    const c = { t: 0 }
    d.sync('ready', 0, 0)
    const got: string[] = []
    const play: [PoseClass, number, number?][] = [
      ['standing', 2], ['hands-raised', 1.5], ['standing', 4], ['bowing', 3], ['standing', 2], ['prostrating', 3], ['sitting', 2], ['prostrating', 3],
      ['standing', 4], ['bowing', 3], ['standing', 2], ['prostrating', 3], ['sitting', 2], ['prostrating', 3],
      ['sitting', 4, 0], ['sitting', 2, 0.8], ['sitting', 2, -0.8],
    ]
    for (const [cls, s, turn] of play) for (const a of feed(d, c, s, cls, { turn: turn ?? 0 })) got.push(segs.find((x) => x.start === a.index)!.posture)
    expect(got).toEqual(segs.map((s) => s.posture))
  })

  it('ignores a brief misread and never jumps to a posture that is not next', () => {
    const d = decoder()
    const c = { t: 0 }
    d.sync('praying', segs[1]!.start, 0) // qiyam
    expect(feed(d, c, 3, 'standing')).toEqual([])
    expect(feed(d, c, 0.2, 'bowing')).toEqual([]) // 3 frames
    expect(feed(d, c, 2, 'standing')).toEqual([])
    // Sitting is not what follows qiyam: no advance, however long.
    expect(feed(d, c, 4, 'sitting')).toEqual([])
  })

  it('waits for the minimum time in a posture', () => {
    const d = decoder()
    const c = { t: 0 }
    d.sync('praying', segs[2]!.start, 0) // just entered ruku
    // Standing straight away (within the 1 s minimum) does not count yet.
    const early = feed(d, c, 0.6, 'standing')
    expect(early).toEqual([])
    const later = feed(d, c, 1, 'standing')
    expect(later.map((a) => a.index)).toEqual([segs[3]!.start])
  })

  it('catches up when a movement was missed', () => {
    const d = decoder()
    const c = { t: 0 }
    d.sync('praying', segs[3]!.start, 0) // i'tidal; sujud missed, now sitting (jalsah)
    feed(d, c, 1.5, 'standing')
    const a = feed(d, c, 3, 'sitting')
    expect(a).toHaveLength(1)
    expect(a[0]!.index).toBe(segs[5]!.start)
    expect(a[0]!.reason).toBe('catch-up')
  })

  it('reads the salams as turns away from the sitting head, whichever way the camera mirrors', () => {
    for (const sign of [1, -1]) {
      const d = decoder()
      const c = { t: 0 }
      d.sync('praying', segs[13]!.start, 0) // tashahhud
      expect(feed(d, c, 4, 'sitting', { turn: 0.1 })).toEqual([])
      const right = feed(d, c, 2, 'sitting', { turn: 0.1 + 0.8 * sign })
      expect(right.map((a) => a.kind)).toEqual(['salam-right'])
      // Turning back to the middle is not the second salam...
      expect(feed(d, c, 1, 'sitting', { turn: 0.1 })).toEqual([])
      // ...turning the other way is.
      const left = feed(d, c, 2, 'sitting', { turn: 0.1 - 0.8 * sign })
      expect(left.map((a) => a.kind)).toEqual(['salam-left'])
    }
  })

  it('lets voice tip a weak movement over, and carries it alone when nobody is in view', () => {
    const d = decoder()
    const c = { t: 0 }
    d.sync('praying', segs[2]!.start, 0) // ruku
    feed(d, c, 2, 'bowing')
    // A hesitant view of standing up: not enough on its own...
    expect(feed(d, c, 1, 'standing', { sure: 0.45, conf: 0.4 })).toEqual([])
    // ...with "sami' Allahu liman hamidah" heard, it is.
    d.addEvidence({ kind: 'tasmi', confidence: 0.9, at: c.t })
    expect(feed(d, c, 1, 'standing', { sure: 0.45, conf: 0.4 }).map((a) => a.index)).toEqual([segs[3]!.start])

    // Nobody in view for 8 s: the decoder says it's lost; a takbir moves on.
    feed(d, c, 9, null)
    expect(d.status(c.t).lost).toBe(true)
    d.addEvidence({ kind: 'takbir', confidence: 0.9, at: c.t })
    expect(feed(d, c, 0.2, null).map((a) => a.reason)).toEqual(['voice'])
  })

  it('ignores voice that does not fit the next movement', () => {
    const d = decoder()
    const c = { t: 0 }
    d.sync('praying', segs[1]!.start, 0) // qiyam, next is ruku
    feed(d, c, 2, 'standing')
    d.addEvidence({ kind: 'salam', confidence: 1, at: c.t })
    d.addEvidence({ kind: 'tasmi', confidence: 1, at: c.t })
    expect(feed(d, c, 2, 'standing')).toEqual([])
  })

  it('reports a finished line inside a posture', () => {
    const d = decoder()
    const c = { t: 0 }
    d.sync('praying', segs[1]!.start, 0)
    d.addEvidence({ kind: 'lineDone', confidence: 0.9, at: c.t })
    expect(feed(d, c, 0.2, 'standing').map((a) => a.reason)).toEqual(['line'])
  })

  it('starts the prayer from the opening takbir only', () => {
    const d = decoder()
    const c = { t: 0 }
    d.sync('ready', 0, 0)
    expect(feed(d, c, 3, 'bowing')).toEqual([])
    expect(feed(d, c, 1.5, 'hands-raised').map((a) => a.index)).toEqual([0])
  })
})
