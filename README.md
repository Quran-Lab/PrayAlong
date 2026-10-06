# PrayAlong

**Live: [prayalong.me](https://prayalong.me)**

A 3D companion that prays with you, step by step. PrayAlong picks the prayer
that is due, shows a companion moving through each posture on a prayer mat,
and puts the Arabic, transliteration and meaning of every line beside it. It
listens to your recitation on your own device and keeps your place.

Built by Quran Lab for the AI Challenge in Service of Islamic Content
(islamicaich.org), track 03: *Interactive experiences and learning journey for
introducing and learning Islam*.

- **Two modes.** *Teach me*: the companion explains each movement and recites
  each line, and you repeat it. *Pray with me*: you recite and it follows
  quietly.
- **On-device Quran speech recognition.** The Quran Lab zipformer2 CTC phoneme
  model (v3.1, int8) runs as WebAssembly in a Web Worker with 160 ms
  streaming. A prayer-graph aligner follows the recitation word by word,
  counts tasbih repetitions and hears the takbir that moves you to the next
  posture. Audio never leaves the device.
- **Four companions** (Yusuf, Ahmad, Maryam, Aisha): soft, modest, with
  eyebrows-only faces. Close-ups show the feet in sitting and sujud and the
  finger in tashahhud.
- **Nine languages** (en, ar, ur, tr, id, fr, de, es, nl) with right-to-left
  layout, recited audio and spoken guidance in four voices.
- **Hands-free camera (beta)**: MediaPipe and DETRPose on the device move the
  prayer on when you change posture.

Laptop first, works on phones.

## Documentation

| Document | What it covers |
| --- | --- |
| [docs/SOURCES.md](docs/SOURCES.md) | Every religious and knowledge source, how it is obtained and verified, content levels A to D, review status, third-party licences, privacy |
| [docs/content.md](docs/content.md) | Content files, translation editions, the per-language review checklist and sign-off |
| [docs/voice.md](docs/voice.md) | The microphone engine: model, aligner, driver, test harnesses and measured results |
| [docs/hands-free.md](docs/hands-free.md) | The camera engine (beta): pipeline, decoder and evaluation |
| [docs/characters.md](docs/characters.md) | How the companions are made and rigged |

## Run locally

Needs Node.js 22 or newer.

```bash
npm ci               # install exact dependencies (also copies the MediaPipe runtime)
npm run dev          # http://localhost:5173
npm test             # unit tests: sequence, content coverage, prayer times, follower, driver, pose decoder
npm run build        # typecheck + production build into dist/
npm run preview      # serve the production build
```

The speech model (68 MB) is not in git. Without it the app runs normally and
moves on by timers, and the microphone button reports that the model is
missing. To follow your voice locally, stage the model with
`node scripts/fetch-voice-model.mjs --chunk 8` (it reads `VOICE_MODEL_SRC` /
`VOICE_TOKENS_SRC`, `VOICE_MODEL_URL`, or a `quran-lab-app-wasm` checkout next
to the repo; see the header of the script), or use the live site.

Useful URLs while developing:

| URL | What |
| --- | --- |
| `/` | The app |
| `/?simulate` | Hands-free without a camera: turn on Hands-Free, then keys **1** hands raised, **2** standing, **3** bowing, **4** prostrating, **5** sitting |
| `/?lab&voice` | Voice lab (dev only): live transcript, cursor, events, record and replay |
| `/?lab&pose=sujud` | Pose Lab (dev only): inspect any posture; add `&az=1.57` for a side view, `&character=/avatars/x.glb` to try a character |

Keyboard: **Space / Right arrow** next line, **Left arrow** back, **P** timed
guidance, **H** hands-free.

## How it fits together

```
src/
  content/        Prayers, postures and every recited line (Arabic, transliteration, meaning)
    quran/        Verse text and meanings per locale, fetched verbatim (never edited by hand)
    adhkar/       Supplication meanings per locale
  sequence/       buildSequence(prayer) -> ordered steps with posture, pose and timing
  state/          Zustand session store: phase, current step, settings
  voice/          Microphone engine: worker client, follower (prayer-graph aligner), driver
  audio/          Companion recitation and spoken guidance playback
  handsfree/      Camera engine (beta): MediaPipe + DETRPose workers, features, decoder
  lib/            Prayer times (adhan), location, wake lock, hooks
  i18n/           Interface text in nine languages
  components/     UI: header, recitation, posture dock, panels, settings
    stage/        3D stage (React Three Fiber): mat, camera, character, posture rig
public/
  voice/          ASR worker, audio worklet, sherpa-onnx WASM runtime
  audio/          Recited lines and guidance per voice, with word timings
  avatars/        The four companions (GLB)
  guides/         Close-up illustrations for feet and finger
worker/           Cloudflare Worker: static assets and the model files
```

**Stack:** Vite, React 19, TypeScript, Tailwind CSS v4, Motion, Radix UI,
React Three Fiber + drei + postprocessing, @pixiv/three-vrm, sherpa-onnx
(WASM), onnxruntime-web, MediaPipe Tasks Vision, adhan, Zustand, Vitest,
Playwright. Deployed on Cloudflare Workers static assets.

## Content and scholarly review

PrayAlong shows only fixed, sourced text: the Quran from Tanzil, published
translations of its meanings, and the prayer supplications from Hisn
al-Muslim. No AI model writes religious text, and the app gives no fatwa or
personal rulings. Where the schools of law differ it says so (for example,
raising the hands at ruku is a setting). The supplication Arabic and the
non-English supplication meanings must be reviewed by qualified people before
release; the full list, with each item's status, is in
[docs/SOURCES.md](docs/SOURCES.md) and [docs/content.md](docs/content.md).

## Privacy

No account, no analytics. Microphone audio and camera frames are processed in
the browser and never uploaded. Settings and location stay in the browser's
local storage. Details in [docs/SOURCES.md](docs/SOURCES.md#privacy).

## Team

Built by Quran Lab.

| Name | Role | Work | Contact |
| --- | --- | --- | --- |
| Mostafa Mahdi | Team lead | AI/ML engineer, speech and on-device inference | mostafa@quranlab.ai |
| Raufa Zuhdi Aristyo | Team member | AI/ML engineer, computer vision and evaluation | raufa@quranlab.ai |

## Licence

PrayAlong is released under the Quran-Lab No-Profit License, Version 1.2
(NPL-1.2); see [LICENSE](LICENSE). Third-party components, fonts, models and
texts keep their own licences; they are listed in
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
