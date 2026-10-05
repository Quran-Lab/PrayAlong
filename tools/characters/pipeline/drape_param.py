"""Sculpted robe drapes for the floor postures (morph targets).

python drape_param.py in.glb out.glb seqprefix morph:pose[:tuck|:hem] [...]

Input: a companion whose lower robe was rebuilt by rebuild_skirt.py as a
regular tube (material 'skirt'; rows run down from the waist, columns around
the body; the rest grid is in in.glb.grid.npz), and dumps of the real
Performer in each posture (pose-seq.test.ts, once for the skirt primitive
with PRIM_MAT=skirt and once for the body). A smooth body envelope is built
on the posed skeleton: capsules on the thighs (sized so the palms rest on
them), shins, seat and heels, hanging down to a rug level set by the knees.

- Sitting (jalsah, tashahhud): every column is laid along the outside of the
  envelope in the vertical plane through the seat: down from the waist,
  over the lap and knees to the rug. Rows keep their rest arc length, so the
  cloth neither stretches nor crumples; below the waist it first falls
  straight, so there is no ledge at the seam.
- Kneel and sujud: the skinned tube already follows the folded legs, so it
  is only relaxed (Laplacian, anchored) and pushed out of the envelope.

Cloth is then relaxed on the envelope and kept above the rug. ':tuck' adds a
'<morph>_tuck' target that presses spare cloth and the bare shins and feet
under the rug; ':hem' does the same for spare cloth only (the feet stay).
Tucked vertices do not hold the body up (performer.ts). Everything is
stored in rest space as S^-1 (target - skinned), with normal deltas.
"""
import sys, os, json, numpy as np
from scipy.spatial import cKDTree
from glbio import Glb

src, dst, seq = sys.argv[1:4]
jobs = [a.split(':') for a in sys.argv[4:]]
g = Glb(src); j = g.json
mesh = j['meshes'][0]; prims = mesh['primitives']
mats = [m['name'] for m in j['materials']]
pidx = {mats[p['material']]: i for i, p in enumerate(prims)}
skin = j['skins'][0]
names = [j['nodes'][k]['name'] for k in skin['joints']]
ibm = g.read(skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
head = {n_: np.linalg.inv(m)[:3, 3] for n_, m in zip(names, ibm)}

sp = prims[pidx['skirt']]
SP = g.read(sp['attributes']['POSITION']).astype(np.float64)
SN = g.read(sp['attributes']['NORMAL']).astype(np.float64)
gr = np.load(src + '.grid.npz')['grid']  # (NR, NA+1, 3) rest, glTF axes
NR, NC = gr.shape[:2]
d_, idx = cKDTree(gr.reshape(-1, 3)).query(SP)
print('grid match max dist %.2e' % d_.max())
ri, ci = np.divmod(idx, NC)
bp = prims[pidx[[m for m in pidx if m not in ('skirt', 'hands')][0]]]
BP = g.read(bp['attributes']['POSITION']).astype(np.float64)
knee_rest = min(head['LeftLeg'][1], head['RightLeg'][1])

def load_seq(prefix, pose):
    meta = json.load(open(f'{prefix}_{pose}.json'))
    raw = np.fromfile(f'{prefix}_{pose}.bin', np.float32)
    nn = meta['n']
    posed = raw[:nn * 3].reshape(nn, 3).astype(np.float64)
    S = raw[nn * 3:].reshape(nn, 4, 4).transpose(0, 2, 1).astype(np.float64)
    R = np.array(meta['toRoot']).reshape(4, 4).T
    return posed, S, R, meta

def to_rest(target_root, posed, S, R):
    Rinv = np.linalg.inv(R)
    tl = target_root @ Rinv[:3, :3].T + Rinv[:3, 3]
    return np.linalg.solve(S[:, :3, :3], (tl - posed)[:, :, None])[:, :, 0]

def cap_d(p, a, b, r, extrude):
    ab = b - a
    t = np.clip(((p - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
    c = a + t[:, None] * ab
    if extrude:  # below the axis the cloth falls to the rug, flaring a little
        below = p[:, 1] < c[:, 1]
        d3 = np.linalg.norm(p - c, axis=1)
        dxz = np.linalg.norm((p - c)[:, [0, 2]], axis=1)
        flare = 1 + FLARE * np.clip((c[:, 1] - p[:, 1]) / max(r, 1e-6), 0, 3)
        return np.where(below, dxz - r * flare, d3 - r)
    return np.linalg.norm(p - c, axis=1) - r

WAIST_HOLD = float(os.environ.get('WAIST_HOLD', '0.03')); WAIST_FADE = float(os.environ.get('WAIST_FADE', '0.12'))
FLARE = float(os.environ.get("FLARE", "-0.12"))

def sdf_of(caps, k=0.03):
    def f(p):
        ds = np.stack([cap_d(p, a, b, r, ex) for a, b, r, ex in caps], 1)
        m = ds.min(1, keepdims=True)
        return (m - k * np.log(np.exp(-(ds - m) / k).sum(1, keepdims=True)))[:, 0]
    return f

def grid_normals(Gm):
    du = np.roll(Gm[:, :-1], -1, 1) - np.roll(Gm[:, :-1], 1, 1)
    dv = np.zeros_like(Gm[:, :-1]); dv[1:-1] = Gm[2:, :-1] - Gm[:-2, :-1]; dv[0] = Gm[1, :-1] - Gm[0, :-1]; dv[-1] = Gm[-1, :-1] - Gm[-2, :-1]
    return np.cross(dv, du)
_rn = grid_normals(gr)
_rest_out = gr[:, :-1] - gr[:, :-1].mean((0, 1)); _rest_out[..., 1] = 0
GRID_SIGN = -1 if np.median((_rn * _rest_out).sum(-1)) < 0 else 1
print('grid normal sign', GRID_SIGN)

targets = []
for job in jobs:
    mname, pose = job[0], job[1]
    tuck = len(job) > 2 and job[2] in ('tuck', 'hem')
    hem_only = len(job) > 2 and job[2] == 'hem'  # hide spare cloth, keep the legs
    posed, S, R, meta = load_seq(seq + '_skirt', pose)
    B = {k: np.array(v) for k, v in meta['bones'].items()}
    X0 = posed @ R[:3, :3].T + R[:3, 3]  # skinned, root space
    sitting = mname.startswith('drape_sit')
    hipw = np.linalg.norm(B['leftUpperLeg'] - B['rightUpperLeg'])
    caps = []
    rth = {}
    for s in ('left', 'right'):
        a_, b_ = B[f'{s}UpperLeg'], B[f'{s}LowerLeg']
        palm = (B[f'{s}Hand'] + B[f'{s}MiddleProximal']) / 2
        ab = b_ - a_; t_ = np.clip((palm - a_) @ ab / (ab @ ab), 0, 1); on = a_ + t_ * ab
        dd = np.linalg.norm(palm - on)
        rth[s] = float(np.clip(dd - float(os.environ.get("PALM_GAP", "0.02")), 0.045, float(os.environ.get("THIGH_MAX", "0.075")))) if (dd < 0.16 and t_ > 0.2) else 0.065
        caps.append((a_, b_, rth[s], not sitting or os.environ.get('EXTRUDE_THIGH', '1') == '1'))
        if not sitting:
            caps.append((b_, B[f'{s}Foot'], 0.8 * rth[s], True))
    r_mean = (rth['left'] + rth['right']) / 2
    kl, kr = B['leftLowerLeg'], B['rightLowerLeg']
    if float(os.environ.get('BRIDGE', '0')) > 0:
        caps.append((kl, kr, float(os.environ['BRIDGE']) * r_mean, True))  # the lap bridges from knee to knee
    hc = (B['leftUpperLeg'] + B['rightUpperLeg']) / 2
    caps.append((hc, hc + float(os.environ.get('MIDLEN', '0.6')) * ((kl + kr) / 2 - hc), float(os.environ.get('MID', '0.75')) * r_mean, True))
    seat = max(0.06, float(os.environ.get('SEAT', '0.65')) * hipw)
    caps.append((B['leftUpperLeg'], B['rightUpperLeg'], seat, sitting))
    caps.append((B['hips'], B['spine'], seat, False))
    if sitting and 'leftFoot' in B and 'rightFoot' in B:
        # the heels under the seat give the back of the robe a little volume
        caps.append((B['leftFoot'], B['rightFoot'], float(os.environ.get('HEEL_R', '0.045')), True))
    f = sdf_of(caps)
    # the rug: where the knees (sitting: thighs) rest
    floor = min(min(B[k][1] for k in ('leftLowerLeg', 'rightLowerLeg')) - r_mean,
                min(B[k][1] for k in ('leftUpperLeg', 'rightUpperLeg')) - r_mean)
    if not sitting:
        toes = [B[k][1] - 0.03 for k in ('leftToes', 'rightToes') if k in B]
        floor = min([floor] + toes)
    floor = max(floor, 0.0)
    # top ring (skinned) per column, and rest arc length down each column
    Wtop = np.zeros((NC, 3)); cnt = np.zeros(NC)
    for v_ in np.where(ri == 0)[0]: Wtop[ci[v_]] += X0[v_]; cnt[ci[v_]] += 1
    Wtop /= np.maximum(cnt, 1)[:, None]
    # slice centre: inside the waist ring, at hip height
    wc = Wtop[:-1].mean(0)
    O = np.array([wc[0], hc[1], wc[2]])
    seg = np.linalg.norm(np.diff(gr, axis=0), axis=2)  # (NR-1, NC)
    arc = np.vstack([np.zeros(NC), np.cumsum(seg, 0)])  # (NR, NC)
    Xg = np.zeros((NR, NC, 3)); over = np.zeros((NR, NC), bool)
    alphas = np.radians(np.linspace(85, -175, 260))
    # Kneeling and in sujud the skinned tube already follows the folded legs
    # well: start from it and only relax it over the body (below).
    for v_ in range(len(X0)) if not sitting else []:
        Xg[ri[v_], ci[v_]] = X0[v_]
    for c in (range(NC) if sitting else []):
        w = Wtop[c]
        u = w - O; u[1] = 0
        un = np.linalg.norm(u)
        u = u / un if un > 1e-6 else np.array([0, 0, 1.0])
        up = np.array([0, 1.0, 0])
        dirs = np.cos(alphas)[:, None] * u + np.sin(alphas)[:, None] * up
        # outermost envelope point along each ray (march in from 1 m)
        ts = np.linspace(1.0, 0.0, 400)
        P = O + dirs[:, None, :] * ts[None, :, None]  # (A, T, 3)
        val = f(P.reshape(-1, 3)).reshape(P.shape[:2])
        inside = val < 0
        first_in = np.where(inside.any(1), inside.argmax(1), len(ts) - 1)
        hit = P[np.arange(len(alphas)), first_in]
        # rays that end below the rug meet the rug instead
        below = hit[:, 1] < floor
        if below.any():
            tf = np.where(dirs[:, 1] < -1e-6, (floor - O[1]) / np.where(dirs[:, 1] < -1e-6, dirs[:, 1], -1), 1.0)
            tf = np.clip(tf, 0, None)
            hit[below] = O + dirs[below] * tf[below, None]
        # below the waist the cloth falls straight before it meets the lap:
        # no ledge where the torso's robe ends and the skirt begins
        hw = (w - O) @ u
        vv = (hit - O) @ up
        hh = (hit - O) @ u
        dy = (w - O) @ up - vv
        tt = np.clip((dy - WAIST_HOLD) / WAIST_FADE, 0, 1)
        hmin = hw * (1 - tt * tt * (3 - 2 * tt))
        push = hh < hmin
        hit[push] = O + hmin[push, None] * u + vv[push, None] * up
        # start the curve at the waist point; keep the rays below it
        aw = np.arctan2((w - O)[1], np.linalg.norm((w - O)[[0, 2]]))
        keep = (alphas < aw) & (hit[:, 1] < w[1] - 0.01)
        curve = np.vstack([w, hit[keep]])
        # light smoothing of the profile
        for it in range(3):
            curve[1:-1] = 0.5 * curve[1:-1] + 0.25 * (curve[:-2] + curve[2:])
        L = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(curve, axis=0), axis=1))])
        for r_ in range(NR):
            s_ = arc[r_, c]
            if s_ <= L[-1]:
                Xg[r_, c] = np.array([np.interp(s_, L, curve[:, k]) for k in range(3)])
            else:
                Xg[r_, c] = curve[-1]
                over[r_, c] = True
    # smooth across columns (wraps around), rows lightly, keep the top ring
    for it in range(4):
        Xs = Xg.copy()
        Xs[1:, :-1] = 0.5 * Xg[1:, :-1] + 0.25 * (np.roll(Xg[1:, :-1], 1, 1) + np.roll(Xg[1:, :-1], -1, 1))
        Xs[1:-1] = 0.6 * Xs[1:-1] + 0.2 * (Xs[:-2] + Xs[2:])
        Xs[:, -1] = Xs[:, 0]
        Xg = Xs
    Xg[..., 1] = np.maximum(Xg[..., 1], floor)
    # relax on the envelope: even out the grid (removes the jumps where a
    # column's slice just misses a thigh) and keep it on the body surface
    def project(P, it=4):
        e = 1e-3
        for _ in range(it):
            d = f(P)
            gr_ = np.stack([(f(P + e * np.eye(3)[k]) - f(P - e * np.eye(3)[k])) / (2 * e) for k in range(3)], 1)
            P = P - (d / np.maximum((gr_ ** 2).sum(1), 1e-6))[:, None] * gr_
        return P
    G_init = Xg[:, :-1].copy()
    ANCHOR = float(os.environ.get('ANCHOR', '0.15' if sitting else '0.05'))
    for it in range(int(os.environ.get('RELAX', '150'))):
        G = Xg[:, :-1]
        nb = 0.25 * (np.roll(G, 1, 1) + np.roll(G, -1, 1))
        nb[1:-1] += 0.25 * (G[:-2] + G[2:]); nb[-1] += 0.5 * G[-2]; nb[0] = G[0] * 0.5
        G2 = G.copy()
        G2[1:] = 0.4 * G[1:] + 0.6 * nb[1:]
        # anchored: stay near the profile, so the lap cannot slide off the thighs
        G2[1:] += ANCHOR * (G_init[1:] - G2[1:])
        flat = G2.reshape(-1, 3)
        onfloor = flat[:, 1] <= floor + 0.003
        rows = np.repeat(np.arange(NR), NC - 1)
        sel = ~onfloor & (rows >= 2)
        sel[sel] = f(flat[sel]) < 0  # only push out of the body; cloth may hang free outside it
        flat[sel] = project(flat[sel])
        flat[:, 1] = np.maximum(flat[:, 1], floor)
        G2 = flat.reshape(G.shape)
        G2[0] = G[0]
        Xg = np.concatenate([G2, G2[:, :1]], 1)
    # how far each palm sits above the cloth under it (for the hand tune)
    hand_gap = {}
    for s_ in ('left', 'right'):
        if f'{s_}Hand' not in B or f'{s_}MiddleProximal' not in B: continue
        pc = (B[f'{s_}Hand'] + B[f'{s_}MiddleProximal']) / 2
        G = Xg.reshape(-1, 3)
        near = np.linalg.norm(G[:, [0, 2]] - pc[[0, 2]], axis=1) < 0.02
        if near.any(): hand_gap[s_] = float(pc[1] - G[near, 1].max())
    print('  palm above cloth', {k: round(v, 3) for k, v in hand_gap.items()})
    X = Xg[ri, ci]
    # the first rows ride with the torso
    tw = np.clip(ri / 6.0, 0, 1); tw = (tw * tw * (3 - 2 * tw))[:, None]
    X = X0 + tw * (X - X0)
    sd = to_rest(X, posed, S, R)
    # normals from the grid
    Xn = Xg
    du = np.roll(Xn[:, :-1], -1, 1) - np.roll(Xn[:, :-1], 1, 1)
    dv = np.zeros_like(Xn[:, :-1]); dv[1:-1] = Xn[2:, :-1] - Xn[:-2, :-1]; dv[0] = Xn[1, :-1] - Xn[0, :-1]; dv[-1] = Xn[-1, :-1] - Xn[-2, :-1]
    nrm = np.cross(dv, du)
    # orient outwards (away from the seat axis)
    outv = Xn[:, :-1] - O; outv[..., 1] *= 0.3
    # the grid is ordered the same way everywhere, so one global sign orients
    # it: take it from the rest tube, whose normals are known to point out
    nrm *= GRID_SIGN
    nrm = np.concatenate([nrm, nrm[:, :1]], 1)
    nrm /= np.maximum(np.linalg.norm(nrm, axis=-1, keepdims=True), 1e-12)
    n_root = nrm[ri, ci]
    n_loc = n_root @ np.linalg.inv(R[:3, :3]).T
    nr_ = np.linalg.solve(S[:, :3, :3], n_loc[:, :, None])[:, :, 0]
    nr_ /= np.maximum(np.linalg.norm(nr_, axis=1, keepdims=True), 1e-12)
    snd = nr_ - SN
    per = {pidx['skirt']: (sd, snd)}
    print(mname, pose, 'floor %.3f' % floor, 'thigh r %.3f %.3f' % (rth['left'], rth['right']), 'max move %.3f' % np.linalg.norm(X - X0, axis=1).max())
    targets.append((mname, per))
    if tuck:
        bposed, bS, bR, _ = load_seq(seq, pose)
        Xb = bposed @ bR[:3, :3].T + bR[:3, 3]
        low = BP[:, 1] < knee_rest
        tgt = Xb.copy()
        # under the thighs and under the rug
        tgt[low, 1] = floor - 0.04
        bd = to_rest(tgt, bposed, bS, bR); bd[~low] = 0
        # cloth that runs on under the body (past the profile, or flat on the rug
        # behind the seat) goes under the rug too
        Xt = Xg.copy()
        # every column: once the cloth reaches the rug, the rest of it runs on
        # under the body; hide it (behind the seat, flat on the rug, too)
        onf = Xg[..., 1] <= floor + 0.004
        k0 = np.where(onf.any(0), onf.argmax(0), NR)
        after = np.arange(NR)[:, None] > (k0[None, :] + 1)
        hid = over | after | (onf & (((Xg - O)[..., 2] < 0) | hem_only))
        if hem_only:
            # spare hem trailing behind the feet (long abayas) goes under the rug
            fz = min(B[k][2] for k in ('leftToes', 'rightToes', 'leftFoot', 'rightFoot') if k in B)
            fy = max(B[k][1] for k in ('leftFoot', 'rightFoot') if k in B)
            hid |= (Xg[..., 2] < fz - 0.01) & (Xg[..., 1] < fy)
            # the lower skirt (below the shins in the rest pose) near the rug
            hid |= (gr[..., 1] < knee_rest - 0.05) & (Xg[..., 1] < fy + 0.02)
        if os.environ.get('DBGVIEW'):
            from dumpview import render
            sp_tri = g.read(sp['indices']).reshape(-1, 3)
            hv = hid[ri, ci]
            colors = np.where(hv[sp_tri].any(1)[:, None], [[230, 60, 60]], [[200, 200, 220]])
            render(X, sp_tri, f'hid_{os.path.basename(seq)}_{pose}.png', views=((90, 0), (150, 10), (0, 70)), colors=colors)
            print('   floor', floor, 'fz', B.get('leftToes', [0,0,0])[2], 'O', np.round(O, 3))
        Xt[hid, 1] = floor - 0.03
        # hidden cloth gathers under the last visible row of its column, so
        # no long sliver joins it to the visible cloth
        for c in range(NC):
            vis = np.where(~hid[:, c])[0]
            last = Xg[vis.max(), c] if len(vis) else Xg[0, c]
            Xt[hid[:, c], c, 0] = last[0]; Xt[hid[:, c], c, 2] = last[2]
        st = to_rest(Xt[ri, ci], posed, S, R) - to_rest(X, posed, S, R)
        st[~hid[ri, ci]] = 0
        tt_ = {pidx['skirt']: (st, None)}
        if not hem_only: tt_[pidx[mats[bp['material']]]] = (bd, None)
        targets.append((mname + '_tuck', tt_))

for p in prims: p['targets'] = []
counts = [j['accessors'][p['attributes']['POSITION']]['count'] for p in prims]
for mname, per in targets:
    for pi, p in enumerate(prims):
        z = np.zeros((counts[pi], 3), np.float32)
        d, nd = per.get(pi, (None, None))
        p['targets'].append({'POSITION': g.add_accessor(z if d is None else d.astype(np.float32)),
                             'NORMAL': g.add_accessor(z if nd is None else nd.astype(np.float32), minmax=False)})
mesh.setdefault('extras', {})['targetNames'] = [m for m, _ in targets]
mesh['weights'] = [0.0] * len(targets)
g.save(dst)
print('wrote', dst, [m for m, _ in targets])
