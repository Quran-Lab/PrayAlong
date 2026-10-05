import { beforeEach, describe, expect, it } from 'vitest'
import { Session } from './session.svelte'

let s: Session

describe('hands-free session flow', () => {
  beforeEach(() => {
    s = new Session()
    s.choosePrayer('fajr')
  })

  it('starts on raised hands and follows the body, never skipping ahead', () => {
    s.onPose('standing')
    expect(s.phase).toBe('ready')
    s.onPose('hands-raised')
    expect(s.phase).toBe('praying')

    s.onPose('standing') // hands folded
    expect(s.step.posture).toBe('qiyam')

    s.onPose('prostrating') // not the next movement (ruku is) — ignored
    expect(s.step.posture).toBe('qiyam')

    s.onPose('bowing')
    expect(s.step.posture).toBe('ruku')
    s.onPose('standing')
    expect(s.step.posture).toBe('itidal')
    s.onPose('prostrating')
    expect(s.step.posture).toBe('sujud')
    s.onPose('sitting')
    expect(s.step.posture).toBe('jalsah')
  })

  it('counts raised hands as standing when rising from ruku, but not right after the opening takbir', () => {
    s.onPose('hands-raised')
    s.onPose('hands-raised') // still the takbir: no skipping into the opening
    expect(s.step.posture).toBe('takbir')
    s.onPose('standing')
    s.onPose('bowing')
    s.onPose('hands-raised') // rising with the hands raised (sami‘allāhu liman hamidah)
    expect(s.step.posture).toBe('itidal')
  })

  it('finishes after the last line', () => {
    s.begin()
    s.goTo(s.sequence.steps.length - 1)
    s.next()
    expect(s.phase).toBe('complete')
  })

  it('follows the clock only until the user chooses', () => {
    const fresh = new Session()
    fresh.autoSelectPrayer('asr')
    expect(fresh.prayer).toBe('asr')
    fresh.choosePrayer('isha')
    fresh.autoSelectPrayer('maghrib')
    expect(fresh.prayer).toBe('isha')
  })
})
