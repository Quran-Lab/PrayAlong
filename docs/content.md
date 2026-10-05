# Content sources and review

PrayAlong shows religious text to people who may be praying for the first
time. Everything on screen during a prayer comes from one of the sources
below, and nothing in a non-English language ships until a qualified native
speaker has signed it off.

| What | Where | Source | Status |
| --- | --- | --- | --- |
| Arabic of the Quran lines | `src/content/quran/ar.json` | Tanzil "simple" text, fetched verbatim | Approved source |
| Arabic of the supplications, all transliteration | `src/content/recitations.ts` | Hand-entered, fully vowelled | Needs scholarly review before release |
| Quran meanings | `src/content/quran/<locale>.json` | Approved translations, fetched verbatim | Approved sources, do not edit by hand |
| Supplication meanings (English) | `src/content/adhkar/en.ts` | Hisn al-Muslim (Fortress of the Muslim), standard English | Follows the published text |
| Supplication meanings (other languages) | `src/content/adhkar/more.ts` | PrayAlong translations of the English meanings | **Must be reviewed by qualified native speakers before release** |
| Interface text | `src/i18n/en.ts` (source), `de.ts`, `more.ts` | PrayAlong | Needs native-speaker review |

## Quran meanings

`scripts/fetch-quran-translations.mjs` pulls the exact text of every verse
PrayAlong recites (Al-Fatiha 1:1–7, Al-Kawthar 108:1–3, Al-Ikhlas 112:1–4)
from [fawazahmed0/quran-api](https://github.com/fawazahmed0/quran-api), which
mirrors Tanzil, King Fahd Complex and Quran.com sources, and writes one JSON
file per locale with the edition id, the credit and the verses:

```sh
node scripts/fetch-quran-translations.mjs
```

| Locale | Edition id | Credit shown in the app |
| --- | --- | --- |
| en | `eng-ummmuhammad` | Saheeh International |
| de | `deu-frankbubenheima` | Bubenheim & Elyas |
| fr | `fra-muhammadhamidul` | Muhammad Hamidullah |
| es | `spa-muhammadisagarc` | Isa García |
| tr | `tur-diyanetisleri` | Diyanet İşleri |
| id | `ind-indonesianislam` | Kementerian Agama RI |
| nl | `nld-sofianssiregar` | Sofian S. Siregar |
| ur | `urd-muhammadjunagar` | Muhammad Junagarhi |
| ar | `ara-quransimple` | Quran (simple script) |

Never translate, shorten or edit a verse in the app. To change a
translation, change the edition in the script, re-run it, and record the
choice here. The credit appears in Settings
(`settings.sources`: "Quran: {credit} · Supplications: Hisn al-Muslim").

## Supplication meanings

The English meanings in `src/content/adhkar/en.ts` follow the standard
English of *Hisn al-Muslim*. Every other language in
`src/content/adhkar/more.ts` is a **PrayAlong translation of those
meanings**. They use the wording each community usually uses for these
adhkar where we know it, but they are not taken from a published
translation and have not yet been checked by a scholar. Arabic readers see
the Arabic itself, so `ar` is deliberately empty.

Rules for these files:

- Keep the meaning of the English (and the Arabic behind it). Don't add to
  it or leave anything out.
- Keep the clause splits exactly as in `en.ts`. Each id is one line on
  screen. `salawat-1` and `salawat-3` end in a comma because the sentence
  continues on the next line.
- If a published translation of *Hisn al-Muslim* exists in the language
  ("Festung des Muslims", "La citadelle du musulman", "La fortaleza del
  musulmán", "Hısnu'l-Müslim", "Hisnul Muslim", "حصن المسلم"), reviewers
  should prefer its wording and note the edition here.
- `src/sequence/build.test.ts` fails if any line has no meaning in any
  non-Arabic locale.

## Interface text

`src/i18n/en.ts` is the source of truth. Other locales translate every key.
Any key left out falls back to English. `{placeholders}` must be kept
exactly. Strings sit in buttons, chips and the posture dock, so keep them
short. The posture labels are plain language on purpose (Standing, Bowing,
Rising, Prostration, Sitting).

## Before release: what to review

### All languages

- [ ] Read every supplication meaning beside the Arabic and the English.
      Confirm the meaning is complete and the clause splits are correct.
- [ ] **Salawat.** The English separates *ṣalli* ("send prayers upon") from
      *bārik* ("send blessings upon"). Check that the translation keeps the
      two apart in a way the community recognises (choices noted per
      language below).
- [ ] **Tasmi‘** (`tasmi`). The English is a wish ("May Allah answer the one
      who praises Him"). Many communities use "Allah hears…" instead. We
      followed the English. Confirm.
- [ ] **"None has the right to be worshipped except…"** (`thana-2`,
      `tashahhud-4`). We followed the English rather than the shorter "there
      is no god but…". Confirm.
- [ ] **Hand position** (`hint.qiyam`: "right hand over left on your chest").
      This comes from the source text, not from translation. Hanafi readers
      (most Turkish and Urdu speakers) usually place the hands below the
      navel. Product and scholars should decide whether this hint needs to
      allow for different schools of law.
- [ ] Hands-Free feature name. It must read the same in `hf.button`,
      `hf.tipOn`, `ready.bodyManual`, `setup.title` and `settings.keys.hf`.
- [ ] Check every string on a phone. Watch the dock labels, the cue chip and
      the "Begin {prayer}" button for truncation.

### German (de)

- [ ] Uses informal *du*. Confirm that is right for the audience.
- [ ] Spellings: *Taschahhud*, *Rak‘a* / *Rak‘at*, *Al-Kauthar*, *Koran*
      (rather than *Qur’an*) in `line.quran` and `settings.sources`.
- [ ] Hands-Free is called **„Freihändig“**.
- [ ] `takbir`: "Allah ist der Größte" (follows the English). Some prefer
      "Allah ist größer".
- [ ] `taawwudh`: "verfluchten Satan" (follows "accursed"). Bubenheim, the
      in-app Quran translation, uses "gesteinigten".
- [ ] Salawat: *ṣalli* → "sprich den Segen über" (Bubenheim's wording for
      33:56), *bārik* → "segne". Confirm the difference reads clearly.
- [ ] `ruku`: "dem Allgewaltigen". Pronouns for Allah are capitalised
      (Du/Dir/Dein/Ihn/Sein). Pronouns for the Prophet ﷺ are not.

### French (fr)

- [ ] Uses *vous*. Prayer names are *Fajr, Dhohr, Asr, Maghrib, Icha*.
- [ ] `complete.done` "{prayer} accompli" treats prayer names as masculine.
      `ready.begin` "Commencer {prayer}" has no article. Confirm both.
- [ ] Typography: a no-break space before `?` and `:` and inside « ».
- [ ] Adhkar: "Gloire et pureté à Toi" for *subḥān*. "Satan le maudit"
      (vs. "le lapidé"). *ṣalli* → "prie sur", *bārik* → "bénis". `ruku`
      "l’Immense". "Tu es Digne de louange et plein de gloire".

### Spanish (es)

- [ ] Uses *tú*. Vocabulary chosen to work in both Spain and Latin America
      ("video", "portátil", "presiona", "ustedes"). Confirm the target
      audience.
- [ ] Isa García's Quran text mostly says **"Dios"** (sometimes "Al-lah"),
      while the supplications say **"Allah"**. Decide which one to use and
      make them match.
- [ ] Surah names: *Al-Fátiha, Al-Kawzar, Al-Ijlás*.
- [ ] `ready.until/from/at` use "las {time}", which is wrong for times in
      the 1 o'clock hour ("la 1:15").
- [ ] Salawat: *ṣalli* → "exalta", *bārik* → "bendice". This is the least
      certain choice in Spanish, so check it against an established
      translation.
- [ ] `settings.method`: "Liga Mundial Musulmana" (vs. "Liga del Mundo
      Islámico").

### Turkish (tr)

- [ ] Uses the polite *siz* imperative. Prayer names are *Sabah, Öğle,
      İkindi, Akşam, Yatsı*.
- [ ] Posture labels use the everyday words *Rükû* and *Secde* rather than
      the plainer *Eğilme* / *Yere kapanma*. Confirm.
- [ ] Groups use the names Turkish worshippers know: *Sübhâneke*,
      *Ettehiyyâtü*, *Kevser Suresi*, *İhlâs Suresi*.
- [ ] `ready.until` "bitiş {time}" and `ready.from` "başlangıç {time}" avoid
      a suffix after the time, because vowel harmony depends on how the
      number is read.
- [ ] `settings.method`: Turkish users usually expect the Diyanet method.
      This is a product decision. The string is translated as it is.
- [ ] Adhkar: *ṣalli* → "rahmet eyle" (the usual Diyanet wording), *bārik* →
      "bereket ver". The tasmi‘ follows the English ("duasını kabul etsin")
      rather than the usual "işitir". "Kovulmuş şeytan". "Resûlü".
- [ ] Credit spelling "Hısnu’l-Müslim".

### Indonesian (id)

- [ ] Uses *Anda*. "Salat" follows KBBI spelling (not *shalat*). Prayer
      names are *Subuh, Zuhur, Asar, Magrib, Isya*.
- [ ] Hands-Free is called **"Tanpa Sentuh"**.
- [ ] `line.quran` uses the local citation style "QS {ref}".
- [ ] Adhkar use open "Maha Suci / Maha Agung" forms to match the Kemenag
      Quran text shown beside them. *ṣalli* → "limpahkanlah selawat" (vs.
      "rahmat"), *bārik* → "berkah". The tasmi‘ follows the English
      ("Semoga Allah mengabulkan doa…") rather than the usual "Allah
      mendengar…".

### Dutch (nl)

- [ ] Uses *je*.
- [ ] Posture label for sujud is **"Neerwerpen"**. Check it reads naturally.
      Also check the spellings *Takbier, Tashahhoed, Salaam, rak‘a /
      rakaat*.
- [ ] `settings.companion` is "Begeleider". We avoided "Metgezel" because
      it suggests the Companions of the Prophet ﷺ.
- [ ] "Koran" vs "Qur’an". The Siregar Quran text says "shalât", while the
      interface says "gebed".
- [ ] Adhkar: *ṣalli* → "eer", *bārik* → "zegen". This is the least certain
      choice in Dutch. `ruku` "de Grootse". Spelling "Mohammed". "Jullie"
      in `salam` / `taqabbal`.

### Urdu (ur)

- [ ] Posture labels are plain (*کھڑے ہونا، رکوع، اٹھنا، سجدہ، بیٹھنا*) rather
      than *قیام، قومہ، جلسہ*. Confirm.
- [ ] First-person verbs in the adhkar are masculine (*کرتا، مانگتا، دیتا*),
      as Urdu prayer books usually write them. Consider whether women
      should see feminine forms.
- [ ] `tashahhud-1` follows the English ("سب آداب، نمازیں اور پاکیزہ کلمات").
      Urdu prayer books usually say "تمام قولی، بدنی اور مالی عبادتیں".
- [ ] Salawat: *ṣalli* → "درود بھیج" (vs. the common "رحمت نازل فرما"),
      *bārik* → "برکت نازل فرما". The tasmi‘ uses the wish form "سن لے"
      rather than the usual "سن لی".
- [ ] English loanwords: ہینڈز فری، ڈیمو، پری ویو، ڈیوائس.
- [ ] The Quran credit (Muhammad Junagarhi) appears in Latin script.

### Arabic (ar)

- [ ] Instructions use the masculine singular imperative (ارفع، اركع، اسجد),
      as Arabic prayer guides usually do. Consider whether to make them
      gender-neutral.
- [ ] `ready.rakahs` is "عدد الركعات: {n}" so that 2 (dual) and 3–4 (plural)
      both read correctly. `line.times` stays "×{n}" for the same reason.
- [ ] Hands-Free is called **«بدون لمس»**.
- [ ] Digits are Western (2–3, times as formatted). Confirm, or switch to
      Arabic-Indic digits.
- [ ] The Quran credit for `ar` is the English string "Quran (simple
      script)", so Settings shows "القرآن: Quran (simple script)". Give it
      an Arabic credit in `scripts/fetch-quran-translations.mjs`.
- [ ] No supplication meanings, by design.

## Sign-off

| Language | Interface reviewed by | Supplications reviewed by (qualified) | Date |
| --- | --- | --- | --- |
| de | | | |
| fr | | | |
| es | | | |
| tr | | | |
| id | | | |
| nl | | | |
| ur | | | |
| ar | | n/a | |

## Sound

- **Voices**: each companion's recitation and spoken guidance are generated
  with ElevenLabs (eleven_v4) from voices designed for PrayAlong, then given
  a light voice EQ and loudness normalisation (`tools/audio/gen_audio.py`).
  Per-word timings come from the TTS character alignment; meaning and
  pronunciation word links come from `tools/audio/gen_align.py`.
- **Ambience**: real field recordings from Freesound, all CC0 (public
  domain), cut to two minutes, set quietly and shuffled with crossfades in
  the app:
  - Fajr: 466242, 632439, 518670, 477643
  - Dhuhr: 650337, 796198, 464315, 641306
  - Asr: 514550, 327499, 245833, 465280
  - Maghrib: 702475, 855326, 580941
  - Isha: 479041, 522299, 500332, 699142

  (Freesound sound ids; see https://freesound.org/s/<id>/.)
