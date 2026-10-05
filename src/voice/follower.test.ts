import { describe, expect, it } from 'vitest'
import phonemeTable from '@/content/phonemes.json'
import { buildSequence } from '@/sequence/build'
import { followSteps } from './core'
import { Follower, skeletonOf } from './follower'
import { lineSkeleton, skeletonChars } from './phonetic'
import type { FollowerEvent, FollowStep } from './types'

const LINES = (phonemeTable as { lines: Record<string, { words: string[] }> }).lines

/** Seeded PRNG so noise tests are reproducible. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const ALPHABET = [...new Set(Object.values(LINES).flatMap((l) => l.words.flatMap((w) => [...w])))]

/** A line as decoder tokens (1-3 characters each, like the real vocabulary). */
function tokensOf(lineId: string, rand = rng(1)): string[] {
  const text = LINES[lineId]!.words.join('')
  const out: string[] = []
  let i = 0
  const chars = [...text]
  while (i < chars.length) {
    const n = 1 + Math.floor(rand() * 3)
    out.push(chars.slice(i, i + n).join(''))
    i += n
  }
  return out
}

/** Corrupt a token stream: substitute, drop and insert characters at `rate`. */
function corrupt(tokens: string[], rate: number, rand: () => number): string[] {
  const out: string[] = []
  for (const tok of tokens) {
    let t = ''
    for (const ch of tok) {
      const r = rand()
      if (r < rate / 3) continue // deletion
      if (r < (2 * rate) / 3) t += ALPHABET[Math.floor(rand() * ALPHABET.length)]! // substitution
      else t += ch
      if (rand() < rate / 3) t += ALPHABET[Math.floor(rand() * ALPHABET.length)]! // insertion
    }
    if (t) out.push(t)
  }
  return out
}

const stepsOf = (prayer: Parameters<typeof buildSequence>[0]): FollowStep[] =>
  followSteps(buildSequence(prayer).steps)

/** Feed tokens a few at a time (as the worker publishes), collecting events. */
function feed(f: Follower, tokens: string[], t0: number, events: FollowerEvent[], dt = 0.1) {
  let at = t0
  for (let i = 0; i < tokens.length; i += 2) {
    at += dt
    events.push(...f.push(tokens.slice(i, i + 2), at))
  }
  return at
}

/** Like the driver: whenever the follower finishes the anchored line, move on. */
function follow(f: Follower, events: FollowerEvent[]) {
  for (const e of events) if (e.kind === 'lineDone') f.setAnchor(e.step + 1)
}

function run(steps: FollowStep[], anchor: number, script: string[][], opts?: { rate?: number; seed?: number }) {
  const f = new Follower(steps)
  f.setAnchor(anchor)
  const all: FollowerEvent[] = []
  let at = 0
  const rand = rng(opts?.seed ?? 7)
  for (const tokens of script) {
    const evs: FollowerEvent[] = []
    at = feed(f, opts?.rate ? corrupt(tokens, opts.rate, rand) : tokens, at, evs)
    evs.push(...f.flush(at))
    // Silence after the utterance, as the worker reports it (10 Hz).
    for (let k = 1; k <= 6; k++) evs.push(...f.level(at + k * 0.1, false))
    follow(f, evs)
    all.push(...evs)
    f.segmentEnd()
    at += 1
  }
  return all
}

const done = (events: FollowerEvent[]) => events.filter((e) => e.kind === 'lineDone').map((e) => (e as { step: number }).step)
const keywords = (events: FollowerEvent[]) => events.filter((e) => ['takbir', 'tasmi', 'salam', 'amin'].includes(e.kind)).map((e) => e.kind)

describe('phonetic skeleton', () => {
  it('collapses madd lengths and geminates', () => {
    expect(skeletonChars('ررَحِۦۦۦۦم').join('')).toBe('ررَحِِِِِم')
    const sk = lineSkeleton(['ررَحِۦۦۦۦم'])
    expect(sk.symbols.join('')).toBe('رَحِم')
  })

  it('has targets for every line in every prayer', () => {
    for (const prayer of ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const) {
      for (const s of buildSequence(prayer).steps) expect(skeletonOf(s.recitationId)?.symbols.length).toBeGreaterThan(3)
    }
  })
})

describe('Follower', () => {
  const fajr = stepsOf('fajr')
  const idx = (lineId: string, from = 0) => fajr.findIndex((s, i) => i >= from && s.lineId === lineId)

  it('tracks Al-Fatiha line by line with every word in order', () => {
    const start = idx('fatiha-1')
    const lines = ['fatiha-1', 'fatiha-2', 'fatiha-3', 'fatiha-4', 'fatiha-5', 'fatiha-6', 'fatiha-7', 'amin']
    const events = run(fajr, start, lines.map((l) => tokensOf(l)))
    expect(done(events)).toEqual(lines.map((_, i) => start + i))
    const words = events.filter((e) => e.kind === 'word') as Extract<FollowerEvent, { kind: 'word' }>[]
    for (const l of lines) {
      const said = words.filter((w) => w.lineId === l).map((w) => w.wordIndex)
      expect(said).toEqual(LINES[l]!.words.map((_, i) => i))
    }
  })

  it('counts a tasbih said three times, and the next line moves on', () => {
    const ruku = idx('ruku')
    const events = run(fajr, ruku, [tokensOf('ruku'), tokensOf('ruku'), tokensOf('ruku'), tokensOf('tasmi'), tokensOf('tahmid')])
    expect(done(events)).toEqual([ruku, ruku + 1, ruku + 2])
    const first = events.find((e) => e.kind === 'lineDone') as Extract<FollowerEvent, { kind: 'lineDone' }>
    expect(first.reps).toBe(3)
    expect(events.some((e) => e.kind === 'lineStart' && e.lineId === 'tasmi')).toBe(true)
  })

  describe('movement phrases (takbir nodes in the expected path)', () => {
    /** The last line before a posture, then "Allahu akbar" (or not), then the new posture's line. */
    function transition(before: string, after: string, takbir: string[] | null) {
      const f = new Follower(fajr)
      f.setAnchor(idx(before))
      const evs: FollowerEvent[] = []
      let at = feed(f, tokensOf(before), 0, evs)
      for (let k = 1; k <= 4; k++) evs.push(...f.level(at + k * 0.1, false))
      f.segmentEnd()
      if (takbir) at = feed(f, takbir, at + 0.5, evs)
      for (let k = 1; k <= 4; k++) evs.push(...f.level(at + k * 0.1, false))
      f.segmentEnd()
      feed(f, tokensOf(after), at + 0.5, evs)
      return evs
    }

    it('hears the takbir between postures', () => {
      for (const [before, after] of [['kawthar-3', 'ruku'], ['tahmid', 'sujud'], ['sujud', 'jalsah']] as const) {
        expect(keywords(transition(before, after, tokensOf('takbir'))), `${before} to ${after}`).toContain('takbir')
      }
    })

    it('is fine without it: the next posture line is followed', () => {
      const evs = transition('tahmid', 'sujud', null)
      expect(keywords(evs)).toEqual([])
      expect(evs.some((e) => e.kind === 'word' && e.lineId === 'sujud')).toBe(true)
    })

    it('never hears a takbir inside a posture, however close a line sounds', () => {
      // "Allahumma barik" is a few edits from "Allahu akbar"; with no takbir
      // node inside a posture there is nothing to mistake it for.
      for (const line of ['thana-1', 'salawat-1', 'salawat-3', 'ikhlas-2', 'tashahhud-2', 'tashahhud-3', 'tashahhud-4', 'fatiha-1', 'taawwudh']) {
        const f = new Follower(fajr)
        f.setAnchor(fajr.findIndex((s) => s.lineId === line))
        const evs: FollowerEvent[] = []
        feed(f, tokensOf(line), 0, evs)
        expect(keywords(evs), line).toEqual([])
      }
    })

    it('hears the takbir through 15% noise in most takes', () => {
      let hits = 0
      for (let seed = 1; seed <= 20; seed++) {
        const evs = transition('kawthar-3', 'ruku', corrupt(tokensOf('takbir', rng(seed)), 0.15, rng(seed + 100)))
        if (keywords(evs).includes('takbir')) hits++
      }
      expect(hits).toBeGreaterThanOrEqual(14)
    })
  })

  it('accepts a tasbih said once, then the next line', () => {
    const ruku = idx('ruku')
    const events = run(fajr, ruku, [tokensOf('ruku'), tokensOf('tasmi')])
    expect(done(events)[0]).toBe(ruku)
    const first = events.find((e) => e.kind === 'lineDone') as Extract<FollowerEvent, { kind: 'lineDone' }>
    expect(first.reps).toBe(1)
  })

  it('survives a false start and a restart without double counting', () => {
    const start = idx('fatiha-2')
    const partial = tokensOf('fatiha-2').slice(0, 6)
    const events = run(fajr, start, [partial, tokensOf('fatiha-2'), tokensOf('fatiha-3')])
    expect(done(events)).toEqual([start, start + 1])
    const words = (events.filter((e) => e.kind === 'word') as Extract<FollowerEvent, { kind: 'word' }>[]).map((w) => `${w.step}:${w.wordIndex}`)
    expect(new Set(words).size).toBe(words.length)
  })

  it('a skipped line completes late and one at a time, never two lines per update', () => {
    const start = idx('thana-1')
    const f = new Follower(fajr)
    f.setAnchor(start)
    let at = 0
    const perUpdate: number[] = []
    for (const tokens of [tokensOf('thana-1'), tokensOf('taawwudh')]) {
      for (let i = 0; i < tokens.length; i += 2) {
        at += 0.1
        const evs = f.push(tokens.slice(i, i + 2), at)
        const d = evs.filter((e) => e.kind === 'lineDone') as Extract<FollowerEvent, { kind: 'lineDone' }>[]
        perUpdate.push(d.length)
        for (const e of d) f.setAnchor(e.step + 1)
      }
    }
    expect(Math.max(...perUpdate)).toBeLessThanOrEqual(1)
  })

  it('stays put on unrelated speech and noise', () => {
    const start = idx('fatiha-1')
    const rand = rng(3)
    const junk = Array.from({ length: 120 }, () => ALPHABET[Math.floor(rand() * ALPHABET.length)]!)
    const events = run(fajr, start, [junk])
    expect(done(events)).toEqual([])
    expect(keywords(events)).toEqual([])
  })

  it('tracks with 15% character noise', () => {
    const start = idx('fatiha-1')
    const lines = ['fatiha-1', 'fatiha-2', 'fatiha-3', 'fatiha-4', 'fatiha-5', 'fatiha-6', 'fatiha-7']
    for (const seed of [1, 2, 3, 4, 5]) {
      const events = run(fajr, start, lines.map((l) => tokensOf(l, rng(seed))), { rate: 0.15, seed })
      expect(done(events)).toEqual(lines.map((_, i) => start + i))
    }
  })

  it('reports the word in progress and how far through it, ending the line at fill 1', () => {
    const i = idx('fatiha-2')
    const f = new Follower(fajr)
    f.setAnchor(i)
    const text = [...LINES['fatiha-2']!.words.join('')]
    const w0 = [...LINES['fatiha-2']!.words[0]!].length
    // Half of the first word.
    f.push([text.slice(0, Math.ceil(w0 / 2)).join('')], 0.5)
    let s = f.snapshot()
    expect(s.step).toBe(i)
    expect(s.wordIndex).toBe(0)
    expect(s.fill).toBeGreaterThan(0.2)
    expect(s.fill).toBeLessThan(1)
    // The rest of the line: last word, full.
    f.push([text.slice(Math.ceil(w0 / 2)).join('')], 2)
    s = f.snapshot()
    expect(s.step).toBe(i)
    expect(s.wordIndex).toBe(LINES['fatiha-2']!.words.length - 1)
    expect(s.fill).toBe(1)
  })

  it('does not finish a line on the onset of its last word, even when that word is held long', () => {
    // Owner report: thana-2 advanced as soon as "ghayruk" began.
    const i = idx('thana-2')
    const f = new Follower(fajr)
    f.setAnchor(i)
    const words = LINES['thana-2']!.words
    const head = words.slice(0, -1).join('')
    const last = [...words.at(-1)!] // e.g. gh-a-y-r-u-k
    const evs: FollowerEvent[] = []
    let at = 0
    for (const chunk of [head.slice(0, 20), head.slice(20), last.slice(0, 3).join('')]) {
      at += 0.4
      evs.push(...f.level(at, true), ...f.push([chunk], at))
    }
    // "ghaaay..." held for two seconds: voiced, no new phonemes.
    for (let k = 0; k < 20; k++) evs.push(...f.level((at += 0.1), true))
    expect(evs.filter((e) => e.kind === 'lineDone')).toEqual([])
    expect(f.snapshot().wordIndex).toBe(words.length - 1)
    expect(f.snapshot().fill).toBeLessThan(1)
    // "...ruk", then quiet: done within a few hundred milliseconds.
    at += 0.1
    evs.push(...f.level(at, true), ...f.push([last.slice(3).join('')], at))
    const end = at
    for (let k = 1; k <= 8; k++) evs.push(...f.level(end + k * 0.1, false))
    const done = evs.find((e) => e.kind === 'lineDone') as Extract<FollowerEvent, { kind: 'lineDone' }>
    expect(done?.step).toBe(i)
    expect(done.at - end).toBeLessThanOrEqual(0.4)
  })

  describe('tasbih x3 (ruku)', () => {
    const ruku = idx('ruku')
    const reps = (f: Follower) => f.snapshot().repsDone
    const sayRuku = (f: Follower, at: number, opts: { speechAfter?: boolean; upTo?: number } = {}) => {
      const text = [...LINES.ruku!.words.join('')].slice(0, opts.upTo)
      const evs: FollowerEvent[] = []
      for (let c = 0; c < text.length; c += 3) {
        at += 0.15
        evs.push(...f.level(at, true), ...f.push([text.slice(c, c + 3).join('')], at))
      }
      return { at, evs }
    }
    const silence = (f: Follower, at: number, secs: number) => {
      const evs: FollowerEvent[] = []
      for (let k = 1; k <= secs * 10; k++) evs.push(...f.level(at + k * 0.1, false))
      return evs
    }

    it('counts three back-to-back repetitions (no pause, no segment break) and finishes after the third', () => {
      const f = new Follower(fajr)
      f.setAnchor(ruku)
      let at = 0
      const evs: FollowerEvent[] = []
      const seen: number[] = []
      for (let r = 0; r < 3; r++) {
        const out = sayRuku(f, at)
        at = out.at
        evs.push(...out.evs)
        seen.push(reps(f))
      }
      expect(seen).toEqual([1, 2, 3])
      expect(evs.filter((e) => e.kind === 'lineDone')).toEqual([])
      evs.push(...silence(f, at, 0.6))
      const done = evs.filter((e) => e.kind === 'lineDone') as Extract<FollowerEvent, { kind: 'lineDone' }>[]
      expect(done.map((d) => [d.step, d.reps])).toEqual([[ruku, 3]])
    })

    it('counts three repetitions with pauses between them', () => {
      const f = new Follower(fajr)
      f.setAnchor(ruku)
      let at = 0
      const evs: FollowerEvent[] = []
      const seen: number[] = []
      for (let r = 0; r < 3; r++) {
        const out = sayRuku(f, at)
        evs.push(...out.evs, ...silence(f, out.at, 0.7))
        f.segmentEnd()
        at = out.at + 0.7
        seen.push(reps(f))
      }
      expect(seen).toEqual([1, 2, 3])
      const done = evs.filter((e) => e.kind === 'lineDone') as Extract<FollowerEvent, { kind: 'lineDone' }>[]
      expect(done.map((d) => [d.step, d.reps])).toEqual([[ruku, 3]])
    })

    it('counts repetitions 2 and 3 even when they come out of the decoder imperfectly', () => {
      // Owner log: after the first repetition the cursor stayed at its end
      // (rep 0, last word, fill 1) while cost climbed and nothing counted.
      let ok = 0
      for (let seed = 1; seed <= 12; seed++) {
        const f = new Follower(fajr)
        f.setAnchor(ruku)
        let at = 0
        const text = LINES.ruku!.words.join('')
        for (let r = 0; r < 3; r++) {
          const toks = r === 0 ? [text] : corrupt([text], 0.25, rng(seed * 10 + r))
          for (const t of toks.join('').match(/.{1,3}/gu) ?? []) {
            at += 0.12
            f.level(at, true)
            f.push([t], at)
          }
          if (seed % 2) {
            // a breath between repetitions
            for (let k = 1; k <= 8; k++) f.level(at + k * 0.1, false)
            at += 0.8
            f.segmentEnd()
          }
        }
        for (let k = 1; k <= 8; k++) f.level(at + k * 0.1, false)
        if (f.repsOf(ruku) === 3) ok++
      }
      expect(ok).toBeGreaterThanOrEqual(11)
    })

    it('counts a third repetition that trails off quietly', () => {
      const f = new Follower(fajr)
      f.setAnchor(ruku)
      let at = 0
      const evs: FollowerEvent[] = []
      for (let r = 0; r < 2; r++) {
        const out = sayRuku(f, at)
        evs.push(...out.evs)
        at = out.at
      }
      // The third: "subhana rabbiyal a..." and the rest too soft to decode.
      const len = [...LINES.ruku!.words.join('')].length
      const out = sayRuku(f, at, { upTo: Math.round(len * 0.8) })
      evs.push(...out.evs, ...silence(f, out.at, 1.5))
      const done = evs.filter((e) => e.kind === 'lineDone') as Extract<FollowerEvent, { kind: 'lineDone' }>[]
      expect(done.map((d) => [d.step, d.reps])).toEqual([[ruku, 3]])
    })
  })

  it('locks onto a heavily accented thana-1 instead of waiting at the line start', () => {
    // Owner log: thana-1 never aligned a word while cost kept rising.
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const i = idx('thana-1')
      const f = new Follower(fajr)
      f.setAnchor(i)
      const evs: FollowerEvent[] = []
      // 30% of characters substituted/dropped/inserted: a strong accent plus decoder errors.
      const toks = corrupt(tokensOf('thana-1', rng(seed)), 0.3, rng(seed + 50))
      let at = 0
      for (const t of toks) evs.push(...f.level((at += 0.12), true), ...f.push([t], at))
      for (let k = 1; k <= 12; k++) evs.push(...f.level(at + k * 0.1, false))
      const words = evs.filter((e) => e.kind === 'word' && e.step === i).length
      expect(words, `seed ${seed}`).toBeGreaterThanOrEqual(2)
    }
  })

  it('never reports progress backwards after an external re-anchor', () => {
    const start = idx('fatiha-1')
    const f = new Follower(fajr)
    f.setAnchor(start)
    const evs: FollowerEvent[] = []
    feed(f, tokensOf('fatiha-1'), 0, evs)
    f.setAnchor(start + 3) // a timer or the camera moved on
    feed(f, tokensOf('fatiha-4'), 5, evs)
    const steps = evs.filter((e) => e.kind === 'word').map((e) => (e as { step: number }).step)
    expect(steps).toEqual([...steps].sort((a, b) => a - b))
  })

  it('finishes al-Kawthar 1 without its pausal r, even when background noise keeps the gate open', () => {
    // Owner log: cursor on "l-kawthar" at fill 0.86, no lineDone (the final r never decoded).
    const steps = stepsOf('fajr')
    const i = steps.findIndex((s) => s.lineId === 'kawthar-1')
    for (const noisy of [false, true]) {
      const f = new Follower(steps)
      f.setAnchor(i)
      const text = LINES['kawthar-1']!.words.join('')
      const evs: FollowerEvent[] = []
      const at = feed(f, [...text.slice(0, -1)].map((c) => c), 0, evs)
      let doneAt = Infinity
      for (let t = at + 0.1; t < at + 6; t += 0.1) {
        for (const e of f.level(t, noisy)) if (e.kind === 'lineDone' && e.step === i) doneAt = Math.min(doneAt, t)
      }
      for (const e of evs) if (e.kind === 'lineDone' && e.step === i) doneAt = Math.min(doneAt, at)
      expect(doneAt - at, noisy ? 'noisy gate' : 'quiet').toBeLessThan(noisy ? 3.6 : 1.6)
    }
  })

  it('counts a ruku tasbih repetition heard only as its tail ("rabbil azim")', () => {
    // Owner log: rep 1 done, then "ra l 'a Zi m" left the cursor at done 1, fill 1.
    const steps = stepsOf('fajr')
    const i = steps.findIndex((s) => s.lineId === 'ruku')
    const f = new Follower(steps)
    f.setAnchor(i)
    const evs: FollowerEvent[] = []
    let at = feed(f, tokensOf('ruku'), 0, evs)
    for (let t = at + 0.1; t < at + 0.8; t += 0.1) evs.push(...f.level(t, false))
    at += 0.8
    expect(f.snapshot().repsDone).toBe(1)
    at = feed(f, ['رَ', 'ل', 'عَ', 'ظِ', 'م'], at, evs)
    for (let t = at + 0.1; t < at + 0.8; t += 0.1) evs.push(...f.level(t, false))
    at += 0.8
    expect(f.snapshot().repsDone).toBe(2)
    at = feed(f, tokensOf('ruku'), at, evs)
    for (let t = at + 0.1; t < at + 2; t += 0.1) evs.push(...f.level(t, false))
    const done = evs.find((e) => e.kind === 'lineDone' && e.step === i) as Extract<FollowerEvent, { kind: 'lineDone' }> | undefined
    expect(done?.reps).toBe(3)
  })
})
