import quranArabic from './quran/ar.json'

/**
 * Every line PrayAlong can show: the Arabic (fully vowelled) and how to say
 * it. Meanings live per language in `quran/<locale>.json` (approved Quran
 * translations, fetched verbatim) and `adhkar/<locale>.ts`; the narration
 * behind each line is in `sources.ts`.
 *
 * The wording follows Sifat Salat an-Nabi ﷺ by Shaykh Muhammad Nasiruddin
 * al-Albani, choosing the shortest authentic wording where there are several
 * (for people learning to pray). Other authentic wordings are in ALTERNATIVES.
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
    transliteration: 'Wa tabārakasmuk, wa ta‘ālā jadduk, wa lā ilāha ghayruk',
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

  // — Al-Falaq (113) —————————————————————————————————————————
  {
    id: 'falaq-1',
    arabic: 'قُلْ أَعُوذُ بِرَبِّ الْفَلَقِ',
    transliteration: 'Qul a‘ūdhu birabbil-falaq',
  },
  {
    id: 'falaq-2',
    arabic: 'مِنْ شَرِّ مَا خَلَقَ',
    transliteration: 'Min sharri mā khalaq',
  },
  {
    id: 'falaq-3',
    arabic: 'وَمِنْ شَرِّ غَاسِقٍ إِذَا وَقَبَ',
    transliteration: 'Wa min sharri ghāsiqin idhā waqab',
  },
  {
    id: 'falaq-4',
    arabic: 'وَمِنْ شَرِّ النَّفَّاثَاتِ فِي الْعُقَدِ',
    transliteration: 'Wa min sharrin-naffāthāti fil-‘uqad',
  },
  {
    id: 'falaq-5',
    arabic: 'وَمِنْ شَرِّ حَاسِدٍ إِذَا حَسَدَ',
    transliteration: 'Wa min sharri hāsidin idhā hasad',
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
    // The full supplication between the prostrations, as in the recording (5 Oct 2026).
    id: 'jalsah',
    arabic: 'اللَّهُمَّ اغْفِرْ لِي وَارْحَمْنِي وَاجْبُرْنِي وَارْفَعْنِي وَعَافِنِي وَارْزُقْنِي',
    transliteration: 'Allāhummaghfir lī, warhamnī, wajburnī, warfa‘nī, wa ‘āfinī, warzuqnī',
  },

  // — Tashahhud ——————————————————————————————————————————————
  {
    id: 'tashahhud-1',
    arabic: 'التَّحِيَّاتُ لِلَّهِ وَالصَّلَوَاتُ وَالطَّيِّبَاتُ',
    transliteration: 'At-tahiyyātu lillāhi was-salawātu wat-tayyibāt',
  },
  {
    id: 'tashahhud-2',
    // "‘Alan-nabiyy", as the Companions said after the Prophet ﷺ passed away (al-Albani's choice).
    arabic: 'السَّلَامُ عَلَى النَّبِيِّ وَرَحْمَةُ اللَّهِ وَبَرَكَاتُهُ',
    transliteration: 'As-salāmu ‘alan-nabiyyi wa rahmatullāhi wa barakātuh',
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

  // — Seeking refuge before the salam ————————————————————————
  {
    id: 'refuge-1',
    arabic: 'اللَّهُمَّ إِنِّي أَعُوذُ بِكَ مِنْ عَذَابِ جَهَنَّمَ وَمِنْ عَذَابِ الْقَبْرِ',
    transliteration: 'Allāhumma innī a‘ūdhu bika min ‘adhābi jahannam, wa min ‘adhābil-qabr',
  },
  {
    id: 'refuge-2',
    arabic: 'وَمِنْ فِتْنَةِ الْمَحْيَا وَالْمَمَاتِ وَمِنْ شَرِّ فِتْنَةِ الْمَسِيحِ الدَّجَّالِ',
    transliteration: 'Wa min fitnatil-mahyā wal-mamāt, wa min sharri fitnatil-masīhid-dajjāl',
  },

  // — Closing ————————————————————————————————————————————————
  {
    id: 'salam',
    arabic: 'السَّلَامُ عَلَيْكُمْ وَرَحْمَةُ اللَّهِ',
    transliteration: 'As-salāmu ‘alaykum wa rahmatullāh',
  },

  // — Right after the prayer (shown when it is complete) ———————
  {
    id: 'istighfar',
    arabic: 'أَسْتَغْفِرُ اللَّهَ',
    transliteration: 'Astaghfirullāh',
  },
  {
    id: 'antas-salam',
    arabic: 'اللَّهُمَّ أَنْتَ السَّلَامُ وَمِنْكَ السَّلَامُ تَبَارَكْتَ ذَا الْجَلَالِ وَالْإِكْرَامِ',
    transliteration: 'Allāhumma antas-salām wa minkas-salām, tabārakta dhal-jalāli wal-ikrām',
  },
] as const satisfies readonly LineSource[]

export type RecitationId = (typeof lines)[number]['id']

/** Quran lines and their verse references. */
export const QURAN_REFS: Partial<Record<RecitationId, string>> = {
  'fatiha-1': '1:1', 'fatiha-2': '1:2', 'fatiha-3': '1:3', 'fatiha-4': '1:4',
  'fatiha-5': '1:5', 'fatiha-6': '1:6', 'fatiha-7': '1:7',
  'kawthar-1': '108:1', 'kawthar-2': '108:2', 'kawthar-3': '108:3',
  'ikhlas-1': '112:1', 'ikhlas-2': '112:2', 'ikhlas-3': '112:3', 'ikhlas-4': '112:4',
  'falaq-1': '113:1', 'falaq-2': '113:2', 'falaq-3': '113:3', 'falaq-4': '113:4', 'falaq-5': '113:5',
}

const BASMALAH = /^بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ\s+/

const BY_ID = Object.fromEntries(lines.map((line) => [line.id, line])) as Record<RecitationId, LineSource>

export function getLine(id: string): LineSource {
  const line = (BY_ID as Record<string, LineSource>)[id]
  if (!line) throw new Error(`Unknown recitation "${id}"`)
  // Quran text comes from the Tanzil "simple" edition, not hand-typed. Tanzil prints the basmalah
  // at the head of each surah's first verse; it is a verse only in Al-Fatihah.
  const verse = (quranArabic.verses as Record<string, string>)[id]
  if (!verse) return line
  return { ...line, arabic: id === 'fatiha-1' ? verse : verse.replace(BASMALAH, '') }
}

export const isQuran = (id: string) => id in QURAN_REFS

/**
 * Other authentic wordings, for a later "learn more" view. The opening
 * supplication of Abu Hurayrah is the soundest narration of all (al-Bukhari
 * 744, Muslim 598); PrayAlong teaches "Subhānaka Allāhumma" first because it
 * is the shortest. One opening is said per prayer, not both.
 */
export const ALTERNATIVES = {
  thana: {
    arabic:
      'اللَّهُمَّ بَاعِدْ بَيْنِي وَبَيْنَ خَطَايَايَ كَمَا بَاعَدْتَ بَيْنَ الْمَشْرِقِ وَالْمَغْرِبِ، اللَّهُمَّ نَقِّنِي مِنْ خَطَايَايَ كَمَا يُنَقَّى الثَّوْبُ الْأَبْيَضُ مِنَ الدَّنَسِ، اللَّهُمَّ اغْسِلْنِي مِنْ خَطَايَايَ بِالثَّلْجِ وَالْمَاءِ وَالْبَرَدِ',
    transliteration:
      'Allāhumma bā‘id baynī wa bayna khatāyāya kamā bā‘adta baynal-mashriqi wal-maghrib. Allāhumma naqqinī min khatāyāya kamā yunaqqath-thawbul-abyadu minad-danas. Allāhummaghsilnī min khatāyāya bith-thalji wal-mā’i wal-barad',
    source: { refs: [['bukhari', '744'], ['muslim', '598']] },
  },
  taawwudh: {
    arabic: 'أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ مِنْ هَمْزِهِ وَنَفْخِهِ وَنَفْثِهِ',
    transliteration: 'A‘ūdhu billāhi minash-shaytānir-rajīm, min hamzihī wa nafkhihī wa nafthih',
  },
  jalsah: {
    // The short form, said twice (Abu Dawud 874, Ibn Majah 897).
    arabic: 'رَبِّ اغْفِرْ لِي',
    transliteration: 'Rabbighfir lī',
    source: { refs: [['abuDawud', '874'], ['ibnMajah', '897']], albani: true },
  },
} as const

/**
 * Short surahs recited after Al-Fatiha in the first two rak'ahs, in mushaf order. For now
 * Al-Ikhlas, then Al-Falaq (the user's choice, 5 Oct 2026); Al-Kawthar stays available.
 */
export const surahsByRakah: Record<number, { group: 'kawthar' | 'ikhlas' | 'falaq'; lines: RecitationId[] }> = {
  1: { group: 'ikhlas', lines: ['ikhlas-1', 'ikhlas-2', 'ikhlas-3', 'ikhlas-4'] },
  2: { group: 'falaq', lines: ['falaq-1', 'falaq-2', 'falaq-3', 'falaq-4', 'falaq-5'] },
}
