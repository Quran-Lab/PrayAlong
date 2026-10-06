import { describe, expect, it } from 'vitest'
import { buildSequence } from '@/sequence/build'
import { cameraRule, FaceFollower, type FaceFrame, type FaceMove } from './face-logic'

const steps = buildSequence('fajr').steps
const first = (posture: string, from = 0) => steps.findIndex((s, i) => i >= from && s.posture === posture)
const RUKU = first('ruku')
const ITIDAL = first('itidal')
const SUJUD1 = first('sujud')
const JALSAH = first('jalsah')
const SUJUD2 = first('sujud', JALSAH)
const AFTER2 = SUJUD2 + 1

/** Frames every 100 ms from t0 to t1 (exclusive). */
function frames(t0: number, t1: number, f: Omit<FaceFrame, 't'> | ((t: number) => Omit<FaceFrame, 't'>)): FaceFrame[] {
  const out: FaceFrame[] = []
  for (let t = t0; t < t1; t += 100) out.push({ t, ...(typeof f === 'function' ? f(t) : f) })
  return out
}
const face = (cy = 0.5, h = 0.2) => ({ visible: true, cy, h })
const none = { visible: false }

/** Run a timeline; moves are applied to the session as the app would. */
function run(fl: FaceFollower, start: number, timeline: FaceFrame[], external: { t: number; index: number }[] = []) {
  let index = start
  fl.sync('praying', index, steps, timeline[0]?.t ?? 0)
  const moves: FaceMove[] = []
  const ext = [...external]
  for (const f of timeline) {
    while (ext.length && ext[0]!.t <= f.t) {
      index = ext.shift()!.index
      fl.sync('praying', index, steps, f.t)
    }
    const m = fl.push(f)
    if (m) {
      expect(m.index).toBeGreaterThan(index)
      moves.push(m)
      index = m.index
      fl.sync('praying', index, steps, f.t)
    }
  }
  return { moves, index }
}

describe('cameraRule', () => {
  it('only the three movements', () => {
    expect(cameraRule(steps, ITIDAL)?.rule).toBe('a')
    expect(cameraRule(steps, JALSAH)?.rule).toBe('a')
    expect(cameraRule(steps, SUJUD1)).toEqual({ rule: 'b', target: JALSAH })
    expect(cameraRule(steps, SUJUD2)).toEqual({ rule: 'b', target: AFTER2 })
    expect(cameraRule(steps, RUKU)).toEqual({ rule: 'c', target: ITIDAL })
    expect(cameraRule(steps, 0)).toBeNull() // takbir -> qiyam: voice/timer
    expect(cameraRule(steps, RUKU - 1)).toBeNull() // qiyam -> ruku: voice/timer
  })
})

describe('FaceFollower', () => {
  it('goes down into sujud when the face is lost after the dwell', () => {
    const fl = new FaceFollower()
    const { moves } = run(fl, ITIDAL, [...frames(0, 2000, face(0.2, 0.08)), ...frames(2000, 4000, none)])
    expect(moves).toHaveLength(1)
    expect(moves[0]!.index).toBe(SUJUD1)
    expect(moves[0]!.reason).toBe('sujud-down')
    // lost after >= 800 ms of absence
    expect(moves[0]!.at).toBeGreaterThanOrEqual(2800)
    expect(moves[0]!.at).toBeLessThan(3000)
  })

  it('rises from sujud when the face comes back', () => {
    const fl = new FaceFollower()
    const { moves } = run(fl, ITIDAL, [...frames(0, 2000, face(0.2, 0.08)), ...frames(2000, 6000, none), ...frames(6000, 8000, face(0.55, 0.3))])
    expect(moves.map((m) => m.index)).toEqual([SUJUD1, JALSAH])
    expect(moves[1]!.reason).toBe('sujud-up')
    expect(moves[1]!.at).toBeGreaterThanOrEqual(6400)
    expect(moves[1]!.at).toBeLessThan(6600)
  })

  it('does both sujuds and the rise to the next rak‘ah in order, one step at a time', () => {
    const fl = new FaceFollower()
    const tl = [
      ...frames(0, 2000, face(0.2, 0.08)), // i'tidal
      ...frames(2000, 5000, none), // sujud 1
      ...frames(5000, 8000, face(0.5, 0.3)), // jalsah
      ...frames(8000, 11000, none), // sujud 2
      ...frames(11000, 13000, face(0.2, 0.08)), // standing again
    ]
    const { moves } = run(fl, ITIDAL, tl)
    expect(moves.map((m) => m.index)).toEqual([SUJUD1, JALSAH, SUJUD2, AFTER2])
  })

  it('a glance away during the dwell does not skip', () => {
    const fl = new FaceFollower()
    // Entered i'tidal at 0; face gone 0..500 ms (shorter than lostMs) then back.
    const { moves } = run(fl, ITIDAL, [...frames(0, 500, none), ...frames(500, 3000, face(0.2, 0.08))])
    expect(moves).toHaveLength(0)
    // Glance shorter than 600 ms later on: still no move.
    const fl2 = new FaceFollower()
    const r2 = run(fl2, ITIDAL, [...frames(0, 2000, face(0.2, 0.08)), ...frames(2000, 2500, none), ...frames(2500, 4000, face(0.2, 0.08))])
    expect(r2.moves).toHaveLength(0)
  })

  it('does not go down if the face was never found in the posture', () => {
    const fl = new FaceFollower()
    const { moves } = run(fl, ITIDAL, frames(0, 5000, none))
    expect(moves).toHaveLength(0)
  })

  it('rises from ruku when the face jumps up', () => {
    const fl = new FaceFollower()
    const { moves } = run(fl, RUKU, [...frames(0, 3000, face(0.6, 0.3)), ...frames(3000, 4000, face(0.4, 0.25))])
    expect(moves).toHaveLength(1)
    expect(moves[0]).toMatchObject({ index: ITIDAL, reason: 'ruku-rise' })
    expect(moves[0]!.at).toBeGreaterThanOrEqual(3300)
  })

  it('rises from ruku when the face shrinks, or leaves through the top', () => {
    const shrink = run(new FaceFollower(), RUKU, [...frames(0, 3000, face(0.6, 0.3)), ...frames(3000, 4000, face(0.58, 0.15))])
    expect(shrink.moves.map((m) => m.index)).toEqual([ITIDAL])
    const top = run(new FaceFollower(), RUKU, [
      ...frames(0, 3000, face(0.3, 0.3)),
      ...frames(3000, 3200, face(0.12, 0.2)), // box top at 0.02
      ...frames(3200, 4500, none),
    ])
    expect(top.moves.map((m) => m.index)).toEqual([ITIDAL])
  })

  it('stays in ruku for small wobbles, a brief jump, or a face that just disappears', () => {
    const wobble = run(new FaceFollower(), RUKU, frames(0, 6000, (t) => face(0.6 + 0.05 * Math.sin(t / 300), 0.3 + 0.03 * Math.cos(t / 400))))
    expect(wobble.moves).toHaveLength(0)
    const brief = run(new FaceFollower(), RUKU, [...frames(0, 3000, face(0.6, 0.3)), ...frames(3000, 3200, face(0.4, 0.3)), ...frames(3200, 5000, face(0.6, 0.3))])
    expect(brief.moves).toHaveLength(0)
    const gone = run(new FaceFollower(), RUKU, [...frames(0, 3000, face(0.6, 0.3)), ...frames(3000, 6000, none)])
    expect(gone.moves).toHaveLength(0)
  })

  it('never moves twice for one movement', () => {
    const fl = new FaceFollower()
    // Lost for a long time in i'tidal -> one move into sujud, nothing more while still lost.
    const { moves } = run(fl, ITIDAL, [...frames(0, 2000, face(0.2, 0.08)), ...frames(2000, 15000, none)])
    expect(moves).toHaveLength(1)
  })

  it('does nothing within 1 s of a voice move, and nothing when the voice already moved', () => {
    // Voice moves i'tidal -> sujud at 2650 just before the camera would: the camera stays put.
    const fl = new FaceFollower()
    const r = run(fl, ITIDAL, [...frames(0, 2000, face(0.2, 0.08)), ...frames(2000, 5000, none)], [{ t: 2500, index: SUJUD1 }])
    expect(r.moves).toHaveLength(0)
    expect(r.index).toBe(SUJUD1)
    // Voice moves sujud -> jalsah; the face comes back 300 ms later: no second move (jalsah needs found-then-lost).
    const fl2 = new FaceFollower()
    const r2 = run(fl2, SUJUD1, [...frames(0, 3000, none), ...frames(3000, 6000, face(0.5, 0.3))], [{ t: 2700, index: JALSAH }])
    expect(r2.moves).toHaveLength(0)
    expect(r2.index).toBe(JALSAH)
    // Voice moves into sujud at 1000; the face is lost at 1100 and back at 1400 (found 1800): held until 2500 (1.5 s in the posture).
    const fl3 = new FaceFollower()
    const r3 = run(fl3, ITIDAL, [...frames(0, 300, face(0.2, 0.08)), ...frames(300, 1400, none), ...frames(1400, 4000, face(0.5, 0.3))], [{ t: 1000, index: SUJUD1 }])
    expect(r3.moves.map((m) => m.index)).toEqual([JALSAH])
    expect(r3.moves[0]!.at).toBeGreaterThanOrEqual(2500)
  })

  it('never two camera moves within 2 s, and flickers never count', () => {
    // Sujud entered by the camera at ~2800; the face flickers back for single frames, then really returns at 3200.
    const fl = new FaceFollower()
    const flicker = frames(2000, 3200, (t) => (t % 500 === 0 ? face(0.5, 0.3) : none))
    const { moves } = run(fl, ITIDAL, [...frames(0, 2000, face(0.2, 0.08)), ...flicker, ...frames(3200, 7000, face(0.5, 0.3))])
    expect(moves.length).toBeLessThanOrEqual(2)
    if (moves.length === 2) expect(moves[1]!.at - moves[0]!.at).toBeGreaterThanOrEqual(2000)
    // single-frame flickers in i'tidal never take it down
    const fl2 = new FaceFollower()
    const r2 = run(fl2, ITIDAL, frames(0, 8000, (t) => (t % 700 === 0 ? none : face(0.2, 0.08))))
    expect(r2.moves).toHaveLength(0)
  })

  it('never moves outside the prayer', () => {
    const fl = new FaceFollower()
    fl.sync('ready', ITIDAL, steps, 0)
    const moves = [...frames(0, 2000, face()), ...frames(2000, 5000, none)].map((f) => fl.push(f)).filter(Boolean)
    expect(moves).toHaveLength(0)
  })

  it('face never seen: no moves, and the note is shown once', () => {
    const fl = new FaceFollower()
    const QIYAM = first('qiyam')
    let shown = 0
    let was: string | null = null
    fl.sync('praying', QIYAM, steps, 0)
    const moves: FaceMove[] = []
    for (const f of frames(0, 30000, none)) {
      const m = fl.push(f)
      if (m) moves.push(m)
      if (fl.hint && !was) shown++
      was = fl.hint
    }
    // also across i'tidal, sujud etc. nothing moves
    for (const [i, idx] of [ITIDAL, SUJUD1, JALSAH, RUKU].entries()) {
      fl.sync('praying', idx, steps, 30000 + i * 5000)
      for (const f of frames(30000 + i * 5000, 35000 + i * 5000, none)) {
        const m = fl.push(f)
        if (m) moves.push(m)
        if (fl.hint && !was) shown++
        was = fl.hint
      }
    }
    expect(moves).toHaveLength(0)
    expect(shown).toBe(1)
    expect(fl.hintCount).toBe(1)
  })
})
