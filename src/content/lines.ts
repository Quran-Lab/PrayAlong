import type { Locale } from '@/i18n/locales'
import { ADHKAR } from './adhkar'
import quranEn from './quran/en.json'
import { getLine, isQuran, QURAN_REFS } from './recitations'
import { SOURCES, type Source } from './sources'

interface QuranEdition {
  edition: string
  credit: string
  verses: Record<string, string>
}

/** English ships with the app; other editions load with their language. */
const QURAN: Partial<Record<Locale, QuranEdition>> = { en: quranEn }
const EDITIONS = import.meta.glob<QuranEdition>('./quran/*.json', { import: 'default' })

export async function loadQuran(locale: Locale) {
  if (!QURAN[locale]) QURAN[locale] = await EDITIONS[`./quran/${locale}.json`]!()
}
const edition = (locale: Locale): QuranEdition => QURAN[locale] ?? quranEn

export interface ResolvedLine {
  arabic: string
  transliteration: string
  /** What it means, in the reader's language ('' for Arabic readers). */
  meaning: string
  /** e.g. "1:1" for Quran lines. */
  ref?: string
  /** Who translated the meaning, for Quran lines. */
  credit?: string
  /** Where the line comes from: the verse, or the narration. */
  source?: Source
}

export function resolveLine(id: string, locale: Locale): ResolvedLine {
  const line = getLine(id)
  const ref = QURAN_REFS[id as keyof typeof QURAN_REFS]
  const source: Source | undefined = ref ? { refs: [['quran', ref]] } : SOURCES[id as keyof typeof SOURCES]
  if (locale === 'ar') return { ...line, meaning: '', ref, source }
  if (isQuran(id)) {
    const e = edition(locale)
    return { ...line, meaning: e.verses[id] ?? quranEn.verses[id as keyof typeof quranEn.verses], ref, credit: e.credit, source }
  }
  return { ...line, meaning: ADHKAR[locale]?.[id] ?? ADHKAR.en?.[id] ?? '', source }
}

export const quranCredit = (locale: Locale) => edition(locale).credit
