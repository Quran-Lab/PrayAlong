import type { PrayerId } from '@/sequence/types'

export interface PrayerInfo {
  id: PrayerId
  name: string
  arabic: string
  /** Fard rak'ahs. */
  rakahs: number
  /** Rak'ahs in which Al-Fatiha and the surah are recited aloud. */
  aloudRakahs: readonly number[]
  /** Ambient hue for the stage glow (OKLCH), so each prayer feels like its time of day. */
  ambient: string
}

export const PRAYERS: readonly PrayerInfo[] = [
  { id: 'fajr', name: 'Fajr', arabic: 'الفجر', rakahs: 2, aloudRakahs: [1, 2], ambient: 'oklch(0.72 0.1 255)' },
  { id: 'dhuhr', name: 'Dhuhr', arabic: 'الظهر', rakahs: 4, aloudRakahs: [], ambient: 'oklch(0.78 0.13 165)' },
  { id: 'asr', name: 'Asr', arabic: 'العصر', rakahs: 4, aloudRakahs: [], ambient: 'oklch(0.8 0.11 80)' },
  { id: 'maghrib', name: 'Maghrib', arabic: 'المغرب', rakahs: 3, aloudRakahs: [1, 2], ambient: 'oklch(0.72 0.13 38)' },
  { id: 'isha', name: 'Isha', arabic: 'العشاء', rakahs: 4, aloudRakahs: [1, 2], ambient: 'oklch(0.66 0.12 285)' },
]

export const PRAYER_BY_ID = Object.fromEntries(PRAYERS.map((p) => [p.id, p])) as Record<PrayerId, PrayerInfo>
