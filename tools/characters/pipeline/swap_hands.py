"""Finish a Meshy-rigged companion: Mixamo bone names + clean, fully rigged hands.

Usage: blenv/python.exe swap_hands.py -- rigged.glb ubc.gltf out.glb

Meshy's hands have fused fingers, so they cannot point a finger. They are
replaced by the CC0 Quaternius UBC hands (3 joints per finger), scaled and
aligned to each wrist, coloured with the character's own skin tone. The
sleeve cuff hides the seam. Bones are renamed to Mixamo names so PrayAlong's
humanoid adapter maps them (Spine/Spine1/Spine2/Neck, LeftHandIndex1..3, ...).
"""
import bpy, bmesh, sys, os
import numpy as np
from mathutils import Vector, Matrix

args = sys.argv[sys.argv.index('--') + 1:]
src, ubc, dst = (os.path.abspath(a) for a in args[:3])
SMOOTH_REPEAT = int(args[3]) if len(args) > 3 else 30
bpy.ops.wm.read_factory_settings(use_empty=True)

# ------------------------------------------------------------ character
bpy.ops.import_scene.gltf(filepath=src)
for a in list(bpy.data.actions): bpy.data.actions.remove(a)
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]; arm.name = 'Armature'
arm.animation_data_clear()
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
body = max(meshes, key=lambda o: len(o.data.vertices))
for o in meshes:
    if o is not body: bpy.data.objects.remove(o)
char_objs = {arm.name, body.name}

# rename the spine chain to Mixamo names
chain = []; b = arm.data.bones['Hips']
while True:
    kids = [c for c in b.children if c.name.lower().startswith(('spine', 'neck', 'head')) and c.name.lower() not in ('head_end', 'headfront')]
    if not kids: break
    b = kids[0]; chain.append(b.name)
for i, n in enumerate(chain): arm.data.bones[n].name = f'__t{i}'
for i, t in enumerate(['Spine', 'Spine1', 'Spine2', 'Neck', 'Head'][: len(chain)]): arm.data.bones[f'__t{i}'].name = t
print('spine chain', chain)

AW = arm.matrix_world.copy()
def head(n): return AW @ arm.data.bones[n].head_local

# skin colour + per-vertex colour from the texture
me = body.data
img = [i for i in bpy.data.images if i.size[0] > 0][0]
W, H = img.size
tex = np.array(img.pixels[:], np.float32).reshape(H, W, 4)
luv = np.array([d.uv for d in me.uv_layers.active.data]); lv = np.array([l.vertex_index for l in me.loops])
x = np.clip((luv[:, 0] % 1) * (W - 1), 0, W - 1).astype(int); y = np.clip((luv[:, 1] % 1) * (H - 1), 0, H - 1).astype(int)
vc = np.zeros((len(me.vertices), 3)); cnt = np.zeros(len(me.vertices))
np.add.at(vc, lv, tex[y, x, :3]); np.add.at(cnt, lv, 1); vc /= np.maximum(cnt, 1)[:, None]
srgb = vc ** (1 / 2.2)
sat = (srgb.max(1) - srgb.min(1)) / np.maximum(srgb.max(1), 1e-6)
is_skin = (srgb[:, 0] >= srgb.max(1) - 1e-6) & (srgb[:, 0] > srgb[:, 2] + 0.05) & (sat > 0.08) & (sat < 0.6) & (srgb.max(1) > 0.35)
gi = {g.name: g.index for g in body.vertex_groups}
Wt = np.zeros((len(me.vertices), len(gi)))
for v in me.vertices:
    for g in v.groups: Wt[v.index, g.group] = g.weight
V = np.array([AW.inverted() @ (body.matrix_world @ v.co) for v in me.vertices])  # armature space ~ world here
hand_skin = {}
for side in ('Left', 'Right'):
    hw = Wt[:, gi[f'{side}Hand']]
    sel = (hw > 0.35) & is_skin
    hand_skin[side] = sel
skin_rgb = np.median(vc[hand_skin['Left'] | hand_skin['Right']], axis=0)
print('hand skin (linear)', np.round(skin_rgb, 3), 'verts', [int(s.sum()) for s in hand_skin.values()])

# target frames from the character
targets = {}
for side, toward in (('Left', Vector((-1, 0, 0))), ('Right', Vector((1, 0, 0)))):
    wrist = head(f'{side}Hand'); elbow = head(f'{side}ForeArm')
    d = (wrist - elbow).normalized()
    hv = np.where(hand_skin[side])[0]
    P = np.array([body.matrix_world @ me.vertices[i].co for i in hv])
    tipdist = np.linalg.norm(P - np.array(wrist), axis=1)
    L = float(np.percentile(tipdist, 99))
    n = (toward - d * toward.dot(d)).normalized()
    targets[side] = dict(wrist=wrist, d=d, n=n, L=L)
    print(side, 'hand length', round(L, 3))

# delete Meshy hand skin
bpy.context.view_layer.objects.active = body; body.select_set(True)
bm = bmesh.new(); bm.from_mesh(me)
bm.verts.ensure_lookup_table()
kill = set(np.where(hand_skin['Left'] | hand_skin['Right'])[0].tolist())
bmesh.ops.delete(bm, geom=[bm.verts[i] for i in kill], context='VERTS')
bm.to_mesh(me); bm.free(); me.update()

# ------------------------------------------------------------ UBC hands
before = set(bpy.data.objects.keys())
bpy.ops.import_scene.gltf(filepath=ubc)
new = [bpy.data.objects[n] for n in bpy.data.objects.keys() if n not in before]
uarm = [o for o in new if o.type == 'ARMATURE'][0]
umesh = max([o for o in new if o.type == 'MESH' and o.vertex_groups], key=lambda o: len(o.data.vertices))
UW = uarm.matrix_world.copy()
FING = {'thumb': 'Thumb', 'index': 'Index', 'middle': 'Middle', 'ring': 'Ring', 'pinky': 'Pinky'}

hand_objs = []
new_bones = []
for side, s in (('Left', 'l'), ('Right', 'r')):
    T = targets[side]
    hb = uarm.data.bones[f'hand_{s}']
    uw = UW @ hb.head_local
    e1 = (UW @ uarm.data.bones[f'middle_01_{s}'].head_local - uw).normalized()
    e2 = Vector((0, 0, -1)); e2 = (e2 - e1 * e2.dot(e1)).normalized()
    e3 = e1.cross(e2)
    f1 = T['d']; f2 = (T['n'] - f1 * T['n'].dot(f1)).normalized(); f3 = f1.cross(f2)
    R = Matrix((f1, f2, f3)).transposed() @ Matrix((e1, e2, e3))  # columns e -> f
    Lu = (UW @ uarm.data.bones[f'middle_04_leaf_{s}'].tail_local - uw).length
    k = T['L'] / Lu
    def xf(p): return T['wrist'] + (R @ (p - uw)) * k
    # bones
    for bn in uarm.data.bones:
        parts = bn.name.split('_')
        if len(parts) == 3 and parts[0] in FING and parts[2] == s and parts[1] in ('01', '02', '03'):
            idx = int(parts[1])
            name = f'{side}Hand{FING[parts[0]]}{idx}'
            parent = f'{side}Hand' if idx == 1 else f'{side}Hand{FING[parts[0]]}{idx - 1}'
            new_bones.append((name, parent, xf(UW @ bn.head_local), xf(UW @ bn.tail_local)))
    # mesh: duplicate the UBC body, keep only this hand (+ a short wrist inside the cuff)
    dup = umesh.copy(); dup.data = umesh.data.copy(); bpy.context.collection.objects.link(dup)
    dup.modifiers.clear(); dup.parent = None; dup.matrix_world = umesh.matrix_world.copy()
    keep_groups = {g.index for g in dup.vertex_groups if g.name.endswith(f'_{s}') and (g.name.startswith(tuple(FING)) or g.name == f'hand_{s}')}
    fore_idx = dup.vertex_groups[f'lowerarm_{s}'].index
    bm = bmesh.new(); bm.from_mesh(dup.data)
    dl = bm.verts.layers.deform.active
    drop = []
    for v in bm.verts:
        wh = sum(w for g, w in v[dl].items() if g in keep_groups)
        if wh < 0.5: drop.append(v)
    bmesh.ops.delete(bm, geom=drop, context='VERTS')
    for v in bm.verts:
        p = dup.matrix_world @ v.co
        v.co = dup.matrix_world.inverted() @ xf(p)
    bm.to_mesh(dup.data); bm.free()
    # rename / keep only relevant groups
    for g in list(dup.vertex_groups):
        parts = g.name.split('_')
        if g.name == f'hand_{s}': g.name = f'{side}Hand'
        elif g.name == f'lowerarm_{s}': g.name = f'{side}ForeArm'
        elif len(parts) == 3 and parts[0] in FING and parts[2] == s and parts[1] in ('01', '02', '03'): g.name = f'{side}Hand{FING[parts[0]]}{int(parts[1])}'
        elif len(parts) == 4 and parts[0] in FING and parts[3] == s: g.name = f'{side}Hand{FING[parts[0]]}3_leaf'  # leaf weights fold into joint 3
        else: dup.vertex_groups.remove(g)
    hand_objs.append(dup)

# remove the UBC import
for o in new: bpy.data.objects.remove(o)

# add finger bones
bpy.ops.object.select_all(action='DESELECT')
bpy.context.view_layer.objects.active = arm; arm.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
inv = AW.inverted()
for name, parent, h, t in new_bones:
    eb = arm.data.edit_bones.new(name); eb.head = inv @ h; eb.tail = inv @ t
    eb.parent = arm.data.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')

# hand material: the character's skin
mat = bpy.data.materials.new('hands')
bsdf = mat.node_tree.nodes['Principled BSDF']
bsdf.inputs['Base Color'].default_value = (*skin_rgb, 1); bsdf.inputs['Roughness'].default_value = 0.75
for h in hand_objs:
    # fold leaf weights into joint 3
    for g in [g for g in h.vertex_groups if g.name.endswith('_leaf')]:
        tgt = h.vertex_groups.get(g.name[:-5]) or h.vertex_groups.new(name=g.name[:-5])
        for v in h.data.vertices:
            for vg in v.groups:
                if vg.group == g.index: tgt.add([v.index], vg.weight, 'ADD')
        h.vertex_groups.remove(g)
    h.data.materials.clear(); h.data.materials.append(mat)
    for f in h.data.polygons: f.use_smooth = True
    h.select_set(True)
body.select_set(True); bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
bpy.ops.object.vertex_group_normalize_all(lock_active=False)
if not any(m.type == 'ARMATURE' for m in body.modifiers):
    m = body.modifiers.new('Armature', 'ARMATURE'); m.object = arm
body.parent = arm
# ------------------------------------------------------------ cloth-like skirt weights
# Long robes are weighted rigidly per leg, so a kneeling or sitting pose tears
# the cloth between the legs. Smooth the weights over the garment below the
# waist so the skirt drapes from both legs and the hips together.
import bmesh as _bm
hips_z = (AW @ arm.data.bones['Hips'].head_local).z
legs = [g.name for g in body.vertex_groups if any(k in g.name for k in ('UpLeg', 'Leg', 'Hips'))]
skinish = set()
img2 = [m for m in body.data.materials if m.name != 'hands']
# weld seam duplicates first (UVs live on loops, so seams survive) so both
# copies of a seam vertex get the same smoothed weights and never tear apart
bm = _bm.new(); bm.from_mesh(body.data)
_bm.ops.remove_doubles(bm, verts=bm.verts[:], dist=2e-5)
bm.to_mesh(body.data); bm.free(); body.data.update()
bm = _bm.new(); bm.from_mesh(body.data); bm.verts.ensure_lookup_table()
dl = bm.verts.layers.deform.active
gidx = {g.name: g.index for g in body.vertex_groups}
foot_groups = {i for n, i in gidx.items() if 'Foot' in n or 'Toe' in n}
arm_groups = {i for n, i in gidx.items() if any(k in n for k in ('Arm', 'Hand', 'Shoulder'))}
leg_groups = {i for n, i in gidx.items() if 'UpLeg' in n or n.endswith('Leg')}
sel = []
for v in bm.verts:
    p = body.matrix_world @ v.co
    w = v[dl]
    footw = sum(w.get(g, 0) for g in foot_groups)
    armw = sum(w.get(g, 0) for g in arm_groups)
    legw = sum(w.get(g, 0) for g in leg_groups)
    if p.z < hips_z + 0.02 and footw < 0.3 and armw < 0.05 and legw > 0.05:
        sel.append(v.index)
bm.free()
for v in body.data.vertices: v.select = False
for i in sel: body.data.vertices[i].select = True
bpy.context.view_layer.objects.active = body
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_mode(type='VERT')
bpy.ops.object.mode_set(mode='OBJECT')
for i in sel: body.data.vertices[i].select = True
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.object.vertex_group_smooth(group_select_mode='ALL', factor=0.6, repeat=SMOOTH_REPEAT, expand=0.0)
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.vertex_group_normalize_all(lock_active=False)
print('smoothed skirt verts', len(sel))

# fresh smooth normals: imported custom normals go stale where the face was reshaped
bpy.context.view_layer.objects.active = body
try:
    bpy.ops.mesh.customdata_custom_splitnormals_clear()
except Exception as e:
    print('normals', e)
for f in body.data.polygons: f.use_smooth = True
body.data.update()
for o in list(bpy.data.objects):
    if o not in (arm, body): bpy.data.objects.remove(o)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_animations=False)
print('wrote', dst, 'bones', len(arm.data.bones), 'verts', len(body.data.vertices))
