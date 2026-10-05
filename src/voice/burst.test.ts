import { describe, expect, it } from 'vitest'
import { BurstCount, briskMs, optionalWords, wordCount } from './burst'

/** Speech segments [start, end] in ms. */
function count(segments: [number, number][]) {
  const c = new BurstCount()
  for (const [a, b] of segments) {
    c.speech(true, a)
    c.speech(false, b)
  }
  c.close()
  return c
}

describe('speech-burst follow', () => {
  it('needs a brisk but humanly possible amount of speech', () => {
    // The app's reciters: takbir 1.8 s, ruku tasbih 2.3 s, sujud tasbih 2.3-2.4 s.
    expect(briskMs('takbir')).toBe(750)
    expect(briskMs('ruku')).toBe(1350)
    expect(briskMs('sujud')).toBe(1250)
  })
  it('leaves the basmala out of a surah opening, unless asked to count it', () => {
    expect(optionalWords('kawthar-1')).toBe(4)
    expect(wordCount('kawthar-1')).toBe(3)
    expect(optionalWords('takbir')).toBe(0)
    expect(briskMs('kawthar-1', true)!).toBeGreaterThan(2 * briskMs('kawthar-1')!)
  })
  it('counts one repetition per burst', () => {
    const need = briskMs('sujud')!
    expect(count([[0, 1600], [2000, 3600], [4000, 5600]]).reps(need)).toBe(3)
    expect(count([[0, 1600], [2000, 3600]]).reps(need)).toBe(2)
  })
  it('does not count one long repetition as several (owner log: 2.1 s of speech counted x3)', () => {
    expect(count([[0, 2112]]).reps(briskMs('sujud')!)).toBe(1)
  })
  it('a breath inside a line does not split it', () => {
    expect(count([[0, 900], [1100, 1800]]).reps(briskMs('sujud')!)).toBe(1)
  })
  it('a cough or a short noise is not a repetition', () => {
    expect(count([[0, 1600], [2500, 2800], [3500, 5100]]).reps(briskMs('sujud')!)).toBe(2)
  })
})
