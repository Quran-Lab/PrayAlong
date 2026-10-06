import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LINE_IDS } from './recitations'
import align from './align.json'
import { MESSAGES } from '@/i18n'

// Every line PrayAlong can show must be recited by every companion, and
// every spoken instruction must exist in every language: new content without
// its audio leaves Teach me silent.
const manifest = JSON.parse(readFileSync('public/audio/manifest.json', 'utf8')) as {
  voices: Record<string, { lines: Record<string, unknown>; guide: Record<string, Record<string, unknown>> }>
}

describe('content coverage', () => {
  it('every line has a clip in every companion voice', () => {
    for (const [voice, v] of Object.entries(manifest.voices)) expect(LINE_IDS.filter((id) => !v.lines[id]), voice).toEqual([])
  })
  it('every spoken instruction has a clip in every language and voice', () => {
    const keys = Object.keys(MESSAGES.en).filter((k) => k.startsWith('voice.'))
    for (const [voice, v] of Object.entries(manifest.voices))
      for (const locale of Object.keys(MESSAGES)) expect(keys.filter((k) => !v.guide[locale]?.[k]), `${voice} ${locale}`).toEqual([])
  })
  it('every line has a word alignment in every language', () => {
    for (const [locale, lines] of Object.entries(align as Record<string, Record<string, unknown>>))
      expect(LINE_IDS.filter((id) => !lines[id] && id !== 'takbir'), locale).toEqual([])
  })
})
