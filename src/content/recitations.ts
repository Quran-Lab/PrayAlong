import quranArabic from './quran/ar.json'

/**
 * Every line PrayAlong can show: the Arabic (fully vowelled) and how to say
 * it. Meanings live per language in `quran/<locale>.json` (approved Quran
 * translations, fetched verbatim) and `adhkar/<locale>.ts`.
 *
 * Transliteration uses macrons for long vowels and ‘ for ‘ayn — readable
 * for beginners without a key.
 *
 * NOTE: religious text — any change here should be reviewed by someone
 * qualified before release.
 */
interface LineSource {
  id: string
  arabic: string
  transliteration: string
}

const lines = [
  // — Opening ————————————————————————————————————————————————
  {
    id: 'takbir',
    arabic: 'اللَّهُ أَكْبَرُ',
    transliteration: 'Allāhu Akbar',
  },
  {
    id: 'thana-1',
    arabic: 'سُبْحَانَكَ اللَّهُمَّ وَبِحَمْدِكَ',
    transliteration: 'Subhānaka Allāhumma wa bihamdik',
  },
  {
    id: 'thana-2',
    arabic: 'وَتَبَارَكَ اسْمُكَ وَتَعَالَىٰ جَدُّكَ وَلَا إِلَٰهَ غَيْرُكَ',
    transliteration: 'Wa tabārakasmuka wa ta‘ālā jadduka wa lā ilāha ghayruk',
  },
  {
    id: 'taawwudh',
    arabic: 'أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ',
    transliteration: 'A‘ūdhu billāhi minash-shaytānir-rajīm',
  },

  // — Al-Fatiha (1) ——————————————————————————————————————————
  {
    id: 'fatiha-1',
    arabic: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ',
    transliteration: 'Bismillāhir-Rahmānir-Rahīm',
  },
  {
    id: 'fatiha-2',
    arabic: 'الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ',
    transliteration: 'Al-hamdu lillāhi rabbil-‘ālamīn',
  },
  {
    id: 'fatiha-3',
    arabic: 'الرَّحْمَٰنِ الرَّحِيمِ',
    transliteration: 'Ar-Rahmānir-Rahīm',
  },
  {
    id: 'fatiha-4',
    arabic: 'مَالِكِ يَوْمِ الدِّينِ',
    transliteration: 'Māliki yawmid-dīn',
  },
  {
    id: 'fatiha-5',
    arabic: 'إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ',
    transliteration: 'Iyyāka na‘budu wa iyyāka nasta‘īn',
  },
  {
    id: 'fatiha-6',
    arabic: 'اهْدِنَا الصِّرَاطَ الْمُسْتَقِيمَ',
    transliteration: 'Ihdinas-sirātal-mustaqīm',
  },
  {
    id: 'fatiha-7',
    arabic: 'صِرَاطَ الَّذِينَ أَنْعَمْتَ عَلَيْهِمْ غَيْرِ الْمَغْضُوبِ عَلَيْهِمْ وَلَا الضَّالِّينَ',
    transliteration: 'Sirātal-ladhīna an‘amta ‘alayhim, ghayril-maghdūbi ‘alayhim wa lad-dāllīn',
  },
  {
    id: 'amin',
    arabic: 'آمِين',
    transliteration: 'Āmīn',
  },

  // — Al-Kawthar (108) ———————————————————————————————————————
  {
    id: 'kawthar-1',
    arabic: 'إِنَّا أَعْطَيْنَاكَ الْكَوْثَرَ',
    transliteration: 'Innā a‘taynākal-kawthar',
  },
  {
    id: 'kawthar-2',
    arabic: 'فَصَلِّ لِرَبِّكَ وَانْحَرْ',
    transliteration: 'Fa salli li rabbika wanhar',
  },
  {
    id: 'kawthar-3',
    arabic: 'إِنَّ شَانِئَكَ هُوَ الْأَبْتَرُ',
    transliteration: 'Inna shāni’aka huwal-abtar',
  },

  // — Al-Ikhlas (112) ————————————————————————————————————————
  {
    id: 'ikhlas-1',
    arabic: 'قُلْ هُوَ اللَّهُ أَحَدٌ',
    transliteration: 'Qul huwallāhu ahad',
  },
  {
    id: 'ikhlas-2',
    arabic: 'اللَّهُ الصَّمَدُ',
    transliteration: 'Allāhus-samad',
  },
  {
    id: 'ikhlas-3',
    arabic: 'لَمْ يَلِدْ وَلَمْ يُولَدْ',
    transliteration: 'Lam yalid wa lam yūlad',
  },
  {
    id: 'ikhlas-4',
    arabic: 'وَلَمْ يَكُن لَّهُ كُفُوًا أَحَدٌ',
    transliteration: 'Wa lam yakul-lahū kufuwan ahad',
  },

  // — Bowing, rising, prostrating ————————————————————————————
  {
    id: 'ruku',
    arabic: 'سُبْحَانَ رَبِّيَ الْعَظِيمِ',
    transliteration: 'Subhāna rabbiyal-‘azīm',
  },
  {
    id: 'tasmi',
    arabic: 'سَمِعَ اللَّهُ لِمَنْ حَمِدَهُ',
    transliteration: 'Sami‘allāhu liman hamidah',
  },
  {
    id: 'tahmid',
    arabic: 'رَبَّنَا وَلَكَ الْحَمْدُ',
    transliteration: 'Rabbanā wa lakal-hamd',
  },
  {
    id: 'sujud',
    arabic: 'سُبْحَانَ رَبِّيَ الْأَعْلَىٰ',
    transliteration: 'Subhāna rabbiyal-a‘lā',
  },
  {
    id: 'jalsah',
    arabic: 'رَبِّ اغْفِرْ لِي',
    transliteration: 'Rabbighfir lī',
  },

  // — Tashahhud ——————————————————————————————————————————————
  {
    id: 'tashahhud-1',
    arabic: 'التَّحِيَّاتُ لِلَّهِ وَالصَّلَوَاتُ وَالطَّيِّبَاتُ',
    transliteration: 'At-tahiyyātu lillāhi was-salawātu wat-tayyibāt',
  },
  {
    id: 'tashahhud-2',
    arabic: 'السَّلَامُ عَلَيْكَ أَيُّهَا النَّبِيُّ وَرَحْمَةُ اللَّهِ وَبَرَكَاتُهُ',
    transliteration: 'As-salāmu ‘alayka ayyuhan-nabiyyu wa rahmatullāhi wa barakātuh',
  },
  {
    id: 'tashahhud-3',
    arabic: 'السَّلَامُ عَلَيْنَا وَعَلَىٰ عِبَادِ اللَّهِ الصَّالِحِينَ',
    transliteration: 'As-salāmu ‘alaynā wa ‘alā ‘ibādillāhis-sālihīn',
  },
  {
    id: 'tashahhud-4',
    arabic: 'أَشْهَدُ أَنْ لَا إِلَٰهَ إِلَّا اللَّهُ وَأَشْهَدُ أَنَّ مُحَمَّدًا عَبْدُهُ وَرَسُولُهُ',
    transliteration: 'Ash-hadu an lā ilāha illallāh, wa ash-hadu anna Muhammadan ‘abduhū wa rasūluh',
  },

  // — Salawat (final sitting) ————————————————————————————————
  {
    id: 'salawat-1',
    arabic: 'اللَّهُمَّ صَلِّ عَلَىٰ مُحَمَّدٍ وَعَلَىٰ آلِ مُحَمَّدٍ',
    transliteration: 'Allāhumma salli ‘alā Muhammadin wa ‘alā āli Muhammad',
  },
  {
    id: 'salawat-2',
    arabic: 'كَمَا صَلَّيْتَ عَلَىٰ إِبْرَاهِيمَ وَعَلَىٰ آلِ إِبْرَاهِيمَ إِنَّكَ حَمِيدٌ مَجِيدٌ',
    transliteration: 'Kamā sallayta ‘alā Ibrāhīma wa ‘alā āli Ibrāhīm, innaka hamīdun majīd',
  },
  {
    id: 'salawat-3',
    arabic: 'اللَّهُمَّ بَارِكْ عَلَىٰ مُحَمَّدٍ وَعَلَىٰ آلِ مُحَمَّدٍ',
    transliteration: 'Allāhumma bārik ‘alā Muhammadin wa ‘alā āli Muhammad',
  },
  {
    id: 'salawat-4',
    arabic: 'كَمَا بَارَكْتَ عَلَىٰ إِبْرَاهِيمَ وَعَلَىٰ آلِ إِبْرَاهِيمَ إِنَّكَ حَمِيدٌ مَجِيدٌ',
    transliteration: 'Kamā bārakta ‘alā Ibrāhīma wa ‘alā āli Ibrāhīm, innaka hamīdun majīd',
  },

  // — Closing ————————————————————————————————————————————————
  {
    id: 'salam',
    arabic: 'السَّلَامُ عَلَيْكُمْ وَرَحْمَةُ اللَّهِ',
    transliteration: 'As-salāmu ‘alaykum wa rahmatullāh',
  },
  {
    id: 'taqabbal',
    arabic: 'تَقَبَّلَ اللَّهُ مِنَّا وَمِنْكُمْ',
    transliteration: 'Taqabbalallāhu minnā wa minkum',
  },
] as const satisfies readonly LineSource[]

export type RecitationId = (typeof lines)[number]['id']

/** Quran lines and their verse references. */
export const QURAN_REFS: Partial<Record<RecitationId, string>> = {
  'fatiha-1': '1:1', 'fatiha-2': '1:2', 'fatiha-3': '1:3', 'fatiha-4': '1:4',
  'fatiha-5': '1:5', 'fatiha-6': '1:6', 'fatiha-7': '1:7',
  'kawthar-1': '108:1', 'kawthar-2': '108:2', 'kawthar-3': '108:3',
  'ikhlas-1': '112:1', 'ikhlas-2': '112:2', 'ikhlas-3': '112:3', 'ikhlas-4': '112:4',
}

const BY_ID = Object.fromEntries(lines.map((line) => [line.id, line])) as Record<RecitationId, LineSource>

export function getLine(id: string): LineSource {
  const line = (BY_ID as Record<string, LineSource>)[id]
  if (!line) throw new Error(`Unknown recitation "${id}"`)
  // Quran text comes from the Tanzil "simple" edition, not hand-typed.
  const verse = (quranArabic.verses as Record<string, string>)[id]
  return verse ? { ...line, arabic: verse } : line
}

export const isQuran = (id: string) => id in QURAN_REFS

/** Short surahs recited after Al-Fatiha in the first two rak'ahs, in mushaf order. */
export const surahsByRakah: Record<number, { group: 'kawthar' | 'ikhlas'; lines: RecitationId[] }> = {
  1: { group: 'kawthar', lines: ['kawthar-1', 'kawthar-2', 'kawthar-3'] },
  2: { group: 'ikhlas', lines: ['ikhlas-1', 'ikhlas-2', 'ikhlas-3', 'ikhlas-4'] },
}
