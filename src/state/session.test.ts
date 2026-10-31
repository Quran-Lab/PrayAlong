import { beforeEach, describe, expect, it } from 'vitest'
import { display, useSession } from './session'

const s = () => useSession.getState()

describe('hands-free session flow', () => {
  beforeEach(() => s().choosePrayer('fajr'))

  it('starts on raised hands and follows the body, never skipping ahead', () => {
    s().onPose('standing')
    expect(s().phase).toBe('ready')
    s().onPose('hands-raised')
    expect(s().phase).toBe('praying')

    s().onPose('standing') // hands folded
    expect(s().sequence.steps[s().index]!.posture).toBe('qiyam')

    s().onPose('prostrating') // not the next movement (ruku is) — ignored
    expect(s().sequence.steps[s().index]!.posture).toBe('qiyam')

    s().onPose('bowing')
    expect(s().sequence.steps[s().index]!.posture).toBe('ruku')
    s().onPose('standing')
    expect(s().sequence.steps[s().index]!.posture).toBe('itidal')
    s().onPose('prostrating')
    expect(s().sequence.steps[s().index]!.posture).toBe('sujud')
    s().onPose('sitting')
    expect(s().sequence.steps[s().index]!.posture).toBe('jalsah')
  })

  it('finishes after the last line', () => {
    s().begin()
    s().goTo(s().sequence.steps.length - 1)
    s().next()
    expect(s().phase).toBe('complete')
  })

  it('follows the clock only until the user chooses', () => {
    s().restart()
    useSession.setState({ prayerSource: 'auto' })
    s().autoSelectPrayer('asr')
    expect(s().prayer).toBe('asr')
    s().choosePrayer('isha')
    s().autoSelectPrayer('maghrib')
    expect(s().prayer).toBe('isha')
  })
})

describe('display', () => {
  const base = useSession.getState().settings

  it('follows the reader by default', () => {
    expect(display({ ...base, arabic: null, transliteration: null, translation: null }, 'en')).toEqual({ arabic: false, transliteration: true, translation: true })
    expect(display({ ...base, arabic: null, transliteration: null, translation: null }, 'ar')).toMatchObject({ arabic: true, transliteration: false })
  })

  it('never leaves a line with nothing to read after a language change', () => {
    // Chosen in English (Arabic and meaning off), then Urdu, where pronunciation is off by default.
    expect(display({ ...base, arabic: false, transliteration: null, translation: false }, 'ur')).toMatchObject({ arabic: true })
    // Only a meaning, then Arabic (which has no meaning line).
    expect(display({ ...base, arabic: false, transliteration: false, translation: true }, 'ar')).toMatchObject({ arabic: true })
    expect(display({ ...base, arabic: false, transliteration: false, translation: false }, 'de')).toMatchObject({ transliteration: true })
    // A real choice is kept.
    expect(display({ ...base, arabic: false, transliteration: false, translation: true }, 'en')).toEqual({ arabic: false, transliteration: false, translation: true })
  })
})
