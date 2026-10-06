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
| Arabic text of the prayer supplications (takbir, opening supplication, ta'awwudh, amin, ruku and sujud tasbih, tasmi', tahmid, the supplication between the prostrations, tashahhud, salawat, salam) (`src/content/recitations.ts`) | Hisn al-Muslim (Sa'id al-Qahtani), prayer chapter, and the hadith it cites (see the table below) | Hand-entered with full vowels | Checked against the printed Hisn al-Muslim during authoring. Hadith references and grades to be confirmed on dorar.net (Hadith Encyclopedia) | A | **Needs scholarly review before release** (vowelling and wording of every line) |
| Meanings of the supplications in English (`src/content/adhkar/en.ts`) | The standard English translation of Hisn al-Muslim (Fortress of the Muslim) | Copied, split into on-screen clauses | Read beside the Arabic | A | Follows the published text |
| Meanings of the supplications in de, fr, es, tr, id, nl, ur (`src/content/adhkar/more.ts`) | **PrayAlong translations** of the English meanings, using the wording each community usually uses where known | Written for PrayAlong | Tests check that every line has a meaning in every locale. The per-language choices to check are listed in `docs/content.md` | A (content), translation unreviewed | **Must be reviewed by qualified native speakers before release.** Where a published translation of Hisn al-Muslim exists in the language, reviewers should prefer its wording |
| Transliteration of every line (`src/content/recitations.ts`) | PrayAlong, from the vowelled Arabic | Hand-entered | Read against the Arabic | A (aid only) | Needs review; it is a reading aid, the Arabic is shown with it |
| Spoken and written guidance: how to do each movement, what to say next (`src/i18n/*.ts`, `public/audio/guide`) | PrayAlong, describing the standard form as given in the fiqh books of the four schools | Written in English, translated per locale; recorded with ElevenLabs | Interface review per language in `docs/content.md` | A (pillars and order), B (explanations) | Needs native-speaker review per language; wording to be checked by a scholar |
| Close-up illustrations: feet in sitting and in prostration, the index finger in tashahhud (`public/guides/*.webp`) | Generated with an image model (gemini-3.1-flash-image) from written posture descriptions and each companion's design; `prayalong-assets/gen_guides.py` | Generated, then picked by eye | Checked by eye against the description (left foot under the seat, right foot upright with toes bent towards the qibla; heels up and toes bent in sujud; index finger pointing) | A (shape of the posture), C where schools differ | Sitting shows iftirash. Some schools sit in tawarruk in the final tashahhud of three and four rak'ah prayers: to be noted in the app after review |
| Prayer times and qibla direction (`src/lib/prayer-times.ts`, `src/lib/location.ts`) | adhan (MIT), standard astronomical calculation; method chosen per region from the time zone, editable in Settings | npm package | Unit tests; the method and the Hanafi asr setting are visible to the user | B | Product decision per region (for example Diyanet for Turkey) open |
| "Taqabbal Allahu minna wa minkum" after the salam | A customary greeting between worshippers, reported from the Companions; not part of the prayer | Hand-entered | Shown after the prayer is complete, not as part of it | B | Source attribution and placement to be confirmed by a scholar |

### Supplication references (candidates, to confirm on dorar.net)

These are the hadith commonly cited for each line in Hisn al-Muslim and the
fiqh books. Each reference and grade still has to be looked up and confirmed on
dorar.net/hadith before the content is marked reviewed.

| Line id | Said in | Commonly cited source |
| --- | --- | --- |
| `takbir` | Opening and each movement | al-Bukhari 757, Muslim 397 (the hadith of the man who prayed badly) |
| `thana-1`, `thana-2` | Opening supplication | Abu Dawud 775, at-Tirmidhi 243 |
| `taawwudh` | Before al-Fatiha | Quran 16:98; Abu Dawud 775 |
| `amin` | After al-Fatiha | al-Bukhari 780, Muslim 410 |
| `ruku` | Bowing | Muslim 772 |
| `tasmi`, `tahmid` | Rising from ruku | al-Bukhari 789 and 795, Muslim 392 |
| `sujud` | Prostration | Muslim 772 |
| `jalsah` | Between the prostrations | Abu Dawud 874, Ibn Majah 897 |
| `tashahhud-1` to `tashahhud-4` | Sitting (tashahhud of Ibn Mas'ud) | al-Bukhari 831, Muslim 402 |
| `salawat-1` to `salawat-4` | Final sitting (as-salat al-Ibrahimiyyah) | al-Bukhari 3370, Muslim 406 |
| `salam` | End of the prayer | Abu Dawud 996, at-Tirmidhi 295 |

### Where the schools differ (level C)

| Point | What the app does | Status |
| --- | --- | --- |
| Raising the hands going into and rising from ruku | Setting (on by default, can be turned off), with the note "Done in the Shafi'i and Hanbali schools; not in the Hanafi and most Maliki practice. Follow what you were taught." | Done |
| Where the hands rest while standing | Hint says "right hand over left on your chest". Hanafi practice places them below the navel | Flagged for scholar decision |
| Sitting in the final tashahhud | Iftirash shown in every sitting | Flagged: tawarruk in the final sitting for some schools |
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
