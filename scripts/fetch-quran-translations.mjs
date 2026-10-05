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
  ar: ['ara-quransimple', 'مصحف تنزيل'],
}

/** recitation id → [surah, ayah] */
const VERSES = {
  'fatiha-1': [1, 1], 'fatiha-2': [1, 2], 'fatiha-3': [1, 3], 'fatiha-4': [1, 4],
  'fatiha-5': [1, 5], 'fatiha-6': [1, 6], 'fatiha-7': [1, 7],
  'kawthar-1': [108, 1], 'kawthar-2': [108, 2], 'kawthar-3': [108, 3],
  'ikhlas-1': [112, 1], 'ikhlas-2': [112, 2], 'ikhlas-3': [112, 3], 'ikhlas-4': [112, 4],
  // Other short surahs people often recite after Al-Fatiha (voice follow accepts them).
  'asr-1': [103, 1], 'asr-2': [103, 2], 'asr-3': [103, 3],
  'kafirun-1': [109, 1], 'kafirun-2': [109, 2], 'kafirun-3': [109, 3], 'kafirun-4': [109, 4], 'kafirun-5': [109, 5], 'kafirun-6': [109, 6],
  'nasr-1': [110, 1], 'nasr-2': [110, 2], 'nasr-3': [110, 3],
  'masad-1': [111, 1], 'masad-2': [111, 2], 'masad-3': [111, 3], 'masad-4': [111, 4], 'masad-5': [111, 5],
  'falaq-1': [113, 1], 'falaq-2': [113, 2], 'falaq-3': [113, 3], 'falaq-4': [113, 4], 'falaq-5': [113, 5],
  'nas-1': [114, 1], 'nas-2': [114, 2], 'nas-3': [114, 3], 'nas-4': [114, 4], 'nas-5': [114, 5], 'nas-6': [114, 6],
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
