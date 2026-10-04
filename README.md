# PrayAlong

A calm, hands-free Salah companion. PrayAlong picks the prayer that's due,
shows a 3D companion moving through each posture on a prayer mat, and puts
the Arabic, transliteration and translation of every line right beneath it.
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
| `/?simulate` | Hands-free without a camera: turn on Hands-Free, then keys **1** hands raised · **2** standing · **3** bowing · **4** prostrating · **5** sitting |
| `/?lab&pose=sujud` | Pose Lab (dev only): inspect any posture; add `&az=1.57` for a side view, `&character=/avatars/x.glb` to try a character |

Keyboard: **Space / →** next line · **←** back · **P** timed guidance · **H** hands-free.

## How it fits together

```
src/
  content/        Prayers, postures and every recited line (Arabic · transliteration · translation)
  sequence/       buildSequence(prayer) → ordered steps with posture, pose and timing
                  schema.json is the JSON Schema for that output
  state/          Zustand session store: phase, current step, hands-free logic
  lib/            Prayer-time detection (adhan), location, wake lock, hooks
  components/     UI: header chips, recitation, dock, panels, settings
    stage/        3D stage (React Three Fiber): lighting, mat, camera, character
      rig/        humanoid.ts   — adapts any VRM / Mixamo-style rig to one normalized skeleton
                  prayer-poses.ts — the postures, authored once for every character
                  performer.ts  — blends postures, grounds the body, IK hands, forehead contact
  handsfree/      Camera → DETRPose (Web Worker) → pose class → stable pose changes
```

**Stack:** Vite · React 19 · TypeScript · Tailwind CSS v4 · Motion · Radix UI ·
React Three Fiber + drei + postprocessing · @pixiv/three-vrm · onnxruntime-web ·
adhan · Zustand · Vitest.

## Characters

Four companions ship with the app — **Yusuf**, **Maryam**, **Ahmad** and
**Aisha** — soft clay chibi characters built in Blender from the scripts in
`tools/characters/`. The stage is character-agnostic: any humanoid VRM, or
GLB with a Mixamo-style skeleton, plays every posture with no
per-character tuning. See [docs/characters.md](docs/characters.md).

## Hands-free

See [docs/hands-free.md](docs/hands-free.md) for the DETRPose model contract
and how pose changes drive the prayer.

## Content review

The Arabic, transliterations and translations in `src/content/recitations.ts`
must be reviewed by someone qualified before release. The sequence follows a
common fard pattern (thana, ta‘awwudh, Al-Fatiha, a short surah in the first
two rak‘ahs, tashahhud, salawat, salam); madhab variants are a planned setting.
