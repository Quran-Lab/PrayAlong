// Dumps each line's Arabic and its meaning in every language, for word alignment:
// MEANING_OUT=out.json npx vitest run scripts/meaning-dump.test.ts
import { writeFileSync } from 'node:fs'
import { it } from 'vitest'
import { resolveLine } from '../src/content/lines'
import { getLine, LINE_IDS } from '../src/content/recitations'
import { LOCALES } from '../src/i18n/locales'

it.skipIf(!process.env.MEANING_OUT)('dump meanings', () => {
  const out: Record<string, Record<string, { arabic: string; translit: string; meaning: string }>> = {}
  for (const locale of Object.keys(LOCALES)) {
    out[locale] = {}
    for (const id of LINE_IDS) {
      const r = resolveLine(id, locale as keyof typeof LOCALES)
      out[locale][id] = { arabic: getLine(id).arabic, translit: r.transliteration, meaning: r.meaning }
    }
  }
  writeFileSync(process.env.MEANING_OUT!, JSON.stringify(out, null, 1))
})
