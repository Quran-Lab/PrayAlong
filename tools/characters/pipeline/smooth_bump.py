"""Smooth only the nose/mouth bump on a Meshy head; texture untouched.
Usage: blenv/python.exe smooth_bump.py -- in.glb out.glb radius_frac"""
import bpy, sys, os, numpy as np, scipy.sparse as sp, scipy.sparse.linalg as spla
args = sys.argv[sys.argv.index('--') + 1:]
src, dst = os.path.abspath(args[0]), os.path.abspath(args[1]); rad = float(args[2]) if len(args) > 2 else 0.06
zlo, zhi = (float(args[3]), float(args[4])) if len(args) > 4 else (0.15, 0.25)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
o = [o for o in bpy.data.objects if o.type == 'MESH'][0]
me = o.data; Mw = np.array(o.matrix_world)
V = np.array([v.co for v in me.vertices]) @ Mw[:3, :3].T + Mw[:3, 3]; N = len(V)
tris = np.array([list(p.vertices) for p in me.polygons for _ in [0]] if False else [list(p.vertices) for p in me.polygons], dtype=object)
_, weld = np.unique(np.round(V / 2e-4).astype(np.int64), axis=0, return_inverse=True); weld = weld.ravel(); NW = weld.max() + 1
VW = np.zeros((NW, 3)); VW[weld] = V
E = []
for p in me.polygons:
    vs = [weld[i] for i in p.vertices]
    for a, b in zip(vs, vs[1:] + vs[:1]):
        if a != b: E.append((a, b))
E = np.unique(np.sort(np.array(E), 1), axis=0)
A = sp.coo_matrix((np.ones(len(E)), (E[:, 0], E[:, 1])), shape=(NW, NW)); A = ((A + A.T) > 0).astype(float).tocsr(); deg = np.asarray(A.sum(1)).ravel()
zmax = VW[:, 2].max(); h = np.ptp(VW[:, 2])
# face front: the front-most point of the head near the centre line, below the brows
head = VW[:, 2] > zmax - 0.36 * h
cand = np.where(head & (np.abs(VW[:, 0]) < 0.02 * h) & (VW[:, 2] < zmax - zlo * h) & (VW[:, 2] > zmax - zhi * h))[0]
tip = cand[np.argmin(VW[cand, 1])]
centre = VW[tip] + np.array([0, 0, (float(args[5]) if len(args) > 5 else -0.012) * h])  # between nose and mouth
d = np.linalg.norm((VW - centre) * np.array([1, 0.5, 1]), axis=1)
region = (d < rad * h) & (VW[:, 1] < VW[tip, 1] + 0.06 * h) & head
print('tip', np.round(VW[tip], 3), 'region', region.sum())
I = np.where(region)[0]; B = np.where(~region)[0]
L = (sp.diags(deg) - A).tocsr(); L2 = (L @ L).tocsr()
solve = spla.factorized((L2[I][:, I] + 1e-9 * sp.eye(len(I))).tocsc())
VnW = VW.copy()
for k in range(3): VnW[I, k] = solve(-(L2[I][:, B] @ VW[B, k]))
print('moved max', np.abs(VnW - VW).max())
# soft blend towards the edge of the patch so nothing creases
w = np.clip((rad * h - d) / (0.35 * rad * h), 0, 1); w = w * w * (3 - 2 * w)
VnW = VW + (VnW - VW) * w[:, None]
Vn = VnW[weld]; inv = np.linalg.inv(Mw)
loc = Vn @ inv[:3, :3].T + inv[:3, 3]
me.vertices.foreach_set('co', loc.ravel()); me.update()
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB')
print('wrote', dst)
