import { describe, expect, it } from 'vitest'
import phonemeTable from '@/content/phonemes.json'
import { buildSequence } from '@/sequence/build'
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
  buildSequence(prayer).steps.map((s) => ({ lineId: s.recitationId, repeat: s.repeat, voice: s.voice }))

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
    expect(keywords(events)).toContain('tasmi')
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
})

describe('Keyword spotter', () => {
  const fajr = stepsOf('fajr')

  it('hears the movement phrases', () => {
    for (const [line, kind] of [['takbir', 'takbir'], ['tasmi', 'tasmi'], ['salam', 'salam'], ['amin', 'amin']] as const) {
      const f = new Follower(fajr)
      const evs: FollowerEvent[] = []
      feed(f, tokensOf(line), 0, evs)
      expect(keywords(evs)).toContain(kind)
    }
  })

  it('does not hear takbir or salam in lines that only resemble them', () => {
    const lookalikes = ['thana-1', 'salawat-1', 'salawat-3', 'ikhlas-2', 'tashahhud-2', 'tashahhud-3', 'tashahhud-4', 'fatiha-1', 'taawwudh']
    for (const line of lookalikes) {
      // The session is on that line (the follower only ever listens around it).
      const f = new Follower(fajr)
      f.setAnchor(fajr.findIndex((s) => s.lineId === line))
      const evs: FollowerEvent[] = []
      feed(f, tokensOf(line), 0, evs)
      expect(keywords(evs).filter((k) => k === 'takbir' || k === 'salam'), line).toEqual([])
    }
  })

  it('hears each takbir once, even back to back', () => {
    const f = new Follower(fajr)
    const evs: FollowerEvent[] = []
    let at = feed(f, tokensOf('takbir'), 0, evs)
    f.segmentEnd()
    feed(f, tokensOf('takbir'), at + 1, evs)
    expect(keywords(evs).filter((k) => k === 'takbir')).toHaveLength(2)
  })

  it('hears takbir through 15% noise in most takes', () => {
    let hits = 0
    for (let seed = 1; seed <= 20; seed++) {
      const f = new Follower(fajr)
      const evs: FollowerEvent[] = []
      feed(f, corrupt(tokensOf('takbir', rng(seed)), 0.15, rng(seed + 100)), 0, evs)
      if (keywords(evs).includes('takbir')) hits++
    }
    expect(hits).toBeGreaterThanOrEqual(14)
  })
})
