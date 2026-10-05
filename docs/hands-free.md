# Hands-free

PrayAlong follows the prayer with the camera of a laptop placed **on the
floor at the front of the prayer rug**, facing the worshipper. From there
the camera sees the body from below and close: standing, the legs and
often the top of the head are cut off; in ruku the head comes down and
towards the lens (from straight on it barely moves in the picture); in
sujud the head lands right in front of it. The engine is built for that
view. The microphone (src/voice) is the default way to follow the prayer;
the camera is an optional, stronger mover for postures.

```
camera 640x480 @ 15 fps (camera.ts: retries 1 s, 3 s, 10 s, then time takes over)
   |
   +--> vision worker (vision-worker.ts, off the main thread)
   |      MediaPipe Pose Landmarker full: 33 landmarks with visibility
   |      MediaPipe Face Landmarker: face box, yaw, pitch
   |      16 x 12 luma grid of the frame
   +--> DETRPose worker (pose-worker.ts; WebGPU only, joins when a frame fits 150 ms)
   |      17 COCO keypoints; finds the person more reliably when cropped
   v
pipeline.ts    pick the body (MediaPipe while it sees the shoulders, else DETRPose;
               sticky), put left/right in a fixed image order, smooth (One Euro)
features.ts    measure against the standing calibration, in square units
posterior.ts   per-frame class probabilities (posture-model.json) + confidence;
               face-only and nobody-in-view fallbacks
change.ts      how the body moved away from the current posture's own baseline
               (change-model.json)
decoder.ts     sequence decoder over the prayer's movements (below)
   v
session.followTo(step)        addEvidence({ kind, confidence, at }) from the voice
```

Video never leaves the device.

## Features

All measured in square units (normalized x scaled by the frame's aspect, so
horizontal and vertical distances compare) and against the standing
calibration, in standing shoulder widths:

- head: drop, growth, sideways shift; the head sinking into the shoulders;
- shoulders: drop and width; torso length and tilt when the hips are seen;
- hands: highest wrist vs the shoulders, gap between the wrists (wide at the
  ears for takbir, together on the chest in qiyam, apart at the knees in ruku);
- model-free: where the picture changed vs standing on a 3 x 3 grid (after
  removing any overall brightness shift), and the bottom-centre filling up.
  These keep working when no model finds the person (sujud right at the lens).

Both pose engines sometimes swap a body's left and right between frames
from this view, so pairs are put in a fixed image order before smoothing.
The salam direction is learned from the first salam, never assumed.

## Calibration and setup

The setup sheet coaches the placement live: nobody in view, too dark, head
cut off while standing ("tilt the screen back"), too close, too far, off to
one side (`advice.ts`, shown once it has held for a second). While the
prayer has not started, the engine keeps a rolling standing calibration
(the median of the last seconds of quiet standing frames). If the head is
cut off at the top, the head reference is estimated from the shoulders.
During qiyam the reference slowly follows the person. Each body engine
keeps its own reference. The sheet also offers a ten-second check: do a
ruku, then sit.

Placement, from the evaluation below: the front edge of the rug works; a
small angle (about 20 degrees, from a front corner) works best; 45 degrees
is worst.

## Sequence decoder

The order of the prayer is known, so the decoder never asks "which pose is
this?" in isolation. Consecutive steps the camera cannot tell apart form a
segment (qiyam's lines; tashahhud and salawat); the salams are segments of
their own (a head turn while sitting). In the current segment it listens
only for the **next** movement:

- per frame, evidence = confidence x (class log-likelihood ratio next vs
  current + change log-likelihood ratio of "moved the way this movement
  moves" vs "still here"), capped per frame;
- **a held posture never moves the prayer on**: the class term only counts
  while the change model sees the body move the expected way. (Without this,
  a lowered gaze in qiyam that merely looks like a bow eventually advanced.)
- evidence accumulates CUSUM-style with a drift (isolated misreads fade) and
  is accepted at a threshold (21), only after the current posture's minimum
  time (ruku 1 s, sujud 1.2 s, ...). Forward only.
- catch-up over a missed movement exists but is off: the app's timer
  fallback (6 s after the line) is safer than guessing two steps ahead.
- salams: a turn away from the neutral sitting head, measured against the
  last 4 to 1 s of sitting (a long tashahhud can drift slowly; a salam is
  quick) and above several times that head's own wander. The first is a
  turn either way, the second a turn the other way.
- lost: nobody in view for 8 s. Time takes over again, except in sujud
  (`hold`).

### Voice and other evidence

```ts
hands.addEvidence({ kind: 'takbir' | 'tasmi' | 'salam' | 'lineDone', confidence: 0..1, at?: ms })
```

`takbir` supports the next movement (except rising from ruku), `tasmi`
supports rising from ruku, `salam` the salams; each is worth half the
threshold while the camera sees the person, and moves on alone (confidence
>= 0.6) when it has seen nobody for 8 s. `lineDone` moves to the next line
inside the same posture. `at` uses the `performance.now()` clock. Advances
are forward-only and keyed by step index (`session.followTo` ignores an
index at or before the current one), so voice and camera never
double-advance.

## Resilience

| Problem | What happens |
| --- | --- |
| Camera track ends, stays muted, or a device is unplugged | Retry after 1 s, 3 s, 10 s (status "Reconnecting", the prayer holds); then time takes over with a notice in the camera card; a new device triggers another try |
| Vision worker crashes, hangs (no result for 3 s; 20 s for the first frame) or its GPU context is lost | Restarted on the CPU |
| DETRPose fails repeatedly (crash, WebGPU device lost) | Dropped; MediaPipe carries on |
| Module workers unavailable | The previous main-thread engine (MediaPipe lite + classify.ts) |
| Camera blocked / missing, no engine | Timed guidance; the camera card explains why and offers Try again and Use demo |
| Nobody in view for 8 s mid-prayer | Timed guidance resumes, except in sujud (hold) |

## Evaluation

There are no real recordings yet, so the set is synthetic: the app's four
companions (`public/avatars`) praying a two-rak'ah prayer with realistic,
seeded timings (qiyam and tashahhud shortened), filmed by a simulated
laptop webcam on the floor (46 degree vertical field of view, 14 to 30 cm
high, tilted 14 to 32 degrees up) at the rug's front edge, 30 cm and 60 cm
back, turned 0, 20, 30 and 45 degrees, in bright, normal and dim light
(gain, sensor noise, blur, JPEG). Every clip raises the hands before ruku
and after rising (raf' al-yadayn) as a distractor. 48 clips, 768
transitions.

```bash
npx vite --port 5191 &                                    # the ?lab pages
node scripts/synth/render.mjs --out .eval/synth           # videos + labels (~25 min)
npx vite build --outDir .eval/dist-perceive && npx vite preview --outDir .eval/dist-perceive --port 5192 &
BASE_URL=http://127.0.0.1:5192 node scripts/eval/perceive.mjs   # real engines, frame-exact (~40 min, 4 shards)
sh scripts/eval/loco.sh mp-first logreg --mode chained    # fit + evaluate, leave one companion out
```

Perception runs the real worker code in Chromium, frame by frame at each
frame's video time (a frozen build, so edits can't reload it mid-run).
Scoring replays the observations through the same TypeScript the app runs.
The per-frame classifier and change model are evaluated **leave one
companion out**: every clip is scored by models fitted on the other three
companions. The decoder settings were picked on two companions (yusuf,
maryam) for zero false advances; the other two (ahmad, aisha) had no say.

Metrics: a transition is *detected* if the app moves to that posture between
the movement's start and 1.5 s after the body arrives; a *false advance* is
a move to a posture the person is not in (or has not started moving into).
*Chained* runs carry the session from movement to movement with the app's
own timer fallback (a missed movement is followed 6 s later); *resync* runs
an ideal fallback (back in step as soon as a detection window has passed),
which isolates each transition. Latency is from the start of the movement
(the performer takes about 0.95 s per movement, 0.75 s per leg of a move to
or from the floor).

| engine (chained) | detected within 1.5 s | false advances | median latency (start / arrival) |
| --- | --- | --- | --- |
| previous engine, MediaPipe lite + classify.ts | 5.5% (42/768) | 0 | 0.92 / 0.87 s |
| previous engine, DETRPose + classify.ts | 4.8% (37/768) | 0 | 0.86 / 0.80 s |
| **new, MediaPipe + DETRPose (WebGPU devices)** | **70.8% (544/768)** | **0** | **0.97 / 0.93 s** |
| new, MediaPipe only (no WebGPU; one decoder tweak earlier) | 44.8% (344/768) | 0 | 0.99 / 0.93 s |
| new, resync (ideal fallback) | 78.3% (601/768) | 0 | 0.97 / 0.93 s |

By placement (new engine, chained / resync):

| | rug edge | 30 cm back | 60 cm back |
| --- | --- | --- | --- |
| detected | 66.8% / 72.3% | 73.4% / 80.5% | 72.3% / 82.0% |

| | straight on | 20 degrees | 30 degrees | 45 degrees |
| --- | --- | --- | --- | --- |
| detected | 69.3% / 81.3% | 81.8% / 84.9% | 72.9% / 78.6% | 59.4% / 68.2% |

Light: bright 80.0%, normal 67.6%, dim 65.8% (chained). Held-out companions
73.4%, tuning companions 68.2%. Zero false advances in every group.

Per movement (resync, 48 each):

| movement | detected | movement | detected |
| --- | --- | --- | --- |
| opening takbir | 72.9% | qiyam (rak'ah 2) | 97.9% |
| hands down to qiyam | 56.3% | ruku (2) | 91.7% |
| ruku | 91.7% | i'tidal (2) | 97.9% |
| i'tidal | 97.9% | sujud (2) | 95.8% |
| sujud | 95.8% | jalsah (2) | 79.2% |
| jalsah | 77.1% | second sujud (2) | 77.1% |
| second sujud | 77.1% | tashahhud | 79.2% |
| | | salam right / left | 47.9% / 16.7% |

The previous engine needed knees and ankles, which this view rarely shows:
it detected 1.2% of movements at the rug's edge.

Remaining failure cases, by evidence:

- **Salams** (48% / 17%): the nose moves 0.1 to 0.5 shoulder widths, little
  more than its wander on the stylized faces, and turning towards an angled
  camera barely moves it. The face model (yaw) almost never finds the
  stylized faces; on real faces it will, and the decoder already fuses it.
  The voice's `salam` evidence covers this meanwhile.
- **Sitting / second sujud** (77%): the short jalsah leaves little time for
  a baseline; some views confuse sitting and sujud in single frames.
- **Takbir to qiyam** (56%): hands coming down to the chest within a short
  takbir; harmless (the timer and the next movement carry on).
- **45 degrees**: the body turns away from both models; avoid it in setup.
- **MediaPipe only** (no WebGPU): MediaPipe often loses these stylized
  bodies when the head is cropped; DETRPose doesn't. Real people should do
  better, but measure it with recordings.
- Latency is about 1 s from the start of the movement (0.93 s after arrival):
  the zero-false-advance threshold costs speed. The decoder's `threshold`
  scale 0.75 cuts it to 0.72 s, but with 2 false advances in the 48 clips.

Caveat: these are stylized characters. Their faces are mostly invisible to
the face model and their bodies are harder for MediaPipe than people are,
so real numbers should be better for the face-driven parts and need to be
measured. Use `?lab&record`.

### Real recordings

`/?lab&record[&name=...]` (works in production builds too) runs the same
camera and vision worker, and records every observation (keypoints, face,
luma, features) plus manual marks. Press Space as each movement starts (it
marks the next posture of a two-rak'ah prayer), D then Space for a hand
raise that is not a step, 0 to 9 for a specific posture. Save downloads the
JSON (`prayalong-recording/1`) and a WebM. Put the JSON in `.eval/recorded/`:
`evaluate`, `dump-features` and `loco.sh` pick it up next to the synthetic
clips. Refit with real data (`scripts/eval/fit.py`) as soon as there is some.

### End to end

`scripts/e2e-handsfree.mjs` runs the whole app in Chromium with a clip as
the fake webcam (give it a still lead-in so the models load first) and
scores what the app followed:

```bash
npm run build && npx vite preview --port 4173 &
ffmpeg -framerate 15 -f mjpeg -i clip.mjpeg -vf tpad=start_duration=15:start_mode=clone -pix_fmt yuv420p clip.y4m
node scripts/e2e-handsfree.mjs clip.y4m clip.json --lead 15
```

Three clips through the whole app (main's App with the voice, the 6 s
grace timer and this engine; DETRPose was over its 150 ms budget on the
shared test GPU, so MediaPipe ran alone):

| clip | camera-detected within 1.5 s | false advances | median latency from start |
| --- | --- | --- | --- |
| yusuf, 30 cm, straight on | 13/16 | 0 | 0.99 s |
| ahmad, 60 cm, 20 degrees | 13/16 | 0 | 1.04 s |
| maryam, rug edge, straight on | 0/16 (the timer carried the prayer) | 0 | - |

The third shows the MediaPipe-only weakness at the rug's edge (see above).

## Testing

- `npm test`: features, decoder (sequence, salams, voice, dwell), camera
  retries, the vision worker's watchdog, and the old classifier.
- **Demo mode** (Settings, Demo mode): on-screen pose buttons, a whole-prayer
  autopilot, and keys 1 to 5.
- `window.__handsFree` holds the latest measures, features, posterior and
  decoder state, plus a log of camera starts and advances.

## Voice

The microphone can lead the prayer on its own (camera off) or move lines
while the camera leads postures. See [voice.md](voice.md): on-device Quran
ASR, a follower constrained to the current and next few lines, movement
phrases (takbir, tasmi, salam) as posture evidence, and a shared `Evidence`
shape for fusing both senses.
