import type { Locale } from '@/i18n/locales'
import { en } from './en'

/**
 * Supplication meanings per language. English follows Hisn al-Muslim; the
 * other languages are PrayAlong translations of those meanings and are
 * awaiting scholarly review (see docs/content.md). Loaded when chosen.
 */
export const ADHKAR: Partial<Record<Locale, Partial<Record<string, string>>>> = { en }

export async function loadAdhkar(locale: Locale) {
  if (ADHKAR[locale]) return
  const { ar, de, es, fr, id, nl, tr, ur } = await import('./more')
  Object.assign(ADHKAR, { ar, de, es, fr, id, nl, tr, ur })
}
