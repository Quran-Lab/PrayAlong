# PrayAlong

A calm, hands-free Salah companion. PrayAlong picks the prayer that's due,
shows a faceless 3D companion (a brother or a sister, matched on this device)
moving through each posture on a prayer mat over a photograph of the time of
day, and puts the Arabic (KFGQPC Uthman Taha Naskh), transliteration and
translation of every line right beneath it.
With **Hands-Free** on, the camera follows your body and the prayer moves on
by itself — no touching the laptop mid-sujud.

Laptop first, works on phones.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit tests (sequence, prayer times, pose classifier, session)
npm run build        # typecheck + production build
```

Useful URLs while developing:

| URL | What |
| --- | --- |
| `/` | The app |
| `/?demo` | Hands-free without a camera (developers): pick a mode, then keys **1** hands raised · **2** standing · **3** bowing · **4** prostrating · **5** sitting |
| `/?lab&pose=sujud` | Pose Lab (dev only): inspect any posture; add `&az=1.57` for a side view, `&character=/avatars/x.glb` to try a character |

Keyboard: **Space / →** next line · **←** back · **P** timed guidance · **H** hands-free.

## How it fits together

```
src/
  content/        Prayers, postures and every recited line (Arabic · transliteration · translation)
                  backdrops.json — the per-prayer photographs (written by `npm run backgrounds`)
  sequence/       buildSequence(prayer) → ordered steps with posture, pose and timing
                  schema.json is the JSON Schema for that output
  state/          Session store (Svelte runes): phase, current step, settings
  i18n/           English built in; Indonesian and Arabic load when chosen (others kept, not offered yet)
  lib/            Prayer-time detection (adhan), location, wake lock, brand (palettes, crescent)
  components/     UI (Svelte 5, PrayAlong design system): header, recitation, dock, panels, sheets
    stage/        3D stage (plain three.js): photo backdrop, lighting, rug, camera, character
      rig/        humanoid.ts   — adapts any VRM / Mixamo-style rig to one normalized skeleton
                  prayer-poses.ts — the postures, authored once for every character
                  performer.ts  — blends postures, grounds the body, IK hands, forehead contact
  handsfree/      Camera → MediaPipe / DETRPose (Web Worker) → pose class → stable pose changes
  voice/          voice.svelte.ts — qari clips, the voice coach, and the microphone listener
    asr/          Quran Lab ASR client, phoneme targets per line, word-by-word follow
```

**Stack:** Vite · Svelte 5 · TypeScript · three.js · @pixiv/three-vrm (VRM only) ·
onnxruntime-web · MediaPipe · sherpa-onnx (ASR) · adhan · Vitest. Design: PrayAlong's own sibling of
the Quran Lab design system: paper and ink, Plus Jakarta Sans, a crescent mark and a plum accent
the learner can change ([docs/DESIGN.md](docs/DESIGN.md)).

## Backdrops

Five Pixabay photographs, one per prayer (dawn, midday, afternoon, sunset,
night), encoded as JPEG XL and AVIF at 960–3840 px with a WebP fallback.
Sources and photographers are in `assets/backgrounds/sources.json`; drop the
full-size originals there and run `npm run backgrounds` (needs `cjxl`,
`avifenc` and `cwebp`).

## Characters

The stage is character-agnostic: any humanoid VRM, or GLB with a
Mixamo-style skeleton, plays every posture with no per-character tuning.
See [docs/characters.md](docs/characters.md) for the asset spec and how to
add one. The two companions, a brother (kufi and thobe) and a sister (khimar,
niqab and abaya), are faceless, about seven heads tall after the brief's pose
sheet, and built from code: `tools/characters/build_brother.py` and
`build_sister.py`. The chibi companions from `main` (Yusuf, Maryam, Ahmad,
Aisha) are still in `public/avatars/` but not in the picker, because they have
faces.

## Voice

The qari (Sheikh Khalifah At-Tunaiji) recites each verse of Al-Fātiḥah before the learner's turn,
a voice coach (Inflect-Nano-v2, rendered at build time) says each movement, and the Quran Lab ASR
can follow the learner's recitation word by word on the device. See [docs/voice.md](docs/voice.md).

```bash
npm run voice        # re-render the coach's lines (needs sherpa-onnx)
npm run fetch:asr    # copy the ASR package into public/asr (not in git)
```

## Hands-free

See [docs/hands-free.md](docs/hands-free.md) for the DETRPose model contract
and how pose changes drive the prayer.

## Content review

The Arabic, transliterations and translations in `src/content/recitations.ts`
must be reviewed by someone qualified before release. The sequence follows a
common fard pattern (thana, ta‘awwudh, Al-Fatiha, a short surah in the first
two rak‘ahs, tashahhud, salawat, salam); madhab variants are a planned setting.
