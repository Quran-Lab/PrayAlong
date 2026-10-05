import type { Step } from '@/sequence/types'
import { announcedBy, type DriverAction } from './driver'
import type { FollowerEvent, KeywordKind } from './types'

/**
 * Offline replay: build a whole prayer from the companion's per-line
 * recordings (with the movement takbirs a worshipper says between postures),
 * keep the ground truth (every word's end time), and score what the follower
 * and the driver did with it.
 */

export interface VoiceLineAudio {
  src: string
  dur: number
  /** [start, end] seconds of each displayed word. */
  words: [number, number][]
  /** Varied takes of the same line (scripts/voice-augment.mjs); one is picked per occurrence. */
  variants?: { src: string; dur: number; words: [number, number][] }[]
}
export type VoiceManifest = Record<string, VoiceLineAudio>

export interface Clip {
  /**
   * line: what the worshipper says (scored); takbir: a movement takbir;
   * companion: the app's own recitation from the speakers; false-start: the
   * first word or two of a line, abandoned; extra: a repetition beyond the
   * sequence's count.
   */
  kind: 'line' | 'takbir' | 'companion' | 'false-start' | 'extra'
  lineId: string
  /** Which decoded audio to use. */
  key: string
  /** The step this clip belongs to (a transition takbir belongs to the step it moves into). */
  step: number
  rep: number
  start: number
  dur: number
  /** Absolute word spans. */
  words: [number, number][]
  /** Per-clip gain (quiet lines can be rendered softer). */
  gain: number
}

export interface Timeline {
  clips: Clip[]
  duration: number
  keywords: { kind: KeywordKind; start: number; end: number }[]
}

export interface TimelineOptions {
  seed: number
  /** Pause after a step, seconds [min, max]. */
  pause: [number, number]
  /** Pause between repetitions. */
  repPause: [number, number]
  lead: number
  tail: number
  /** Say "Allahu akbar" when moving into a posture announced by it. */
  transitionTakbir: boolean
  /** Gain for lines the sequence marks quiet (1 = same as aloud). */
  quietGain: number
  /** Human imperfections: false starts, a forgotten quiet line, tasbih x1 / x5. */
  perturb: boolean
  /** Level of the companion's voice reaching the microphone (speaker bleed). */
  companionGain: number
  /** Consecutive Quran lines in one breath (no pause between ayat). */
  joined: boolean
  /** Amin after al-Fatiha: said normally, left out, after a long pause (4-6 s), or joined to the last verse. */
  amin: 'normal' | 'skip' | 'pause' | 'joined'
}

const isQuranLine = (id: string) => /^(fatiha|kawthar|ikhlas|asr|kafirun|nasr|masad|falaq|nas)-\d/.test(id)

export const DEFAULT_TIMELINE: TimelineOptions = {
  seed: 1,
  pause: [0.5, 1.2],
  repPause: [0.3, 0.6],
  lead: 1.5,
  tail: 3,
  transitionTakbir: true,
  quietGain: 1,
  perturb: false,
  companionGain: 0.5,
  joined: false,
  amin: 'normal',
}

export function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const KEYWORD_OF: Record<string, KeywordKind> = { takbir: 'takbir', tasmi: 'tasmi', salam: 'salam', amin: 'amin' }

export function buildTimeline(steps: readonly Step[], audio: VoiceManifest, options: Partial<TimelineOptions> = {}, companion?: VoiceManifest): Timeline {
  const o = { ...DEFAULT_TIMELINE, ...options }
  const rand = rng(o.seed)
  const between = ([a, b]: [number, number]) => a + (b - a) * rand()
  const clips: Clip[] = []
  const keywords: Timeline['keywords'] = []
  let t = o.lead
  const place = (kind: Clip['kind'], lineId: string, step: number, rep: number, gain: number, upToWord?: number) => {
    const line = (kind === 'companion' ? companion : audio)?.[lineId]
    if (!line) throw new Error(`no audio for ${lineId}`)
    const a = line.variants?.length ? line.variants[Math.floor(rand() * line.variants.length)]! : line
    const dur = upToWord === undefined ? a.dur : Math.min(a.dur, a.words[upToWord]![1] + 0.05)
    const words = a.words.slice(0, upToWord === undefined ? undefined : upToWord + 1)
    const clip: Clip = {
      kind,
      lineId,
      key: kind === 'companion' ? `companion:${a.src}` : a.src,
      step,
      rep,
      start: t,
      dur,
      words: words.map(([s, e]) => [t + s, t + Math.min(e, dur)]),
      gain,
    }
    clips.push(clip)
    const kw = kind === 'takbir' ? 'takbir' : kind === 'line' ? KEYWORD_OF[lineId] : undefined
    if (kw) keywords.push({ kind: kw, start: t, end: t + dur })
    t += dur
    return clip
  }
  steps.forEach((step, i) => {
    if (o.transitionTakbir && announcedBy(steps, i) === 'takbir') {
      place('takbir', 'takbir', i, 0, 1)
      t += between([0.4, 0.8])
    }
    const gain = step.voice === 'quiet' ? o.quietGain : 1
    const keyword = step.recitationId in KEYWORD_OF
    const sameAsPrev = steps[i - 1]?.posture === step.posture
    // Perturbations: a forgotten quiet line, a tasbih said once or five times.
    if (o.perturb && step.voice === 'quiet' && !keyword && sameAsPrev && step.repeat === 1 && rand() < 0.1) return
    if (step.recitationId === 'amin' && o.amin === 'skip') return
    if (step.recitationId === 'amin' && o.amin === 'pause') t += between([4, 6])
    let reps = Math.max(1, step.repeat)
    if (o.perturb && reps === 3) {
      const r = rand()
      reps = r < 0.2 ? 1 : r < 0.32 ? 5 : 3
    }
    if (companion) {
      place('companion', step.recitationId, i, 0, o.companionGain)
      t += between([0.3, 0.6])
    }
    for (let rep = 0; rep < reps; rep++) {
      if (rep > 0) t += between(o.repPause)
      const words = audio[step.recitationId]?.words.length ?? 0
      if (o.perturb && rep === 0 && words >= 3 && rand() < 0.12) {
        // A false start: one or two words, a breath, then the whole line again.
        place('false-start', step.recitationId, i, rep, gain, rand() < 0.5 ? 0 : 1)
        t += between([0.4, 0.9])
      }
      place(rep < Math.max(1, step.repeat) ? 'line' : 'extra', step.recitationId, i, rep, gain)
    }
    // Ayat said in one breath (people often join 108:1-3 and 112:1-4).
    const next = steps[i + 1]
    const joinedNext = o.joined && next && next.posture === step.posture && isQuranLine(step.recitationId) && isQuranLine(next.recitationId)
    const aminJoined = o.amin === 'joined' && next?.recitationId === 'amin'
    t += between(joinedNext || aminJoined ? [0.02, 0.15] : o.pause)
  })
  return { clips, duration: t + o.tail, keywords }
}

/** Pink-ish noise (Paul Kellet's economy filter), unit RMS-ish. */
function pinkNoise(n: number, rand: () => number): Float32Array {
  const out = new Float32Array(n)
  let b0 = 0, b1 = 0, b2 = 0
  for (let i = 0; i < n; i++) {
    const w = rand() * 2 - 1
    b0 = 0.99765 * b0 + w * 0.099046
    b1 = 0.963 * b1 + w * 0.2965164
    b2 = 0.57 * b2 + w * 1.0526913
    out[i] = (b0 + b1 + b2 + w * 0.1848) * 0.25
  }
  return out
}

export interface RenderOptions {
  sampleRate: number
  /** Overall gain applied after mixing (0.1 = -20 dB). */
  gain: number
  /** Add pink noise at this speech-to-noise ratio (dB); null = clean. */
  snrDb: number | null
  seed: number
}

export function renderTimeline(tl: Timeline, clips: Map<string, Float32Array>, o: RenderOptions): Float32Array {
  const sr = o.sampleRate
  const out = new Float32Array(Math.ceil(tl.duration * sr))
  let speechSq = 0
  let speechN = 0
  for (const c of tl.clips) {
    const pcm = clips.get(c.key)
    if (!pcm) throw new Error(`no pcm for ${c.key}`)
    const at = Math.round(c.start * sr)
    const n = Math.min(pcm.length, Math.round(c.dur * sr))
    // Short fade so a cut-off false start does not click.
    const fade = Math.round(0.03 * sr)
    for (let i = 0; i < n && at + i < out.length; i++) {
      const env = c.kind === 'false-start' ? Math.min(1, (n - i) / fade) : 1
      const v = pcm[i]! * c.gain * env
      out[at + i]! += v
      if (c.kind !== 'companion') {
        speechSq += v * v
        speechN++
      }
    }
  }
  if (o.snrDb !== null && speechN) {
    const speechRms = Math.sqrt(speechSq / speechN)
    const noise = pinkNoise(out.length, rng(o.seed + 99))
    let nsq = 0
    for (const v of noise) nsq += v * v
    const scale = speechRms / 10 ** (o.snrDb / 20) / Math.sqrt(nsq / noise.length)
    for (let i = 0; i < out.length; i++) out[i]! += noise[i]! * scale
  }
  if (o.gain !== 1) for (let i = 0; i < out.length; i++) out[i]! *= o.gain
  for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i]!))
  return out
}

/** 16-bit PCM mono WAV. */
export function encodeWav(pcm: Float32Array, sampleRate: number): Uint8Array {
  const buf = new ArrayBuffer(44 + pcm.length * 2)
  const v = new DataView(buf)
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + pcm.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, pcm.length * 2, true)
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, pcm[i]!)) * 32767), true)
  return new Uint8Array(buf)
}

export interface ReplayLog {
  events: { e: FollowerEvent; t: number }[]
  actions: { a: DriverAction; t: number }[]
  /** Session phase at the end. */
  phase: string
  index: number
  audioSeconds: number
  decodeMs: number[]
  /** Raw decoder output (for re-running the follower offline). */
  tokens?: { tokens: string[]; at: number; segment: number }[]
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))]!
}
const r2 = (v: number) => Math.round(v * 100) / 100

export interface ReplayMetrics {
  words: { total: number; reported: number; recall: number; lagP50: number; lagP95: number; lagMax: number; early: number }
  /** beforeEnd: completed before the last word had ended (must be 0); lag: completion minus last word end. */
  lineDone: { total: number; onTime: number; early: number; late: number; missing: number; accuracy: number; beforeEnd: number; lagP50: number; lagP95: number }
  /** Repeated lines (tasbih): count reported exactly; share of repetitions whose last word was shown. */
  reps: { steps: number; countExact: number; repsShown: number }
  session: { steps: number; arrivals: number; premature: number; late: number; arrivalLagP50: number; arrivalLagP95: number; byReason: Record<string, number>; completed: boolean }
  keywords: { takbirTotal: number; takbirHit: number; takbirRecall: number; falseEvents: number; falsePerMin: number; byKind: Record<string, { truth: number; hit: number; false: number }> }
  audioMinutes: number
  decodeP95Ms: number
}

/** Seconds; `t` in the log is seconds on the audio clock. */
export function scoreReplay(tl: Timeline, steps: readonly Step[], log: ReplayLog): ReplayMetrics {
  // Words.
  const wordEvents = new Map<string, number>()
  for (const { e, t } of log.events) if (e.kind === 'word') wordEvents.set(`${e.step}:${e.rep}:${e.wordIndex}`, t)
  const lags: number[] = []
  let totalWords = 0
  let early = 0
  for (const c of tl.clips) {
    if (c.kind !== 'line') continue
    c.words.forEach(([, end], wi) => {
      totalWords++
      const t = wordEvents.get(`${c.step}:${c.rep}:${wi}`)
      if (t === undefined) return
      const lag = t - end
      if (lag < -0.25) early++
      lags.push(lag)
    })
  }

  // Line done.
  const doneAt = new Map<number, number>()
  const doneReps = new Map<number, number>()
  for (const { e, t } of log.events) {
    if (e.kind === 'lineDone' && !doneAt.has(e.step)) {
      doneAt.set(e.step, t)
      doneReps.set(e.step, e.reps)
    }
  }
  let onTime = 0, earlyDone = 0, late = 0, missing = 0, totalLines = 0, beforeEnd = 0
  const doneLags: number[] = []
  let repSteps = 0, repsExact = 0, repWords = 0, repWordsSeen = 0
  steps.forEach((step, i) => {
    const lineClips = tl.clips.filter((c) => c.kind === 'line' && c.step === i)
    if (!lineClips.length) return
    totalLines++
    const last = lineClips.at(-1)!
    const lastEnd = last.words.at(-1)?.[1] ?? last.start + last.dur
    // A movement phrase can finish the line first (salam moves on as it ends).
    const left = log.actions.find((x) => x.a.type === 'goTo' && x.a.index === i + 1 && ['takbir', 'tasmi', 'salam'].includes(x.a.reason))
    const own = doneAt.get(i)
    const t = own ?? left?.t
    if (own !== undefined) {
      doneLags.push(own - lastEnd)
      if (own < lastEnd - 0.05) beforeEnd++
    }
    if (t === undefined) missing++
    else if (t < lastEnd - 0.4) earlyDone++
    else if (t > lastEnd + 3) late++
    else onTime++
    // Repetitions: counted right, and each one shown as it is said.
    if (step.repeat > 1) {
      repSteps++
      if (doneReps.get(i) === lineClips.length) repsExact++
      for (const c of lineClips) {
        repWords++
        if (wordEvents.has(`${i}:${c.rep}:${c.words.length - 1}`)) repWordsSeen++
      }
    }
  })

  // Session arrivals.
  const arrivals = new Map<number, { t: number; reason: string }>()
  for (const { a, t } of log.actions) {
    if (a.type === 'goTo' && !arrivals.has(a.index)) arrivals.set(a.index, { t, reason: a.reason })
    if (a.type === 'begin' && !arrivals.has(0)) arrivals.set(0, { t, reason: a.reason })
  }
  // When the person was ready for step i: the end of what they said for step
  // i-1, or of the movement takbir that announces step i.
  const lastWordEnd = (i: number) => {
    const c = tl.clips.filter((x) => x.kind === 'line' && x.step === i).at(-1)
    return c ? (c.words.at(-1)?.[1] ?? c.start + c.dur) : null
  }
  const readyAt = (i: number) => {
    const takbir = tl.clips.find((c) => c.kind === 'takbir' && c.step === i)
    // Moving while saying "Allahu akbar": ready once "Allahu" has been said.
    if (takbir) return takbir.words[0]?.[1] ?? takbir.start + takbir.dur / 2
    if (i === 0) return tl.clips[0]!.start
    // A line left out (amin not said): ready once the line before it was said.
    for (let j = i - 1; j >= 0; j--) {
      const end = lastWordEnd(j)
      if (end !== null) return end
    }
    return null
  }
  const byReason: Record<string, number> = {}
  const arrivalLags: number[] = []
  let premature = 0
  let lateArrivals = 0
  for (const [i, { t, reason }] of arrivals) {
    byReason[reason] = (byReason[reason] ?? 0) + 1
    const ready = readyAt(i)
    if (ready === null) continue
    const lag = t - ready
    arrivalLags.push(lag)
    if (lag < -0.3) premature++
    if (lag > 3) lateArrivals++
  }
  const finish = log.actions.find((x) => x.a.type === 'finish')
  if (finish) byReason[finish.a.reason] = (byReason[finish.a.reason] ?? 0) + 1

  // Keywords.
  const byKind: ReplayMetrics['keywords']['byKind'] = {}
  for (const k of ['takbir', 'tasmi', 'salam', 'amin']) byKind[k] = { truth: tl.keywords.filter((w) => w.kind === k).length, hit: 0, false: 0 }
  const used = new Set<number>()
  let falseEvents = 0
  // The opening takbir is the first line of the prayer: it is heard when it
  // begins the prayer (it is followed as a line, not reported as a keyword).
  const opening = tl.keywords.findIndex((w) => w.kind === 'takbir')
  const begin = log.actions.find((x) => x.a.type === 'begin')
  if (opening === 0 && begin && begin.t >= tl.keywords[0]!.start - 0.3 && begin.t <= tl.keywords[0]!.end + 2.5) {
    used.add(0)
    byKind.takbir!.hit++
  }
  for (const { e, t } of log.events) {
    if (!(e.kind in byKind)) continue
    const hit = tl.keywords.findIndex((w, wi) => !used.has(wi) && w.kind === e.kind && t >= w.start - 0.3 && t <= w.end + 2.5)
    if (hit >= 0) {
      used.add(hit)
      byKind[e.kind]!.hit++
    } else {
      byKind[e.kind]!.false++
      falseEvents++
    }
  }
  const minutes = tl.duration / 60
  return {
    words: { total: totalWords, reported: lags.length, recall: r2(lags.length / Math.max(1, totalWords)), lagP50: r2(pct(lags, 50)), lagP95: r2(pct(lags, 95)), lagMax: r2(Math.max(...lags)), early },
    lineDone: {
      total: totalLines,
      onTime,
      early: earlyDone,
      late,
      missing,
      accuracy: r2(onTime / Math.max(1, totalLines)),
      beforeEnd,
      lagP50: r2(pct(doneLags, 50)),
      lagP95: r2(pct(doneLags, 95)),
    },
    reps: { steps: repSteps, countExact: repsExact, repsShown: r2(repWordsSeen / Math.max(1, repWords)) },
    session: {
      steps: steps.length,
      arrivals: arrivals.size,
      premature,
      late: lateArrivals,
      arrivalLagP50: r2(pct(arrivalLags, 50)),
      arrivalLagP95: r2(pct(arrivalLags, 95)),
      byReason,
      completed: log.phase === 'complete',
    },
    keywords: {
      takbirTotal: byKind.takbir!.truth,
      takbirHit: byKind.takbir!.hit,
      takbirRecall: r2(byKind.takbir!.hit / Math.max(1, byKind.takbir!.truth)),
      falseEvents,
      falsePerMin: r2(falseEvents / minutes),
      byKind,
    },
    audioMinutes: r2(minutes),
    decodeP95Ms: r2(pct(log.decodeMs, 95)),
  }
}
