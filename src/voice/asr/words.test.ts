import { describe, expect, it } from 'vitest'
import { getLine } from '@/content/recitations'
import FIX from './fixtures.json'
import { arabicWords, trackable, wordsHeard } from './words'

const heard = FIX.tokens as Record<string, string[]>
/** The clips PrayAlong plays as examples (qari surahs and the dhikr recordings). */
const shipped = FIX.app as Record<string, string[]>

describe('word-by-word ASR follow', () => {
  it('lights every word of a line that was recited (qari and real dhikr recordings)', () => {
    for (const [id, tokens] of Object.entries(heard)) {
      const arabic = getLine(id).arabic
      expect(wordsHeard(id, arabic, tokens), id).toBe(arabicWords(arabic).length)
    }
  })

  it('lights every word of every example clip it follows', () => {
    const followed = Object.keys(shipped).filter(trackable)
    expect(followed).toEqual(expect.arrayContaining(['ikhlas-1', 'falaq-5', 'takbir', 'tashahhud-2', 'salam']))
    for (const id of followed) {
      const arabic = getLine(id).arabic
      expect(wordsHeard(id, arabic, shipped[id]!), id).toBe(arabicWords(arabic).length)
    }
  })

  it('lights nothing for a different line', () => {
    expect(wordsHeard('falaq-1', getLine('falaq-1').arabic, shipped['ikhlas-3']!)).toBe(0)
    expect(wordsHeard('ikhlas-2', getLine('ikhlas-2').arabic, shipped['falaq-2']!)).toBe(0)
    expect(wordsHeard('fatiha-4', getLine('fatiha-4').arabic, heard['fatiha-2']!)).toBe(0)
    expect(wordsHeard('ruku', getLine('ruku').arabic, heard['tasmi']!)).toBe(0)
    expect(wordsHeard('salam', getLine('salam').arabic, heard['takbir']!)).toBe(0)
  })

  it('lights only the words said so far', () => {
    const half = heard['fatiha-7']!.slice(0, 16)
    const n = wordsHeard('fatiha-7', getLine('fatiha-7').arabic, half)
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThan(arabicWords(getLine('fatiha-7').arabic).length)
  })

  it('follows only lines it has a target for', () => {
    expect(trackable('fatiha-1')).toBe(true)
    expect(trackable('tashahhud-4')).toBe(true)
    expect(trackable('ikhlas-1')).toBe(true)
    expect(trackable('falaq-3')).toBe(true)
    expect(trackable('kawthar-1')).toBe(false)
    expect(trackable('thana-1')).toBe(false)
  })
})
