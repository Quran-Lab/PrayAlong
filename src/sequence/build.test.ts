import Ajv2020 from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'
import { PRAYERS } from '@/content/prayers'
import { getLine } from '@/content/recitations'
import { resolveLine } from '@/content/lines'
import { LOCALES, type Locale } from '@/i18n/locales'
import { buildSequence, nextPoseChange, postureSegments } from './build'
import schema from './schema.json'

const validate = new Ajv2020({ allErrors: true }).compile(schema)

describe('buildSequence', () => {
  it.each(PRAYERS.map((p) => [p.id, p.rakahs] as const))('%s matches the JSON schema and has %i rak‘ahs', (id, rakahs) => {
    const seq = buildSequence(id)
    expect(validate(seq), JSON.stringify(validate.errors)).toBe(true)
    expect(seq.rakahs).toBe(rakahs)
    expect(new Set(seq.steps.map((s) => s.rakah)).size).toBe(rakahs)
  })

  it('every line has real text', () => {
    for (const p of PRAYERS) for (const s of buildSequence(p.id).steps) expect(getLine(s.recitationId).arabic.length).toBeGreaterThan(0)
  })

  it('opens with takbir and ends with both salams', () => {
    const steps = buildSequence('dhuhr').steps
    expect(steps[0]!.posture).toBe('takbir')
    expect(steps.at(-2)!.posture).toBe('salam-right')
    expect(steps.at(-1)!.posture).toBe('salam-left')
  })

  it('recites Al-Fatiha in every rak‘ah but a surah only in the first two', () => {
    const steps = buildSequence('isha').steps
    for (let r = 1; r <= 4; r++) {
      const lines = steps.filter((s) => s.rakah === r).map((s) => s.recitationId)
      expect(lines).toContain('fatiha-1')
      expect(lines.some((l) => l.startsWith('kawthar') || l.startsWith('ikhlas'))).toBe(r <= 2)
    }
  })

  it('has two prostrations per rak‘ah with a sitting between', () => {
    const segments = postureSegments(buildSequence('fajr').steps).filter((s) => s.rakah === 1).map((s) => s.posture)
    expect(segments).toEqual(['takbir', 'qiyam', 'ruku', 'itidal', 'sujud', 'jalsah', 'sujud'])
  })

  it('sits for the middle tashahhud only in 3- and 4-rak‘ah prayers', () => {
    const middle = (id: 'fajr' | 'maghrib') => buildSequence(id).steps.some((s) => s.rakah === 2 && s.recitationId === 'tashahhud-1')
    expect(middle('maghrib')).toBe(true)
    expect(middle('fajr')).toBe(true) // Fajr's 2nd rak'ah *is* the final sitting
    expect(buildSequence('maghrib').steps.some((s) => s.rakah === 2 && s.recitationId === 'salawat-1')).toBe(false)
  })

  it('recites aloud only where the prayer is aloud', () => {
    const quiet = buildSequence('dhuhr').steps.filter((s) => s.recitationId === 'fatiha-1')
    expect(quiet.every((s) => s.voice === 'quiet')).toBe(true)
    const maghrib = buildSequence('maghrib').steps.filter((s) => s.recitationId === 'fatiha-1').map((s) => s.voice)
    expect(maghrib).toEqual(['aloud', 'aloud', 'quiet'])
  })
})

describe('content', () => {
  it('has a meaning for every line in every language (English as the floor)', () => {
    const ids = new Set(PRAYERS.flatMap((p) => buildSequence(p.id).steps.map((s) => s.recitationId)))
    for (const locale of Object.keys(LOCALES) as Locale[]) {
      for (const id of ids) {
        const line = resolveLine(id, locale)
        expect(line.transliteration).not.toBe('')
        if (locale !== 'ar') expect(line.meaning, `${locale} ${id}`).not.toBe('')
      }
    }
  })

  it('uses Saheeh International for English Quran lines', () => {
    expect(resolveLine('fatiha-1', 'en')).toMatchObject({
      meaning: 'In the name of Allah, the Entirely Merciful, the Especially Merciful',
      credit: 'Saheeh International',
      ref: '1:1',
    })
  })
})

describe('nextPoseChange', () => {
  it('skips lines in the same pose and finds the next movement', () => {
    const steps = buildSequence('dhuhr').steps
    const qiyam = steps.findIndex((s) => s.posture === 'qiyam')
    const next = nextPoseChange(steps, qiyam)
    expect(steps[next]!.posture).toBe('ruku')
  })
})
