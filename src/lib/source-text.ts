import type { Source } from '@/content/sources'
import type { MessageKey } from '@/i18n'

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string

/** "Abu Dawud 776 · at-Tirmidhi 243 · sahih per al-Albani", or "Quran 1:2 · Saheeh International". */
export function sourceText(source: Source | undefined, t: Translate, credit?: string): string {
  if (!source) return credit ?? ''
  const parts = source.refs.map(([collection, n]) => (collection === 'quran' ? t('line.quran', { ref: n }) : `${t(`src.${collection}`)} ${n}`))
  if (source.albani) parts.push(t('src.albani'))
  if (credit) parts.push(credit)
  return parts.join(' · ')
}
