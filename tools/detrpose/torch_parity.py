"""Compare an exported DETRPose ONNX model against the *unpatched* PyTorch model (eager).

    python torch_parity.py --repo /tmp/detrpose-src --variant n --weights detrpose_hgnetv2_n.pth \
        --onnx detrpose_n_fp32.onnx [--images a.jpg b.jpg]

For each image, matches every one of the top-5 PyTorch detections to the nearest ONNX detection and
prints the keypoint distance (px) and the top-8 score difference. With onnx_patches applied during
export this is ~0 px / <1e-4; the stock export is ~0.5-2 px / up to 0.01 off.
"""
import argparse
import os
import sys

import numpy as np
import onnxruntime as ort
import torch
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('--repo', default='/tmp/detrpose-src')
ap.add_argument('--variant', default='n')
ap.add_argument('--weights', required=True)
ap.add_argument('--onnx', required=True)
ap.add_argument('--images', nargs='+')
a = ap.parse_args()

repo = os.path.abspath(a.repo)
weights, onnx_path = os.path.abspath(a.weights), os.path.abspath(a.onnx)
images = [os.path.abspath(p) for p in a.images] if a.images else [f'{repo}/examples/example1.jpg', f'{repo}/examples/example2.jpg']
sys.path.insert(0, repo)
os.chdir(repo)
from src.core import LazyConfig, instantiate  # noqa: E402

cfg = LazyConfig.load(f'configs/detrpose/detrpose_hgnetv2_{a.variant}.py')
cfg.model.backbone.pretrained = False
model, post = instantiate(cfg.model), instantiate(cfg.postprocessor).deploy()
ck = torch.load(weights, map_location='cpu', weights_only=False)
model.load_state_dict(ck['ema']['module'] if 'ema' in ck else ck['model'])
model = model.deploy().eval()

so = ort.SessionOptions()
so.log_severity_level = 3
sess = ort.InferenceSession(onnx_path, so, providers=['CPUExecutionProvider'])
worst = 0.0
for path in images:
    im = Image.open(path).convert('RGB')
    w, h = im.size
    x = (np.asarray(im.resize((640, 640), Image.BILINEAR), dtype=np.float32) / 255).transpose(2, 0, 1)[None].copy()
    sz = np.array([[w, h]], dtype=np.int64)
    with torch.no_grad():
        ts, _, tk = post(model(torch.from_numpy(x)), torch.from_numpy(sz))
    os_, _, ok = sess.run(None, {'images': x, 'orig_target_sizes': sz})
    tk, ok = tk[0].numpy(), ok[0]
    d = [float(np.linalg.norm(ok - tk[i][None], axis=-1).mean(-1).min()) for i in range(5)]
    worst = max(worst, max(d))
    print(f'{os.path.basename(path)}: top-5 keypoint dist (px) {np.round(d, 3).tolist()}, '
          f'top-8 score |diff| max {np.abs(ts[0, :8].numpy() - os_[0, :8]).max():.2e}')
print('PARITY OK' if worst < 0.1 else 'PARITY DRIFT (was onnx_patches applied?)')
