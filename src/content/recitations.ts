import type { Recitation } from '@/sequence/types'

/**
 * Every line PrayAlong can show. Arabic is fully vowelled (Hafs, simple
 * script). Transliteration uses macrons for long vowels and ‘ for ‘ayn —
 * readable for beginners without a key.
 *
 * NOTE: religious text — any change here should be reviewed by someone
 * qualified before release.
 */
const lines = [
  // — Opening ————————————————————————————————————————————————
  {
    id: 'takbir',
    arabic: 'اللَّهُ أَكْبَرُ',
    transliteration: 'Allāhu Akbar',
    translation: 'Allah is the Greatest.',
  },
  {
    id: 'thana-1',
    arabic: 'سُبْحَانَكَ اللَّهُمَّ وَبِحَمْدِكَ',
    transliteration: 'Subhānaka Allāhumma wa bihamdik',
    translation: 'Glory be to You, O Allah, and all praise.',
  },
  {
    id: 'thana-2',
    arabic: 'وَتَبَارَكَ اسْمُكَ وَتَعَالَىٰ جَدُّكَ وَلَا إِلَٰهَ غَيْرُكَ',
    transliteration: 'Wa tabārakasmuka wa ta‘ālā jadduka wa lā ilāha ghayruk',
    translation: 'Blessed is Your name, exalted is Your majesty, and there is no god but You.',
  },
  {
    id: 'taawwudh',
    arabic: 'أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ',
    transliteration: 'A‘ūdhu billāhi minash-shaytānir-rajīm',
    translation: 'I seek refuge in Allah from Satan, the accursed.',
  },

  // — Al-Fatiha (1) ——————————————————————————————————————————
  {
    id: 'fatiha-1',
    arabic: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ',
    transliteration: 'Bismillāhir-Rahmānir-Rahīm',
    translation: 'In the name of Allah, the Most Gracious, the Most Merciful.',
  },
  {
    id: 'fatiha-2',
    arabic: 'الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ',
    transliteration: 'Al-hamdu lillāhi rabbil-‘ālamīn',
    translation: 'All praise is for Allah, Lord of all worlds.',
  },
  {
    id: 'fatiha-3',
    arabic: 'الرَّحْمَٰنِ الرَّحِيمِ',
    transliteration: 'Ar-Rahmānir-Rahīm',
    translation: 'The Most Gracious, the Most Merciful.',
  },
  {
    id: 'fatiha-4',
    arabic: 'مَالِكِ يَوْمِ الدِّينِ',
    transliteration: 'Māliki yawmid-dīn',
    translation: 'Master of the Day of Judgement.',
  },
  {
    id: 'fatiha-5',
    arabic: 'إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ',
    transliteration: 'Iyyāka na‘budu wa iyyāka nasta‘īn',
    translation: 'You alone we worship, and You alone we ask for help.',
  },
  {
    id: 'fatiha-6',
    arabic: 'اهْدِنَا الصِّرَاطَ الْمُسْتَقِيمَ',
    transliteration: 'Ihdinas-sirātal-mustaqīm',
    translation: 'Guide us along the straight path,',
  },
  {
    id: 'fatiha-7',
    arabic: 'صِرَاطَ الَّذِينَ أَنْعَمْتَ عَلَيْهِمْ غَيْرِ الْمَغْضُوبِ عَلَيْهِمْ وَلَا الضَّالِّينَ',
    transliteration: 'Sirātal-ladhīna an‘amta ‘alayhim, ghayril-maghdūbi ‘alayhim wa lad-dāllīn',
    translation:
      'the path of those You have blessed — not of those who earned Your anger, nor of those who went astray.',
  },
  {
    id: 'amin',
    arabic: 'آمِين',
    transliteration: 'Āmīn',
    translation: 'O Allah, answer our prayer.',
  },

  // — Al-Kawthar (108) ———————————————————————————————————————
  {
    id: 'kawthar-1',
    arabic: 'إِنَّا أَعْطَيْنَاكَ الْكَوْثَرَ',
    transliteration: 'Innā a‘taynākal-kawthar',
    translation: 'Indeed, We have granted you abundant good.',
  },
  {
    id: 'kawthar-2',
    arabic: 'فَصَلِّ لِرَبِّكَ وَانْحَرْ',
    transliteration: 'Fa salli li rabbika wanhar',
    translation: 'So pray to your Lord and offer sacrifice.',
  },
  {
    id: 'kawthar-3',
    arabic: 'إِنَّ شَانِئَكَ هُوَ الْأَبْتَرُ',
    transliteration: 'Inna shāni’aka huwal-abtar',
    translation: 'Indeed, it is your enemy who is cut off.',
  },

  // — Al-Ikhlas (112) ————————————————————————————————————————
  {
    id: 'ikhlas-1',
    arabic: 'قُلْ هُوَ اللَّهُ أَحَدٌ',
    transliteration: 'Qul huwallāhu ahad',
    translation: 'Say: He is Allah, the One.',
  },
  {
    id: 'ikhlas-2',
    arabic: 'اللَّهُ الصَّمَدُ',
    transliteration: 'Allāhus-samad',
    translation: 'Allah, the Eternal Refuge.',
  },
  {
    id: 'ikhlas-3',
    arabic: 'لَمْ يَلِدْ وَلَمْ يُولَدْ',
    transliteration: 'Lam yalid wa lam yūlad',
    translation: 'He neither begets, nor was He begotten,',
  },
  {
    id: 'ikhlas-4',
    arabic: 'وَلَمْ يَكُن لَّهُ كُفُوًا أَحَدٌ',
    transliteration: 'Wa lam yakul-lahū kufuwan ahad',
    translation: 'and there is none comparable to Him.',
  },

  // — Bowing, rising, prostrating ————————————————————————————
  {
    id: 'ruku',
    arabic: 'سُبْحَانَ رَبِّيَ الْعَظِيمِ',
    transliteration: 'Subhāna rabbiyal-‘azīm',
    translation: 'Glory be to my Lord, the Magnificent.',
  },
  {
    id: 'tasmi',
    arabic: 'سَمِعَ اللَّهُ لِمَنْ حَمِدَهُ',
    transliteration: 'Sami‘allāhu liman hamidah',
    translation: 'Allah hears the one who praises Him.',
  },
  {
    id: 'tahmid',
    arabic: 'رَبَّنَا وَلَكَ الْحَمْدُ',
    transliteration: 'Rabbanā wa lakal-hamd',
    translation: 'Our Lord, all praise is Yours.',
  },
  {
    id: 'sujud',
    arabic: 'سُبْحَانَ رَبِّيَ الْأَعْلَىٰ',
    transliteration: 'Subhāna rabbiyal-a‘lā',
    translation: 'Glory be to my Lord, the Most High.',
  },
  {
    id: 'jalsah',
    arabic: 'رَبِّ اغْفِرْ لِي',
    transliteration: 'Rabbighfir lī',
    translation: 'My Lord, forgive me.',
  },

  // — Tashahhud ——————————————————————————————————————————————
  {
    id: 'tashahhud-1',
    arabic: 'التَّحِيَّاتُ لِلَّهِ وَالصَّلَوَاتُ وَالطَّيِّبَاتُ',
    transliteration: 'At-tahiyyātu lillāhi was-salawātu wat-tayyibāt',
    translation: 'All greetings, prayers and pure words are for Allah.',
  },
  {
    id: 'tashahhud-2',
    arabic: 'السَّلَامُ عَلَيْكَ أَيُّهَا النَّبِيُّ وَرَحْمَةُ اللَّهِ وَبَرَكَاتُهُ',
    transliteration: 'As-salāmu ‘alayka ayyuhan-nabiyyu wa rahmatullāhi wa barakātuh',
    translation: 'Peace be upon you, O Prophet, and the mercy of Allah and His blessings.',
  },
  {
    id: 'tashahhud-3',
    arabic: 'السَّلَامُ عَلَيْنَا وَعَلَىٰ عِبَادِ اللَّهِ الصَّالِحِينَ',
    transliteration: 'As-salāmu ‘alaynā wa ‘alā ‘ibādillāhis-sālihīn',
    translation: 'Peace be upon us and upon the righteous servants of Allah.',
  },
  {
    id: 'tashahhud-4',
    arabic: 'أَشْهَدُ أَنْ لَا إِلَٰهَ إِلَّا اللَّهُ وَأَشْهَدُ أَنَّ مُحَمَّدًا عَبْدُهُ وَرَسُولُهُ',
    transliteration: 'Ash-hadu an lā ilāha illallāh, wa ash-hadu anna Muhammadan ‘abduhū wa rasūluh',
    translation:
      'I bear witness that there is no god but Allah, and that Muhammad is His servant and Messenger.',
  },

  // — Salawat (final sitting) ————————————————————————————————
  {
    id: 'salawat-1',
    arabic: 'اللَّهُمَّ صَلِّ عَلَىٰ مُحَمَّدٍ وَعَلَىٰ آلِ مُحَمَّدٍ',
    transliteration: 'Allāhumma salli ‘alā Muhammadin wa ‘alā āli Muhammad',
    translation: 'O Allah, send prayers upon Muhammad and the family of Muhammad,',
  },
  {
    id: 'salawat-2',
    arabic: 'كَمَا صَلَّيْتَ عَلَىٰ إِبْرَاهِيمَ وَعَلَىٰ آلِ إِبْرَاهِيمَ إِنَّكَ حَمِيدٌ مَجِيدٌ',
    transliteration: 'Kamā sallayta ‘alā Ibrāhīma wa ‘alā āli Ibrāhīm, innaka hamīdun majīd',
    translation:
      'as You sent prayers upon Ibrahim and the family of Ibrahim. You are Praiseworthy, Glorious.',
  },
  {
    id: 'salawat-3',
    arabic: 'اللَّهُمَّ بَارِكْ عَلَىٰ مُحَمَّدٍ وَعَلَىٰ آلِ مُحَمَّدٍ',
    transliteration: 'Allāhumma bārik ‘alā Muhammadin wa ‘alā āli Muhammad',
    translation: 'O Allah, bless Muhammad and the family of Muhammad,',
  },
  {
    id: 'salawat-4',
    arabic: 'كَمَا بَارَكْتَ عَلَىٰ إِبْرَاهِيمَ وَعَلَىٰ آلِ إِبْرَاهِيمَ إِنَّكَ حَمِيدٌ مَجِيدٌ',
    transliteration: 'Kamā bārakta ‘alā Ibrāhīma wa ‘alā āli Ibrāhīm, innaka hamīdun majīd',
    translation: 'as You blessed Ibrahim and the family of Ibrahim. You are Praiseworthy, Glorious.',
  },

  // — Closing ————————————————————————————————————————————————
  {
    id: 'salam',
    arabic: 'السَّلَامُ عَلَيْكُمْ وَرَحْمَةُ اللَّهِ',
    transliteration: 'As-salāmu ‘alaykum wa rahmatullāh',
    translation: 'Peace be upon you, and the mercy of Allah.',
  },
  {
    id: 'taqabbal',
    arabic: 'تَقَبَّلَ اللَّهُ مِنَّا وَمِنْكُمْ',
    transliteration: 'Taqabbalallāhu minnā wa minkum',
    translation: 'May Allah accept it from us and from you.',
  },
] as const satisfies readonly Recitation[]

export type RecitationId = (typeof lines)[number]['id']

export const recitations: Record<RecitationId, Recitation> = Object.fromEntries(
  lines.map((line) => [line.id, line]),
) as Record<RecitationId, Recitation>

export function getRecitation(id: string): Recitation {
  const line = (recitations as Record<string, Recitation>)[id]
  if (!line) throw new Error(`Unknown recitation "${id}"`)
  return line
}

/** Short surahs recited after Al-Fatiha in the first two rak'ahs, in mushaf order. */
export const surahsByRakah: Record<number, { name: string; lines: RecitationId[] }> = {
  1: { name: 'Al-Kawthar', lines: ['kawthar-1', 'kawthar-2', 'kawthar-3'] },
  2: { name: 'Al-Ikhlas', lines: ['ikhlas-1', 'ikhlas-2', 'ikhlas-3', 'ikhlas-4'] },
}
