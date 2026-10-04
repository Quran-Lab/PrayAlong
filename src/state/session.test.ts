import { beforeEach, describe, expect, it } from 'vitest'
import { useSession } from './session'

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
