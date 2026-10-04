"""Run DETRPose's own tools/deployment/export_onnx.py (opset 16) with three export-time patches.

Usage (from anywhere):
    python export_onnx.py --repo /tmp/detrpose-src --variant n --weights detrpose_hgnetv2_n.pth \
        --out detrpose_n_fp32.onnx [--opset 16] [--dynamic-batch] [--no-patch]

Patches (the repo files themselves are not modified):
  * onnx_patches.apply() - rewrites the decoder's in-place `tensor[:, :, -np:] += pos` (and the
                    aliasing that depends on it) out-of-place so the traced graph computes what
                    PyTorch eager/training computes. Without it the ONNX output drifts ~1-2 px /
                    0.01 score from PyTorch. Disable with --no-patch to get the stock export.
torch.onnx.export is wrapped with:
  * dynamo=False  - torch >= 2.9 defaults to the torch.export/onnxscript exporter; the repo
                    was written for (and tested with) the legacy TorchScript exporter.
  * static batch  - the deploy postprocessor hard-codes `expand(1, num_select, ...)`, so the
                    'N' dynamic axis is fake. A static [1,3,640,640] graph lets onnxsim fold
                    every shape computation, which makes the browser graph smaller and faster.
The repo script then runs onnx.checker + onnxsim (both on by default) and writes
<repo>/onnx_engines/detrpose_hgnetv2_<variant>.onnx, which we copy to --out.
"""
import argparse
import os
import runpy
import shutil
import sys

import torch

ap = argparse.ArgumentParser()
ap.add_argument('--repo', default='/tmp/detrpose-src')
ap.add_argument('--variant', default='n', choices=['n', 's', 'm', 'l', 'x'])
ap.add_argument('--weights', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--opset', type=int, default=16)
ap.add_argument('--dynamic-batch', action='store_true', help='keep the repo\'s dynamic N axis')
ap.add_argument('--no-patch', action='store_true', help='skip onnx_patches (reproduces the stock export)')
args = ap.parse_args()

repo = os.path.abspath(args.repo)
weights = os.path.abspath(args.weights)
out = os.path.abspath(args.out)
cfg = f'configs/detrpose/detrpose_hgnetv2_{args.variant}.py'

_orig_export = torch.onnx.export


def patched_export(model, a, f, **kw):
    kw['dynamo'] = False
    kw['opset_version'] = args.opset
    if not args.dynamic_batch:
        kw['dynamic_axes'] = None
    print(f'[wrapper] torch.onnx.export(dynamo=False, opset={args.opset}, dynamic_axes={kw.get("dynamic_axes")})')
    return _orig_export(model, a, f, **kw)


torch.onnx.export = patched_export

os.chdir(repo)  # the repo's config loader and output folder are relative to the repo root
sys.path.insert(0, repo)
if not args.no_patch:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import onnx_patches
    onnx_patches.apply()
    print('[wrapper] applied onnx_patches (out-of-place pos-embed in decoder)')
sys.argv = ['export_onnx.py', '-c', cfg, '-r', weights]
runpy.run_path(os.path.join(repo, 'tools/deployment/export_onnx.py'), run_name='__main__')

produced = os.path.join(repo, 'onnx_engines', f'detrpose_hgnetv2_{args.variant}.onnx')
os.makedirs(os.path.dirname(out), exist_ok=True)
shutil.copyfile(produced, out)
print(f'[wrapper] wrote {out} ({os.path.getsize(out) / 1e6:.2f} MB)')
