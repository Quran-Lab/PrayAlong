import type { RecitationId } from './recitations'

/**
 * The narration behind each line, shown under it. Hadith numbers follow the
 * common numbering (al-Bukhari: Fath al-Bari; Muslim: Fu'ad 'Abd al-Baqi),
 * which sunnah.com also uses. The main reference for the prayer as a whole is
 * Sifat Salat an-Nabi ﷺ by Shaykh Muhammad Nasiruddin al-Albani.
 *
 * NOTE: religious text — have every reference checked by someone qualified
 * before release (docs/content.md).
 */
export type Collection = 'quran' | 'bukhari' | 'muslim' | 'abuDawud' | 'tirmidhi' | 'nasai' | 'ibnMajah'

export interface Source {
  /** [collection, number] — for the Quran, "surah:verse". */
  refs: readonly (readonly [Collection, string])[]
  /** Graded sahih by al-Albani (said for narrations outside al-Bukhari and Muslim). */
  albani?: boolean
}

/** Takbir at every change of posture: Abu Hurayrah's description of the Prophet's prayer ﷺ. */
const TAKBIRS: Source = { refs: [['bukhari', '789'], ['muslim', '392']] }
const IBN_MASUD_TASHAHHUD: Source = { refs: [['bukhari', '831'], ['muslim', '402']] }
const SALAWAT: Source = { refs: [['bukhari', '3370']] }
const REFUGE: Source = { refs: [['muslim', '588']] }

export const SOURCES: Partial<Record<RecitationId, Source>> = {
  // "When you stand for the prayer, say takbir" — the man who prayed badly.
  takbir: { refs: [['bukhari', '757'], ['muslim', '397']] },
  'thana-1': { refs: [['abuDawud', '776'], ['tirmidhi', '243']], albani: true },
  'thana-2': { refs: [['abuDawud', '776'], ['tirmidhi', '243']], albani: true },
  taawwudh: { refs: [['quran', '16:98']] },
  amin: { refs: [['bukhari', '780'], ['muslim', '410']] },
  ruku: { refs: [['muslim', '772']] },
  tasmi: TAKBIRS,
  tahmid: TAKBIRS,
  sujud: { refs: [['muslim', '772']] },
  jalsah: { refs: [['abuDawud', '850'], ['tirmidhi', '284'], ['ibnMajah', '898']], albani: true },
  'tashahhud-1': IBN_MASUD_TASHAHHUD,
  // What the Companions said once the Prophet ﷺ had passed away (Ibn Mas'ud).
  'tashahhud-2': { refs: [['bukhari', '6265']] },
  'tashahhud-3': IBN_MASUD_TASHAHHUD,
  'tashahhud-4': IBN_MASUD_TASHAHHUD,
  'salawat-1': SALAWAT,
  'salawat-2': SALAWAT,
  'salawat-3': SALAWAT,
  'salawat-4': SALAWAT,
  'refuge-1': REFUGE,
  'refuge-2': REFUGE,
  salam: { refs: [['abuDawud', '996'], ['tirmidhi', '295']], albani: true },
  istighfar: { refs: [['muslim', '591']] },
  'antas-salam': { refs: [['muslim', '591']] },
}
