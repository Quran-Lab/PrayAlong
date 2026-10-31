import { describe, expect, it } from 'vitest'
import align from '@/content/align.json'
import phonemes from '@/content/phonemes.json'
import { getLine } from '@/content/recitations'

const LINES = (phonemes as { lines: Record<string, { words: string[]; optional?: number }> }).lines
const ALIGN = align as unknown as Record<string, Record<string, { t: unknown[] }>>

/**
 * The optional basmala before a surah is part of the verse as shown (Tanzil
 * text) and as heard (the follower's words), so a heard word index points at
 * the same Arabic word on screen — no offset between them.
 */
describe('surah openings with an optional basmala', () => {
  const withBasmala = Object.entries(LINES).filter(([, l]) => (l.optional ?? 0) > 0)

  it('exist', () => expect(withBasmala.length).toBeGreaterThan(0))

  it.each(withBasmala.map(([id, l]) => [id, l.optional!, l.words.length] as const))('%s shows its %i basmala words in the Arabic', (id, optional, words) => {
    const arabic = getLine(id).arabic.split(/\s+/).filter(Boolean)
    expect(arabic.length).toBe(words)
    // Letters only (diacritics are encoded differently across sources).
    const letters = (x: string) => x.normalize('NFC').replace(/[\u064B-\u065F\u0670\u06E1]/g, '')
    expect(letters(arabic.slice(0, optional).join(' '))).toBe(letters('بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ'))
    // The basmala words link to nothing in the pronunciation line.
    expect(ALIGN.en?.[id]?.t.slice(0, optional).every((x) => x === null)).toBe(true)
  })
})
