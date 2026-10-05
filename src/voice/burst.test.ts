import { describe, expect, it } from 'vitest'
import { briskMs, optionalWords, wordCount } from './burst'

describe('speech-burst follow', () => {
  it('needs only a brisk amount of speech for short lines', () => {
    expect(briskMs('takbir')).toBeGreaterThanOrEqual(350)
    expect(briskMs('takbir')!).toBeLessThan(700)
    expect(briskMs('ruku')!).toBeLessThan(1000)
  })
  it('leaves the basmala out of a surah opening', () => {
    expect(optionalWords('kawthar-1')).toBe(4)
    expect(wordCount('kawthar-1')).toBe(3)
    expect(optionalWords('takbir')).toBe(0)
  })
})
