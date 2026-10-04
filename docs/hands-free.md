# Hands-free

```
camera (12 fps) ──▶ pose-worker.ts (DETRPose, onnxruntime-web, off the main thread)
                       │ 17 keypoints of the most confident person
                       ▼
                 classify.ts  ──▶ hands-raised · standing · bowing · prostrating · sitting
                       ▼
                 stabilizer.ts ──▶ only deliberate, held changes (~0.6 s)
                       ▼
                 session.onPose(pose)
```

The session only listens for the **next** movement in the prayer (from qiyam
it waits for *bowing*, from ruku for *standing*, and so on), so a misread can
never skip ahead. Lines within a posture advance on timing; the body decides
when to change posture. If the camera or model isn't available, PrayAlong
falls back to timed guidance and says so — the user is never stuck.

Video never leaves the device.

## Model contract (DETRPose)

Put the exported model at `public/models/detrpose.onnx` (git-ignored), or set
`VITE_POSE_MODEL_URL` to where it's hosted. Export with DETRPose's
`tools/deployment/export_onnx.py` (opset 16):

| Tensor | Type / shape | Notes |
| --- | --- | --- |
| `images` (in) | float32 `[1,3,640,640]` | RGB, 0–1, plain resize (no letterbox, no mean/std) |
| `orig_target_sizes` (in) | int64 `[1,2]` | We pass `[1,1]` so keypoints come back normalized |
| `scores` (out) | float32 `[1,Q]` | We take the best score ≥ 0.4 |
| `labels` (out) | int64 `[1,Q]` | Unused |
| `keypoints` (out) | float32 `[1,Q,17,2]` | COCO-17 order, (x, y) |

Execution provider: WebGPU when available, WASM otherwise. Start with the N
or S variant for laptops; test the deformable-attention ops on both providers.

If the export differs, only `src/handsfree/pose-worker.ts` needs to change.

## Tuning the classifier

`src/handsfree/classify.ts` uses body geometry in units of the person's own
torso length, so distance from the camera doesn't matter. It handles side and
front views (a head-on bow is detected by torso foreshortening against a
quiet standing calibration). `classify.test.ts` has stick-figure fixtures;
add real recorded keypoints there as you collect them.

## Testing without a camera

Open `/?simulate`, turn on Hands-Free, and press **1**–**5** to act out poses.
