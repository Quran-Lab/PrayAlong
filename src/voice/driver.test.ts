import { describe, expect, it } from 'vitest'
import phonemeTable from '@/content/phonemes.json'
import { buildSequence } from '@/sequence/build'
import type { Step } from '@/sequence/types'
import { SessionSim, VoiceCore } from './core'
import { announcedBy, VoiceDriver, type DriverAction, type SessionView } from './driver'
import type { FollowerEvent } from './types'

const steps = buildSequence('fajr').steps
const idx = (lineId: string, from = 0) => steps.findIndex((s, i) => i >= from && s.recitationId === lineId)
const view = (index: number, phase: SessionView['phase'] = 'praying'): SessionView => ({ phase, index, steps })
const stepMs = (s: Step) => s.timing.expectedMs
const driver = (mode: 'full' | 'lines' | 'evidence' = 'full') => new VoiceDriver({ mode, stepMs })

const kw = (kind: 'takbir' | 'tasmi' | 'salam', confidence = 0.8): FollowerEvent => ({ kind, confidence, at: 0, start: 0 })
const done = (step: number): FollowerEvent => ({ kind: 'lineDone', step, lineId: steps[step]!.recitationId, confidence: 0.9, reps: 1, at: 0 })
const start = (step: number): FollowerEvent => ({ kind: 'lineStart', step, lineId: steps[step]!.recitationId, confidence: 0.9, at: 0 })
const word = (step: number): FollowerEvent => ({ kind: 'word', step, lineId: steps[step]!.recitationId, wordIndex: 0, rep: 0, confidence: 1, at: 0 })

/** Arrive on `index` at t=0, then deliver `e` at `now`. */
function at(d: VoiceDriver, index: number, e: FollowerEvent, now = 5000, phase: SessionView['phase'] = 'praying'): DriverAction | null {
  d.sync(view(index, phase), 0)
  return d.onEvent(e, view(index, phase), now)
}

describe('announcedBy', () => {
  it('names the phrase each posture change is announced with', () => {
    expect(announcedBy(steps, idx('thana-1'))).toBeNull() // folding the hands
    expect(announcedBy(steps, idx('ruku'))).toBe('takbir')
    expect(announcedBy(steps, idx('tasmi'))).toBe('tasmi')
    expect(announcedBy(steps, idx('sujud'))).toBe('takbir')
    expect(announcedBy(steps, idx('jalsah'))).toBe('takbir')
    expect(announcedBy(steps, idx('salam'))).toBe('salam')
    expect(announcedBy(steps, idx('fatiha-2'))).toBeNull()
  })
})

describe('VoiceDriver', () => {
  it('begins the prayer on the opening takbir', () => {
    expect(at(driver(), 0, kw('takbir'), 100, 'ready')).toEqual({ type: 'begin', reason: 'takbir' })
  })

  it('moves line by line within a posture', () => {
    const i = idx('fatiha-2')
    expect(at(driver(), i, done(i))).toEqual({ type: 'goTo', index: i + 1, reason: 'lineDone' })
  })

  it('waits at the end of a posture, then follows the takbir', () => {
    const last = idx('ruku') - 1
    const d = driver()
    expect(at(d, last, done(last))).toBeNull()
    expect(d.onEvent(kw('takbir'), view(last), 6000)).toEqual({ type: 'goTo', index: idx('ruku'), reason: 'takbir' })
  })

  it('ignores a takbir in the middle of an aloud passage that is being followed', () => {
    const i = idx('fatiha-3')
    const d = driver()
    d.sync(view(i), 0)
    d.onEvent(word(i), view(i), 4000)
    expect(d.onEvent(kw('takbir'), view(i), 5000)).toBeNull()
  })

  it('one phrase, one move: no keyword move right after arriving', () => {
    const last = idx('ruku') - 1
    expect(at(driver(), last, kw('takbir'), 300)).toBeNull()
  })

  it('rises on tasmi, and only tasmi', () => {
    const ruku = idx('ruku')
    expect(at(driver(), ruku, kw('takbir'))).toBeNull()
    expect(at(driver(), ruku, kw('tasmi'))).toEqual({ type: 'goTo', index: idx('tasmi'), reason: 'tasmi' })
  })

  it('salam: moves into the salam from the last salawat, but the salam line itself is not a move', () => {
    const lastSalawat = idx('salawat-4')
    const right = idx('salam')
    expect(at(driver(), lastSalawat, kw('salam'))).toEqual({ type: 'goTo', index: right, reason: 'salam' })
    expect(at(driver(), right, kw('salam'))).toBeNull()
    expect(at(driver(), right, done(right))).toEqual({ type: 'goTo', index: right + 1, reason: 'lineDone' })
    expect(at(driver(), right + 1, done(right + 1))).toEqual({ type: 'finish', reason: 'lineDone' })
  })

  it('hearing the next line moves one step, never two, never back', () => {
    const i = idx('fatiha-4')
    expect(at(driver(), i, start(i + 1))).toEqual({ type: 'goTo', index: i + 1, reason: 'lineStart' })
    expect(at(driver(), i, start(i + 2))).toBeNull()
    expect(at(driver(), i, done(i - 1))).toBeNull()
  })

  it('times quiet lines out when nothing is heard, but not while someone talks', () => {
    const i = idx('thana-1')
    const d = driver()
    d.sync(view(i), 0)
    const ms = stepMs(steps[i]!)
    expect(d.tick(view(i), ms - 10)).toBeNull()
    d.onLevel(true, ms)
    expect(d.tick(view(i), ms + 100)).toBeNull()
    expect(d.tick(view(i), ms + 1000)).toEqual({ type: 'goTo', index: i + 1, reason: 'timer' })
  })

  it('gives posture changes extra grace before timing out', () => {
    const last = idx('ruku') - 1
    const d = driver()
    d.sync(view(last), 0)
    const ms = stepMs(steps[last]!)
    expect(d.tick(view(last), ms + 100)).toBeNull()
    expect(d.tick(view(last), ms + d.cfg.postureGraceMs + 100)).toEqual({ type: 'goTo', index: last + 1, reason: 'timer' })
  })

  it('holds the timers while the companion recites', () => {
    const i = idx('thana-1')
    const d = driver()
    d.sync(view(i), 0)
    d.setCompanion(true, 0)
    expect(d.tick(view(i), 60_000)).toBeNull()
    d.setCompanion(false, 60_000)
    expect(d.tick(view(i), 60_000 + stepMs(steps[i]!) - 10)).toBeNull()
    expect(d.tick(view(i), 60_000 + stepMs(steps[i]!) + 10)).not.toBeNull()
  })

  it("'lines' mode leaves postures to the camera; 'evidence' never moves", () => {
    const last = idx('ruku') - 1
    expect(at(driver('lines'), last, kw('takbir'), 6000)).toBeNull()
    expect(at(driver('lines'), last, start(last + 1))).toBeNull()
    expect(at(driver('lines'), idx('fatiha-2'), done(idx('fatiha-2')))).not.toBeNull()
    expect(at(driver('evidence'), idx('fatiha-2'), done(idx('fatiha-2')))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The whole loop (follower + driver + session) on synthetic decoder output.

const LINES = (phonemeTable as { lines: Record<string, { words: string[] }> }).lines

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

interface Utterance {
  lineId: string
  /** Seconds of speech. */
  dur: number
}

/** A worshipper praying aloud: every line, the movement takbirs, pauses. */
function script(prayerSteps: readonly Step[], rand: () => number, perturb = false): Utterance[] {
  const out: Utterance[] = []
  prayerSteps.forEach((s, i) => {
    if (announcedBy(prayerSteps, i) === 'takbir') out.push({ lineId: 'takbir', dur: 1.2 })
    let reps = s.repeat
    if (perturb && reps === 3 && rand() < 0.3) reps = 1
    for (let r = 0; r < reps; r++) {
      if (perturb && rand() < 0.1) out.push({ lineId: s.recitationId, dur: 0.6 }) // false start (cut below)
      out.push({ lineId: s.recitationId, dur: 0.6 + LINES[s.recitationId]!.words.length * 0.55 })
    }
  })
  return out
}

function simulate(prayer: 'fajr' | 'maghrib', seed: number, perturb: boolean, missed = 0) {
  const seq = buildSequence(prayer).steps
  const sim = new SessionSim(seq)
  const actions: { a: DriverAction; t: number }[] = []
  const core = new VoiceCore(seq, { mode: 'full', stepMs: (s) => s.timing.expectedMs }, { view: sim.view, apply: sim.apply, onAction: (a, t) => actions.push({ a, t }) })
  core.sync(0)
  const rand = rng(seed)
  let t = 1
  const tickTo = (until: number, speech: boolean) => {
    for (; t < until; t += 0.1) {
      core.level(speech, t, t * 1000)
      core.tick(t * 1000)
    }
  }
  const utts = script(seq, rand, perturb)
  // Listening started late: the first `missed` utterances were never heard.
  for (let u = missed; u < utts.length; u++) {
    const { lineId, dur } = utts[u]!
    const text = LINES[lineId]!.words.join('')
    // A false start is the same line, cut after a third of it.
    const chars = [...text].slice(0, dur < 0.7 ? Math.ceil(text.length / 3) : undefined)
    const per = dur / Math.max(1, chars.length)
    for (let c = 0; c < chars.length; c += 2) {
      t += per * 2
      core.level(true, t, t * 1000)
      core.tokens([chars.slice(c, c + 2).join('')], t + 0.5, (t + 0.5) * 1000) // 0.5 s decoder latency
      core.tick((t + 0.5) * 1000)
    }
    tickTo(t + 0.5 + rand() * 0.7, false)
    core.endpoint(t, t * 1000)
  }
  tickTo(t + 15, false)
  return { sim, actions }
}

describe('VoiceCore: a whole prayer', () => {
  for (const [prayer, seed, perturb] of [['fajr', 1, false], ['maghrib', 2, false], ['fajr', 3, true], ['maghrib', 4, true]] as const) {
    it(`${prayer}${perturb ? ' with false starts and short tasbih' : ''}: completes, in order, without timers`, () => {
      const { sim, actions } = simulate(prayer, seed, perturb)
      expect(sim.phase).toBe('complete')
      const moves = actions.filter((x) => x.a.type === 'goTo').map((x) => (x.a as { index: number }).index)
      expect(moves).toEqual([...moves].sort((a, b) => a - b))
      const steps = buildSequence(prayer).steps
      expect(new Set(moves).size).toBe(steps.length - 1)
      expect(actions.filter((x) => x.a.reason === 'timer')).toEqual([])
    })
  }
})

describe('VoiceCore: listening started late', () => {
  for (const missed of [3, 8, 14]) {
    it(`misses the first ${missed} utterances, catches up and completes`, () => {
      const { sim, actions } = simulate('fajr', 7, false, missed)
      expect(sim.phase).toBe('complete')
      const moves = actions.filter((x) => x.a.type === 'goTo').map((x) => (x.a as { index: number }).index)
      expect(moves).toEqual([...moves].sort((a, b) => a - b))
      expect(actions.filter((x) => x.a.reason === 'timer').length).toBeLessThanOrEqual(2)
    })
  }
})
