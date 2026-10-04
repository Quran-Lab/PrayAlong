import { CalculationMethod, Coordinates, HighLatitudeRule, PrayerTimes } from 'adhan'
import type { PrayerId } from '@/sequence/types'
import type { Place } from './location'

export type DayTimes = Record<PrayerId, Date> & { sunrise: Date }

export function timesFor(place: Place, date = new Date()): DayTimes {
  const coords = new Coordinates(place.latitude, place.longitude)
  const params = CalculationMethod.MuslimWorldLeague()
  // Nordic summers have no true night; this keeps Fajr/Isha sensible.
  params.highLatitudeRule = HighLatitudeRule.recommended(coords)
  const t = new PrayerTimes(coords, date, params)
  return { fajr: t.fajr, sunrise: t.sunrise, dhuhr: t.dhuhr, asr: t.asr, maghrib: t.maghrib, isha: t.isha }
}

export interface DetectedPrayer {
  id: PrayerId
  /** "now" while its time is running; "next" in the gap between sunrise and Dhuhr. */
  status: 'now' | 'next'
  startsAt: Date
  /** When this prayer's window closes (start of the next one, or sunrise for Fajr). */
  endsAt: Date
}

const DAY = 24 * 60 * 60 * 1000

/** The prayer the user most likely wants to pray right now. */
export function detectPrayer(place: Place, now = new Date()): DetectedPrayer {
  const today = timesFor(place, now)
  const at = now.getTime()

  if (at < today.fajr.getTime()) {
    // After midnight, before Fajr: last night's Isha is still on.
    const yesterday = timesFor(place, new Date(at - DAY))
    return { id: 'isha', status: 'now', startsAt: yesterday.isha, endsAt: today.fajr }
  }
  if (at < today.sunrise.getTime()) return { id: 'fajr', status: 'now', startsAt: today.fajr, endsAt: today.sunrise }
  if (at < today.dhuhr.getTime()) return { id: 'dhuhr', status: 'next', startsAt: today.dhuhr, endsAt: today.asr }
  if (at < today.asr.getTime()) return { id: 'dhuhr', status: 'now', startsAt: today.dhuhr, endsAt: today.asr }
  if (at < today.maghrib.getTime()) return { id: 'asr', status: 'now', startsAt: today.asr, endsAt: today.maghrib }
  if (at < today.isha.getTime()) return { id: 'maghrib', status: 'now', startsAt: today.maghrib, endsAt: today.isha }
  const tomorrow = timesFor(place, new Date(at + DAY))
  return { id: 'isha', status: 'now', startsAt: today.isha, endsAt: tomorrow.fajr }
}

export const formatTime = (date: Date) =>
  date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
