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

  it('reports the timer fallback for the visible slider', () => {
    const d = driver()
    const i = idx('fatiha-2')
    expect(d.timeoutMs(view(i))).toBe(stepMs(steps[i]!))
    const last = idx('ruku') - 1
    expect(d.timeoutMs(view(last))).toBe(stepMs(steps[last]!) + d.cfg.postureGraceMs)
    expect(driver('lines').timeoutMs(view(last))).toBeNull()
    expect(d.timeoutMs(view(0, 'ready'))).toBeNull()
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

/** Drive a VoiceCore by hand: utterances as tokens at a steady pace, level ticks every 100 ms. */
function harness(prayer: 'fajr', startAt: string) {
  const seq = buildSequence(prayer).steps
  const sim = new SessionSim(seq)
  sim.phase = 'praying'
  sim.index = seq.findIndex((s) => s.recitationId === startAt)
  const actions: { a: DriverAction; t: number }[] = []
  const core = new VoiceCore(seq, { mode: 'full', stepMs: (s) => s.timing.expectedMs }, { view: sim.view, apply: sim.apply, onAction: (a, t) => actions.push({ a, t: t / 1000 }) })
  core.sync(0)
  let t = 0
  const tick = (speech: boolean) => {
    t = Math.round((t + 0.1) * 10) / 10
    core.level(speech, t, t * 1000)
    core.tick(t * 1000)
  }
  return {
    sim,
    actions,
    seq,
    now: () => t,
    core: () => core,
    /** Say a line (or the first `frac` of it), at ~12 phoneme characters a second. */
    say(lineId: string, frac = 1) {
      const chars = [...LINES[lineId]!.words.join('')]
      const n = Math.max(1, Math.round(chars.length * frac))
      for (let c = 0; c < n; c += 2) {
        tick(true)
        tick(true)
        // Tokens arrive ~0.4 s after the audio (decoder chunk): stamp them with the current clock.
        core.tokens([chars.slice(c, Math.min(n, c + 2)).join('')], t, t * 1000)
      }
    },
    silence(secs: number) {
      for (let k = 0; k < Math.round(secs * 10); k++) tick(false)
    },
    endpoint() {
      core.endpoint(t, t * 1000)
    },
  }
}

describe('VoiceCore: owner-reported scenarios', () => {
  it('tahmid, 10 s with no takbir, then the sujud tasbih: moves to sujud within 1 s of its first words', () => {
    const h = harness('fajr', 'tasmi')
    h.say('tasmi')
    h.silence(0.6)
    h.say('tahmid')
    h.silence(0.4)
    const tahmid = h.seq.findIndex((s) => s.recitationId === 'tahmid')
    expect(h.sim.index).toBe(tahmid)
    // Ten seconds of quiet (no takbir); the 3 s fallback after a finished line may move it.
    h.silence(10)
    h.endpoint()
    const sujud = tahmid + 1
    if (h.sim.index !== sujud) {
      const start = h.now()
      h.say('sujud', 0.35)
      expect(h.sim.index).toBe(sujud)
      const move = h.actions.find((x) => x.a.type === 'goTo' && (x.a as { index: number }).index === sujud)!
      expect(move.t - start).toBeLessThanOrEqual(1)
    } else {
      const move = h.actions.find((x) => x.a.type === 'goTo' && (x.a as { index: number }).index === sujud)!
      expect(move.a.reason).toBe('timer')
    }
  })

  it('the sujud tasbih straight after tahmid (no takbir heard): moves on its first words', () => {
    const h = harness('fajr', 'tahmid')
    h.say('tahmid')
    h.silence(0.4)
    const sujud = h.sim.index + 1
    const start = h.now()
    h.say('sujud', 0.35)
    expect(h.sim.index).toBe(sujud)
    const move = h.actions.find((x) => x.a.type === 'goTo' && (x.a as { index: number }).index === sujud)!
    expect(move.t - start).toBeLessThanOrEqual(1)
  })

  const ruku = (h: ReturnType<typeof harness>) => h.seq.findIndex((s) => s.recitationId === 'ruku')

  it('ruku x3 with 1 to 2 s between repetitions: counts 3, never advances early', () => {
    const h = harness('fajr', 'ruku')
    const i = ruku(h)
    for (const gap of [1.2, 1.8, 0]) {
      h.say('ruku')
      h.silence(gap)
      h.endpoint()
    }
    expect(h.core().follower.repsOf(i)).toBe(3)
    expect(h.actions.filter((x) => x.t <= h.now())).toEqual([])
    expect(h.sim.index).toBe(i)
  })

  it('ruku x3 joined with no gaps: counts 3', () => {
    const h = harness('fajr', 'ruku')
    for (let r = 0; r < 3; r++) h.say('ruku')
    expect(h.core().follower.repsOf(ruku(h))).toBe(3)
    expect(h.sim.index).toBe(ruku(h))
  })

  it('ruku x2 then a pause: does not advance until a long silence', () => {
    const h = harness('fajr', 'ruku')
    const i = ruku(h)
    h.say('ruku')
    h.silence(1)
    h.say('ruku')
    h.silence(5)
    expect(h.core().follower.repsOf(i)).toBe(2)
    expect(h.sim.index).toBe(i)
    h.silence(4)
    expect(h.sim.index).toBe(i + 1)
    expect(h.actions.at(-1)!.a.reason).toBe('timer')
  })
})

describe('VoiceCore: short surahs', () => {
  const SURAHS = ['asr', 'kawthar', 'kafirun', 'nasr', 'masad', 'ikhlas', 'falaq', 'nas'] as const
  const linesOf = (surah: string) => Object.keys(LINES).filter((id) => id.startsWith(`${surah}-`)).sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]))

  /** Rak'ah 1 of fajr from amin: then `surah` (planned: al-Kawthar). */
  function recite(surah: string, basmala: boolean, joined: boolean) {
    const seq = buildSequence('fajr').steps
    const sim = new SessionSim(seq, 'fajr')
    sim.phase = 'praying'
    sim.index = seq.findIndex((s) => s.recitationId === 'amin')
    const actions: DriverAction[] = []
    const core = new VoiceCore(seq, { mode: 'full', stepMs: (s) => s.timing.expectedMs }, { view: sim.view, apply: sim.apply, onAction: (a) => actions.push(a) })
    core.sync(0)
    let t = 0
    const say = (words: string[]) => {
      const chars = [...words.join('')]
      for (let c = 0; c < chars.length; c += 2) {
        t += 0.13
        core.level(true, t, t * 1000)
        core.tokens([chars.slice(c, c + 2).join('')], t, t * 1000)
        core.tick(t * 1000)
      }
    }
    const pause = (secs: number) => {
      for (let k = 0; k < secs * 10; k++) {
        t += 0.1
        core.level(false, t, t * 1000)
        core.tick(t * 1000)
      }
      core.endpoint(t, t * 1000)
    }
    say(LINES.amin!.words)
    pause(0.8)
    linesOf(surah).forEach((id, k) => {
      const words = LINES[id]!.words
      const optional = (LINES[id] as { optional?: number }).optional ?? 0
      say(k === 0 && !basmala ? words.slice(optional) : words)
      if (!joined) pause(0.7)
    })
    pause(1.2)
    return { sim, actions }
  }

  for (const surah of SURAHS) {
    for (const [basmala, joined] of [[true, false], [false, true]] as const) {
      it(`${surah}${basmala ? ' with basmala' : ' without basmala'}${joined ? ', ayat joined' : ''}: follows it to its last verse`, () => {
        const { sim, actions } = recite(surah, basmala, joined)
        const switched = actions.filter((a) => a.type === 'surah')
        if (surah === 'kawthar') expect(switched).toEqual([])
        else expect(switched.map((a) => (a as { surah: string }).surah)).toEqual([surah])
        const last = linesOf(surah).at(-1)!
        // On the surah's last line (waiting for the takbir) or already past it.
        const at = sim.steps[sim.index]!.recitationId
        expect([last, 'ruku']).toContain(at)
        expect(sim.steps.some((s) => s.recitationId === last)).toBe(true)
      })
    }
  }
})

describe('SurahSpotter under decoder noise', () => {
  const SURAHS = ['asr', 'kawthar', 'kafirun', 'nasr', 'masad', 'ikhlas', 'falaq', 'nas'] as const
  const ALPHA = [...new Set(Object.values(LINES).flatMap((l) => l.words.flatMap((w) => [...w])))]
  it('never names the wrong surah, and names the right one in most noisy takes', async () => {
    const { SurahSpotter } = await import('./follower')
    const { skeletonChars } = await import('./phonetic')
    let wrong = 0
    let right = 0
    let total = 0
    for (const surah of SURAHS) {
      const first = Object.keys(LINES).filter((id) => id.startsWith(`${surah}-`)).sort()[0]!
      const second = `${surah}-2`
      for (let seed = 1; seed <= 5; seed++) {
        const r = rng(seed * 31 + surah.length)
        const sp = new SurahSpotter('kawthar', 12)
        let got: string | null = null
        const text = [...LINES[first]!.words.join(''), ...LINES[second]!.words.join('')]
        let last = ''
        for (const ch of text) {
          const x = r()
          const c = x < 0.05 ? '' : x < 0.1 ? ALPHA[Math.floor(r() * ALPHA.length)]! : ch
          for (const s of skeletonChars(c)) {
            if (s === last) continue
            last = s
            got = sp.push(s)?.surah ?? got
          }
        }
        got = sp.confirm()?.surah ?? got
        total++
        if (surah === 'kawthar') {
          if (got) wrong++
          else right++
        } else if (got === surah) right++
        else if (got) wrong++
      }
    }
    console.info(`surah spotter, 10% noise: right ${right}/${total}, wrong ${wrong}`)
    expect(wrong).toBe(0)
    expect(right / total).toBeGreaterThanOrEqual(0.8)
  })
})

describe('VoiceCore: listening started late', () => {
  for (const missed of [3, 8]) {
    it(`misses the first ${missed} utterances, catches up and completes`, () => {
      const { sim, actions } = simulate('fajr', 7, false, missed)
      expect(sim.phase).toBe('complete')
      const moves = actions.filter((x) => x.a.type === 'goTo').map((x) => (x.a as { index: number }).index)
      expect(moves).toEqual([...moves].sort((a, b) => a - b))
      expect(actions.filter((x) => x.a.reason === 'timer').length).toBeLessThanOrEqual(2)
    })
  }

  it('starting a whole posture late: keeps following one step at a time, never jumps', () => {
    // 14 utterances missed = listening began after ruku. The strict one-step
    // rule means the session re-locks a rak'ah behind rather than jumping.
    const { sim, actions } = simulate('fajr', 7, false, 14)
    let at = 0
    for (const x of actions) {
      if (x.a.type !== 'goTo') continue
      const to = (x.a as { index: number }).index
      expect(to).toBeGreaterThan(at)
      expect(to - at).toBeLessThanOrEqual(1)
      at = to
    }
    expect(sim.index).toBeGreaterThan(20)
  })
})
