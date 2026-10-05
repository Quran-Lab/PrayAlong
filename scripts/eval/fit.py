"""Fits the per-frame posture classifier on the calibrated features and
writes src/handsfree/posture-model.json.

    node scripts/eval/run.mjs dump-features > .eval/features.csv
    python scripts/eval/fit.py .eval/features.csv [--model logreg|mlp] [--all] [--out path]

Fits on the 'tune' split (two characters) only, unless --all; reports
per-frame accuracy on the held-out 'test' characters. Only settled frames
(the body has arrived) are used. Face features are deliberately left out:
the synthetic companions' stylised faces are rarely found by the face
model, so anything learned about faces here would not transfer to people.

The model is a small softmax network: no hidden layer (logistic
regression) or one ReLU layer (--model mlp). posterior.ts runs either.
"""
import json
import sys

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.neural_network import MLPClassifier

FEATS = ['headDy', 'headScale', 'shDy', 'shScale', 'neck', 'headDx', 'torsoRatio', 'tilt', 'headVis', 'shVis', 'hipVis', 'kneeVis',
         'headLow', 'wristUp', 'wristHead', 'wristSpread', 'lumaBottom', 'lumaDark', 'body',
         'lumaTL', 'lumaTC', 'lumaTR', 'lumaML', 'lumaMC', 'lumaMR', 'lumaBL', 'lumaBC', 'lumaBR']
CLASSES = ['standing', 'hands-raised', 'bowing', 'prostrating', 'sitting']
CLIP = 6.0


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def design(df, mean=None, std=None):
    X = df[FEATS].astype(float)
    miss = X.isna()
    if mean is None:
        mean = X.mean()
        std = X.std().replace(0, 1).fillna(1)
    Z = ((X - mean) / std).clip(-CLIP, CLIP).fillna(0)
    M = miss.astype(float).add_suffix('_missing')
    return np.hstack([Z.values, M.values]), mean, std


def main():
    path = sys.argv[1]
    kind = arg('--model', 'logreg')
    use_all = '--all' in sys.argv
    df = pd.read_csv(path)
    df = df[df.settled == 1]
    chars = arg('--train-chars')
    if chars:
        train_set = set(chars.split(','))
        tune = df[df.character.isin(train_set)]
        test = df[~df.character.isin(train_set)]
    else:
        tune = df if use_all else df[df.split == 'tune']
        test = df[df.split == 'test']
    X, mean, std = design(tune)
    y = tune.cls.map(CLASSES.index).values
    if kind == 'mlp':
        clf = MLPClassifier(hidden_layer_sizes=(24,), alpha=1e-2, max_iter=600, random_state=0, early_stopping=True)
        # Balance classes by resampling (MLPClassifier has no class_weight).
        rng = np.random.default_rng(0)
        counts = np.bincount(y, minlength=len(CLASSES))
        idx = np.concatenate([rng.choice(np.where(y == c)[0], counts.max(), replace=True) for c in range(len(CLASSES)) if counts[c]])
        clf.fit(X[idx], y[idx])
        layers = [{'W': W.T.round(5).tolist(), 'b': b.round(5).tolist()} for W, b in zip(clf.coefs_, clf.intercepts_)]
    else:
        clf = LogisticRegression(C=0.3, max_iter=3000, class_weight='balanced')
        clf.fit(X, y)
        layers = [{'W': clf.coef_.round(5).tolist(), 'b': clf.intercept_.round(5).tolist()}]

    def report(name, d):
        if not len(d):
            return
        Xd, _, _ = design(d, mean, std)
        pred = clf.predict(Xd)
        yd = d.cls.map(CLASSES.index).values
        acc = (pred == yd).mean()
        per = {c: round(float((pred[yd == i] == i).mean()), 3) for i, c in enumerate(CLASSES) if (yd == i).any()}
        print(f'{name}: frame accuracy {acc:.3f} (n={len(d)})  per class recall {per}')
        for col in ['gap', 'yaw']:
            g = d.assign(ok=(pred == yd)).groupby(col).ok.mean().round(3).to_dict()
            print(f'   by {col}: {g}')

    report('tune', tune)
    report('test', test)
    model = {
        'features': FEATS,
        'mean': [float(mean[f]) for f in FEATS],
        'std': [float(std[f]) for f in FEATS],
        'clip': CLIP,
        'classes': [CLASSES[i] for i in clf.classes_],
        'layers': layers,
        'fit': {'model': kind, 'split': chars or ('all' if use_all else 'tune'), 'rows': int(len(tune))},
    }
    out = arg('--out', 'src/handsfree/posture-model.json')
    with open(out, 'w') as f:
        json.dump(model, f, separators=(',', ':'))
    print('wrote', out)

    change = fit_change(tune)
    out = arg('--change-out', 'src/handsfree/change-model.json')
    with open(out, 'w') as f:
        json.dump(change, f, separators=(',', ':'))
    print('wrote', out, 'transitions', sorted(change['transitions']))


# ------------------------------------------------ change model

CHANGE_FEATS = ['headDy', 'shDy', 'neck', 'headDx', 'torsoRatio', 'tilt', 'headLow', 'headScale', 'shScale', 'wristUp', 'wristSpread', 'lumaBottom', 'headVis', 'shVis',
                'lumaTL', 'lumaTC', 'lumaTR', 'lumaML', 'lumaMC', 'lumaMR', 'lumaBL', 'lumaBC', 'lumaBR']
FLOOR = {'headLow': 0.015, 'lumaBottom': 0.01, 'headVis': 0.03, 'shVis': 0.03,
         **{f'luma{r}{c}': 0.008 for r in 'TMB' for c in 'LCR'}}


def robust(x):
    x = np.asarray(x, dtype=float)
    x = x[np.isfinite(x)]
    if len(x) < 5:
        return None, None
    med = float(np.median(x))
    return med, float(1.4826 * np.median(np.abs(x - med)))


def fit_change(df):
    """How each feature moves at each kind of transition, relative to the
    median of the posture just left (the decoder's baseline), and how much it
    wanders while a posture is held. Robust (median / MAD) estimates."""
    moved = {}
    still = {}
    for _, g in df.groupby('clip'):
        g = g.sort_values('t')
        segs = sorted(s for s in g.gseg.unique() if s >= 0)
        for j in segs:
            cur = g[g.gseg == j]
            onset = cur.t.min()
            prev = g[(g.gseg == j - 1) & (g.t >= onset - 3.5) & (g.t <= onset - 0.3)]
            if len(prev) < 8:
                continue
            key = f"{prev.gkind.iloc[0]}>{cur.gkind.iloc[0]}"
            if key.split('>')[0] == key.split('>')[1]:
                continue  # salams: a head turn, handled by the decoder
            base = prev[CHANGE_FEATS].median()
            arrived = cur[cur.settled == 1]
            m = moved.setdefault(key, {f: [] for f in CHANGE_FEATS})
            for f in CHANGE_FEATS:
                m[f].extend((arrived[f] - base[f]).tolist())
            held = g[(g.gseg == j - 1) & (g.settled == 1)]
            s = still.setdefault(prev.gkind.iloc[0], {f: [] for f in CHANGE_FEATS})
            for f in CHANGE_FEATS:
                s[f].extend((held[f] - held[f].median()).tolist())
    out = {'features': CHANGE_FEATS, 'transitions': {}, 'noise': {}}
    for key, m in moved.items():
        mu, s1 = [], []
        for f in CHANGE_FEATS:
            a, b = robust(m[f])
            mu.append(round(a, 4) if a is not None else None)
            s1.append(round(max(b, FLOOR.get(f, 0.05)), 4) if b is not None else None)
        out['transitions'][key] = {'mu': mu, 's1': s1}
    for kind, s in still.items():
        out['noise'][kind] = [round(max(robust(s[f])[1] or 0, FLOOR.get(f, 0.05)), 4) for f in CHANGE_FEATS]
    return out


if __name__ == '__main__':
    main()
