# Sources, verification and licences

PrayAlong teaches the standard form of the five daily prayers to people who
may be praying for the first time. This document records, for every kind of
content the app shows or recites, where it comes from, how it got into the
app, how it is checked, which content level it belongs to, and what still
needs review. It also lists the licences of third-party components and the
privacy position.

Content levels follow the scientific reference package of the AI Challenge in
Service of Islamic Content:

| Level | Scope | Required handling |
| --- | --- | --- |
| A | Established, original information: Quran, authentic hadith, pillars, basic sirah, morals | Direct answer documented with its source |
| B | Explanation, definition, evidence | From approved material, with the reference shown; no certainty where there is disagreement |
| C | Fiqh disagreement and other sensitive matters | Restricted to what is approved, state that a difference exists, or refer to a specialist |
| D | Fatwa or a personal case | No independent ruling: give general information and refer to a qualified authority |

## What PrayAlong does and does not do

- It shows and recites a **fixed, sourced text**. No generative model writes
  or rewrites Quran, supplications, translations or rulings at run time.
- The speech recogniser only decides **where the user is** in that fixed text
  (which line, which word, how many repetitions). It never produces text that
  is shown to the user. If it is unsure, the app falls back to timers and
  stays on the text; it does not guess new content.
- It teaches **one standard form** of the obligatory (fard) prayers: opening
  takbir, opening supplication, ta'awwudh, al-Fatiha, a short surah in the
  first two rak'ahs, ruku, rising, two prostrations with the sitting between
  them, tashahhud, salawat and salam.
- Where the schools of law differ, it either offers a setting with a short
  neutral note naming the schools (raising the hands at ruku) or keeps the
  difference on the review list below. It says "follow what you were taught".
- It gives **no fatwa and no personal rulings** (level D). It has no chat or
  question box, so it cannot be asked for one. The intended answer to any
  personal question is: ask a scholar or your local mosque.
- The companions are animated characters, not people and not teachers with
  authority. The app is an automated tool and presents itself as one.

## Content inventory

| Content | Exact source | How it was obtained | How it is verified | Level | Review status |
| --- | --- | --- | --- | --- | --- |
| Arabic text of the recited verses: al-Fatiha, and the short surahs al-Asr, al-Kawthar, al-Kafirun, an-Nasr, al-Masad, al-Ikhlas, al-Falaq, an-Nas (`src/content/quran/ar.json`) | Tanzil Quran text, "simple" script (tanzil.net), Hafs 'an 'Asim | Fetched verbatim by `scripts/fetch-quran-translations.mjs` from fawazahmed0/quran-api (`ara-quransimple`), which mirrors Tanzil | Never edited by hand; the script is the only writer. `src/sequence/build.test.ts` and `src/content/coverage.test.ts` check that every recited line has its text. Tanzil itself is checked against the Madinah mushaf by the Tanzil project | A | Approved source. Planned: cross-check every verse character by character against the King Fahd Complex (qurancomplex.gov.sa) Hafs text |
| Phoneme targets for the speech recogniser (`src/content/phonemes.json`) | quran-g2p (Quran Lab), pinned Tanzil Uthmani text of the same verses | `python scripts/gen-phonemes.py` | The script fails if any line's word count differs from the displayed text. Used only for alignment, never displayed | A (derived) | Internal; no user-facing text |
| Meanings of the verses in 8 languages (`src/content/quran/<locale>.json`) | Published translations: en Saheeh International; de Bubenheim and Elyas; fr Muhammad Hamidullah; es Isa Garcia; tr Diyanet Isleri; id Kementerian Agama RI; nl Sofian S. Siregar; ur Muhammad Junagarhi | Fetched verbatim from fawazahmed0/quran-api, which mirrors King Fahd Complex, Tanzil and Quran.com editions. Edition id and credit are stored in each file | Never edited by hand; the credit is shown in Settings ("Quran: {credit}"). Tests fail if a recited verse lacks a meaning in any locale | A | Approved translations. Planned: confirm each edition against the copy on quranenc.com (King Fahd Complex translations, the organiser's approved reference) and switch the language to the QuranEnc edition where the edition differs or is not listed there |
| Arabic text of the prayer supplications (takbir, opening supplication, ta'awwudh, amin, ruku and sujud tasbih, tasmi', tahmid, the supplication between the prostrations, tashahhud, salawat, salam) (`src/content/recitations.ts`) | Hisn al-Muslim (Sa'id al-Qahtani), prayer chapter (nos. 28, 33, 38, 39, 41, 48, 52, 53), and the hadith behind each line (see the table below) | Hand-entered with full vowels | Every line checked against the matn in al-Maktaba al-Shamela: al-Bukhari, Muslim, Abu Dawud, al-Tirmidhi, al-Nasa'i, Ibn Majah, with the grade of al-Albani for the Sunan. All sources are sahih or hasan; the wording matches a reported matn (wording check below) | A | Sources and grades verified. **Vowelling still needs scholarly review before release.** Open for the reviewer: short ta'awwudh form; see the wording check |
| Meanings of the supplications in English (`src/content/adhkar/en.ts`) | The standard English translation of Hisn al-Muslim (Fortress of the Muslim) | Copied, split into on-screen clauses | Read beside the Arabic | A | Follows the published text |
| Meanings of the supplications in de, fr, es, tr, id, nl, ur (`src/content/adhkar/more.ts`) | **PrayAlong translations** of the English meanings, using the wording each community usually uses where known | Written for PrayAlong | Tests check that every line has a meaning in every locale. The per-language choices to check are listed in `docs/content.md` | A (content), translation unreviewed | **Must be reviewed by qualified native speakers before release.** Where a published translation of Hisn al-Muslim exists in the language, reviewers should prefer its wording |
| Transliteration of every line (`src/content/recitations.ts`) | PrayAlong, from the vowelled Arabic | Hand-entered | Read against the Arabic | A (aid only) | Needs review; it is a reading aid, the Arabic is shown with it |
| Spoken and written guidance: how to do each movement, what to say next (`src/i18n/*.ts`, `public/audio/guide`) | PrayAlong, describing the standard form as given in the fiqh books of the four schools | Written in English, translated per locale; recorded with ElevenLabs | Interface review per language in `docs/content.md` | A (pillars and order), B (explanations) | Needs native-speaker review per language; wording to be checked by a scholar |
| Close-up illustrations: feet in sitting and in prostration, the index finger in tashahhud (`public/guides/*.webp`) | Generated with an image model (gemini-3.1-flash-image) from written posture descriptions and each companion's design; `prayalong-assets/gen_guides.py` | Generated, then picked by eye | Checked by eye against the description (left foot under the seat, right foot upright with toes bent towards the qibla; heels up and toes bent in sujud; index finger pointing) | A (shape of the posture), C where schools differ | Sitting shows iftirash. Some schools sit in tawarruk in the final tashahhud of three and four rak'ah prayers: to be noted in the app after review |
| Prayer times and qibla direction (`src/lib/prayer-times.ts`, `src/lib/location.ts`) | adhan (MIT), standard astronomical calculation; method chosen per region from the time zone, editable in Settings | npm package | Unit tests; the method and the Hanafi asr setting are visible to the user | B | Product decision per region (for example Diyanet for Turkey) open |
| "Taqabbal Allahu minna wa minkum" after the salam | A greeting reported from the Companions on the day of Eid (Jubayr ibn Nufayr, isnad hasan per Ibn Hajar, Fath al-Bari 2/446); not a hadith of the Prophet and not part of the prayer | Hand-entered | Shown after the prayer is complete, not as part of it. Reports checked in Fath al-Bari, Tamam al-Minna and al-Sunan al-Kubra of al-Bayhaqi | B | Source verified. The reports are about Eid, not each daily prayer: a scholar should decide whether to keep it after every prayer or show it only on Eid |

### Supplication references (verified in al-Maktaba al-Shamela)

**Sources: approved Shamela editions; cross-check links: dorar.net (both are
the organisers' approved hadith references).**

The "Check on dorar.net" column links each hadith to its page in the Hadith
Encyclopedia of dorar.net (al-Mawsu'a al-Hadithiyya), which shows the matn
with its grade. Where dorar.net has a page for the same collection and number,
the link goes to that page (dorar.net/h/...). Where it does not, the link is a
dorar.net search for a phrase of the matn, which lists the narration with its
grades. The links were checked on 6 October 2026. Differences from dorar.net:

- Grades: every linked page gives the same grade as the table. One point for
  the reviewer: for al-Tirmidhi 248 (`amin`), dorar.net lists two entries by
  al-Albani, Sahih al-Tirmidhi 248 (sahih, linked) and Da'if al-Tirmidhi 248
  ("shadh"); the second appears to concern a different wording of Wa'il's
  report. Abu Dawud 932 is sahih on dorar.net, as in the table.
- Numbering: dorar.net cites al-Albani's Sahih Ibn Majah by its own number
  (739 and 755 for the jalsah and salam hadith), and lists the toes hadith of
  Ibn 'Umar as Sahih al-Nasa'i 1157 (cited here as al-Nasa'i 1158, Sahih Sunan
  al-Nasa'i 1109). The matn and narrator are the same.

Each line was looked up on 6 October 2026 in a local copy of al-Maktaba
al-Shamela (Shamela 4 export). The matn was read in the book itself, and the
grade was taken from the same edition. Editions and numbering:

| Short name | Shamela book | Numbering and grades |
| --- | --- | --- |
| al-Bukhari | Sahih al-Bukhari, Sultaniyya edition | Numbering of Muhammad Fu'ad 'Abd al-Baqi, as in Fath al-Bari |
| Muslim | Sahih Muslim, ed. Muhammad Fu'ad 'Abd al-Baqi | Main number ('Abd al-Baqi) |
| Abu Dawud | Sunan Abi Dawud, ed. Muhyi al-Din 'Abd al-Hamid | Grade of al-Albani printed with each hadith |
| al-Tirmidhi | Sunan al-Tirmidhi, ed. Ahmad Shakir | Grade of al-Albani printed with each hadith; al-Tirmidhi's own verdict where he gives one |
| al-Nasa'i | Sunan al-Nasa'i (al-Mujtaba), Egyptian edition | Abu Ghudda numbering; grade from al-Albani, Sahih Sunan al-Nasa'i |
| Ibn Majah | Sunan Ibn Majah, ed. Muhammad Fu'ad 'Abd al-Baqi | Grade of al-Albani printed with each hadith |
| al-Bayhaqi | al-Sunan al-Kubra, Dar al-Kutub al-'Ilmiyya edition | Edition numbering |
| Hisn al-Muslim | Hisn al-Muslim min adhkar al-Kitab wa-l-Sunna, Sa'id al-Qahtani, Safir print | Running number of each dhikr in the print |
| Fath al-Bari | Fath al-Bari, Ibn Hajar, Salafiyya edition | Volume/page |
| Tamam al-Minna | Tamam al-Minna fi al-ta'liq 'ala Fiqh al-Sunna, al-Albani | Page |

#### Recited lines

| Line id | Hadith source (collection, book or bab, number) | Grade (by whom) | Hisn al-Muslim no. | Verified in | Check on dorar.net |
| --- | --- | --- | --- | --- | --- |
| `takbir` | Opening: al-Bukhari 757, Kitab al-Adhan, bab wujub al-qira'a li-l-imam wa-l-ma'mum; Muslim 397, Kitab al-Salat, bab wujub qira'at al-Fatiha (the man who prayed badly: "when you stand for the prayer, say takbir"). The words "Allahu akbar" and a takbir at each movement: al-Bukhari 795, bab ma yaqul al-imam wa man khalfahu idha rafa'a ra'sahu min al-ruku'; al-Bukhari 789, bab al-takbir idha qama min al-sujud. "Its opening is the takbir": Abu Dawud 61, bab fard al-wudu'; al-Tirmidhi 3 | al-Bukhari and Muslim: sahih. Abu Dawud 61, al-Tirmidhi 3: hasan sahih (al-Albani) | Not a numbered item | Sahih al-Bukhari; Sahih Muslim; Sunan Abi Dawud; Sunan al-Tirmidhi | [al-Bukhari 757](https://dorar.net/h/3gzp06Yt) |
| `thana-1`, `thana-2` | Abu Dawud 775 (Abu Sa'id al-Khudri) and 776 ('A'isha), bab man ra'a al-istiftah bi-Subhanaka Allahumma wa bihamdik; al-Tirmidhi 242, 243, bab ma yaqul 'inda iftitah al-salat. Also Muslim 399, Kitab al-Salat, bab hujjat man qala la yajhar bi-l-basmala: 'Umar ibn al-Khattab said it aloud in prayer (a report from 'Umar) | Sahih (al-Albani) for Abu Dawud 775, 776 and al-Tirmidhi 242, 243. Abu Dawud and al-Tirmidhi each note a weakness in a single chain; al-Albani grades the hadith sahih | 28 | Sunan Abi Dawud; Sunan al-Tirmidhi; Sahih Muslim; Hisn al-Muslim | [search: Abu Dawud 775, al-Tirmidhi 242](https://dorar.net/hadith/search?q=%D8%B3%D8%A8%D8%AD%D8%A7%D9%86%D9%83%20%D8%A7%D9%84%D9%84%D9%87%D9%85%20%D9%88%D8%A8%D8%AD%D9%85%D8%AF%D9%83%20%D9%88%D8%AA%D8%A8%D8%A7%D8%B1%D9%83%20%D8%A7%D8%B3%D9%85%D9%83&st=a) |
| `taawwudh` | The app's wording is Quran 16:98 ("fa-sta'idh billahi min al-shaytan al-rajim"). In prayer, Abu Dawud 775 and al-Tirmidhi 242 give a longer form (see the wording check). The same short phrase is taught in al-Bukhari 6115, Kitab al-Adab, bab al-hadhar min al-ghadab (outside prayer) | Quran. Abu Dawud 775, al-Tirmidhi 242: sahih (al-Albani). al-Bukhari 6115: sahih | Not a separate item. No. 31 has a longer form (Abu Dawud 764, Ibn Majah 807), graded da'if by al-Albani in these editions and hasan li-ghayrihi by Shu'ayb al-Arna'ut as quoted by al-Qahtani | Sahih al-Bukhari; Sunan Abi Dawud; Sunan al-Tirmidhi; Sunan Ibn Majah; Hisn al-Muslim | [al-Bukhari 6115](https://dorar.net/h/LTmCGVB1); [search: Abu Dawud 775](https://dorar.net/hadith/search?q=%D8%A3%D8%B9%D9%88%D8%B0%20%D8%A8%D8%A7%D9%84%D9%84%D9%87%20%D8%A7%D9%84%D8%B3%D9%85%D9%8A%D8%B9%20%D8%A7%D9%84%D8%B9%D9%84%D9%8A%D9%85%20%D9%85%D9%86%20%D8%A7%D9%84%D8%B4%D9%8A%D8%B7%D8%A7%D9%86%20%D8%A7%D9%84%D8%B1%D8%AC%D9%8A%D9%85%20%D9%85%D9%86%20%D9%87%D9%85%D8%B2%D9%87&st=a) |
| `amin` | al-Bukhari 780, Kitab al-Adhan, bab jahr al-imam bi-l-ta'min; Muslim 410, Kitab al-Salat, bab al-tasmi' wa-l-tahmid wa-l-ta'min; Abu Dawud 932, bab al-ta'min wara' al-imam; al-Tirmidhi 248, bab ma ja'a fi al-ta'min (Wa'il ibn Hujr: after "wa la al-dallin" he said "amin") | al-Bukhari and Muslim: sahih. Abu Dawud 932, al-Tirmidhi 248: sahih (al-Albani); hasan (al-Tirmidhi) | Not a numbered item | Sahih al-Bukhari; Sahih Muslim; Sunan Abi Dawud; Sunan al-Tirmidhi | [Abu Dawud 932 (al-Albani: sahih)](https://dorar.net/h/4Mu8r5vX); [al-Tirmidhi 248 (al-Albani: sahih)](https://dorar.net/h/ZPgNfLmV) |
| `ruku` | Muslim 772 (Hudhayfa), Kitab Salat al-Musafirin, bab istihbab tatwil al-qira'a fi salat al-layl; al-Tirmidhi 262, bab ma ja'a fi al-tasbih fi al-ruku' wa-l-sujud; Abu Dawud 874, bab ma yaqul al-rajul fi ruku'ihi wa sujudihi. Three times: Ibn Majah 888, bab al-tasbih fi al-ruku' wa-l-sujud | Muslim: sahih. al-Tirmidhi 262: hasan sahih (al-Tirmidhi), sahih (al-Albani). Abu Dawud 874, Ibn Majah 888: sahih (al-Albani) | 33 (three times) | Sahih Muslim; Sunan al-Tirmidhi; Sunan Abi Dawud; Sunan Ibn Majah; Hisn al-Muslim | [Muslim 772](https://dorar.net/h/uRwJgKlo) |
| `tasmi` | al-Bukhari 789 and 795 (Abu Hurayra); Muslim 392, Kitab al-Salat, bab ithbat al-takbir fi kull khafd wa raf' illa raf'ahu min al-ruku' fa-yaqul fihi "sami'a Allahu liman hamidah"; Muslim 772 | Sahih | 38 | Sahih al-Bukhari; Sahih Muslim; Hisn al-Muslim | [al-Bukhari 789](https://dorar.net/h/GEAHFDUP); [al-Bukhari 795](https://dorar.net/h/LsJ0Azh7) |
| `tahmid` | Exact wording "rabbana wa laka al-hamd": al-Bukhari 732, bab ijab al-takbir wa iftitah al-salat, and al-Bukhari 735, bab raf' al-yadayn fi al-takbira al-ula. Other authentic forms: "rabbana laka al-hamd" (al-Bukhari 789), "Allahumma rabbana laka al-hamd" (al-Bukhari 796), "Allahumma rabbana wa laka al-hamd" (al-Bukhari 795) | Sahih | 39 (longer form) | Sahih al-Bukhari; Hisn al-Muslim | [al-Bukhari 732](https://dorar.net/h/QfMJmPi1); [al-Bukhari 735](https://dorar.net/h/3PdCLmh9) |
| `sujud` | Muslim 772; al-Tirmidhi 262; Abu Dawud 874. Three times: Ibn Majah 888 | As for `ruku` | 41 (three times) | As for `ruku` | [Muslim 772](https://dorar.net/h/uRwJgKlo) |
| `jalsah` | Abu Dawud 874 (Hudhayfa), bab ma yaqul al-rajul fi ruku'ihi wa sujudihi; Ibn Majah 897, bab ma yaqul bayn al-sajdatayn; al-Nasa'i 1145, Kitab al-Tatbiq, bab al-du'a' bayn al-sajdatayn | Sahih (al-Albani) for all three | 48 | Sunan Abi Dawud; Sunan Ibn Majah; Sunan al-Nasa'i; Sahih Sunan al-Nasa'i; Hisn al-Muslim | [Ibn Majah, Sahih Ibn Majah 739 (al-Albani: sahih)](https://dorar.net/h/umT5heIi); [search: Abu Dawud 874](https://dorar.net/hadith/search?q=%D8%B1%D8%A8%20%D8%A7%D8%BA%D9%81%D8%B1%20%D9%84%D9%8A%20%D8%B1%D8%A8%20%D8%A7%D8%BA%D9%81%D8%B1%20%D9%84%D9%8A&st=a) |
| `tashahhud-1` to `tashahhud-4` | Tashahhud of Ibn Mas'ud: al-Bukhari 831, Kitab al-Adhan, bab al-tashahhud fi al-akhira; Muslim 402, Kitab al-Salat, bab al-tashahhud fi al-salat | Sahih | 52 | Sahih al-Bukhari; Sahih Muslim; Hisn al-Muslim | [al-Bukhari 831](https://dorar.net/h/DkwVeIra) |
| `salawat-1` to `salawat-4` | Ka'b ibn 'Ujra: al-Bukhari 3370, Kitab Ahadith al-Anbiya' (the app's wording); al-Bukhari 6357, Kitab al-Da'awat, bab al-salat 'ala al-Nabi; Muslim 406, Kitab al-Salat, bab al-salat 'ala al-Nabi ba'd al-tashahhud | Sahih | 53 | Sahih al-Bukhari; Sahih Muslim; Hisn al-Muslim | [al-Bukhari 3370](https://dorar.net/h/2KHlClbG); [al-Bukhari 6357](https://dorar.net/h/6qdnQQxE) |
| `salam` | Ibn Mas'ud: Abu Dawud 996, bab fi al-salam; al-Tirmidhi 295, bab ma ja'a fi al-taslim fi al-salat; Ibn Majah 914, bab al-taslim. Turning right and left: Muslim 582 (Sa'd ibn Abi Waqqas), Kitab al-Masajid, bab al-salam li-l-tahlil min al-salat. "Its ending is the taslim": Abu Dawud 61, al-Tirmidhi 3 | Sahih (al-Albani) for Abu Dawud 996, al-Tirmidhi 295, Ibn Majah 914; hasan sahih (al-Tirmidhi). Muslim 582: sahih | Not a numbered item | Sunan Abi Dawud; Sunan al-Tirmidhi; Sunan Ibn Majah; Sahih Muslim | [Abu Dawud 996 (al-Albani: sahih)](https://dorar.net/h/Hd9Gdc0p); [Ibn Majah, Sahih Ibn Majah 755 (al-Albani: sahih)](https://dorar.net/h/asnfeHZ4) |

#### Postures shown or described

| Point | Hadith source (collection, book or bab, number) | Grade (by whom) | Hisn al-Muslim no. | Verified in | Check on dorar.net |
| --- | --- | --- | --- | --- | --- |
| Raising the hands at the opening, going into ruku and rising from it (the optional setting) | Ibn 'Umar: al-Bukhari 735, Kitab al-Adhan, bab raf' al-yadayn fi al-takbira al-ula ma'a al-iftitah sawa'; Muslim 390, Kitab al-Salat, bab istihbab raf' al-yadayn hadhw al-mankibayn | Sahih. The schools differ on acting on it (level C note in the app) | Not applicable | Sahih al-Bukhari; Sahih Muslim | [al-Bukhari 735](https://dorar.net/h/3PdCLmh9) |
| Raising the index finger in the tashahhud | Ibn 'Umar: Muslim 580 ("he raised the finger next to the thumb and supplicated with it"); Ibn al-Zubayr: Muslim 579 ("and he pointed with his finger"). Both Kitab al-Masajid, bab sifat al-julus fi al-salat | Sahih | Not applicable | Sahih Muslim | [Muslim 580](https://dorar.net/h/Iszw9fCi); [Muslim 579](https://dorar.net/h/ScOXfSk6) |
| Iftirash sitting (left foot under the seat, right foot upright) | Abu Humayd al-Sa'idi: al-Bukhari 828, Kitab al-Adhan, bab sunnat al-julus fi al-tashahhud; 'A'isha: Muslim 498, Kitab al-Salat, bab ma yajma' sifat al-salat. al-Bukhari 828 also describes tawarruk in the last rak'ah, which supports the open level C note below | Sahih | Not applicable | Sahih al-Bukhari; Sahih Muslim | [al-Bukhari 828](https://dorar.net/h/qGyRdlJc); [Muslim 498](https://dorar.net/h/TNAkRI7A) |
| Toes bent towards the qibla | In sujud: al-Bukhari 828 ("he faced the qibla with the tips of his toes"). In sitting, the right foot: Ibn 'Umar, al-Nasa'i 1158, Kitab al-Tatbiq, bab al-istiqbal bi-atraf asabi' al-qadam al-qibla 'inda al-qu'ud li-l-tashahhud | al-Bukhari 828: sahih. al-Nasa'i 1158: sahih (al-Albani, Sahih Sunan al-Nasa'i 1109) | Not applicable | Sahih al-Bukhari; Sunan al-Nasa'i; Sahih Sunan al-Nasa'i | [al-Bukhari 828](https://dorar.net/h/qGyRdlJc); [al-Nasa'i, Sahih al-Nasa'i 1157 on dorar (al-Albani: sahih)](https://dorar.net/h/Gfjh4q5M) |

#### After the prayer: "taqabbal Allahu minna wa minkum"

This is a greeting between Muslims. It is not part of the prayer and it is not
a hadith of the Prophet. What the sources say:

| Report | Source | Grade (by whom) | Verified in | Check on dorar.net |
| --- | --- | --- | --- | --- |
| Jubayr ibn Nufayr: when the Companions of the Messenger of Allah met on the day of Eid, they said to one another "taqabbal Allahu minna wa minka" | Ibn Hajar, Fath al-Bari 2/446, Kitab al-'Idayn, under bab sunnat al-'idayn li-ahl al-Islam, citing al-Mahamiliyyat | Isnad hasan (Ibn Hajar). al-Albani, Tamam al-Minna pp. 354 to 356: the chain in al-Mahamili's Salat al-'Idayn is sahih | Fath al-Bari; Tamam al-Minna | [Tamam al-Minna 354 (al-Albani: isnad sahih)](https://dorar.net/h/x9ONriNC) |
| Abu Umama al-Bahili and other Companions said it to each other on Eid; Abu Umama in the form "minna wa minkum" | Cited in Tamam al-Minna p. 356 (from Ibn al-Turkmani and al-Suyuti) | Isnad jayyid (Ahmad ibn Hanbal, as quoted by al-Albani); hasan (al-Suyuti, as quoted by al-Albani) | Tamam al-Minna | [search: taqabbal Allahu minna wa minkum](https://dorar.net/hadith/search?q=%D8%AA%D9%82%D8%A8%D9%84%20%D8%A7%D9%84%D9%84%D9%87%20%D9%85%D9%86%D8%A7%20%D9%88%D9%85%D9%86%D9%83%D9%85&st=a) |
| 'Umar ibn 'Abd al-'Aziz did not object when people said it to him on the two Eids | al-Bayhaqi, al-Sunan al-Kubra 6296, Kitab Salat al-'Idayn, bab ma ruwiya fi qawl al-nas yawm al-'id ba'duhum li-ba'd | Report from a Successor | al-Sunan al-Kubra | Not a hadith; not on dorar.net |
| Wathila ibn al-Asqa', attributed to the Prophet | al-Bayhaqi 6294, 6295 | Weak: munkar (Ibn 'Adi); al-Bayhaqi: not preserved; weak (Ibn Hajar, Fath al-Bari 2/446) | al-Sunan al-Kubra; Fath al-Bari | [al-Silsila al-Da'ifa 5666 (al-Albani: da'if jiddan)](https://dorar.net/h/HdRFDZsy) |
| 'Ubada ibn al-Samit, attributed to the Prophet, disapproving of it | al-Bayhaqi 6297 | Weak: 'Abd al-Khaliq ibn Zayd is munkar al-hadith (al-Bukhari, as quoted by al-Bayhaqi); weak (Ibn Hajar) | al-Sunan al-Kubra; Fath al-Bari | [search: taqabbal Allahu minna wa minka](https://dorar.net/hadith/search?q=%D8%AA%D9%82%D8%A8%D9%84%20%D8%A7%D9%84%D9%84%D9%87%20%D9%85%D9%86%D8%A7%20%D9%88%D9%85%D9%86%D9%83&st=a) |

All of these reports are about the day of Eid. None of them is about saying
it after each daily prayer. The app shows it on the screen after the prayer is
complete, as a kind word, outside the prayer itself. Whether to keep it after
every daily prayer, or to show it only on Eid, is left to the reviewing
scholar (see the content inventory).

The Mahamiliyyat volumes present in this Shamela copy are partial and do not
contain the Jubayr report, so it was verified through the citations of Ibn
Hajar and al-Albani.

#### Wording check

The Arabic in `src/content/recitations.ts` compared with the matn. Vowel marks
were ignored in the comparison; the vowelling still needs the scholarly review
listed in the inventory.

| Line id | App text | Matn in the source | Result |
| --- | --- | --- | --- |
| `takbir` | اللَّهُ أَكْبَرُ | الله أكبر<br>(al-Bukhari 795) | Same |
| `thana-1`, `thana-2` | سُبْحَانَكَ اللَّهُمَّ وَبِحَمْدِكَ وَتَبَارَكَ اسْمُكَ وَتَعَالَىٰ جَدُّكَ وَلَا إِلَٰهَ غَيْرُكَ | سبحانك اللهم وبحمدك، وتبارك اسمك، وتعالى جدك، ولا إله غيرك<br>(Abu Dawud 775, 776; al-Tirmidhi 242, 243; Hisn 28) | Same. Muslim 399 (from 'Umar) has "tabaraka" without the "wa" before it |
| `taawwudh` | أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ | أعوذ بالله السميع العليم من الشيطان الرجيم من همزه ونفخه ونفثه<br>(Abu Dawud 775, al-Tirmidhi 242) | Differs: the app uses the short form of Quran 16:98 and al-Bukhari 6115. The hadith form in prayer adds "al-Sami' al-'Alim" and "min hamzihi wa nafkhihi wa nafthihi". The short form is the common practice; the longer form could be offered as an alternative after review |
| `amin` | آمِين | آمين<br>(al-Bukhari 780, Abu Dawud 932) | Same |
| `ruku` | سُبْحَانَ رَبِّيَ الْعَظِيمِ | سبحان ربي العظيم<br>(Muslim 772) | Same. Said three times in the app, as in Hisn 33 and Ibn Majah 888 |
| `tasmi` | سَمِعَ اللَّهُ لِمَنْ حَمِدَهُ | سمع الله لمن حمده<br>(al-Bukhari 789) | Same |
| `tahmid` | رَبَّنَا وَلَكَ الْحَمْدُ | ربنا ولك الحمد<br>(al-Bukhari 732, 735) | Same. Hisn 39 continues with "hamdan kathiran tayyiban mubarakan fih", which the app does not include |
| `sujud` | سُبْحَانَ رَبِّيَ الْأَعْلَىٰ | سبحان ربي الأعلى<br>(Muslim 772) | Same. Said three times in the app, as in Hisn 41 |
| `jalsah` | رَبِّ اغْفِرْ لِي | رب اغفر لي، رب اغفر لي<br>(Abu Dawud 874, Ibn Majah 897) | Same; the app says the line twice, as in the hadith |
| `tashahhud-1` to `tashahhud-4` | التَّحِيَّاتُ لِلَّهِ وَالصَّلَوَاتُ وَالطَّيِّبَاتُ، السَّلَامُ عَلَيْكَ أَيُّهَا النَّبِيُّ وَرَحْمَةُ اللَّهِ وَبَرَكَاتُهُ، السَّلَامُ عَلَيْنَا وَعَلَىٰ عِبَادِ اللَّهِ الصَّالِحِينَ، أَشْهَدُ أَنْ لَا إِلَٰهَ إِلَّا اللَّهُ وَأَشْهَدُ أَنَّ مُحَمَّدًا عَبْدُهُ وَرَسُولُهُ | التحيات لله، والصلوات والطيبات، السلام عليك أيها النبي ورحمة الله وبركاته، السلام علينا وعلى عباد الله الصالحين، أشهد أن لا إله إلا الله، وأشهد أن محمدا عبده ورسوله<br>(al-Bukhari 831, Muslim 402) | Same |
| `salawat-1` to `salawat-4` | اللَّهُمَّ صَلِّ عَلَىٰ مُحَمَّدٍ وَعَلَىٰ آلِ مُحَمَّدٍ كَمَا صَلَّيْتَ عَلَىٰ إِبْرَاهِيمَ وَعَلَىٰ آلِ إِبْرَاهِيمَ إِنَّكَ حَمِيدٌ مَجِيدٌ، اللَّهُمَّ بَارِكْ عَلَىٰ مُحَمَّدٍ وَعَلَىٰ آلِ مُحَمَّدٍ كَمَا بَارَكْتَ عَلَىٰ إِبْرَاهِيمَ وَعَلَىٰ آلِ إِبْرَاهِيمَ إِنَّكَ حَمِيدٌ مَجِيدٌ | The same words in al-Bukhari 3370 and Hisn 53 | Same as al-Bukhari 3370. al-Bukhari 6357 and Muslim 406 say "kama sallayta 'ala al Ibrahim" and "kama barakta 'ala al Ibrahim", without "'ala Ibrahim wa" |
| `salam` | السَّلَامُ عَلَيْكُمْ وَرَحْمَةُ اللَّهِ | السلام عليكم ورحمة الله<br>(Abu Dawud 996, al-Tirmidhi 295) | Same; said to the right and to the left, as in the hadith |
| `taqabbal` | تَقَبَّلَ اللَّهُ مِنَّا وَمِنْكُمْ | تقبل الله منا ومنك<br>(Jubayr ibn Nufayr report)<br>تقبل الله منا ومنكم<br>(Abu Umama, and the Successors' report in Tamam al-Minna) | Both forms are reported. The context differs: the reports are for Eid, the app shows it after every prayer |

Summary: every recited line of the prayer has an authentic source, and the
app's wording matches a reported matn. Two points remain for the reviewer:
the short ta'awwudh (valid, but not the hadith form used in prayer) and the
placement of "taqabbal Allahu minna wa minkum" after every prayer.

### Where the schools differ (level C)

| Point | What the app does | Status |
| --- | --- | --- |
| Raising the hands going into and rising from ruku | Setting (on by default, can be turned off), with the note "Done in the Shafi'i and Hanbali schools; not in the Hanafi and most Maliki practice. Follow what you were taught." | Done |
| Where the hands rest while standing | Hint says "right hand over left on your chest". Hanafi practice places them below the navel | Flagged for scholar decision |
| Sitting in the final tashahhud | Iftirash shown in every sitting | Flagged: tawarruk in the final sitting for some schools (al-Bukhari 828 describes it) |
| Choice of opening supplication and tashahhud wording | One authentic wording of each is taught | Others are equally valid; to be stated in the app |
| Prayer-time method and asr | Regional default, user can change it | Product decision open |

Anything beyond these, for example making up a missed prayer, shortening while
travelling, or doubts about one's own prayer, is level D and outside the app.

## How changes are controlled

- Quran text and meanings change only by changing the edition in
  `scripts/fetch-quran-translations.mjs`, re-running it, and recording the
  choice in `docs/content.md`. The JSON files are never edited by hand.
- Supplication text lives in one file (`src/content/recitations.ts`); the
  phoneme targets are regenerated from it, and the build fails if the two
  disagree.
- Recited audio is regenerated from the same text (`tools/audio/gen_audio.py`),
  so the voice cannot drift from what is on screen. Word timings come from the
  TTS alignment of that text.
- Review sign-off per language is recorded in the table at the end of
  `docs/content.md`.

## Third-party components and licences

| Component | Used for | Licence or terms |
| --- | --- | --- |
| Quran Lab zipformer2 CTC phoneme model v3.1 (int8) | On-device Quran speech recognition | Quran Lab's own model; served from Quran Lab storage |
| sherpa-onnx WASM runtime | Runs the speech model in the browser | Apache-2.0 (`public/voice/runtime/LICENSE.sherpa-onnx`) |
| onnxruntime-web | Runs DETRPose | MIT |
| MediaPipe Tasks Vision (Pose Landmarker, Face Landmarker) | Camera beta | Apache-2.0 |
| DETRPose (github.com/SebastianJanampa/DETRPose) | Camera beta, second pose model | Apache-2.0 (see `tools/detrpose/README.md`) |
| ElevenLabs eleven_v4 | Recitation and spoken guidance, generated once and shipped as audio files | ElevenLabs Terms of Service for generated output; voices designed for PrayAlong, not cloned from a person |
| Meshy (meshy-7.1, auto-rig) | 3D bodies of the four companions, from PrayAlong's own concept art | Generated output, used under Meshy's terms for the generating account |
| Quaternius Universal Base Characters | Hands of the companions (3 joints per finger) | CC0 |
| Image model (gemini-3.1-flash-image) | Concept art and the posture close-ups | Generated output under the provider's terms |
| three.js, React Three Fiber, drei, postprocessing, @pixiv/three-vrm | 3D stage | MIT |
| React, Zustand, Radix UI, Motion, Tailwind CSS, lucide-react | Interface | MIT (lucide-react ISC) |
| adhan | Prayer times | MIT |
| Fonts: Figtree, Inter, Source Serif 4, Noto Sans Arabic, Noto Nastaliq Urdu, Amiri, Amiri Quran (via @fontsource) | Text in all languages | SIL Open Font License 1.1 |
| Tanzil Quran text | Arabic of the verses | Tanzil terms: verbatim copies with attribution, no changes to the text |
| Translations via fawazahmed0/quran-api | Meanings of the verses | Each translation remains under its publisher's terms; the translator credit is shown in the app |

## Privacy

- No account, no sign-up, no analytics, no advertising.
- Microphone audio is processed in a Web Worker in the browser and discarded.
  The speech model is downloaded once and cached; audio is never uploaded.
  An opt-in setting, off by default ("Record my sessions on this device"),
  keeps the session's audio on the device so the user can save it to help fix
  problems; nothing is sent automatically.
- Camera frames (beta, off by default) are processed in Web Workers in the
  browser and discarded. Video is never uploaded.
- Location, if the user allows it, is used on the device to compute prayer
  times and the qibla, and is kept in the browser's local storage. Without
  permission the app estimates the region from the time zone.
- Settings (language, mode, companion) are kept in local storage on the device.
- The app infers nothing about the user's faith, practice or school, and
  keeps no history of prayers.
- The site is static files on Cloudflare; the host sees ordinary requests for
  those files, as for any website. The app itself sends no data.
