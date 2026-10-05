# Voice: examples, coach and listener

PrayAlong speaks and listens without anything leaving the device. Everything the learner needs is
said aloud, so they can follow from the mat without reading the screen.

| Part | What it does | Engine | Size on the device |
| --- | --- | --- | --- |
| Examples: the qari | Recites each verse of Al-Fātiḥah, Al-Ikhlāṣ and Al-Falaq before the learner's turn | Sheikh Khalifah At-Tunaiji, human recitation | 16 clips, about 650 KB AAC |
| Examples: the dhikr | Says every other line (takbir, opening, ta‘awwudh, bowing, rising, prostration, the sitting, tashahhud, ṣalawāt, seeking refuge, salam, and the remembrance after the prayer) | The dhikr recordings supplied on 5 Oct 2026 | 22 clips, about 870 KB AAC |
| Voice coach | Says each movement, what to recite and how many times, the rak‘ah, where the hands go | Inflect-Nano-v2, rendered at build time (English); the browser's voice (Indonesian, Arabic) | 31 clips, about 600 KB AAC |
| Listener | Lights each Arabic word as the learner says it; a fully heard line moves on by itself | Quran Lab Zipformer v3.1 int8 (sherpa-onnx WASM) | 85 MB, loaded when the first prayer starts (Chrome, Edge; not Safari) |

The coach and the listener are part of every prayer; there are no switches for them. The learner
only chooses how to pray, on the start screen:

| Mode | What PrayAlong does |
| --- | --- |
| **Watch it first** ("I want to learn the example first") | Says each movement and what to recite; before each line the example plays, then it is the learner's turn. After the prayer it plays the istighfār and "Allāhumma antas-salām" |
| **Practice** ("I want to practice it") | Says each movement and what to recite; the learner recites straight away |

Both follow the body (hands-free is on by default) and the recitation. Choosing a mode asks for the
camera and the microphone in one prompt, then the setup sheet checks the framing; "Begin" (or
raising the hands) starts the prayer.

Rules kept from the team brief: Quran is never TTS; the coach only instructs and encourages (no
"wrong", no red); the listener only ever confirms, and a word it didn't hear is simply not lit.

## What is said, line by line

Per line: the movement, if the line starts one (unless it was said ahead while the learner was
still finishing the last line) → what to recite → in "Watch it first", the example ("Listen first"
and "Now you" frame the first one) → the learner's time. The line's timer starts only when
PrayAlong has finished speaking.

| When | Coach (`src/voice/coach-lines.json`) |
| --- | --- |
| Before the prayer | "Stand on your mat, facing the qibla. Make your intention in your heart." · "Raise your hands to your ears, to begin the prayer." |
| Opening | "Place your right hand over your left, on your chest." · "Say the opening supplication, quietly." |
| Al-Fātiḥah, Āmīn, surah | "Recite Al-Fātiḥah, aloud / quietly." · "Say Āmīn." · "Now recite Surah Al-Ikhlāṣ / Al-Falaq." |
| Bowing | "Raise your hands, then bow. Hands on your knees, back flat." · "Glorify your Lord, the Most Great, three times." |
| Rising | "Rise up, raising your hands to your ears." · then "Lower your hands to your sides, and praise your Lord." |
| Prostration, sitting | "Go down into prostration. Forehead and nose on the ground." · "Glorify your Lord, the Most High, three times." · "Sit up, and rest a moment." · "Ask your Lord for forgiveness and mercy." · "Prostrate again." |
| Next rak‘ah | "Stand up for the second / third (raising your hands) / fourth rak‘ah." |
| Sitting | "Sit, and rest your hands on your thighs." · "Recite the tashahhud, pointing with your right index finger." · "Send blessings upon the Prophet ﷺ." · "Seek refuge in Allah, before the salam." |
| Salam, after | "Turn your face to the right, and say the salam." · "Now turn to the left." · "Well done. Your prayer is complete." · "After the prayer, ask Allah's forgiveness, three times." |

The steps carry this as `cue` (the movement, also shown on the card) and `say` (what to recite,
spoken only); see `src/sequence/build.ts`. Indonesian and Arabic speak `voice.say.*` from
`src/i18n` with the browser's voice.

## Examples

`public/audio/tunaiji/<line>.m4a` (the Quran) and `public/audio/dhikr/<line>.m4a` (the rest), one
clip per line, made by `tools/voice/cut_lines.py` from the sources listed in
`tools/voice/lines.json`:

```bash
export ASR_MODEL=<folder with zipformer2-ctc.onnx and tokens.txt>
python3 tools/voice/cut_lines.py check ~/Downloads/Tahiyat.mp3   # symbols with times, and the silences
python3 tools/voice/cut_lines.py cut                             # cuts every line, then reads each clip back
```

Lines are cut at the silent gaps the Quran Lab ASR shows between them, never at published timings:
mp3quran's ayah timings put "Qul" in the basmalah clip and the "wa" of Al-Ikhlāṣ 4 and Al-Falaq 3–5
in the verse before it. Every clip is read back by the ASR and must hold its whole line, from the
first word to the last (`src/voice/asr/fixtures.json` keeps what it heard; `words.test.ts` checks it).

- **Qari.** Al-Fātiḥah: the mp3quran.net recording (Ḥafṣ ‘an ‘Āṣim, de-reverbed); verses 1–7 in the
  Kūfī count (verse 1 = basmalah). Al-Ikhlāṣ and Al-Falaq: the same reciter, de-reverbed with
  anvuew's mel-band roformer. The basmalah before a surah is not played (it isn't shown either).
  Check mp3quran's terms before a public release.
- **Dhikr.** The supplied recordings: `Istiftah` → `thana-1`, `thana-2`; `Tahiyat` → `tashahhud-1…4`;
  `Shalawat Ibrahim` → `salawat-1…4`; `Last Dua` → `refuge-1`, `refuge-2`; `Tasyahud` (the
  supplication *between the prostrations*, despite its name) → `jalsah`; one clip each for the rest.
  Āmīn has none. The voice needs a credit in Settings → About before release.

## Voice coach (Inflect-Nano-v2)

The coach's lines are a fixed set (`src/voice/coach-lines.json`), so they are rendered once:

```bash
pip install sherpa-onnx soundfile
npm run voice            # = python3 tools/voice/render_coach.py
```

Other languages use the browser's own voice with the translated `cue.*` text.

FP16 and INT8 were measured for an in-browser engine and are not used:

| Variant | Size | Speed (CPU, RTF) | Notes |
| --- | --- | --- | --- |
| FP32 (shipped renders) | 16.2 MB | 0.51 | Reference |
| INT8 (dynamic, MatMul/Conv/Gather) | 5.8 MB | 1.19 (2.3× slower) | The author warns naive quantization audibly damages the waveform decoder |
| FP16 | — | — | Does not convert cleanly (Cast type mismatch in the encoder); not validated by the author |

Rendering ahead means the browser downloads no TTS model at all.

## Listener (Quran Lab ASR)

`src/voice/asr/`: the worker (`public/asr-app/asr-worker.js`), the phoneme matcher and the
targets per line (`targets.ts`: Al-Fātiḥah from the ATQAN alignment, Al-Ikhlāṣ and Al-Falaq from
the model's own reading of At-Tunaiji's clips, dhikr drafts from the speech team). Followed lines:
takbir, ta‘awwudh, Al-Fātiḥah 1–7, āmīn, Al-Ikhlāṣ, Al-Falaq, ruku, tasmi‘, taḥmīd, sujud, the
sitting, tashahhud 1–4 and salam, but only when they are recited aloud (in practice: the
Fātiḥah, āmīn and surahs of Fajr, Maghrib and ‘Isha, the takbir and the salam).

`words.test.ts` checks it against the ASR's own output on the At-Tunaiji clips and the Yufid.TV
dhikr clips: every word of every line lights, a different line lights nothing, and half a verse
lights about half.

The model is gated (NPL-1.2) and not in git:

```bash
npm run fetch:asr        # copies it from ASR_DIR (default ~/Documents/PrayAlong/web/public/asr)
```

`npm run build` splits the 73 MB model into parts under 25 MiB for Cloudflare
(`dist/asr/manifest.json`); the worker stitches them back. It needs cross-origin isolation
(`public/_headers`, and the dev/preview server in `vite.config.ts`). Safari doesn't support
`credentialless`, so the listener reports "can't run in this browser" there.
