// What each recited line should sound like to the Quran Lab ASR (Zipformer v3.1 phoneme CTC):
// strings in the model's own alphabet, split into its symbols by `tokenize`. Al-Fatihah comes from
// the ATQAN alignment; Al-Ikhlas and Al-Falaq from the model's own reading of At-Tunaiji's clips
// (pausal endings, qalqalah ڇ); the dhikr strings are the drafts from PrayAlong/web/src/lib/recite/bacaan.ts
// (to be validated by the speech team). Lines without a target are shown but not followed.
import FATIHAH from './fatihah.json'
import { tokenize } from './match'

const PH: Record<string, string> = {
  takbir: 'ءَللَااهُءَكبَر',
  taawwudh: 'ءَعُۥۥذُبِللَااهِمِنَششَيطَاانِررَجِۦۦۦۦم',
  amin: 'ءَاامِۦۦن',
  ruku: 'سُبڇحَاانَرَببِيَلعَظِۦۦۦۦم',
  tasmi: 'سَمِعَللَااهُلِمَنحَمِدَه',
  tahmid: 'رَببَنَااوَلَكَلحَمد',
  sujud: 'سُبڇحَاانَرَببِيَلءَعلَاا',
  jalsah: 'ءَللَااهُممَغفِرلِۦۦوَرحَمنِۦۦوَجبُرنِۦۦوَرفَعنِۦۦوَعَاافِنِۦۦوَرزُقنِۦۦ',
  'tashahhud-1': 'ءَتتَحِييَااتُلِللَااهِوَصصَلَوَااتُوَططَييِبَاات',
  'tashahhud-2': 'ءَسسَلَاامُعَلَننننَبِييِوَرَحمَتُللَااهِوَبَرَكَااتُه',
  'tashahhud-3': 'ءَسسَلَاامُعَلَينَااوَعَلَااعِبَاادِللَااهِصصَاالِحِۦۦۦۦن',
  'tashahhud-4': 'ءَشهَدُءَللَااااءِلَااهَءِللَللَااهوَءَشهَدُءَننننَمُحَممممَدَنعَبڇدُهُۥۥوَرَسُۥۥلُه',
  salam: 'ءَسسَلَاامُعَلَيكُموَرَحمَتُللَااه',
  'ikhlas-1': 'قُلهُوَللَااهُءَحَدڇ',
  'ikhlas-2': 'ءَللَااهُصصَمَدڇ',
  'ikhlas-3': 'لَميَلِدڇوَلَميُۥۥلَدڇ',
  'ikhlas-4': 'وَلَميَكُللَهُۥۥكُفُوَنءَحَدڇ',
  'falaq-1': 'قُلءَعُۥۥذُبِرَببِلفَلَقڇ',
  'falaq-2': 'مِںںںشَررِمَااخَلَقڇ',
  'falaq-3': 'وَمِںںںشَررِغَااسِقِنءِذَااوَقَبڇ',
  'falaq-4': 'وَمِںںںشَررِننننَففَااثَااتِفِلعُقَدڇ',
  'falaq-5': 'وَمِںںںشَررِحَااسِدِنءِذَااحَسَدڇ',
}

const cache = new Map<string, string[] | null>()

/** The model symbols for a recitation line, or null if PrayAlong can't follow it. */
export function targetFor(lineId: string): string[] | null {
  if (cache.has(lineId)) return cache.get(lineId)!
  const ayah = /^fatiha-(\d)$/.exec(lineId)
  const toks = ayah ? (FATIHAH.ayahs[Number(ayah[1]) - 1]?.symbols ?? null) : PH[lineId] ? tokenize(PH[lineId]) : null
  cache.set(lineId, toks)
  return toks
}
