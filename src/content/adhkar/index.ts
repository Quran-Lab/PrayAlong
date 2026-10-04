import type { Locale } from '@/i18n/locales'
import { en } from './en'
import { ar, de, es, fr, id, nl, tr, ur } from './more'

/**
 * Supplication meanings per language. English follows Hisn al-Muslim; the
 * other languages are PrayAlong translations of those meanings and are
 * awaiting scholarly review (see docs/content.md).
 */
export const ADHKAR: Record<Locale, Partial<Record<string, string>>> = { en, de, fr, es, tr, id, nl, ur, ar }
