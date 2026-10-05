# Hands-free

```
camera (15 fps) ──▶ pose engine ──▶ 17 COCO keypoints of the most prominent person
                         │            MediaPipe Pose Landmarker — starts instantly (GPU → CPU)
                         │            DETRPose-N on WebGPU — warms up in the background and
                         │            takes over when a frame fits the budget (≤ 120 ms)
                         ▼
                   classify.ts   ──▶ hands-raised · standing · bowing · prostrating · sitting
                         ▼
                   stabilizer.ts ──▶ only deliberate, held changes (~0.5 s)
                         ▼
                   session.onPose(pose)
```

Hands-free is **on by default**. The camera starts when the learner picks a
mode on the start screen (one prompt for camera and microphone), never on page
load; the header button turns it off, and the choice is remembered.

The session only listens for the **next** movement in the prayer (from qiyam
it waits for *bowing*, from ruku for *standing*, and so on), so a misread can
never skip ahead. Lines within a posture advance on timing; the body decides
when to change posture. Video never leaves the device.

## Fallbacks

| Problem | What happens |
| --- | --- |
| GPU delegate fails | MediaPipe retries on the CPU |
| Preferred engine fails | The other engine is tried |
| Camera blocked / missing, or no engine starts | Prayer continues on timed guidance; the setup sheet offers **Continue without the camera** and **Try again**, the camera card **Try again** |
| Person not fully in frame | "Step back so your whole body is in view" (setup sheet and camera card) |

## Engines

**MediaPipe Pose Landmarker** (`public/models/pose_landmarker_lite.task`,
wasm self-hosted in `public/mediapipe/`, copied on `npm install`) is the
default: fast on laptops and phones, with per-landmark visibility used for
the framing check.

**DETRPose-N** (`public/models/detrpose.onnx`, 8.8 MB, fp16 weights / fp32
maths, COCO 57.2 AP) runs in a Web Worker with onnxruntime-web's WebGPU
(JSEP) backend, falling back to multi-threaded WebAssembly. On WebGPU
devices it warms up behind MediaPipe and takes over once its speed test
passes; the camera setup sheet shows which engine is live. Force it with
`?engine=detrpose` (or `?engine=mediapipe`, or `VITE_POSE_ENGINE`).

The WebGPU runtime is 28 MB — over Cloudflare's 25 MiB per-file limit — so
`npm run build` splits it into parts under `dist/ort/`
(`scripts/split-large-assets.mjs`) and the worker stitches them back
together. Still fully self-hosted; a hung GPU times out and never blocks
hands-free.
`tools/detrpose/` rebuilds it byte-for-byte — see its README for the three
export fixes (in-place decoder op, shape annotation, MaxPool `ceil_mode`).

| Tensor | Type / shape | Notes |
| --- | --- | --- |
| `images` (in) | float32 `[1,3,640,640]` | RGB 0–1, plain resize |
| `orig_target_sizes` (in) | int64 `[1,2]` | We pass `[1,1]` → normalized keypoints |
| `scores` (out) | float32 `[1,60]` | Sorted; we take the best ≥ 0.4 |
| `labels` (out) | int64 `[1,60]` | Always person |
| `keypoints` (out) | float32 `[1,60,17,2]` | COCO-17 (x, y) |

Speed: WebAssembly is single-threaded unless the page is cross-origin
isolated — `public/_headers` sets COOP/COEP on Cloudflare (Workers static
assets), Netlify and Cloudflare Pages.

## Testing

- **Demo mode** (developers only, `/?demo`; not offered in the app): on-screen
  pose buttons, a whole-prayer autopilot, and keys **1**–**5** on a keyboard.
- **End to end with a real engine**: feed any video as the webcam —
  ```bash
  npm run build && npx vite preview --port 4173 &
  node scripts/e2e-handsfree.mjs path/to/praying.mjpeg 90          # MediaPipe
  ENGINE=detrpose node scripts/e2e-handsfree.mjs path/to/praying.mjpeg 90
  ```
  It logs the dock, the camera card and the raw classification over time.
  Verified with a rendered video of the companion praying: takbir starts
  the prayer, then standing → bowing → rising → prostration are followed.
- `window.__handsFree` holds the latest keypoints and reading while running.

## Tuning the classifier

`src/handsfree/classify.ts` uses body geometry in units of the person's own
torso length, so distance from the camera doesn't matter. It handles side
and front views: a head-on bow by torso foreshortening against a quiet
standing calibration, head-on kneeling by ankles tucked level with the
knees. `classify.test.ts` has stick-figure fixtures; add real recorded
keypoints there as you collect them (copy `window.__handsFree.keypoints`).
