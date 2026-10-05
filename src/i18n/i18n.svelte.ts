import { session } from '@/state/session.svelte'
import { detectLocale, loadLocale, LOCALES, translate, type Locale, type MessageKey } from './index'

/** The language in use, reactive: the user's choice or the browser's. */
class I18n {
  /** Bumped when a language finishes loading, so text re-renders. */
  private loaded = $state(0)

  get locale(): Locale {
    const choice = session.settings.locale
    return choice === 'auto' ? detectLocale() : choice
  }
  get dir() {
    return LOCALES[this.locale].dir
  }

  t = (key: MessageKey, params?: Record<string, string | number>) => {
    void this.loaded
    return translate(this.locale, key, params)
  }

  /** Re-render once the current language's strings and meanings arrive. */
  sync() {
    $effect(() => {
      const locale = this.locale
      loadLocale(locale).then(() => this.loaded++)
    })
  }
}

export const i18n = new I18n()
export const t = i18n.t
export type T = typeof t
