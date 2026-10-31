import { CalculationMethod, Coordinates, HighLatitudeRule, Madhab, PrayerTimes } from 'adhan'
import type { PrayerId } from '@/sequence/types'
import type { Place } from './location'
import type { Locale } from '@/i18n/locales'

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

/** The authorities' names where the Latin ones would stand out (right-to-left scripts). */
const METHOD_NAMES_LOCAL: Partial<Record<Locale, Partial<Record<MethodId, string>>>> = {
  ar: {
    MuslimWorldLeague: 'رابطة العالم الإسلامي',
    Egyptian: 'الهيئة المصرية العامة للمساحة',
    Karachi: 'جامعة العلوم الإسلامية، كراتشي',
    UmmAlQura: 'أم القرى، مكة المكرمة',
    Dubai: 'دبي',
    MoonsightingCommittee: 'لجنة رؤية الهلال',
    NorthAmerica: 'الجمعية الإسلامية لأمريكا الشمالية',
    Kuwait: 'الكويت',
    Qatar: 'قطر',
    Tehran: 'طهران',
    Turkey: 'رئاسة الشؤون الدينية التركية',
    Other: 'مخصص',
  },
  ur: {
    MuslimWorldLeague: 'مسلم ورلڈ لیگ',
    Egyptian: 'مصری جنرل اتھارٹی',
    Karachi: 'جامعہ علومِ اسلامیہ، کراچی',
    UmmAlQura: 'ام القریٰ، مکہ مکرمہ',
    Dubai: 'دبئی',
    MoonsightingCommittee: 'رؤیتِ ہلال کمیٹی',
    Kuwait: 'کویت',
    Qatar: 'قطر',
    Tehran: 'تہران',
    Turkey: 'دیانت',
    Other: 'اپنی مرضی کا',
  },
}

const HANAFI_ASR: Record<Locale, string> = {
  en: 'Hanafi Asr',
  de: 'Hanafi-Asr',
  fr: 'Asr hanafite',
  es: 'Asr hanafí',
  tr: 'Hanefi ikindi',
  id: 'Asar Hanafi',
  nl: 'Hanafi-asr',
  ur: 'حنفی عصر',
  ar: 'العصر على المذهب الحنفي',
}

export function methodLabel(zone?: string, locale: Locale = 'en') {
  const { method, hanafi } = regionalMethod(zone)
  const name = METHOD_NAMES_LOCAL[locale]?.[method] ?? METHOD_NAMES[method]
  return name + (hanafi ? ` · ${HANAFI_ASR[locale]}` : '')
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

/** Noon on the calendar day `days` away (24 h steps go wrong on daylight-saving days). */
const dayFrom = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12)

/** The prayer the user most likely wants to pray right now. */
export function detectPrayer(place: Place, now = new Date(), zone?: string): DetectedPrayer {
  const today = timesFor(place, now, zone)
  const at = now.getTime()

  if (at < today.fajr.getTime()) {
    const yesterday = timesFor(place, dayFrom(now, -1), zone)
    // Summer far north or west, Isha can begin after midnight: until it does, it is still Maghrib.
    if (at < yesterday.isha.getTime()) return { id: 'maghrib', status: 'now', startsAt: yesterday.maghrib, endsAt: yesterday.isha }
    // After midnight, before Fajr: last night's Isha is still on.
    return { id: 'isha', status: 'now', startsAt: yesterday.isha, endsAt: today.fajr }
  }
  if (at < today.sunrise.getTime()) return { id: 'fajr', status: 'now', startsAt: today.fajr, endsAt: today.sunrise }
  if (at < today.dhuhr.getTime()) return { id: 'dhuhr', status: 'next', startsAt: today.dhuhr, endsAt: today.asr }
  if (at < today.asr.getTime()) return { id: 'dhuhr', status: 'now', startsAt: today.dhuhr, endsAt: today.asr }
  if (at < today.maghrib.getTime()) return { id: 'asr', status: 'now', startsAt: today.asr, endsAt: today.maghrib }
  if (at < today.isha.getTime()) return { id: 'maghrib', status: 'now', startsAt: today.maghrib, endsAt: today.isha }
  const tomorrow = timesFor(place, dayFrom(now, 1), zone)
  return { id: 'isha', status: 'now', startsAt: today.isha, endsAt: tomorrow.fajr }
}

/** A prayer time in the app's language (5:32 AM, 05:32, ٥:٣٢ ص ...), not the system's. */
export const formatTime = (date: Date, locale?: string) => date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
