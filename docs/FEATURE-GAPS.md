# What PrayAlong still lacks

Checked on 5 Oct 2026 against two references:

- **Prototype**: the PrayAlong guided-learning artifact (claude.ai artifact `RVLC7xkB…`): a hands-free course with a setup, movement lessons, recitation practice, a whole prayer and a summary.
- **Local app**: `~/Documents/PrayAlong/web` (Svelte), the CV and recitation work from 1–4 Oct.

"Repo" means this branch (`redesign/svelte-quranlab`), which keeps every feature of `main`.

## Already in the repo, not in the prototype

| Feature | Where |
| --- | --- |
| Prayer times and the prayer that is due, from location or time zone | `lib/prayer-times.ts`, `lib/prayer-clock.svelte.ts` |
| Qibla bearing | `components/Panels.svelte` |
| All five prayers as full line-by-line sequences (thana, ta‘awwudh, Al-Fatiha, short surah, tashahhud, salawat, salam) | `sequence/build.ts`, `content/recitations.ts` |
| 3D companion that performs every posture | `components/stage/` |
| Real camera tracking (MediaPipe, then DETRPose on WebGPU) that advances the prayer by body movement | `handsfree/` |
| Two ways to pray: **Watch it first** (the qari's example before each verse) and **Practice** (added 5 Oct) | `components/Panels.svelte`, [voice.md](voice.md) |
| Hands-free on by default; one prompt for camera and microphone | `App.svelte`, `components/SetupSheet.svelte` |
| Demo without a camera for developers (`/?demo`), with an autopilot | `components/DemoBar.svelte` |
| English, Indonesian and Arabic (six more kept, not offered yet) | `i18n/`, `content/quran/`, `content/adhkar/` |
| Text size, theme, colour, show or hide Arabic, transliteration and meaning | Settings → Display |
| The narration under every line, al-Albani's wording (added 5 Oct) | `content/sources.ts`, [content.md](content.md) |
| Brother or sister companion (picked in Settings; camera matching is a placeholder, see below) | `components/stage/characters.ts` |
| Qari before the learner's turn, spoken movement instructions, word-by-word recitation follow (added 5 Oct) | `voice/`, [voice.md](voice.md) |

## Missing: in the prototype or the local app, not in the repo

Ordered by how much they matter for the judging rubric (benefit, reliability, UX).

| # | Missing feature | In | Notes |
| --- | --- | --- | --- |
| 1 | **Learn mode**: one movement at a time, watch, then try, then automatic feedback, then move on | Prototype | Partly done (5 Oct): "Watch it first" shows the example before the learner's turn, but always for the whole prayer. A learner cannot yet practise ruku on its own. |
| 2 | ~~**Voice coach**~~ **Done (5 Oct):** Inflect-Nano-v2 clips in English, the browser's voice elsewhere | Prototype, local app | Movement instructions only; it never corrects. |
| 3 | ~~**Recitation check**~~ **Done (5 Oct):** Zipformer v3.1 int8, word by word, only confirms | Local app | Al-Ikhlāṣ and Al-Falaq are followed too (targets from At-Tunaiji's clips). Lines said quietly are never followed. Safari can't run it. |
| 4 | ~~**Human qari audio**~~ **Done for Al-Fātiḥah (5 Oct):** At-Tunaiji, verse by verse, then the learner's turn | Local app | **Every line has an example (5 Oct):** At-Tunaiji for Al-Fātiḥah, Al-Ikhlāṣ and Al-Falaq; the supplied dhikr recordings for the rest, cut and checked with the Quran Lab ASR. Still needed: a licence check on mp3quran and a credit for the dhikr voice. |
| 5 | **Works under mukena and telekung**: the calibrated recognizer (MobileNetV4 or DINOv3 prototypes), and the silhouette fallback | Local app, `docs/RISET-CV-MOAT.md` | The repo classifies from keypoints only. In black telekung, sujud keypoints fail, so hands-free stalls for many women. This is the biggest reliability gap. |
| 6 | **End-of-prayer summary**: what went well, what was not checked (quiet rakaat, details the camera could not see), with a sunnah.com reference | Prototype | The repo ends with the dhikr after the prayer (Muslim 591). It must never phrase anything as a correction (team rule: no red, no "wrong"). |
| 7 | **Progress that is remembered**: lessons done, "Continue" | Prototype | |
| 8 | **Tuma'ninah (hold still) indicator** that fills, then moves on | Prototype | Timing only, and never a fail state. |
| 9 | **Salam detected from the head turn** | Local app research | `classify.ts` already computes `headTurn`, but nothing uses it; both salams advance on time. |
| 10 | **Offline, installable app** (service worker precaches audio and models) | Local app (`public/sw.js`) | Models (~23 MB) are fetched again whenever the HTTP cache is cleared. |
| 11 | **Notice: "automatic, can be wrong; pray with a teacher"** | Prototype | Needed for the reliability criterion and the scholarly review. |
| 12 | ~~**Recitation wording**, with the source per line~~ **Done (5 Oct):** Sifat Salat an-Nabi (al-Albani), narration under every line | Local app | The narration numbers need checking before release ([content.md](content.md)). |
| 13 | **Aloud or quiet rakaat shown before starting** | Prototype | The repo marks each line "aloud" or "quietly", but not up front. |

## Decisions the team should make

- **Learn mode vs. pray-along**: the prototype is a course and `main` is a companion. They can coexist as two entries on the start screen.
- **Hand feedback rules**: the prototype says "Almost, flatten your back"; the team rule says no corrections. Keep encouragement only and list "not checked" items instead.
- **Backdrops**: the encoded files come from Pixabay's 1280 px previews. Put the 4K originals in `assets/backgrounds/` (links in `sources.json`) and run `npm run backgrounds`.

## Companion matching from the camera: a placeholder for now

Settings shows "Pick my companion from the camera · Coming soon"; the companion is chosen by hand.
The 4 Oct experiment (TinyCLIP zero-shot on upright frames, 8.6 MB) scored 240/241 frames, but
the test set had one man, so it was taken out rather than shipped on thin evidence.

**Is a TCN the answer? No.** A TCN models *time*: a sequence of poses. That is the right tool for
the movement recogniser (transitions such as ruku → i‘tidal, holding still for tuma'ninah), not
for *who* is on the mat, which is a per-picture appearance question (thobe or mukena, khimar,
niqab). The only "time" it needs is averaging a few upright frames, which is a mean, not a network.

Options, simplest first:

1. **Ask once** in the setup sheet: "Brother / Sister" (one tap, or said aloud). Nothing to
   train, never wrong, no camera judgement about the person. Recommended for the hackathon.
2. **A small image classifier** if automatic matters: a linear probe on the MobileNetV4/DINOv3
   features the posture recogniser already computes (no extra model download), trained on
   consented, labelled clips that include mukena, telekung, abaya, thobe and everyday clothes, from
   many people. Average about 10 upright frames, keep an "unsure → leave as is" band, and report
   per-group accuracy before turning it on.

The four chibi companions on `main` (Yusuf, Maryam, Ahmad, Aisha) have faces, so they are kept in
`public/avatars/` but not offered in the picker (team rule: every demonstrator is faceless).
