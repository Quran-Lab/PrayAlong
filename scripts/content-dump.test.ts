// Dumps the text PrayAlong speaks, for audio generation:
// CONTENT_OUT=out.json npx vitest run scripts/content-dump.test.ts
import { writeFileSync } from 'node:fs'
import { it } from 'vitest'
import { getLine, isQuran, LINE_IDS } from '../src/content/recitations'
import { MESSAGES } from '../src/i18n'

it.skipIf(!process.env.CONTENT_OUT)('dump content', () => {
  const lines = LINE_IDS.map((id) => ({ id, arabic: getLine(id).arabic, transliteration: getLine(id).transliteration, quran: isQuran(id) }))
  const guide: Record<string, Record<string, string>> = {}
  for (const [locale, msgs] of Object.entries(MESSAGES)) {
    guide[locale] = Object.fromEntries(Object.entries(msgs as Record<string, string>).filter(([k]) => k.startsWith('hint.') || k.startsWith('cue.')))
  }
  writeFileSync(process.env.CONTENT_OUT!, JSON.stringify({ lines, guide }, null, 1))
})
