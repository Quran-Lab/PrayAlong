import { describe, expect, it } from 'vitest'
import type { Place } from './location'
import { detectPrayer, timesFor } from './prayer-times'

const mecca: Place = { latitude: 21.42, longitude: 39.83, source: 'gps' }
const at = (iso: string) => new Date(iso)

describe('detectPrayer', () => {
  const t = timesFor(mecca, at('2026-03-20T12:00:00Z'))
  const plus = (d: Date, min: number) => new Date(d.getTime() + min * 60_000)

  it('follows the day', () => {
    expect(detectPrayer(mecca, plus(t.fajr, 5)).id).toBe('fajr')
    expect(detectPrayer(mecca, plus(t.dhuhr, 5))).toMatchObject({ id: 'dhuhr', status: 'now' })
    expect(detectPrayer(mecca, plus(t.asr, 5)).id).toBe('asr')
    expect(detectPrayer(mecca, plus(t.maghrib, 5)).id).toBe('maghrib')
    expect(detectPrayer(mecca, plus(t.isha, 5)).id).toBe('isha')
  })

  it('offers Dhuhr as next between sunrise and noon', () => {
    expect(detectPrayer(mecca, plus(t.sunrise, 30))).toMatchObject({ id: 'dhuhr', status: 'next' })
  })

  it('keeps Isha after midnight until Fajr', () => {
    expect(detectPrayer(mecca, plus(t.fajr, -30))).toMatchObject({ id: 'isha', status: 'now' })
  })

  it('copes with Nordic summer nights', () => {
    const copenhagen: Place = { latitude: 55.68, longitude: 12.57, source: 'gps' }
    const times = timesFor(copenhagen, at('2026-06-21T12:00:00Z'))
    expect(times.fajr.getTime()).toBeLessThan(times.sunrise.getTime())
    expect(times.isha.getTime()).toBeGreaterThan(times.maghrib.getTime())
  })
})
