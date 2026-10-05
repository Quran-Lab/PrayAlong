"""Rebuild the upper-body skin weights of a companion master GLB.

python reweight.py in.glb out.glb

Meshy's auto-rig weights the collar and upper back to the Head, the chest to
the upper arms and blends the sleeves with the hand. That shreds the sleeves
when the arms rise and lifts a hump behind the neck when the head bends.
This writes clean weights straight into the GLB (vertex order untouched):

- sleeves: found by flood fill from the cuff inside a tube around the arm
  bones; weighted along the arm (Arm -> ForeArm across the elbow, cuff fully
  ForeArm so the hem never tears against the hand);
- torso, collar, neck and head: a vertical profile along the spine chain
  (Head is rigid from the chin up, the collar follows the upper chest);
- skirt below the waist: the existing smoothed leg weights are kept;
- seams between these regions are relaxed with a harmonic (Laplace) solve
  on the welded mesh, so no two neighbours disagree.
The hands primitive is left exactly as it is.
"""
import sys, os, numpy as np
from scipy.sparse import coo_matrix, csr_matrix
from scipy.sparse.linalg import spsolve
from glbio import Glb

src, dst = sys.argv[1], sys.argv[2]
g = Glb(src)
j = g.json
prim = j['meshes'][0]['primitives'][0]
A = prim['attributes']
P0 = g.read(A['POSITION']).astype(np.float64)
tri = g.read(prim['indices']).reshape(-1, 3)
J0 = g.read(A['JOINTS_0']); W0 = g.read(A['WEIGHTS_0'])
skin = j['skins'][0]
names = [j['nodes'][k]['name'] for k in skin['joints']]
NB = len(names)
bi = {n: i for i, n in enumerate(names)}
ibm = g.read(skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
head = {n: np.linalg.inv(m)[:3, 3] for n, m in zip(names, ibm)}

# ---------------------------------------------------------------- weld
key = np.round(P0 / 1e-6).astype(np.int64)
_, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
inv = inv.reshape(-1)
P = P0[first]
n = len(P)
T = inv[tri]
e = np.concatenate([T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]])
e = np.unique(np.sort(e, 1), axis=0)
e = e[e[:, 0] != e[:, 1]]
el = np.linalg.norm(P[e[:, 0]] - P[e[:, 1]], axis=1)
wgt = 1.0 / np.maximum(el, 1e-5)
Adj = coo_matrix((np.r_[wgt, wgt], (np.r_[e[:, 0], e[:, 1]], np.r_[e[:, 1], e[:, 0]])), shape=(n, n)).tocsr()
nbr = [[] for _ in range(n)]
for a, b in e: nbr[a].append(b); nbr[b].append(a)

Wold = np.zeros((n, NB))
for k in range(4): np.add.at(Wold, (inv, J0[:, k]), W0[:, k])
Wold /= np.bincount(inv, minlength=n)[:, None]
for extra in ('head_end', 'headfront'):
    if extra in bi:
        Wold[:, bi['Head']] += Wold[:, bi[extra]]; Wold[:, bi[extra]] = 0

y = P[:, 1]
W = np.zeros((n, NB))
label = np.zeros(n, int)  # 0 torso, 1 left arm, 2 right arm, 3 skirt

# ---------------------------------------------------------------- sleeves
def seg_param(p, a, b):
    d = b - a; L = np.linalg.norm(d); t = np.clip(((p - a) @ d) / (L * L), -np.inf, np.inf)
    return t, L
arm_u = np.zeros(n); arm_info = {}
for side, lab in (('Left', 1), ('Right', 2)):
    a, el_, wr = head[f'{side}Arm'], head[f'{side}ForeArm'], head[f'{side}Hand']
    t1, L1 = seg_param(P, a, el_); t2, L2 = seg_param(P, el_, wr)
    c1 = a + np.clip(t1, 0, 1)[:, None] * (el_ - a)
    c2 = el_ + np.clip(t2, 0, 1.4)[:, None] * (wr - el_)
    d1 = np.linalg.norm(P - c1, axis=1); d2 = np.linalg.norm(P - c2, axis=1)
    use2 = (d2 < d1) | (t1 > 1)
    u = np.where(use2, L1 + np.clip(t2, 0, 1.4) * L2, t1 * L1)
    d = np.where(use2, d2, d1)
    s = np.sign(wr[0])
    # sleeve radius from the middle of the forearm
    mid = (u > L1 + 0.3 * L2) & (u < L1 + 0.7 * L2) & (d < 0.15) & (P[:, 0] * s > el_[0] * s)
    Rf = np.percentile(d[mid], 95)
    midu = (u > 0.4 * L1) & (u < 0.8 * L1) & (d < 0.15) & (P[:, 0] * s > a[0] * s)
    Ru = min(np.percentile(d[midu], 95) if midu.sum() > 20 else Rf, 1.3 * Rf)
    R = np.where(u > L1, Rf, Ru) * 1.25
    allowed = (u > -0.005) & (d < R) & (P[:, 0] * s > 0)
    seeds = np.where(allowed & (u > L1 + 0.5 * L2))[0]
    mask = np.zeros(n, bool); mask[seeds] = True
    stack = list(seeds)
    while stack:
        v = stack.pop()
        for w_ in nbr[v]:
            if not mask[w_] and allowed[w_]:
                mask[w_] = True; stack.append(w_)
    label[mask] = lab
    arm_u[mask] = u[mask]
    arm_info[side] = (L1, L2, Rf, Ru)
    print(side, 'sleeve verts', mask.sum(), 'L1 %.3f L2 %.3f Rf %.3f Ru %.3f' % (L1, L2, Rf, Ru))
    EB = float(os.environ.get('ELB', '0.085'))
    fore = np.clip((u - (L1 - EB)) / (2 * EB), 0, 1)
    fore = fore * fore * (3 - 2 * fore)
    cap = np.clip((u + 0.005) / 0.06, 0, 1)  # shoulder cap blends into the chest
    W[mask, bi[f'{side}ForeArm']] = fore[mask]
    W[mask, bi[f'{side}Arm']] = ((1 - fore) * cap)[mask]
    W[mask, bi['Spine2']] = ((1 - fore) * (1 - cap))[mask]

# ---------------------------------------------------------------- torso / neck / head profile
H, S, S1, S2, N, Hd = (head[b][1] for b in ('Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head'))
neck_full = N + 0.15 * (Hd - N)     # Spine2 up to here (collar)
neck_peak = (N + Hd) / 2
head_cut = Hd - 0.25 * (Hd - N)      # rigid head from here up (chin)
knots = [(H, 'Hips'), ((S + S1) / 2, 'Spine'), ((S1 + S2) / 2, 'Spine1'), (neck_full, 'Spine2'), (neck_peak, 'Neck'), (head_cut, 'Head')]
torso = label == 0
ky = np.array([k[0] for k in knots])
for i, (yk, b) in enumerate(knots):
    lo = ky[i - 1] if i > 0 else -np.inf
    hi = ky[i + 1] if i + 1 < len(knots) else np.inf
    w = np.zeros(n)
    w[(y >= lo) & (y <= yk)] = 1 if i == 0 else 0
    if i > 0:
        m = (y > lo) & (y <= yk); w[m] = (y[m] - lo) / (yk - lo)
    else:
        w[y <= yk] = 1
    if i + 1 < len(knots):
        m = (y > yk) & (y < hi); w[m] = (hi - y[m]) / (hi - yk)
    else:
        w[y > yk] = 1
    W[torso, bi[b]] += w[torso]

# ---------------------------------------------------------------- skirt: keep the smoothed leg weights
waist_lo, waist_hi = H - 0.03, H + 0.03
legish = sum(Wold[:, bi[b]] for b in names if 'UpLeg' in b or b.endswith('Leg') or 'Foot' in b or 'Toe' in b)
skirt = torso & (y < waist_hi) & ((y < waist_lo) | (legish > 0.02))
mix = np.clip((y - waist_lo) / (waist_hi - waist_lo), 0, 1)[:, None]
W[skirt] = (1 - mix[skirt]) * Wold[skirt] + mix[skirt] * W[skirt]
label[skirt & (y < waist_lo)] = 3
# feet and anything below the knees: keep exactly
low = y < head['LeftLeg'][1] + 0.02
W[low & torso] = Wold[low & torso]

# ---------------------------------------------------------------- relax seams (harmonic)
lab_n = np.array([label[nb].max() != label[nb].min() if nb else False for nb in nbr])
bnd = np.array([any(label[w_] != label[v] for w_ in nbr[v]) for v in range(n)])
# free = within 3 cm of a label boundary (excluding feet/shins), plus the waist band
from scipy.spatial import cKDTree
free = np.zeros(n, bool)
if bnd.any():
    dd, _ = cKDTree(P[bnd]).query(P)
    free |= dd < 0.03
free |= (y > waist_lo - 0.02) & (y < waist_hi + 0.02) & (label != 1) & (label != 2)
free &= ~low
free &= y < head_cut - 0.005  # the face and cap stay rigid
fi = np.where(free)[0]; ai = np.where(~free)[0]
L = csr_matrix(Adj)
deg = np.asarray(L.sum(1)).ravel()
Lff = (coo_matrix((deg[fi], (np.arange(len(fi)), np.arange(len(fi)))), shape=(len(fi), len(fi))) - L[fi][:, fi]).tocsc()
rhs = L[fi][:, ai] @ W[ai]
W[fi] = np.column_stack([spsolve(Lff, rhs[:, c]) if np.any(rhs[:, c]) else np.zeros(len(fi)) for c in range(NB)])
print('free verts', len(fi))
W = np.clip(W, 0, None)
W /= W.sum(1, keepdims=True)

# ---------------------------------------------------------------- write (top 4)
Wv = W[inv]
top = np.argsort(-Wv, 1)[:, :4]
tw = np.take_along_axis(Wv, top, 1)
tw[tw < 1e-3] = 0
tw /= tw.sum(1, keepdims=True)
top[tw == 0] = 0
g.write(A['JOINTS_0'], top.astype(J0.dtype))
g.write(A['WEIGHTS_0'], tw.astype(np.float32))
g.save(dst)
np.savez(dst + '.labels.npz', label=label[inv], W=Wv.astype(np.float32))
print('wrote', dst)
