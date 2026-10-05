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

  // — Other short surahs (voice follow accepts these in place of the planned one) —
  // NOTE: transliterations added for voice follow; review before release.
  // Al-Asr (103)
  { id: 'asr-1', arabic: 'وَالْعَصْرِ', transliteration: 'Wal-‘asr' },
  { id: 'asr-2', arabic: 'إِنَّ الْإِنْسَانَ لَفِي خُسْرٍ', transliteration: 'Innal-insāna lafī khusr' },
  {
    id: 'asr-3',
    arabic: 'إِلَّا الَّذِينَ آمَنُوا وَعَمِلُوا الصَّالِحَاتِ وَتَوَاصَوْا بِالْحَقِّ وَتَوَاصَوْا بِالصَّبْرِ',
    transliteration: 'Illal-ladhīna āmanū wa ‘amilus-sālihāti wa tawāsaw bil-haqqi wa tawāsaw bis-sabr',
  },
  // Al-Kafirun (109)
  { id: 'kafirun-1', arabic: 'قُلْ يَا أَيُّهَا الْكَافِرُونَ', transliteration: 'Qul yā ayyuhal-kāfirūn' },
  { id: 'kafirun-2', arabic: 'لَا أَعْبُدُ مَا تَعْبُدُونَ', transliteration: 'Lā a‘budu mā ta‘budūn' },
  { id: 'kafirun-3', arabic: 'وَلَا أَنْتُمْ عَابِدُونَ مَا أَعْبُدُ', transliteration: 'Wa lā antum ‘ābidūna mā a‘bud' },
  { id: 'kafirun-4', arabic: 'وَلَا أَنَا عَابِدٌ مَا عَبَدْتُمْ', transliteration: 'Wa lā ana ‘ābidum-mā ‘abattum' },
  { id: 'kafirun-5', arabic: 'وَلَا أَنْتُمْ عَابِدُونَ مَا أَعْبُدُ', transliteration: 'Wa lā antum ‘ābidūna mā a‘bud' },
  { id: 'kafirun-6', arabic: 'لَكُمْ دِينُكُمْ وَلِيَ دِينِ', transliteration: 'Lakum dīnukum wa liya dīn' },
  // An-Nasr (110)
  { id: 'nasr-1', arabic: 'إِذَا جَاءَ نَصْرُ اللَّهِ وَالْفَتْحُ', transliteration: 'Idhā jā’a nasrullāhi wal-fath' },
  { id: 'nasr-2', arabic: 'وَرَأَيْتَ النَّاسَ يَدْخُلُونَ فِي دِينِ اللَّهِ أَفْوَاجًا', transliteration: 'Wa ra’aytan-nāsa yadkhulūna fī dīnillāhi afwājā' },
  { id: 'nasr-3', arabic: 'فَسَبِّحْ بِحَمْدِ رَبِّكَ وَاسْتَغْفِرْهُ ۚ إِنَّهُ كَانَ تَوَّابًا', transliteration: 'Fa sabbih bi hamdi rabbika wastaghfirh, innahū kāna tawwābā' },
  // Al-Masad (111)
  { id: 'masad-1', arabic: 'تَبَّتْ يَدَا أَبِي لَهَبٍ وَتَبَّ', transliteration: 'Tabbat yadā abī lahabiw-wa tabb' },
  { id: 'masad-2', arabic: 'مَا أَغْنَىٰ عَنْهُ مَالُهُ وَمَا كَسَبَ', transliteration: 'Mā aghnā ‘anhu māluhū wa mā kasab' },
  { id: 'masad-3', arabic: 'سَيَصْلَىٰ نَارًا ذَاتَ لَهَبٍ', transliteration: 'Sayaslā nāran dhāta lahab' },
  { id: 'masad-4', arabic: 'وَامْرَأَتُهُ حَمَّالَةَ الْحَطَبِ', transliteration: 'Wamra’atuhū hammālatal-hatab' },
  { id: 'masad-5', arabic: 'فِي جِيدِهَا حَبْلٌ مِنْ مَسَدٍ', transliteration: 'Fī jīdihā hablum-mim-masad' },
  // Al-Falaq (113)
  { id: 'falaq-1', arabic: 'قُلْ أَعُوذُ بِرَبِّ الْفَلَقِ', transliteration: 'Qul a‘ūdhu bi rabbil-falaq' },
  { id: 'falaq-2', arabic: 'مِنْ شَرِّ مَا خَلَقَ', transliteration: 'Min sharri mā khalaq' },
  { id: 'falaq-3', arabic: 'وَمِنْ شَرِّ غَاسِقٍ إِذَا وَقَبَ', transliteration: 'Wa min sharri ghāsiqin idhā waqab' },
  { id: 'falaq-4', arabic: 'وَمِنْ شَرِّ النَّفَّاثَاتِ فِي الْعُقَدِ', transliteration: 'Wa min sharrin-naffāthāti fil-‘uqad' },
  { id: 'falaq-5', arabic: 'وَمِنْ شَرِّ حَاسِدٍ إِذَا حَسَدَ', transliteration: 'Wa min sharri hāsidin idhā hasad' },
  // An-Nas (114)
  { id: 'nas-1', arabic: 'قُلْ أَعُوذُ بِرَبِّ النَّاسِ', transliteration: 'Qul a‘ūdhu bi rabbin-nās' },
  { id: 'nas-2', arabic: 'مَلِكِ النَّاسِ', transliteration: 'Malikin-nās' },
  { id: 'nas-3', arabic: 'إِلَٰهِ النَّاسِ', transliteration: 'Ilāhin-nās' },
  { id: 'nas-4', arabic: 'مِنْ شَرِّ الْوَسْوَاسِ الْخَنَّاسِ', transliteration: 'Min sharril-waswāsil-khannās' },
  { id: 'nas-5', arabic: 'الَّذِي يُوَسْوِسُ فِي صُدُورِ النَّاسِ', transliteration: 'Alladhī yuwaswisu fī sudūrin-nās' },
  { id: 'nas-6', arabic: 'مِنَ الْجِنَّةِ وَالنَّاسِ', transliteration: 'Minal-jinnati wan-nās' },

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
  'asr-1': '103:1', 'asr-2': '103:2', 'asr-3': '103:3',
  'kafirun-1': '109:1', 'kafirun-2': '109:2', 'kafirun-3': '109:3', 'kafirun-4': '109:4', 'kafirun-5': '109:5', 'kafirun-6': '109:6',
  'nasr-1': '110:1', 'nasr-2': '110:2', 'nasr-3': '110:3',
  'masad-1': '111:1', 'masad-2': '111:2', 'masad-3': '111:3', 'masad-4': '111:4', 'masad-5': '111:5',
  'falaq-1': '113:1', 'falaq-2': '113:2', 'falaq-3': '113:3', 'falaq-4': '113:4', 'falaq-5': '113:5',
  'nas-1': '114:1', 'nas-2': '114:2', 'nas-3': '114:3', 'nas-4': '114:4', 'nas-5': '114:5', 'nas-6': '114:6',
}

/** Short surahs a worshipper may recite after Al-Fatiha, in mushaf order. */
export type SurahId = 'asr' | 'kawthar' | 'kafirun' | 'nasr' | 'masad' | 'ikhlas' | 'falaq' | 'nas'

export const SHORT_SURAHS: Record<SurahId, { number: number; lines: RecitationId[] }> = {
  asr: { number: 103, lines: ['asr-1', 'asr-2', 'asr-3'] },
  kawthar: { number: 108, lines: ['kawthar-1', 'kawthar-2', 'kawthar-3'] },
  kafirun: { number: 109, lines: ['kafirun-1', 'kafirun-2', 'kafirun-3', 'kafirun-4', 'kafirun-5', 'kafirun-6'] },
  nasr: { number: 110, lines: ['nasr-1', 'nasr-2', 'nasr-3'] },
  masad: { number: 111, lines: ['masad-1', 'masad-2', 'masad-3', 'masad-4', 'masad-5'] },
  ikhlas: { number: 112, lines: ['ikhlas-1', 'ikhlas-2', 'ikhlas-3', 'ikhlas-4'] },
  falaq: { number: 113, lines: ['falaq-1', 'falaq-2', 'falaq-3', 'falaq-4', 'falaq-5'] },
  nas: { number: 114, lines: ['nas-1', 'nas-2', 'nas-3', 'nas-4', 'nas-5', 'nas-6'] },
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
export const surahsByRakah: Record<number, { group: SurahId; lines: RecitationId[] }> = {
  1: { group: 'kawthar', lines: SHORT_SURAHS.kawthar.lines },
  2: { group: 'ikhlas', lines: SHORT_SURAHS.ikhlas.lines },
}

/** The planned surah for a rak'ah, or the one chosen (or recited) instead. */
export function surahFor(rakah: number, chosen?: Partial<Record<number, SurahId>>): { group: SurahId; lines: RecitationId[] } | undefined {
  const id = chosen?.[rakah]
  return id ? { group: id, lines: SHORT_SURAHS[id].lines } : surahsByRakah[rakah]
}

/** Every line id, in reading order (for audio generation and checks). */
export const LINE_IDS: readonly RecitationId[] = lines.map((line) => line.id)
