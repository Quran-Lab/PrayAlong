import { useSession } from '@/state/session'
import { de } from './de'
import { en, type MessageKey, type Messages } from './en'
import { ar, es, fr, id, nl, tr, ur } from './more'
import { detectLocale, type Locale } from './locales'

const MESSAGES: Record<Locale, Messages> = { en, de, fr, es, tr, id, nl, ur, ar }

export type { Locale, MessageKey }
export { LOCALES, READS_ARABIC, detectLocale } from './locales'

export function translate(locale: Locale, key: MessageKey, params?: Record<string, string | number>): string {
  const template = MESSAGES[locale][key] ?? en[key]
  return params ? template.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? '')) : template
}

/** The locale actually in use (the user's choice, or the browser's). */
export function useLocale(): Locale {
  const choice = useSession((s) => s.settings.locale)
  return choice === 'auto' ? detectLocale() : choice
}

export function useT() {
  const locale = useLocale()
  return (key: MessageKey, params?: Record<string, string | number>) => translate(locale, key, params)
}

export type T = ReturnType<typeof useT>
