export const LOCALES = {
  en: { name: 'English', dir: 'ltr' },
  de: { name: 'Deutsch', dir: 'ltr' },
  fr: { name: 'Français', dir: 'ltr' },
  es: { name: 'Español', dir: 'ltr' },
  tr: { name: 'Türkçe', dir: 'ltr' },
  id: { name: 'Bahasa Indonesia', dir: 'ltr' },
  nl: { name: 'Nederlands', dir: 'ltr' },
  ur: { name: 'اردو', dir: 'rtl' },
  ar: { name: 'العربية', dir: 'rtl' },
} as const

export type Locale = keyof typeof LOCALES

/**
 * The languages offered for now. The others keep their files and come back once their texts
 * (and the new al-Albani wording) are reviewed.
 */
export const OFFERED: readonly Locale[] = ['en', 'id', 'ar']

/** Locales whose readers read Arabic script — they see it by default. */
export const READS_ARABIC: ReadonlySet<Locale> = new Set(['ar', 'ur'])

export function detectLocale(languages: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages): Locale {
  for (const tag of languages) {
    const base = tag.toLowerCase().split('-')[0]!
    if (base === 'ms') return 'id'
    if (OFFERED.includes(base as Locale)) return base as Locale
  }
  return 'en'
}
