import { loadAdhkar } from '@/content/adhkar'
import { loadQuran } from '@/content/lines'
import { en, type MessageKey, type Messages } from './en'
import type { Locale } from './locales'

/** English ships with the app; every other language loads when chosen. */
const MESSAGES: Partial<Record<Locale, Messages>> = { en }

export type { Locale, MessageKey }
export { LOCALES, OFFERED, READS_ARABIC, detectLocale } from './locales'

async function loadMessages(locale: Locale) {
  if (MESSAGES[locale]) return
  if (locale === 'de') MESSAGES.de = (await import('./de')).de
  else {
    const { ar, es, fr, id, nl, tr, ur } = await import('./more')
    Object.assign(MESSAGES, { ar, es, fr, id, nl, tr, ur })
  }
}

/** UI strings, Quran meanings and supplication meanings for one language. */
export function loadLocale(locale: Locale): Promise<unknown> {
  return Promise.all([loadMessages(locale), loadQuran(locale), loadAdhkar(locale)])
}

export function translate(locale: Locale, key: MessageKey, params?: Record<string, string | number>): string {
  const template = MESSAGES[locale]?.[key] ?? en[key]
  return params ? template.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? '')) : template
}
