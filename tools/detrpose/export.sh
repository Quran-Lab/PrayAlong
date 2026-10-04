#!/usr/bin/env bash
# Reproduce public/models/detrpose.onnx (DETRPose-N, fp16 weights / fp32 compute) end to end.
#
#   tools/detrpose/export.sh            # N variant -> public/models/detrpose.onnx
#   tools/detrpose/export.sh s          # S variant (stays in $OUT_DIR, not installed)
#
# Env overrides: DETRPOSE_SRC (/tmp/detrpose-src), DETRPOSE_VENV (/tmp/detrpose-venv),
#                OUT_DIR (/tmp/detrpose-build), BROWSER_CHECK=1 (also run headless Chromium).
set -euo pipefail

VARIANT=${1:-n}
HERE=$(cd "$(dirname "$0")" && pwd)
APP=$(cd "$HERE/../.." && pwd)
SRC=${DETRPOSE_SRC:-/tmp/detrpose-src}
VENV=${DETRPOSE_VENV:-/tmp/detrpose-venv}
OUT=${OUT_DIR:-/tmp/detrpose-build}
PY="$VENV/bin/python"
COMMIT=d56a05012e98e83d1594e53d1826b9cf42a5db8a # upstream main as of 2026-10-04 (what onnx_patches mirrors)

# 1. upstream source
if [ ! -d "$SRC" ]; then
  git clone https://github.com/SebastianJanampa/DETRPose "$SRC"
  git -C "$SRC" checkout "$COMMIT"
fi
[ "$(git -C "$SRC" rev-parse HEAD)" = "$COMMIT" ] || echo "WARN: $SRC is not at $COMMIT; re-check onnx_patches.py against transformer.py"

# 2. python env (PyPI only; the default Linux torch wheel pulls CUDA libs, CPU is used)
if [ ! -x "$PY" ]; then
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q --upgrade pip
  "$VENV/bin/pip" install -q torch==2.14.1 torchvision==0.29.1 numpy==2.4.6 onnx==1.23.1 onnxruntime==1.30.0 \
    onnxsim==0.7.3 omegaconf iopath cloudpickle scipy opencv-python-headless pycocotools pillow cython setuptools wheel
  # the repo imports xtcocotools at module load; its PyPI wheel is built against numpy 1.x -> rebuild
  "$VENV/bin/pip" install -q --no-deps --no-binary xtcocotools --no-build-isolation xtcocotools
fi

# 3. weights (GitHub release "model_weights")
mkdir -p "$OUT/weights"
W="$OUT/weights/detrpose_hgnetv2_$VARIANT.pth"
[ -s "$W" ] || curl -sSL -o "$W" "https://github.com/SebastianJanampa/DETRPose/releases/download/model_weights/detrpose_hgnetv2_$VARIANT.pth"

# 4. export with the repo's tools/deployment/export_onnx.py (+ patches, see export_onnx.py)
"$PY" "$HERE/export_onnx.py" --repo "$SRC" --variant "$VARIANT" --weights "$W" --out "$OUT/detrpose_${VARIANT}_fp32.onnx"
"$PY" "$HERE/torch_parity.py" --repo "$SRC" --variant "$VARIANT" --weights "$W" --onnx "$OUT/detrpose_${VARIANT}_fp32.onnx"

# 5. browser-ready variants (web fixes + fp16 weights; add int8w/fp16/int8 to --only for the others)
"$PY" "$HERE/make_web_models.py" "$OUT/detrpose_${VARIANT}_fp32.onnx" --out-dir "$OUT/web" --prefix "detrpose_$VARIANT" --only fp32 fp16w
FP32="$OUT/web/detrpose_${VARIANT}_fp32.web.onnx"
FINAL="$OUT/web/detrpose_${VARIANT}_fp16w.web.onnx"

# 6. python checks: fp32 -> golden data + overlays; fp16w vs fp32
IMGS=("$SRC/examples/example1.jpg" "$SRC/examples/example2.jpg")
"$PY" "$HERE/verify_onnx.py" "$FP32" --images "${IMGS[@]}" --dump "$OUT/golden_$VARIANT" --draw "$OUT/vis"
"$PY" "$HERE/verify_onnx.py" "$FINAL" --ref "$FP32" --images "${IMGS[@]}" --draw "$OUT/vis"

# 7. onnxruntime-web (WASM backend) in Node, using the app's node_modules
node "$HERE/check_web.mjs" "$FINAL" "$OUT/golden_$VARIANT" --threads 1
node "$HERE/check_web.mjs" "$FINAL" "$OUT/golden_$VARIANT" --threads 4
if [ "${BROWSER_CHECK:-0}" = 1 ]; then
  CHROMIUM_PATH=${CHROMIUM_PATH:-/opt/pw-browsers/chromium} node "$HERE/check_browser.mjs" "$FINAL" "$OUT/golden_$VARIANT" --runs 3
fi

# 8. install (N only; S is ~3x slower on WASM and 24 MB as fp16w)
if [ "$VARIANT" = n ]; then
  mkdir -p "$APP/public/models"
  cp "$FINAL" "$APP/public/models/detrpose.onnx"
  echo "installed $APP/public/models/detrpose.onnx ($(du -h "$APP/public/models/detrpose.onnx" | cut -f1))"
fi
