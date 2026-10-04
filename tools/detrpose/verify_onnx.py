"""Sanity-check a DETRPose ONNX export with onnxruntime (CPU).

    python verify_onnx.py model.onnx [--ref ref.onnx] [--images a.jpg b.jpg] [--draw outdir]

* Preprocessing is exactly what src/handsfree/pose-worker.ts does: plain resize to 640x640,
  RGB, /255, NCHW float32, no mean/std.
* Runs with orig_target_sizes=[w,h] (pixel coords) and [1,1] (normalized) and checks
  pixel == normalized * [w,h].
* With --ref, compares scores/keypoints of the top detections against a reference model
  (e.g. the fp32 export) to quantify fp16/int8 drift.
* With --draw, writes skeleton overlays so you can eyeball that keypoints land on people.
* With --dump DIR, writes <image>.input.bin (raw float32 [1,3,640,640]) and <image>.json (normalized
  outputs of this model) as golden data for check_web.mjs (onnxruntime-web in Node).
"""
import argparse
import os
import time

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageDraw

COCO_SKELETON = [(15, 13), (13, 11), (16, 14), (14, 12), (11, 12), (5, 11), (6, 12), (5, 6), (5, 7),
                 (6, 8), (7, 9), (8, 10), (1, 2), (0, 1), (0, 2), (1, 3), (2, 4), (3, 5), (4, 6)]


def preprocess(path):
    im = Image.open(path).convert('RGB')
    w, h = im.size
    x = np.asarray(im.resize((640, 640), Image.BILINEAR), dtype=np.float32) / 255.0
    return im, w, h, x.transpose(2, 0, 1)[None].copy()


def session(path):
    so = ort.SessionOptions()
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    return ort.InferenceSession(path, so, providers=['CPUExecutionProvider'])


def run(sess, x, size):
    s, l, k = sess.run(None, {'images': x, 'orig_target_sizes': np.array([size], dtype=np.int64)})
    return s[0], l[0], k[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('model')
    ap.add_argument('--ref')
    ap.add_argument('--images', nargs='+', default=['/tmp/detrpose-src/examples/example1.jpg',
                                                     '/tmp/detrpose-src/examples/example2.jpg'])
    ap.add_argument('--thr', type=float, default=0.4)
    ap.add_argument('--draw')
    ap.add_argument('--bench', type=int, default=20)
    ap.add_argument('--dump')
    a = ap.parse_args()

    sess = session(a.model)
    ref = session(a.ref) if a.ref else None
    print(f'model {a.model} ({os.path.getsize(a.model) / 1e6:.2f} MB)')
    for i in sess.get_inputs():
        print('  in ', i.name, i.type, i.shape)
    for o in sess.get_outputs():
        print('  out', o.name, o.type, o.shape)

    for path in a.images:
        im, w, h, x = preprocess(path)
        s, l, kp = run(sess, x, [w, h])
        sn, _, kn = run(sess, x, [1, 1])
        keep = np.where(s > a.thr)[0]
        print(f'\n{os.path.basename(path)} {w}x{h}: {len(keep)} people > {a.thr} '
              f'(top scores {np.round(np.sort(s)[::-1][:5], 3).tolist()}), labels {set(l[keep].tolist())}')
        assert np.allclose(s, sn), 'scores must not depend on orig_target_sizes'
        err = np.abs(kn * np.array([w, h]) - kp).max()
        print(f'  [1,1] -> normalized range x[{kn[keep, :, 0].min():.3f},{kn[keep, :, 0].max():.3f}] '
              f'y[{kn[keep, :, 1].min():.3f},{kn[keep, :, 1].max():.3f}]; max |norm*[w,h] - pixel| = {err:.4f}px')
        for q in keep[:6]:
            k = kp[q]
            print(f'  person q={q} score={s[q]:.3f} nose=({k[0, 0]:.0f},{k[0, 1]:.0f}) '
                  f'hips=({k[11, 0]:.0f},{k[11, 1]:.0f})/({k[12, 0]:.0f},{k[12, 1]:.0f}) '
                  f'ankles=({k[15, 0]:.0f},{k[15, 1]:.0f})/({k[16, 0]:.0f},{k[16, 1]:.0f})')
        if ref is not None:
            rs, _, rk = run(ref, x, [w, h])
            rkeep = np.where(rs > a.thr)[0]
            top = np.argsort(-rs)[:max(len(rkeep), 1)]
            # match each reference person to the closest candidate by mean keypoint distance
            dists, sdiff = [], []
            for q in top:
                d = np.linalg.norm(kp - rk[q][None], axis=-1).mean(-1)
                j = int(np.argmin(d))
                dists.append(np.linalg.norm(kp[j] - rk[q], axis=-1))
                sdiff.append(abs(float(s[j]) - float(rs[q])))
            dists = np.stack(dists)
            print(f'  vs ref: ref people {len(rkeep)}, this {len(keep)}; keypoint err mean {dists.mean():.2f}px '
                  f'max {dists.max():.2f}px (image {w}x{h}); score |diff| max {max(sdiff):.4f}')
        if a.dump:
            import json
            os.makedirs(a.dump, exist_ok=True)
            stem = os.path.splitext(os.path.basename(path))[0]
            x.astype(np.float32).tofile(os.path.join(a.dump, stem + '.input.bin'))
            json.dump({'width': w, 'height': h, 'scores': sn.tolist(), 'keypoints': kn.tolist()},
                      open(os.path.join(a.dump, stem + '.json'), 'w'))
        if a.draw:
            os.makedirs(a.draw, exist_ok=True)
            d = ImageDraw.Draw(im)
            for q in keep:
                k = kp[q]
                for i, j in COCO_SKELETON:
                    d.line([tuple(k[i]), tuple(k[j])], fill=(0, 255, 0), width=3)
                for x0, y0 in k:
                    d.ellipse([x0 - 4, y0 - 4, x0 + 4, y0 + 4], fill=(255, 0, 0))
            name = os.path.splitext(os.path.basename(a.model))[0] + '_' + os.path.basename(path)
            im.save(os.path.join(a.draw, name))

    if a.bench:
        _, w, h, x = preprocess(a.images[0])
        for _ in range(3):
            run(sess, x, [1, 1])
        t = time.perf_counter()
        for _ in range(a.bench):
            run(sess, x, [1, 1])
        print(f'\nORT CPU latency: {(time.perf_counter() - t) / a.bench * 1000:.1f} ms/frame '
              f'({ort.get_device()}, intra_op threads default)')


if __name__ == '__main__':
    main()
