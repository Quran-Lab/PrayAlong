# DETRPose → `public/models/detrpose.onnx`

Browser build of [DETRPose](https://github.com/SebastianJanampa/DETRPose) (Apache-2.0), the model
behind `src/handsfree/pose-worker.ts`. One command reproduces the shipped file bit-for-bit:

```sh
tools/detrpose/export.sh          # N variant -> public/models/detrpose.onnx  (sha256 29f843c6…10f9f)
BROWSER_CHECK=1 tools/detrpose/export.sh   # + headless-Chromium check on wasm and webgpu
tools/detrpose/export.sh s        # S variant, left in $OUT_DIR (default /tmp/detrpose-build)
```

## What ships

`public/models/detrpose.onnx`: **DETRPose-N (COCO, 57.2 AP), fp16 weights with fp32 compute,
8.77 MB**, opset 16, static batch 1.

| Tensor | Type / shape | Notes |
| --- | --- | --- |
| `images` (in) | float32 `[1,3,640,640]` | RGB 0–1, plain resize, no mean/std |
| `orig_target_sizes` (in) | int64 `[1,2]` | `[w,h]`; `[1,1]` gives normalized keypoints |
| `scores` (out) | float32 `[1,60]` | sigmoid score; Q = 60, sorted descending |
| `labels` (out) | int64 `[1,60]` | always 1 (person) |
| `keypoints` (out) | float32 `[1,60,17,2]` | COCO-17 (x, y), times `orig_target_sizes` |

The IO is fp32/int64. The weights are stored as fp16 and each one is followed by a `Cast` to fp32.
ORT constant-folds these casts when it creates the session, so it computes in fp32 on every EP and
only the download is halved. The contract matches `pose-worker.ts` exactly, so no app changes are
needed.

## Verification (example images from the DETRPose repo, 640×480)

| Check | Result |
| --- | --- |
| ONNX fp32 vs PyTorch eager | top-5 people 0.000 px, scores ≤ 3e-5 |
| shipped fp16w vs fp32 | mean 0.03 px, max 0.31 px, score ≤ 0.0006, same people ≥ 0.4 |
| `[1,1]` vs `[w,h]` | `norm·[w,h] == pixel` exactly; keypoints land on every person (overlays in `$OUT_DIR/vis`) |
| onnxruntime-web 1.30, WASM, Node (`check_web.mjs`) | OK, 0.03 / 0.06 px vs golden |
| onnxruntime-web 1.30, **app bundle** `ort.bundle.min.mjs`, Chromium 141, `wasm` | OK, 0.03 / 0.06 px |
| same, `webgpu` (SwiftShader adapter) | OK, 0.03 / 0.06 px; 939 nodes on WebGPU, 15 on CPU (below) |

Latency on a shared 4-vCPU VM that was busy with other jobs (load avg 5–8), so treat these as
upper bounds:

| Runtime | N fp16w (shipped) |
| --- | --- |
| onnxruntime 1.30 Python CPU, 1 thread | ~200 ms |
| onnxruntime 1.30 Python CPU, default threads (quieter moment) | ~90–170 ms |
| onnxruntime-web WASM in Node, 1 thread | ~600 ms |
| onnxruntime-web WASM in Node, 2 threads | ~340 ms |
| onnxruntime-web WASM in Chromium (COOP/COEP, 2 threads) | ~320 ms |

S is about 3× slower: about 1 s/frame on 2-thread WASM, about 470 ms on 1-thread Python CPU.

## Three things the stock export gets wrong (and the fixes)

1. **The decoder isn't traced faithfully (accuracy).** `DeformableTransformerDecoderLayer.with_pos_embed`
   does `tensor[:, :, -np:] += pos` in place. Eager PyTorch, and so training and the published AP,
   relies on the mutation showing up through aliases: the attention value and residual, the gateway
   input, and `TransformerDecoder.forward`'s `output_pose_detach`, which is a view of the previous
   layer's output. The TorchScript exporter rewrites the op as `ScatterND` and doesn't update those
   aliases, so the stock ONNX drifts 0.5–2 px and up to 0.01 in score from PyTorch.
   `onnx_patches.py` rewrites the two forwards out-of-place. That is bit-identical in eager
   (max |diff| = 0) and makes the ONNX match PyTorch. `torch_parity.py` checks this
   (`--no-patch` on `export_onnx.py` reproduces the drift).
2. **onnxruntime-web refuses the session.** The export leaves one `Gemm` output annotated as
   rank 0 (it is really `[400,128]`). Python ORT only warns ("lenient merge"); onnxruntime-web fails
   with `ShapeInferenceError: Mismatch between number of inferred and declared dimensions`.
   `make_web_models.py` strips `value_info` after checking strict shape inference.
3. **WebGPU fails at `run()`.** The HGNetv2 stem's `MaxPool2d(k=2, s=1, ceil_mode=True)` throws
   `ceil_mode ... not yet implemented in the WebGPU MaxPool kernel`. Session *creation* succeeds,
   so `['webgpu','wasm']` would never fall back to WASM; every frame would error. With stride 1,
   `ceil_mode` is a no-op, so `make_web_models.py` sets it to 0 (and refuses if stride ≠ 1).

Smaller environment notes: torch ≥ 2.9 defaults to the dynamo exporter, so `export_onnx.py` wraps
`torch.onnx.export` with `dynamo=False` (what upstream used) and a static batch. The postprocessor
hard-codes batch 1 anyway. The repo imports `xtcocotools` at load time, and its PyPI wheel is built
against numpy 1.x, so `export.sh` rebuilds it from source.

## Variants (scratch only; `make_web_models.py --only …`)

Accuracy is measured against each model's own fp32. "People" means detections with score ≥ 0.4.

| Variant | N size | N accuracy | S size | S accuracy | Verdict |
| --- | --- | --- | --- | --- | --- |
| fp32 | 17.2 MB | reference | 47.7 MB | reference | too big |
| **fp16w** (fp16 weights, fp32 compute) | **8.8 MB** | 0.03 px, 0.0006 | 24.1 MB | 0.03 px, 0.002 | **shipped (N)** |
| fp16 (fp16 compute, `keep_io_types`) | 8.7 MB | 0.16 px, 0.023, borderline person lost | 24.0 MB | not measured | slower on WASM (ORT inserts casts); possible WebGPU speedup, untested on a real GPU |
| int8w (int8 weights, per-channel, fp32 compute) | 4.7 MB | 1.1 px mean, 21 px max, 0.58, people change | 12.4 MB | 0.6 px mean, 7.8 px max, 0.02, same people | N: no. S: the only S under 14 MB, but about 1 s/frame on WASM |
| int8 dynamic (`quantize_dynamic` MatMul/Gemm) | 12.3 MB | 2.6 px mean, 0.73, people change | 28.7 MB | 1.4 px mean, 0.024 | no |

## Caveats for the app

- **WASM threads need cross-origin isolation.** Without COOP/COEP headers, onnxruntime-web runs
  WASM single-threaded: about 600 ms/frame here, 2–5 fps on a typical laptop. The Vite config
  doesn't set them. Add `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp` (or `credentialless`) on the host to get threads,
  but check other cross-origin assets first.
- **WebGPU CPU fallbacks:** 3 × `TopK` (encoder query selection over 2000 anchors, the LQE head,
  the postprocessor) plus small int64 ops (`Tile`, `Unsqueeze`, `Cast`, `Mod`, `Expand`) run on
  CPU, which costs a few GPU↔CPU syncs per frame. GridSample (deformable attention) runs on
  WebGPU. WebGPU was validated only on SwiftShader, so its speed on a real GPU isn't measured here.
- No NMS: a person can appear twice (for example 0.71 and 0.42). The worker's "take the max score"
  is fine for a single user.
- `onnx_patches.py` mirrors upstream commit `d56a050`. If upstream `transformer.py` changes,
  re-check the patch with `torch_parity.py`.

## Files

| File | Purpose |
| --- | --- |
| `export.sh` | end-to-end reproduction (venv → weights → export → web variants → checks → install) |
| `export_onnx.py` | runs upstream `tools/deployment/export_onnx.py` with the patches above |
| `onnx_patches.py` | out-of-place decoder forwards (fix 1) |
| `torch_parity.py` | ONNX vs unpatched PyTorch eager |
| `make_web_models.py` | web fixes (2, 3) plus fp16w / fp16 / int8w / int8 variants |
| `verify_onnx.py` | Python ORT checks, `[1,1]` vs `[w,h]`, overlays, golden dump for the JS checks |
| `check_web.mjs` | onnxruntime-web WASM in Node vs golden data, plus latency |
| `check_browser.mjs` | same in headless Chromium with the app's bundle, `wasm` and `webgpu`, plus node placement |
