"""Clean the sleeve cuffs where the Meshy hands were cut away.

python cuff.py in.glb out.glb

The cut left a ragged open edge (plus a few loose shards) at each wrist, so
the sleeve looks torn where the UBC hand comes out of it. Per wrist:
- loose islands and shards near the wrist are dropped;
- the open edge is snapped to one plane across the forearm and its outline
  smoothed into a clean round hem; the band behind it is relaxed;
- a narrow hem ring is added, turned in towards the wrist, so nobody looks
  into the hollow sleeve.
Works on the GLB directly (body primitive only).
"""
import sys, os, numpy as np
from collections import defaultdict
from glbio import Glb

src, dst = sys.argv[1], sys.argv[2]
g = Glb(src); j = g.json
prim = j['meshes'][0]['primitives'][0]
A = prim['attributes']
attrs = {k: g.read(v) for k, v in A.items()}
P0 = attrs['POSITION'].astype(np.float64)
tri = g.read(prim['indices']).reshape(-1, 3).astype(np.int64)
skin = j['skins'][0]
names = [j['nodes'][k]['name'] for k in skin['joints']]
ibm = g.read(skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
head = {n: np.linalg.inv(m)[:3, 3] for n, m in zip(names, ibm)}

def weld(P):
    key = np.round(P / 1e-6).astype(np.int64)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    return first, inv.reshape(-1)

first, inv = weld(P0)
T = inv[tri]
n = len(first)

# ---- drop small islands (components) near the wrists
parent = np.arange(n)
def find(a):
    while parent[a] != a:
        parent[a] = parent[parent[a]]; a = parent[a]
    return a
for t in T:
    ra, rb, rc = find(t[0]), find(t[1]), find(t[2])
    parent[rb] = ra; parent[find(rc)] = ra
root = np.array([find(i) for i in range(n)])
comp_size = np.bincount(root, minlength=n)
Pw0 = P0[first]
cent = np.zeros((n, 3)); np.add.at(cent, root, Pw0); cent /= np.maximum(comp_size, 1)[:, None]
near_wrist = np.minimum(np.linalg.norm(cent - head['LeftHand'], axis=1), np.linalg.norm(cent - head['RightHand'], axis=1)) < 0.08
small = (comp_size < 300) & near_wrist
main = ~small[root[T[:, 0]]]
print('dropped island triangles', int((~main).sum()))
tri, T = tri[main], T[main]

def boundary_loops(T):
    cnt = defaultdict(int); dirs = {}
    for t in T:
        for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            k = (min(a, b), max(a, b)); cnt[k] += 1; dirs[k] = (a, b)
    nxt = {}
    for k, c in cnt.items():
        if c == 1:
            a, b = dirs[k]; nxt[a] = b
    loops, seen = [], set()
    for s in list(nxt):
        if s in seen: continue
        loop = [s]; seen.add(s); v = nxt[s]
        while v != s and v in nxt and v not in seen:
            loop.append(v); seen.add(v); v = nxt[v]
        loops.append(loop)
    return loops

# ---- drop shard triangles hanging off the cuff: faces with two boundary edges near a wrist
for _ in range(3):
    cnt = defaultdict(int)
    for t in T:
        for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])): cnt[(min(a, b), max(a, b))] += 1
    nb = np.array([sum(cnt[(min(a, b), max(a, b))] == 1 for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0]))) for t in T])
    Pw = P0[first]
    near = np.zeros(len(T), bool)
    for side in ('Left', 'Right'):
        near |= np.linalg.norm(Pw[T].mean(1) - head[f'{side}Hand'], axis=1) < 0.08
    kill = (nb >= 2) & near
    if not kill.any(): break
    print('dropped shard triangles', int(kill.sum()))
    tri, T = tri[~kill], T[~kill]

import io
from PIL import Image
_ti = j['materials'][prim['material']]['pbrMetallicRoughness']['baseColorTexture']['index']
_bv = j['bufferViews'][j['images'][j['textures'][_ti]['source']]['bufferView']]
TEX = np.asarray(Image.open(io.BytesIO(bytes(g.bin[_bv.get('byteOffset', 0):_bv.get('byteOffset', 0) + _bv['byteLength']]))).convert('RGB')).astype(np.float32) / 255
UV = attrs['TEXCOORD_0']
def texcol(raw):
    uv = UV[raw]; Ht, Wt = TEX.shape[:2]
    return TEX[np.clip((uv[:, 1] % 1) * (Ht - 1), 0, Ht - 1).astype(int), np.clip((uv[:, 0] % 1) * (Wt - 1), 0, Wt - 1).astype(int)]
uv_fix = -np.ones(len(P0), int)

# ---- hands: the same skin as the face and feet, as the app renders it
col = texcol(np.arange(len(P0)))
mx, mn = col.max(1), col.min(1)
sat = (mx - mn) / np.maximum(mx, 1e-6)
skinish = (col[:, 0] >= mx - 1e-6) & (col[:, 1] > col[:, 2] + 0.02) & (col[:, 0] > col[:, 2] + 0.08) & (sat > 0.12) & (sat < 0.7) & (mx > 0.3)
face = skinish & (P0[:, 1] > head['Head'][1] - 0.04) & (P0[:, 2] > head['Head'][2] + 0.03)
feet = skinish & (P0[:, 1] < 0.08)
pick = face | feet
srgb = np.median(col[pick], 0)
lin = np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4)
hm = j['materials'][j['meshes'][0]['primitives'][1]['material']]
old = hm['pbrMetallicRoughness'].get('baseColorFactor')
body_mat = j['materials'][prim['material']]['pbrMetallicRoughness']
hm['pbrMetallicRoughness']['baseColorFactor'] = [float(lin[0]), float(lin[1]), float(lin[2]), 1.0]
hm['pbrMetallicRoughness']['roughnessFactor'] = body_mat.get('roughnessFactor', 1.0)
hm['pbrMetallicRoughness']['metallicFactor'] = body_mat.get('metallicFactor', 1.0)
print('hand colour', np.round(old, 3), '->', np.round(lin, 3), 'from', int(face.sum()), 'face +', int(feet.sum()), 'feet texels, srgb', np.round(srgb, 3))

Pw = P0[first].copy()
new_pos, new_src, new_nrm, new_tris = [], [], [], []
Nv = len(P0)
for side in ('Left', 'Right'):
    wr, el = head[f'{side}Hand'], head[f'{side}ForeArm']
    d = (wr - el) / np.linalg.norm(wr - el)
    loops = boundary_loops(T)
    near = [l for l in loops if len(l) > 12 and np.linalg.norm(Pw[l].mean(0) - wr) < 0.1]
    L = np.array(max(near, key=len))
    # ---- fill notches: runs of the rim that dip back up the sleeve
    ax = (Pw[L] - wr) @ d
    a_ref = np.median(ax)
    low = ax < a_ref - 0.008
    uax = np.cross(d, [0, 1, 0]); uax /= np.linalg.norm(uax); wax = np.cross(d, uax)
    rmean = np.linalg.norm(Pw[L] - wr - ax[:, None] * d, axis=1).mean()
    def unwrap(vs):
        r = Pw[vs] - wr
        ang = np.unwrap(np.arctan2(r @ wax, r @ uax))
        return np.stack([ang * rmean, r @ d], 1)
    keep = np.ones(len(L), bool)
    if low.any() and not low.all():
        start = np.where(~low)[0][0]
        order = np.roll(np.arange(len(L)), -start)
        runs, cur = [], []
        for i in order:
            if low[i]: cur.append(i)
            elif cur: runs.append(cur); cur = []
        if cur: runs.append(cur)
        for run in runs:
            ia, ib = (run[0] - 1) % len(L), (run[-1] + 1) % len(L)
            poly = [L[ia]] + [L[i] for i in run] + [L[ib]]
            q = unwrap(np.array(poly))
            # ear clipping (polygon closed by the B -> A chord)
            idx = list(range(len(poly)))
            area = sum(q[idx[i - 1], 0] * q[idx[i], 1] - q[idx[i], 0] * q[idx[i - 1], 1] for i in range(len(idx)))
            sgn = np.sign(area)
            def inside(pt, a, b, c):
                def s(p1, p2, p3): return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])
                d1, d2, d3 = s(pt, a, b), s(pt, b, c), s(pt, c, a)
                return not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0))
            guard = 0
            while len(idx) > 3 and guard < 1000:
                guard += 1
                for k_ in range(len(idx)):
                    i0, i1, i2 = idx[k_ - 1], idx[k_], idx[(k_ + 1) % len(idx)]
                    cr = (q[i1, 0] - q[i0, 0]) * (q[i2, 1] - q[i0, 1]) - (q[i1, 1] - q[i0, 1]) * (q[i2, 0] - q[i0, 0])
                    if cr * sgn <= 0: continue
                    if any(inside(q[m], q[i0], q[i1], q[i2]) for m in idx if m not in (i0, i1, i2)): continue
                    new_tris.append(('w', side, poly[i0], poly[i1], poly[i2])); idx.pop(k_); break
                else:
                    break
            if len(idx) == 3: new_tris.append(('w', side, poly[idx[0]], poly[idx[1]], poly[idx[2]]))
            keep[run] = False
            print(side, 'filled notch of', len(run), 'verts, depth %.3f' % (a_ref - ax[run].min()))
    L = L[keep]
    # small pinholes in the sleeve near the cut: fan-fill
    for l in loops:
        if 3 <= len(l) <= 8 and np.linalg.norm(Pw[l].mean(0) - wr) < 0.12:
            for i in range(1, len(l) - 1):
                new_tris.append(('w', side, l[0], l[i], l[i + 1]))
    p = Pw[L]
    c = p.mean(0)
    ax = (p - wr) @ d
    a_star = np.percentile(ax, 40)
    radial = p - wr - ax[:, None] * d
    # smooth the outline along the loop (circular moving average of the radial vector)
    k = 3
    rs = np.zeros_like(radial)
    for o in range(-k, k + 1): rs += np.roll(radial, o, 0)
    rs /= 2 * k + 1
    # keep the original mean radius
    rs *= (np.linalg.norm(radial, axis=1).mean() / np.linalg.norm(rs, axis=1).mean())
    newp = wr + a_star * d + rs
    print(side, 'cuff loop', len(L), 'axial spread %.4f' % (ax.max() - ax.min()), 'mean r %.4f' % np.linalg.norm(radial, axis=1).mean())
    Pw[L] = newp
    # relax the band behind the hem (within 2.5 cm, on the sleeve side), keeping the hem fixed
    band = np.where((np.linalg.norm(Pw - (wr + a_star * d), axis=1) < 0.07) & (((Pw - wr) @ d) < a_star) & (((Pw - wr) @ d) > a_star - 0.03))[0]
    band = np.setdiff1d(band, L)
    nb_ = defaultdict(set)
    for t in T:
        for a_, b_ in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])): nb_[a_].add(b_); nb_[b_].add(a_)
    for it in range(6):
        upd = Pw.copy()
        for v in band:
            nbs = list(nb_[v])
            if nbs: upd[v] = 0.5 * Pw[v] + 0.5 * Pw[nbs].mean(0)
        Pw = upd
    # hem ring turned in towards the wrist
    hem = wr + (a_star - 0.006) * d + rs * float(os.environ.get("HEM_IN", "0.8"))
    # representative raw vertex for each loop vertex (attributes source)
    rep = np.array([np.where(inv == v)[0][0] for v in L])
    # the hem takes its cloth colour (UVs) from the sleeve 2-3 cm behind the edge,
    # since the texture right at the cut still holds bits of the old hand
    rel = Pw - wr; axv = rel @ d; radv = rel - axv[:, None] * d
    back = np.where((axv > a_star - 0.035) & (axv < a_star - 0.015) & (np.linalg.norm(radv, axis=1) < 2 * rmean))[0]
    back_raw = np.array([np.where(inv == v)[0][0] for v in back])
    bc = texcol(back_raw)
    cloth = back_raw[np.argmin(np.linalg.norm(bc - np.median(bc, 0), axis=1))]
    cloth_col = texcol(np.array([cloth]))[0]
    # rim verts whose texel is not cloth (skin left over from the cut) take the cloth UV too
    rim_raw = np.where(np.isin(inv, L))[0]
    off = np.linalg.norm(texcol(rim_raw) - cloth_col, axis=1) > 0.12
    uv_fix[rim_raw[off]] = cloth
    print(side, 'cloth uv from', cloth, 'rim texels recoloured', int(off.sum()), 'of', len(rim_raw))
    # the hem strip has its own copies of the rim, all on one cloth texel
    ids_o = Nv + len(new_pos) + np.arange(len(L))
    # hem normals lean outwards like the sleeve, so the rim shades as cloth
    rn = rs / np.maximum(np.linalg.norm(rs, axis=1, keepdims=True), 1e-9)
    hn = rn * 0.75 + d * 0.25; hn /= np.linalg.norm(hn, axis=1, keepdims=True)
    new_pos += list(Pw[L]); new_src += [cloth] * len(L); new_nrm += list(hn)
    ids = Nv + len(new_pos) + np.arange(len(L))
    new_pos += list(hem); new_src += [cloth] * len(L); new_nrm += list(hn)
    for i in range(len(L)):
        a0, a1 = ids_o[i], ids_o[(i + 1) % len(L)]
        b0, b1 = ids[i], ids[(i + 1) % len(L)]
        for t in ((a0, a1, b1), (a0, b1, b0)):
            pos = lambda r: new_pos[r - Nv] if r >= Nv else Pw[inv[r]]
            nrm = np.cross(pos(t[1]) - pos(t[0]), pos(t[2]) - pos(t[0]))
            new_tris.append(t if nrm @ d > 0 else (t[0], t[2], t[1]))

# write positions back to every split copy
P_out = Pw[inv].astype(np.float32)
attrs['POSITION'] = np.vstack([P_out, np.array(new_pos, np.float32)])
for kname, arr in attrs.items():
    if kname == 'POSITION': continue
    if kname.startswith('TEXCOORD'):
        arr = arr.copy(); fx = uv_fix >= 0; arr[fx] = arr[uv_fix[fx]]
    extra = arr[np.array(new_src)]
    if kname == 'NORMAL': extra = np.array(new_nrm, arr.dtype)
    attrs[kname] = np.vstack([arr, extra])
rep_of = {}
fin = []
for t in new_tris:
    if t[0] != 'w':
        fin.append(t); continue
    _, side, a, b, c = t
    r = [rep_of.setdefault(v, int(np.where(inv == v)[0][0])) for v in (a, b, c)]
    wr = head[f'{side}Hand']; el = head[f'{side}ForeArm']; dd = (wr - el) / np.linalg.norm(wr - el)
    pa, pb, pc = Pw[a], Pw[b], Pw[c]
    cen = (pa + pb + pc) / 3 - wr; radial = cen - (cen @ dd) * dd
    nrm = np.cross(pb - pa, pc - pa)
    fin.append(tuple(r) if nrm @ radial > 0 else (r[0], r[2], r[1]))
tri_all = np.vstack([tri, np.array(fin)])

# rebuild accessors for the body primitive (append new ones; old data stays as dead bytes)
from glbio import CT
for kname, arr in attrs.items():
    old = j['accessors'][A[kname]]
    while len(g.bin) % 4: g.bin.append(0)
    off = len(g.bin); arr = np.ascontiguousarray(arr); g.bin += arr.tobytes()
    j['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': arr.nbytes, 'target': 34962})
    acc = {'bufferView': len(j['bufferViews']) - 1, 'componentType': old['componentType'], 'count': len(arr), 'type': old['type']}
    if old.get('normalized'): acc['normalized'] = True
    if kname == 'POSITION': acc['min'] = arr.min(0).tolist(); acc['max'] = arr.max(0).tolist()
    j['accessors'].append(acc); A[kname] = len(j['accessors']) - 1
idx = tri_all.astype(np.uint32 if len(attrs['POSITION']) > 65535 else np.uint16).reshape(-1)
while len(g.bin) % 4: g.bin.append(0)
off = len(g.bin); g.bin += idx.tobytes()
j['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': idx.nbytes, 'target': 34963})
j['accessors'].append({'bufferView': len(j['bufferViews']) - 1, 'componentType': 5125 if idx.dtype == np.uint32 else 5123, 'count': len(idx), 'type': 'SCALAR'})
prim['indices'] = len(j['accessors']) - 1
g.save(dst)
print('wrote', dst, 'verts', len(attrs['POSITION']), 'tris', len(tri_all))
