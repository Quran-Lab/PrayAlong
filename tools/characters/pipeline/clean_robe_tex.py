"""Clean dark marks out of the robe texture.

python clean_robe_tex.py in.glb out.glb

Meshy paints shading from its own fused hands and folds onto the robe; once
the hands are swapped and the cloth moves, those marks read as slits or holes
(Maryam's abaya front). In the texels used by the robe (below the shoulders,
not the face or hands), small spots much darker than their surroundings are
replaced by the local cloth colour. The face, hijab and hands are untouched.
"""
import sys, io, numpy as np
from PIL import Image, ImageDraw, ImageFilter
from glbio import Glb

src, dst = sys.argv[1], sys.argv[2]
g = Glb(src); j = g.json
prim = j['meshes'][0]['primitives'][0]
A = prim['attributes']
P = g.read(A['POSITION']); uv = g.read(A['TEXCOORD_0']); tri = g.read(prim['indices']).reshape(-1, 3)
skin = j['skins'][0]
names = [j['nodes'][k]['name'] for k in skin['joints']]
ibm = g.read(skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
head = {n_: np.linalg.inv(m)[:3, 3] for n_, m in zip(names, ibm)}
ti = j['materials'][prim['material']]['pbrMetallicRoughness']['baseColorTexture']['index']
img_i = j['textures'][ti]['source']
bv = j['bufferViews'][j['images'][img_i]['bufferView']]
im = Image.open(io.BytesIO(bytes(g.bin[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]))).convert('RGB')
W, H = im.size
# robe triangles: below the shoulders
cut = head['LeftArm'][1] - 0.04
robe = P[tri].max(1)[:, 1] < cut
mask = Image.new('L', (W, H), 0); d = ImageDraw.Draw(mask)
uvt = uv[tri]
small = (uvt.max(1) - uvt.min(1)).max(1) < 0.1  # skip triangles across a UV seam
for t in tri[robe & small]:
    pts = [((uv[k, 0] % 1) * W, (uv[k, 1] % 1) * H) for k in t]
    d.polygon(pts, fill=255)
mask = np.asarray(mask.filter(ImageFilter.MaxFilter(3))) > 0
a = np.asarray(im).astype(np.float32)
lum = a.mean(2)
# mask-aware blur (normalized convolution), so other UV islands never bleed in
def nblur(x, m, r):
    from scipy.ndimage import uniform_filter
    w = uniform_filter(m.astype(np.float32), r)
    if x.ndim == 3:
        return np.stack([uniform_filter(x[..., c] * m, r) for c in range(3)], -1) / np.maximum(w, 1e-6)[..., None]
    return uniform_filter(x * m, r) / np.maximum(w, 1e-6)
big = nblur(a, mask, 31)
blum = big.mean(2)
dark = mask & (lum < blum * float(__import__('os').environ.get('DARK', '0.8'))) & (blum > 40)
dark_img = Image.fromarray((dark * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5))
dark = np.asarray(dark_img) > 0
dark &= mask
# fill from the clean neighbourhood only
keep = mask & ~dark
fill = nblur(a, keep, 41)
# only where the fill is plainly cloth coloured (no bleed from skin or hijab)
med = np.median(a[mask], 0)
dark &= np.linalg.norm(fill - med, axis=-1) < 45
out = a.copy(); out[dark] = fill[dark]
# smooth the robe geometry a little: Meshy sculpts small dents where its
# own hands touched the cloth, and they read as slits
key = np.round(P.astype(np.float64) / 1e-6).astype(np.int64)
_, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True); inv = inv.reshape(-1)
Pw = P[first].astype(np.float64); n = len(first)
T = inv[tri]
E = np.unique(np.sort(np.concatenate([T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]]), 1), axis=0); E = E[E[:, 0] != E[:, 1]]
deg = np.bincount(E.ravel(), minlength=n)
lab = np.load(src + '.labels.npz')['label'] if __import__('os').path.exists(src + '.labels.npz') else None
region = (Pw[:, 1] < cut - 0.03) & (Pw[:, 1] > head['LeftLeg'][1])
if lab is not None:
    sl = np.zeros(n, bool); np.logical_or.at(sl, inv, (lab == 1) | (lab == 2)); region &= ~sl
# soft edge so the smoothing fades out
wgt = region.astype(np.float64)
for _ in range(3):
    wgt = np.maximum(wgt, 0) ; nb = (np.bincount(E[:, 0], wgt[E[:, 1]], n) + np.bincount(E[:, 1], wgt[E[:, 0]], n)) / np.maximum(deg, 1); wgt = np.where(region, nb, 0)
X = Pw.copy()
for it in range(int(__import__('os').environ.get('GEO_IT', '0'))):
    for lam in (0.5, -0.53):
        nb = np.stack([np.bincount(E[:, 0], X[E[:, 1], c], n) + np.bincount(E[:, 1], X[E[:, 0], c], n) for c in range(3)], 1) / np.maximum(deg, 1)[:, None]
        X += lam * wgt[:, None] * (nb - X)
print('robe smoothing max move %.4f' % np.linalg.norm(X - Pw, axis=1).max())
g.write(A['POSITION'], X[inv].astype(np.float32))
# normals: recompute where moved
fn = np.cross(X[T[:, 1]] - X[T[:, 0]], X[T[:, 2]] - X[T[:, 0]])
vn = np.zeros_like(X)
for c in range(3): np.add.at(vn, T[:, c], fn)
vn /= np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), 1e-12)
N0 = g.read(A['NORMAL']).astype(np.float64)
vn_r = vn[inv]; vn_r *= np.where(np.einsum('ij,ij->i', vn_r, N0) < 0, -1, 1)[:, None]
moved = (wgt[inv] > 0)[:, None]
g.write(A['NORMAL'], np.where(moved, vn_r, N0).astype(np.float32))
print('robe texels', int(mask.sum()), 'cleaned', int(dark.sum()))
buf = io.BytesIO(); Image.fromarray(out.clip(0, 255).astype(np.uint8)).save(buf, 'PNG')
data = buf.getvalue()
while len(g.bin) % 4: g.bin.append(0)
off = len(g.bin); g.bin += data
j['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data)})
j['images'][img_i] = {'bufferView': len(j['bufferViews']) - 1, 'mimeType': 'image/png', 'name': j['images'][img_i].get('name', 'tex')}
g.save(dst)
Image.fromarray((dark * 255).astype(np.uint8)).save(dst + '.cleanmask.png')
