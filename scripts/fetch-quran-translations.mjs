// Pulls the exact text of the verses recited in PrayAlong from approved
// translations (fawazahmed0/quran-api, mirrored from Tanzil / King Fahd
// Complex / Quran.com sources) into src/content/quran/<locale>.json.
//   node scripts/fetch-quran-translations.mjs
import { writeFile } from 'node:fs/promises'

const BASE = 'https://raw.githubusercontent.com/fawazahmed0/quran-api/1/editions'

/** locale → [edition id, credit shown in the app] */
const EDITIONS = {
  en: ['eng-ummmuhammad', 'Saheeh International'],
  de: ['deu-frankbubenheima', 'Bubenheim & Elyas'],
  fr: ['fra-muhammadhamidul', 'Muhammad Hamidullah'],
  es: ['spa-muhammadisagarc', 'Isa García'],
  tr: ['tur-diyanetisleri', 'Diyanet İşleri'],
  id: ['ind-indonesianislam', 'Kementerian Agama RI'],
  ur: ['urd-muhammadjunagar', 'Muhammad Junagarhi'],
  nl: ['nld-sofianssiregar', 'Sofian S. Siregar'],
  ar: ['ara-quransimple', 'Quran (simple script)'],
}

/** recitation id → [surah, ayah] */
const VERSES = {
  'fatiha-1': [1, 1], 'fatiha-2': [1, 2], 'fatiha-3': [1, 3], 'fatiha-4': [1, 4],
  'fatiha-5': [1, 5], 'fatiha-6': [1, 6], 'fatiha-7': [1, 7],
  'kawthar-1': [108, 1], 'kawthar-2': [108, 2], 'kawthar-3': [108, 3],
  'ikhlas-1': [112, 1], 'ikhlas-2': [112, 2], 'ikhlas-3': [112, 3], 'ikhlas-4': [112, 4],
}

for (const [locale, [edition, credit]] of Object.entries(EDITIONS)) {
  const chapters = {}
  for (const surah of new Set(Object.values(VERSES).map(([s]) => s))) {
    const res = await fetch(`${BASE}/${edition}/${surah}.json`)
    if (!res.ok) throw new Error(`${edition} ${surah}: ${res.status}`)
    chapters[surah] = (await res.json()).chapter
  }
  const verses = Object.fromEntries(
    Object.entries(VERSES).map(([id, [s, a]]) => [id, chapters[s].find((v) => v.verse === a).text.trim()]),
  )
  await writeFile(`src/content/quran/${locale}.json`, JSON.stringify({ edition, credit, verses }, null, 2) + '\n')
  console.log(locale, edition, Object.keys(verses).length)
}
