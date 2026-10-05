"""Replace a companion's lower robe with a clean cloth tube.

blenv/python.exe rebuild_skirt.py -- in.glb out.glb [rows_per_m] [cols]

The Meshy robe below the waist is an irregular, coarse triangle shell with
painted shading, so it cannot fold cleanly when the legs fold. This cuts it
off with a straight plane just below the hips and rebuilds it as a regular
quad tube (the "skirt" material/primitive): every ring is cast from the
robe's own centre line onto the old surface, so standing it has exactly the
modelled silhouette, down to the hem. Its texture is resampled from the old
robe into a small cylindrical map (lightly blurred so painted folds do not
fight real ones). Its top ring takes the old surface's skin weights so the
seam never opens; below that the weights blend smoothly from the hips into
the thighs and knees. Bare shins, feet, sleeves, hands and everything above
the cut are untouched.
"""
import bpy, bmesh, sys, os, math
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

args = sys.argv[sys.argv.index('--') + 1:]
src, dst = os.path.abspath(args[0]), os.path.abspath(args[1])
ROW_STEP = float(args[2]) if len(args) > 2 else 0.011
NA = int(args[3]) if len(args) > 3 else 96

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
for o in list(bpy.data.objects):
    if o.type == 'MESH' and len(o.data.vertices) < 100: bpy.data.objects.remove(o)
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
body = [o for o in bpy.data.objects if o.type == 'MESH'][0]
me = body.data
# Meshy leaves a second, unused UV layer; keep only the textured one
while len(me.uv_layers) > 1: me.uv_layers.remove(me.uv_layers[len(me.uv_layers) - 1])
me.uv_layers[0].name = 'UVMap'
print('uv layers', [l.name for l in me.uv_layers])
MW = body.matrix_world.copy(); MWi = MW.inverted()
AW = arm.matrix_world
def bone_head(n): return AW @ arm.data.bones[n].head_local
hips_z = bone_head('Hips').z
knee_z = min(bone_head('LeftLeg').z, bone_head('RightLeg').z)
ankle_z = min(bone_head('LeftFoot').z, bone_head('RightFoot').z)

gn = [g.name for g in body.vertex_groups]
nv = len(me.vertices)
W = np.zeros((nv, len(gn)))
for v in me.vertices:
    for g in v.groups: W[v.index, g.group] = g.weight
armish = np.array([('Arm' in n or 'Hand' in n) for n in gn])
sleeve = W[:, armish].sum(1) > 0.55  # robe sides carry some arm weight from the old rig
V = np.array([MW @ v.co for v in me.vertices])
mat_names = [m.name for m in me.materials]
body_mat = [i for i, n in enumerate(mat_names) if n != 'hands'][0]

# texture
img = [n.image for n in me.materials[body_mat].node_tree.nodes if n.type == 'TEX_IMAGE'][0]
TW, TH = img.size
px = np.empty(TW * TH * 4, np.float32); img.pixels.foreach_get(px)
TEX = px.reshape(TH, TW, 4)[:, :, :3]
uv_layer = me.uv_layers.active.data

# faces of the robe shell (no sleeves, no hands)
faces = [f for f in me.polygons if f.material_index == body_mat and not sleeve[list(f.vertices)].any()]
fidx = np.array([f.index for f in faces])
bvh = BVHTree.FromPolygons([tuple(V[i]) for i in range(nv)], [tuple(f.vertices) for f in faces])
loops_of = {f.index: list(f.loop_indices) for f in faces}

def hit_info(fi_local, loc):
    f = me.polygons[int(fidx[fi_local])]
    vs = list(f.vertices)
    P = V[vs]
    # barycentric on the triangle (Meshy meshes are triangles)
    a, b, c = P[0], P[1], P[2]
    v0, v1, v2 = b - a, c - a, np.array(loc) - a
    d00, d01, d11 = v0 @ v0, v0 @ v1, v1 @ v1
    d20, d21 = v2 @ v0, v2 @ v1
    den = d00 * d11 - d01 * d01 or 1e-12
    w1 = (d11 * d20 - d01 * d21) / den; w2 = (d00 * d21 - d01 * d20) / den; w0 = 1 - w1 - w2
    bw = np.clip(np.array([w0, w1, w2]), 0, 1); bw /= bw.sum()
    uv = sum(bw[k] * np.array(uv_layer[f.loop_indices[k]].uv) for k in range(3))
    wts = sum(bw[k] * W[vs[k]] for k in range(3))
    return uv, wts

def texel(uv):
    x = int(np.clip((uv[0] % 1) * (TW - 1), 0, TW - 1)); y = int(np.clip((uv[1] % 1) * (TH - 1), 0, TH - 1))
    return TEX[y, x]

shell = ~sleeve & (V[:, 2] < hips_z + 0.05)
def centre(z):
    m = shell & (np.abs(V[:, 2] - z) < 0.012)
    if m.sum() < 8: return None
    return V[m, :2].mean(0)

z_top = hips_z + 0.02
def ring(z, na, prev_c=None):
    c = centre(z)
    if c is None: c = prev_c
    pts, infos = [], []
    for j in range(na):
        th = 2 * math.pi * j / na
        d = Vector((math.sin(th), -math.cos(th), 0))  # j=0 faces the front (-Y in Blender)
        # cast inwards from outside: the outermost surface is the robe (some
        # Meshy bodies also carry legs or trousers inside the robe)
        o = Vector((c[0], c[1], z)) + d * 0.6
        loc, nrm, fi, dist = bvh.ray_cast(o, -d)
        if loc is None:
            pts.append(None); infos.append(None); continue
        pts.append(np.array(loc)); infos.append(hit_info(fi, loc))
    return c, pts, infos

# cloth colour and the hem: the lowest ring that is still mostly cloth
_, p0, i0 = ring(hips_z - 0.08, 64)
cloth_col = np.median([texel(i[0]) for i in i0 if i is not None], 0)
hem_z = None
prof = []
z = z_top
c_prev = centre(z_top)
while z > 0.005:
    c_prev, pts, infos = ring(z, 48, c_prev)
    cols = [texel(i[0]) for i in infos if i is not None]
    frac = np.mean([np.linalg.norm(cc - cloth_col) < float(os.environ.get('HEMTHR', '0.22')) for cc in cols]) if cols else 0
    prof.append((z, frac))
    if os.environ.get('HEMDBG') and abs(z - 0.45) < 0.003:
        print('cols at 0.45', np.round(np.array(cols)[::6], 2).tolist(), 'radii', np.round([np.linalg.norm(p[:2] - c_prev) for p in pts if p is not None][::6], 3).tolist())
    if frac >= 0.6: hem_z = z
    z -= 0.005
# the hem is the bottom of the longest run of cloth rings from the top (short gaps allowed)
miss = 0; hem_z = z_top
for zz, fr in prof:
    if fr >= 0.6: hem_z = zz; miss = 0
    else:
        miss += 1
        if miss > 4: break
print('profile', ' '.join('%.2f:%.1f' % (zz, fr) for zz, fr in prof[::6]))
print('hips %.3f top %.3f hem %.3f knee %.3f ankle %.3f' % (hips_z, z_top, hem_z, knee_z, ankle_z), 'cloth', np.round(cloth_col, 3))

NR = max(8, int(round((z_top - hem_z) / ROW_STEP)) + 1)
zs = np.linspace(z_top, hem_z, NR)
grid = np.zeros((NR, NA, 3)); gw = np.zeros((NR, NA, len(gn))); ok = np.zeros((NR, NA), bool)
c_prev = centre(z_top)
for i, zz in enumerate(zs):
    c_prev, pts, infos = ring(zz, NA, c_prev)
    for j in range(NA):
        if pts[j] is not None:
            grid[i, j] = pts[j]; gw[i, j] = infos[j][1]; ok[i, j] = True
# fill misses from neighbours in the ring
for i in range(NR):
    if not ok[i].all():
        good = np.where(ok[i])[0]
        for j in np.where(~ok[i])[0]:
            k = good[np.argmin(np.abs(((good - j + NA // 2) % NA) - NA // 2))]
            grid[i, j] = grid[i, k]; gw[i, j] = gw[i, k]
# light smoothing of the ring outlines (Meshy surface noise), not across the top ring
for it in range(3):
    g2 = grid.copy()
    g2[1:-1] = 0.5 * grid[1:-1] + 0.125 * (np.roll(grid[1:-1], 1, 1) + np.roll(grid[1:-1], -1, 1) + grid[:-2] + grid[2:])
    g2[-1] = 0.5 * grid[-1] + 0.25 * (np.roll(grid[-1], 1, 0) + np.roll(grid[-1], -1, 0))
    grid = g2
# along each column only: deep vertical folds stay, but ring-to-ring jitter
# (it reads as horizontal crumples on wide abayas) goes
for it in range(int(os.environ.get('VSMOOTH', '12'))):
    g2 = grid.copy()
    g2[1:-1] = 0.5 * grid[1:-1] + 0.25 * (grid[:-2] + grid[2:])
    g2[-1, :, :2] = 0.5 * grid[-1, :, :2] + 0.5 * grid[-2, :, :2]
    grid = g2

# ---- skirt texture: resample the old robe into a cylindrical map
TU, TV = 512, 256
tex = np.zeros((TV, TU, 3), np.float32)
c_prev = centre(z_top)
for r in range(TV):
    zz = z_top + (hem_z - z_top) * r / (TV - 1)
    c_prev, pts, infos = ring(zz, TU, c_prev)
    row = [texel(inf[0]) if inf is not None else cloth_col for inf in infos]
    tex[r] = np.array(row)
# soften painted folds: blend towards a heavy blur
def blur(a, k):
    out = a.copy()
    for _ in range(k):
        out = (np.roll(out, 1, 1) + np.roll(out, -1, 1) + out * 2) / 4
        out[1:-1] = (out[:-2] + out[2:] + out[1:-1] * 2) / 4
    return out
tex = 0.2 * blur(tex, 2) + 0.8 * blur(tex, 40)
# keep it close to the cloth colour: painted shadows of hands, feet and folds
# would show as stripes once the cloth is laid out differently
med = np.median(tex.reshape(-1, 3), 0)
dv = tex - med; dn = np.linalg.norm(dv, axis=-1, keepdims=True)
tex = med + dv * np.minimum(1, 0.06 / np.maximum(dn, 1e-6))
if os.environ.get('FLAT_SKIRT', '1') == '1':
    # one plain cloth colour: real folds come from the geometry and the light
    # one plain cloth colour: real folds come from the geometry and the light;
    # the first rows keep the robe's own colour so the waist seam does not show
    flat = np.median(tex[: TV // 2].reshape(-1, 3), 0)
    top = np.median(tex[:4], axis=0)  # per column, just below the cut
    k = np.clip(np.arange(TV) / (0.12 * TV), 0, 1)[:, None, None]
    tex[:] = (1 - k) * top[None] + k * flat
simg = bpy.data.images.new('skirt', TU, TV)
rgba = np.concatenate([tex[::-1], np.ones((TV, TU, 1), np.float32)], 2)  # Blender images start at the bottom
simg.pixels.foreach_set(rgba.ravel())
simg.filepath_raw = dst + '.skirt.png'; simg.file_format = 'PNG'; simg.save()
simg = bpy.data.images.load(dst + '.skirt.png'); simg.pack()

# ---- skirt weights
gi = {n: k for k, n in enumerate(gn)}
def scheme(x, t):
    H = 1 - np.clip(t / 0.45, 0, 1) ** 1.5
    sL = 1 / (1 + np.exp(-(x / 0.03)))
    fLeg = 0.7 * np.clip((t - 0.45) / 0.55, 0, 1) ** 1.2
    w = np.zeros(len(gn))
    w[gi['Hips']] = H
    w[gi['LeftUpLeg']] = (1 - H) * sL * (1 - fLeg); w[gi['LeftLeg']] = (1 - H) * sL * fLeg
    w[gi['RightUpLeg']] = (1 - H) * (1 - sL) * (1 - fLeg); w[gi['RightLeg']] = (1 - H) * (1 - sL) * fLeg
    return w
cx = bone_head('Hips').x
leg_cols = [gi[n] for n in gn if n.endswith(('UpLeg', 'Leg'))]
for i in range(NR):
    for j in range(NA):
        gw[i, j, gi['Hips']] += gw[i, j, leg_cols].sum(); gw[i, j, leg_cols] = 0
for i in range(NR):
    t = (z_top - zs[i]) / (z_top - hem_z)
    a = np.clip(i / 3, 0, 1) ** 2  # first rows keep the old surface's weights (seam stays shut)
    for j in range(NA):
        sw = scheme(grid[i, j, 0] - cx, t)
        w = (1 - a) * gw[i, j] + a * sw
        w[w < 1e-3] = 0
        gw[i, j] = w / w.sum()

# A short band laps over the cut from the outside, like the waist seam of a
# real garment, so the torso's cut edge never shows as a lip.
WB_UP, WB_OUT = float(os.environ.get('WB_UP', '0.012')), float(os.environ.get('WB_OUT', '0.004'))
c0 = grid[0, :, :2].mean(0)
rad = grid[0, :, :2] - c0
band = grid[0].copy()
band[:, :2] = c0 + rad * (1 + WB_OUT / np.maximum(np.linalg.norm(rad, axis=1, keepdims=True), 1e-6))
band[:, 2] += WB_UP
grid[0, :, :2] = band[:, :2]
grid = np.concatenate([band[None], grid], 0)
gw = np.concatenate([gw[:1], gw], 0)
zs = np.concatenate([[z_top + WB_UP], zs])
NR += 1

# skin colour from the face, for telling bare legs from robe leftovers
foot_cols = [k for k, n in enumerate(gn) if 'Foot' in n or 'Toe' in n]
head_z = bone_head('Head').z
fl = [l for f in me.polygons if f.material_index == body_mat and (MW @ f.center).z > head_z for l in f.loop_indices]
fc = np.array([texel(np.array(uv_layer[li].uv)) for li in fl[::7]])
mxc = fc.max(1); satc = (mxc - fc.min(1)) / np.maximum(mxc, 1e-6)
sk = (fc[:, 0] >= mxc - 1e-6) & (fc[:, 1] > fc[:, 2] + 0.02) & (fc[:, 0] > fc[:, 2] + 0.08) & (satc > 0.12) & (satc < 0.7) & (mxc > 0.3)
skin_col = np.median(fc[sk], 0) if sk.sum() > 20 else np.array([0.75, 0.55, 0.45])
print('skin colour', np.round(skin_col, 3))
# ---- cut the old robe: straight plane at z_top, drop the robe below it
bm = bmesh.new(); bm.from_mesh(me)
bm.verts.ensure_lookup_table(); bm.faces.ensure_lookup_table()
dl = bm.verts.layers.deform.active
cand = [f for f in bm.faces if f.material_index == body_mat and not any(sleeve[v.index] for v in f.verts)]
geom = list({e for f in cand for e in f.edges}) + cand + list({v for f in cand for v in f.verts})
res = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=MWi @ Vector((0, 0, z_top)), plane_no=(MWi.to_3x3() @ Vector((0, 0, 1))).normalized(), dist=1e-6)
bm.faces.ensure_lookup_table()
uvl = bm.loops.layers.uv.active
kill = []
for f in bm.faces:
    if f.material_index != body_mat: continue
    if any(len(v.link_faces) and False for v in f.verts): pass
    cz = (MW @ f.calc_center_median()).z
    if cz >= z_top: continue
    vsl = [v.index for v in f.verts if v.index < nv]
    if vsl and sum(sleeve[k] for k in vsl) * 2 > len(vsl): continue
    if cz > hem_z - 0.004:
        kill.append(f); continue
    # below the hem: keep bare skin and shoes, drop the robe's inside
    col = np.mean([texel(np.array(l[uvl].uv)) for l in f.loops], 0)
    footw = np.mean([W[v.index, foot_cols].sum() if v.index < nv else 0 for v in f.verts])
    skin_like = np.linalg.norm(col - skin_col) < 0.16
    shoe_like = footw > 0.5 and np.linalg.norm(col - cloth_col) > 0.3
    if not (skin_like or shoe_like): kill.append(f)
bmesh.ops.delete(bm, geom=kill, context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
bm.to_mesh(me); bm.free(); me.update()
print('uv after cut', [l.name for l in me.uv_layers])
print('removed robe faces', len(kill))

# grid for the parametric drapes (glTF axes: x, z, -y)
gg = np.concatenate([grid, grid[:, :1]], 1)
np.savez(dst + '.grid.npz', grid=np.stack([gg[..., 0], gg[..., 2], -gg[..., 1]], -1), zs=zs)
# The torso just above the cut carried some thigh weight from the old skirt
# blend; with the tube below it, it should follow the pelvis only, or it
# tears when the thighs fold.
legg = [g for g in body.vertex_groups if g.name.endswith(('UpLeg', 'Leg'))]
hipg = body.vertex_groups['Hips']
for v in me.vertices:
    if sleeve[v.index] if v.index < len(sleeve) else False: continue
    z = (MW @ v.co).z
    if z < z_top - 0.002 or z > hips_z + 0.15: continue
    moved = 0.0
    for gq in legg:
        try:
            w = gq.weight(v.index)
        except RuntimeError:
            continue
        if w > 0: moved += w; gq.remove([v.index])
    if moved > 0: hipg.add([v.index], moved, 'ADD')
# ---- the tube
tm = bpy.data.meshes.new('skirt')
verts, uvs = [], []
for i in range(NR):
    for j in range(NA + 1):
        verts.append(tuple(MWi @ Vector(grid[i, j % NA])))
fcs = []
for i in range(NR - 1):
    for j in range(NA):
        a = i * (NA + 1) + j; b = a + 1; c = a + NA + 1 + 1; d = a + NA + 1
        fcs.append((a, d, c, b))
tm.from_pydata(verts, [], fcs)
tuv = tm.uv_layers.new(name='UVMap')
for f in tm.polygons:
    for li, vi in zip(f.loop_indices, f.vertices):
        i, j = divmod(vi, NA + 1)
        tuv.data[li].uv = (j / NA, 1 - i / (NR - 1))
for f in tm.polygons: f.use_smooth = True
tob = bpy.data.objects.new('skirt', tm); bpy.context.collection.objects.link(tob)
tob.matrix_world = MW
for n in gn: tob.vertex_groups.new(name=n)
for i in range(NR):
    for j in range(NA + 1):
        w = gw[i, j % NA]
        for k in np.where(w > 0)[0]:
            tob.vertex_groups[gn[k]].add([i * (NA + 1) + j], float(w[k]), 'REPLACE')
mat = bpy.data.materials.new('skirt'); mat.use_nodes = True
bsdf = mat.node_tree.nodes['Principled BSDF']
tn = mat.node_tree.nodes.new('ShaderNodeTexImage'); tn.image = simg
mat.node_tree.links.new(tn.outputs['Color'], bsdf.inputs['Base Color'])
src_bsdf = me.materials[body_mat].node_tree.nodes.get('Principled BSDF')
bsdf.inputs['Roughness'].default_value = src_bsdf.inputs['Roughness'].default_value if src_bsdf else 0.8
bsdf.inputs['Metallic'].default_value = 0
mat.use_backface_culling = False
tm.materials.append(mat)
# smooth normals that blend into the old torso at the seam
bpy.ops.object.select_all(action='DESELECT')
tob.select_set(True); body.select_set(True); bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
print('uv after join', [l.name for l in body.data.uv_layers], body.data is me)
body.data.update()
print('skirt rows', NR, 'cols', NA)
for o in list(bpy.data.objects):
    if o not in (arm, body): bpy.data.objects.remove(o)
# Meshy's leftover colour layers are unused; the new skirt would get black ones
for nm in [ca.name for ca in body.data.color_attributes]:
    ca = body.data.color_attributes.get(nm)
    if ca is not None: body.data.color_attributes.remove(ca)
print('uv layers at export', [(l.name, l.active, l.active_render) for l in body.data.uv_layers])
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_animations=False)
print('wrote', dst)
