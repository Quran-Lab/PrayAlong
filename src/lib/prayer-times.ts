import { CalculationMethod, Coordinates, HighLatitudeRule, Madhab, PrayerTimes } from 'adhan'
import type { PrayerId } from '@/sequence/types'
import type { Place } from './location'

export type DayTimes = Record<PrayerId, Date> & { sunrise: Date }
type MethodId = keyof typeof CalculationMethod

/**
 * Use the convention people around the user actually pray by, chosen from
 * the device time zone (Diyanet in Türkiye, Karachi in South Asia, ISNA in
 * North America…), with Hanafi Asr where that's the norm.
 */
const REGIONAL: [RegExp, MethodId, hanafi?: boolean][] = [
  [/^(Europe\/Istanbul|Asia\/Istanbul)$/, 'Turkey', true],
  [/^Asia\/(Karachi|Kolkata|Calcutta|Dhaka|Kabul|Tashkent|Samarkand|Dushanbe|Bishkek|Almaty)$/, 'Karachi', true],
  [/^(America\/(?!Sao_Paulo|Argentina|Bogota|Lima|Santiago|Caracas)|US\/|Canada\/)/, 'NorthAmerica'],
  [/^Asia\/Riyadh$/, 'UmmAlQura'],
  [/^Africa\/Cairo$/, 'Egyptian'],
  [/^Asia\/Dubai$/, 'Dubai'],
  [/^Asia\/Qatar$/, 'Qatar'],
  [/^Asia\/Kuwait$/, 'Kuwait'],
  [/^Asia\/(Singapore|Kuala_Lumpur|Kuching|Jakarta|Pontianak|Makassar|Jayapura|Brunei)$/, 'Singapore'],
  [/^Asia\/Tehran$/, 'Tehran'],
]

export const METHOD_NAMES: Record<MethodId, string> = {
  MuslimWorldLeague: 'Muslim World League',
  Egyptian: 'Egyptian General Authority',
  Karachi: 'University of Islamic Sciences, Karachi',
  UmmAlQura: 'Umm al-Qura, Makkah',
  Dubai: 'Dubai',
  MoonsightingCommittee: 'Moonsighting Committee',
  NorthAmerica: 'ISNA',
  Kuwait: 'Kuwait',
  Qatar: 'Qatar',
  Singapore: 'MUIS · JAKIM · Kemenag',
  Tehran: 'Tehran',
  Turkey: 'Diyanet',
  Other: 'Custom',
}

export function regionalMethod(zone = Intl.DateTimeFormat().resolvedOptions().timeZone): { method: MethodId; hanafi: boolean } {
  for (const [re, method, hanafi] of REGIONAL) if (re.test(zone)) return { method, hanafi: !!hanafi }
  return { method: 'MuslimWorldLeague', hanafi: false }
}

export function methodLabel(zone?: string) {
  const { method, hanafi } = regionalMethod(zone)
  return METHOD_NAMES[method] + (hanafi ? ' · Hanafi Asr' : '')
}

export function timesFor(place: Place, date = new Date(), zone?: string): DayTimes {
  const coords = new Coordinates(place.latitude, place.longitude)
  const { method, hanafi } = regionalMethod(zone)
  const params = CalculationMethod[method]()
  if (hanafi) params.madhab = Madhab.Hanafi
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
export function detectPrayer(place: Place, now = new Date(), zone?: string): DetectedPrayer {
  const today = timesFor(place, now, zone)
  const at = now.getTime()

  if (at < today.fajr.getTime()) {
    // After midnight, before Fajr: last night's Isha is still on.
    const yesterday = timesFor(place, new Date(at - DAY), zone)
    return { id: 'isha', status: 'now', startsAt: yesterday.isha, endsAt: today.fajr }
  }
  if (at < today.sunrise.getTime()) return { id: 'fajr', status: 'now', startsAt: today.fajr, endsAt: today.sunrise }
  if (at < today.dhuhr.getTime()) return { id: 'dhuhr', status: 'next', startsAt: today.dhuhr, endsAt: today.asr }
  if (at < today.asr.getTime()) return { id: 'dhuhr', status: 'now', startsAt: today.dhuhr, endsAt: today.asr }
  if (at < today.maghrib.getTime()) return { id: 'asr', status: 'now', startsAt: today.asr, endsAt: today.maghrib }
  if (at < today.isha.getTime()) return { id: 'maghrib', status: 'now', startsAt: today.maghrib, endsAt: today.isha }
  const tomorrow = timesFor(place, new Date(at + DAY), zone)
  return { id: 'isha', status: 'now', startsAt: today.isha, endsAt: tomorrow.fajr }
}

/** A prayer time in the app's language (5:32 AM, 05:32, ٥:٣٢ ص ...), not the system's. */
export const formatTime = (date: Date, locale?: string) => date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
