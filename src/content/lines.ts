import type { Locale } from '@/i18n/locales'
import { ADHKAR } from './adhkar'
import quranAr from './quran/ar.json'
import quranDe from './quran/de.json'
import quranEn from './quran/en.json'
import quranEs from './quran/es.json'
import quranFr from './quran/fr.json'
import quranId from './quran/id.json'
import quranNl from './quran/nl.json'
import quranTr from './quran/tr.json'
import quranUr from './quran/ur.json'
import { getLine, isQuran, QURAN_REFS } from './recitations'

interface QuranEdition {
  edition: string
  credit: string
  verses: Record<string, string>
}

const QURAN: Record<Locale, QuranEdition> = {
  en: quranEn, de: quranDe, fr: quranFr, es: quranEs, tr: quranTr, id: quranId, nl: quranNl, ur: quranUr, ar: quranAr,
}

export interface ResolvedLine {
  arabic: string
  transliteration: string
  /** What it means, in the reader's language ('' for Arabic readers). */
  meaning: string
  /** e.g. "1:1" for Quran lines. */
  ref?: string
  /** Who translated the meaning, for Quran lines. */
  credit?: string
}

export function resolveLine(id: string, locale: Locale): ResolvedLine {
  const line = getLine(id)
  const ref = QURAN_REFS[id as keyof typeof QURAN_REFS]
  if (locale === 'ar') return { ...line, meaning: '', ref }
  if (isQuran(id)) {
    const edition = QURAN[locale]
    return { ...line, meaning: edition.verses[id] ?? QURAN.en.verses[id]!, ref, credit: edition.credit }
  }
  return { ...line, meaning: ADHKAR[locale][id] ?? ADHKAR.en[id] ?? '' }
}

export const quranCredit = (locale: Locale) => QURAN[locale].credit
