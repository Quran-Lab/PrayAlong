"""
The companion's own body, from the reference figure (reference.py): his head, hands and feet as
modelled, and a slim body under the clothes (the figure only has a sweater and trousers there;
the garments drape over this instead).

The head is made faceless, like every demonstrator in PrayAlong: the eyes, teeth and the inside of
the mouth go, the lips close, the face is smoothed and the painted features (brows, lashes, lips,
nostrils) are painted over with the skin around them. The head's shape, skin and hair stay his.
FACE=1 keeps the face as it is.
"""
from __future__ import annotations

import os

import bmesh
import bpy
import mathutils
import numpy as np

import common as C
from common import capsule, loft, log, material, mirror_x, sdf_mesh, srgb, tube, union

HERE = os.path.dirname(__file__)


# ───────────────────────────────────────────────────────────── the head


def _components(bm):
    seen, comps = set(), []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack, comp = [v], []
        seen.add(v.index)
        while stack:
            u = stack.pop()
            comp.append(u)
            for e in u.link_edges:
                w = e.other_vert(u)
                if w.index not in seen:
                    seen.add(w.index)
                    stack.append(w)
        comps.append(comp)
    return comps


def _face_region(P, profile):
    """Weight (0…1) of the face: within a few centimetres of the front of the head at each height,
    from the chin to the brows, between the cheeks. `profile` = (z bins, front y per bin)."""
    zb, fy = profile
    front = np.interp(P[:, 2], zb, fy)
    w = C.smoothstep(0.068, 0.042, np.abs(P[:, 0]))
    w *= C.smoothstep(0.06, 0.03, P[:, 1] - front)
    w *= C.smoothstep(1.522, 1.545, P[:, 2]) * C.smoothstep(1.678, 1.662, P[:, 2])
    return w


def _profile(P):
    zb = np.arange(P[:, 2].min(), P[:, 2].max(), 0.005)
    mid = np.abs(P[:, 0]) < 0.03
    fy = np.array([P[mid & (np.abs(P[:, 2] - z) < 0.004), 1].min() if (mid & (np.abs(P[:, 2] - z) < 0.004)).any() else np.nan for z in zb])
    ok = ~np.isnan(fy)
    return zb[ok], fy[ok]


def faceless_head(ob):
    """Close the mouth, smooth the face (eyes, lips, nostrils into soft planes, a gentle nose
    kept) and paint the features out of the texture. Returns the head."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    comps = sorted(_components(bm), key=len)
    # The inside of the mouth (small pieces behind the lips).
    head = comps[-1]
    keep = {v.index for v in head}
    extra = [v for v in bm.verts if v.index not in keep and abs(v.co.x) < 0.04]
    bmesh.ops.delete(bm, geom=extra, context='VERTS')
    # Close the lips: fill the opening of the mouth (the only boundary in front of the face).
    edges = [e for e in bm.edges if e.is_boundary and all(v.co.y < 0.0 and abs(v.co.x) < 0.04 for v in e.verts)]
    if edges:
        res = bmesh.ops.holes_fill(bm, edges=edges, sides=0)
        bmesh.ops.triangulate(bm, faces=res['faces'])
    bm.verts.ensure_lookup_table()
    P = np.array([tuple(v.co) for v in bm.verts])
    prof = _profile(P)
    band = (P[:, 2] > 1.56) & (P[:, 2] < 1.61)
    nose_z = P[band][np.argmin(P[band, 1]), 2]
    w = _face_region(P, prof)
    # A smooth, convex face: fit the front of the face (depth as a cubic in x and z) to its upper
    # envelope (eye sockets and the mouth's corners don't pull it in), then add a soft nose.
    m = w > 0.02
    X = np.stack([np.ones(m.sum()), P[m, 0] ** 2, P[m, 2] - 1.6, (P[m, 2] - 1.6) ** 2, (P[m, 2] - 1.6) ** 3,
                  P[m, 0] ** 2 * (P[m, 2] - 1.6), P[m, 0] ** 4], 1)
    y = P[m, 1]
    k = np.ones(m.sum())
    for _ in range(8):
        coef = np.linalg.lstsq(X * k[:, None], y * k, rcond=None)[0]
        fit = X @ coef
        k = np.where(y > fit + 0.002, 0.15, 1.0)  # behind the surface: a hollow, trust it less
    target = P.copy()
    target[m, 1] = fit - 0.0015 * np.exp(-((P[m, 0] / 0.02) ** 2 + ((P[m, 2] - nose_z) / 0.03) ** 2))
    Q = P + (target - P) * w[:, None]
    # A little relaxing so the edge of the region blends into the cheeks.
    nbr = [[e.other_vert(v).index for e in v.link_edges] for v in bm.verts]
    for _ in range(25):
        avg = np.array([Q[n].mean(0) if n else Q[i] for i, n in enumerate(nbr)])
        Q = Q + (avg - Q) * (0.5 * w)[:, None]
        # Back onto the fitted surface (smoothing evens out the creases, not the face's form).
        Q[m, 1] = Q[m, 1] + (target[m, 1] - Q[m, 1]) * w[m] * 0.5
    for v, q in zip(bm.verts, Q):
        v.co = q
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    _paint_out_features(ob, w_of=lambda P: _face_region(P, prof))
    log(f'head: faceless ({len(ob.data.vertices)} verts)')
    return ob


def _texture(ob):
    m = ob.data.materials[0]
    for n in m.node_tree.nodes:
        if n.type == 'TEX_IMAGE' and n.image:
            return n.image
    return None


def _paint_out_features(ob, w_of):
    """Over the face (in UV space), replace anything darker or redder than the skin (brows,
    lashes, nostrils, lips) with the skin's own smooth colour."""
    from scipy import ndimage

    img = _texture(ob)
    if img is None:
        return
    W, H = img.size
    px = np.array(img.pixels[:], np.float32).reshape(H, W, 4)
    me = ob.data
    uv = me.uv_layers.active.data
    P = np.array([tuple(v.co) for v in me.vertices])
    w = w_of(P)
    # Rasterise the face's triangles into a UV mask (weighted).
    mask = np.zeros((H, W), np.float32)
    for poly in me.polygons:
        vw = [w[i] for i in poly.vertices]
        if max(vw) < 0.05:
            continue
        uvs = [uv[li].uv for li in poly.loop_indices]
        xs = [u.x * (W - 1) for u in uvs]
        ys = [u.y * (H - 1) for u in uvs]
        x0, x1 = int(max(0, min(xs))), int(min(W - 1, max(xs) + 1))
        y0, y1 = int(max(0, min(ys))), int(min(H - 1, max(ys) + 1))
        mask[y0 : y1 + 1, x0 : x1 + 1] = np.maximum(mask[y0 : y1 + 1, x0 : x1 + 1], float(np.max(vw)))
    mask = ndimage.gaussian_filter(mask, 2.0)
    rgb = px[..., :3]
    lum = rgb.mean(-1)
    red = rgb[..., 0] - rgb[..., 1]
    face = mask > 0.2
    skin_l = np.median(lum[face])
    skin_r = np.median(red[face])
    # Skin-like pixels feed a smooth fill; features (darker, or redder like lips) are replaced.
    good = (np.abs(lum - skin_l) < 0.09) & (red < skin_r + 0.06)
    wgt = good.astype(np.float32)
    fill = np.stack([ndimage.gaussian_filter(rgb[..., c] * wgt, 9) for c in range(3)], -1)
    fill /= np.maximum(ndimage.gaussian_filter(wgt, 9), 1e-4)[..., None]
    # A smoother skin still, from a wider blur, for the whole face.
    wide = np.stack([ndimage.gaussian_filter(rgb[..., c] * wgt, 24) for c in range(3)], -1)
    wide /= np.maximum(ndimage.gaussian_filter(wgt, 24), 1e-4)[..., None]
    feature = ndimage.gaussian_filter(ndimage.binary_dilation(~good, iterations=3).astype(np.float32), 2.0)
    a = np.clip(mask * 3.0, 0, 1)
    rgb[:] = rgb * (1 - a[..., None]) + wide * a[..., None]
    px[..., :3] = rgb
    img.pixels[:] = px.ravel()
    img.update()
    if os.environ.get('FACE_DEBUG'):
        img.save(filepath=os.environ['FACE_DEBUG'])


def hair_shell(head, color='#2a211b'):
    """Short, tidy hair: the scalp above a clean hairline, lifted a few millimetres (fuller on
    top), as its own mesh with the head's weights."""
    me = head.data
    P = np.array([tuple(v.co) for v in me.vertices])
    N = np.array([tuple(v.normal) for v in me.vertices])
    c = np.array([0.0, P[:, 1].mean() + 0.01, 0.0])
    ang = np.arctan2(P[:, 0] - c[0], -(P[:, 1] - c[1]))  # 0 = the forehead, ±pi = the nape
    top = P[:, 2].max()
    line = top - 0.05 - 0.018 * (1 - np.cos(np.clip(ang, -1.6, 1.6))) - 0.11 * C.smoothstep(1.7, 3.1, np.abs(ang))
    # Clear of the ears.
    ears = (np.abs(np.abs(P[:, 0]) - 0.075) < 0.03) & (np.abs(P[:, 1] - c[1]) < 0.035)
    line = np.where(ears, np.maximum(line, top - 0.075), line)
    hair = P[:, 2] > line
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    geom = [f for f in bm.faces if all(hair[v.index] for v in f.verts)]
    keep = {v.index for f in geom for v in f.verts}
    out = bmesh.new()
    vmap = {}
    for i in sorted(keep):
        lift = 0.002 + 0.003 * C.smoothstep(top - 0.06, top, P[i, 2])
        vmap[i] = out.verts.new(tuple(P[i] + N[i] * lift))
    for f in geom:
        out.faces.new([vmap[v.index] for v in f.verts])
    bm.free()
    m2 = bpy.data.meshes.new('Hair')
    out.to_mesh(m2)
    out.free()
    ob = bpy.data.objects.new('Hair', m2)
    bpy.context.scene.collection.objects.link(ob)
    m2.shade_smooth()
    C.assign(ob, material('Hair', color, roughness=0.6, sheen=0.2, sheen_tint='#6a6e7a'))
    vg = ob.vertex_groups.new(name='Head')
    vg.add(list(range(len(m2.vertices))), 1.0, 'REPLACE')
    log(f'hair: {len(m2.vertices)} verts')
    return ob


ARABIC_FONT = os.path.expanduser('~/Library/Fonts/UthmanTN1-Ver10.otf')


def _glyph_outline(char, size=900):
    """The outline of a glyph (metres per glyph-height = 1), from the app's Arabic font."""
    from PIL import Image, ImageDraw, ImageFont
    from skimage.measure import approximate_polygon, find_contours

    font = ImageFont.truetype(ARABIC_FONT, size)
    x0, y0, x1, y1 = font.getbbox(char)
    im = Image.new('L', (x1 - x0 + 40, y1 - y0 + 40), 0)
    ImageDraw.Draw(im).text((20 - x0, 20 - y0), char, font=font, fill=255)
    G = np.asarray(im, np.float32) / 255.0
    loops = [approximate_polygon(c, 1.2) for c in find_contours(G, 0.5)]
    loops = [c for c in loops if len(c) > 8]
    h = (y1 - y0)
    cy, cx = (G.shape[0]) / 2, (G.shape[1]) / 2
    # (row, col) → (x, z) with the glyph's height 1, centred.
    return [np.stack([(c[:, 1] - cx) / h, (cy - c[:, 0]) / h], 1) for c in loops], (x1 - x0) / h


def hamzah_eyes(head, eyes, height=0.019, name='Eyes'):
    """The eyes, as two hamzahs (ء) in the app's Arabic font (KFGQPC Uthman Taha Naskh): thin
    decals on the face where the figure's eyes were, sharp at any distance."""
    from mathutils.bvhtree import BVHTree

    if not len(eyes):
        return None
    loops, aspect = _glyph_outline('\u0621')
    tree = BVHTree.FromObject(head, bpy.context.evaluated_depsgraph_get(), deform=False)
    bm = bmesh.new()
    for c in eyes:
        for loop in loops:
            vs = []
            for gx, gz in loop[:-1]:
                o = mathutils.Vector((c[0] + gx * height, c[1] - 0.2, c[2] + gz * height))
                hit, nrm, _, _ = tree.ray_cast(o, mathutils.Vector((0, 1, 0)))
                p = (hit + nrm * 0.0007) if hit is not None else o
                vs.append(bm.verts.new(p))
            for i in range(len(vs)):
                bm.edges.new((vs[i], vs[(i + 1) % len(vs)]))
    bmesh.ops.triangle_fill(bm, edges=bm.edges[:], use_beauty=True, use_dissolve=False)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    C.assign(ob, material('Ink', '#1c1719', roughness=0.95, specular=0.1))
    vg = ob.vertex_groups.new(name='Head')
    vg.add(list(range(len(me.vertices))), 1.0, 'REPLACE')
    log(f'face: hamzah eyes, {len(me.polygons)} faces')
    return ob


def skin_tone(ob):
    """The head's average cheek colour (sRGB), for the hands and feet to match."""
    img = _texture(ob)
    if img is None:
        return '#c79a7e'
    W, H = img.size
    px = np.array(img.pixels[:], np.float32).reshape(H, W, 4)
    me = ob.data
    uv = me.uv_layers.active.data
    P = np.array([tuple(v.co) for v in me.vertices])
    front = P[:, 1].min()
    cheek = (np.abs(np.abs(P[:, 0]) - 0.045) < 0.012) & (P[:, 1] < front + 0.04)
    cols = []
    for poly in me.polygons:
        if all(cheek[i] for i in poly.vertices):
            for li in poly.loop_indices:
                u = uv[li].uv
                cols.append(px[int(u.y * (H - 1)), int(u.x * (W - 1)), :3])
    c = np.median(np.array(cols), 0) if cols else np.array([0.78, 0.6, 0.5])
    return srgb(tuple(float(x) for x in c))[:3]  # the texture is sRGB; materials want linear


# ───────────────────────────────────────────────────────────── under the clothes


def under_sdf(J, slim=1.0):
    """A slim body from the joints J (bone → head position, A-pose): torso, shoulders, arms and
    legs, ending inside the head's neck, the hands' wrists and the feet's ankles."""
    s = slim
    cy = J['Spine'][1]
    torso = loft([
        (0.84, 0, cy + 0.005, 0.15 * s, 0.1 * s),
        (0.93, 0, cy + 0.002, 0.158 * s, 0.104 * s),
        (1.04, 0, cy - 0.004, 0.138 * s, 0.093 * s),
        (1.15, 0, cy - 0.01, 0.143 * s, 0.1 * s),
        (1.25, 0, cy - 0.01, 0.152 * s, 0.108 * s),
        (1.33, 0, cy - 0.004, 0.155 * s, 0.104 * s),
        (1.4, 0, cy + 0.006, 0.142 * s, 0.088 * s),
        (1.445, 0, cy + 0.016, 0.09, 0.066),
        (1.475, 0, cy + 0.02, 0.05, 0.048),
        (1.52, 0, cy + 0.01, 0.043, 0.042),
    ], cap=0.01)
    sh, el, wr = (np.array(J[f'Left{b}'], float) for b in ('Arm', 'ForeArm', 'Hand'))
    deltoid = capsule((0.09, sh[1], 1.41), tuple(sh), 0.05 * s)
    arm = tube([tuple(sh), tuple(el), tuple(wr + (wr - el) * 0.05)], [0.044 * s, 0.035 * s, 0.026 * s])
    hip, kn, an = (np.array(J[f'Left{b}'], float) for b in ('UpLeg', 'Leg', 'Foot'))
    leg = tube([tuple(hip), tuple(hip * 0.45 + kn * 0.55), tuple(kn), tuple(kn * 0.55 + an * 0.45), tuple(an + np.array([0, -0.01, 0.02]))],
               [0.066 * s, 0.05 * s, 0.04 * s, 0.042 * s, 0.03 * s])
    b = union(torso, mirror_x(deltoid), k=0.035)
    b = union(b, mirror_x(arm), k=0.025)
    return union(b, mirror_x(leg), k=0.04)


def transfer_weights(target, sources, k=4):
    """Skin weights for `target` from the nearest vertices of the skinned `sources`."""
    from mathutils.kdtree import KDTree

    pts, groups = [], []
    for src in sources:
        names = {g.index: g.name for g in src.vertex_groups}
        for v in src.data.vertices:
            pts.append(tuple(v.co))
            groups.append({names[g.group]: g.weight for g in v.groups if g.weight > 0 and names[g.group] != 'pin'})
    tree = KDTree(len(pts))
    for i, p in enumerate(pts):
        tree.insert(p, i)
    tree.balance()
    acc = {}
    for v in target.data.vertices:
        found = tree.find_n(v.co, k)
        tot = {}
        wsum = 0.0
        for _, i, d in found:
            iw = 1.0 / max(d, 1e-4)
            wsum += iw
            for g, w in groups[i].items():
                tot[g] = tot.get(g, 0.0) + w * iw
        s = sum(tot.values()) or 1.0
        for g, w in tot.items():
            acc.setdefault(g, {})[v.index] = w / s
    target.vertex_groups.clear()
    for g, ws in acc.items():
        vg = target.vertex_groups.new(name=g)
        for i, w in ws.items():
            if w > 0.01:
                vg.add([i], w, 'REPLACE')


def joints(rig):
    return {b.name: tuple(b.head_local) for b in rig.data.bones}


def build_body(ref, *, name, feet='skin', faceless=True, hair=True, slim=1.0, trousers='Sirwal', hem=0.115):
    """Head, hands, feet, the figure's own loose trousers (cut above the ankles, as `trousers`
    material) and the under-body, joined into one skinned mesh `name`. Returns (body, materials,
    joints)."""
    rig = ref.arm
    J = joints(rig)
    head = ref.parts['head'][0]
    if faceless and os.environ.get('FACE') != '1':
        faceless_head(head)
    face_mat = head.data.materials[0]
    face_mat.name = 'Face'
    tone = skin_tone(head)
    skin = material('Skin', tone if isinstance(tone, str) else '#000000', roughness=0.6)
    if not isinstance(tone, str):
        bsdf = skin.node_tree.nodes['Principled BSDF']
        bsdf.inputs['Base Color'].default_value = (*tone, 1.0)
        skin.diffuse_color = (*tone, 1.0)
    under = material('Under', '#18181b', roughness=0.85)
    socks = material('Socks', '#1a1a1d', roughness=0.9)

    hands = ref.parts['hands'][0]
    # Drop the stray rings at the ankles (the reference's sock tops).
    bm = bmesh.new()
    bm.from_mesh(hands.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < 0.5], context='VERTS')
    bm.to_mesh(hands.data)
    bm.free()
    C.assign(hands, skin)
    foot = ref.parts['feet'][0]
    C.assign(foot, socks if feet == 'socks' else skin)

    lo, hi = (-0.75, -0.25, 0.0), (0.75, 0.42, 1.6)
    core = sdf_mesh(f'{name}Under', under_sdf(J, slim), voxel=0.004, faces=3600, symmetric=True, lo=lo, hi=hi)
    C.assign(core, under)
    transfer_weights(core, ref.parts['top'] + ref.parts['bottom'])
    for o in ref.parts['top']:
        bpy.data.objects.remove(o)
    ref.parts.pop('top', None)
    # The trousers: loose already, and skinned for this very prayer by their author. Above the
    # ankles (no isbal), the hem straightened.
    pants = ref.parts.pop('bottom')[0]
    bm = bmesh.new()
    bm.from_mesh(pants.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().z < hem], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    for v in bm.verts:
        if v.is_boundary and abs(v.co.z - hem) < 0.02:
            v.co.z = hem
    bm.to_mesh(pants.data)
    bm.free()
    pants_mat = material(trousers, '#1c1c1f', roughness=0.82, sheen=0.1, sheen_tint='#5e6068')
    C.assign(pants, pants_mat)

    parts = [head, hands, foot, core, pants]
    if faceless and os.environ.get('FACE') != '1':
        eyes = hamzah_eyes(head, ref.eyes)
        if eyes:
            parts.append(eyes)
    if hair:
        parts.append(hair_shell(head))
    for o in parts:
        for m in [m for m in o.modifiers if m.type == 'ARMATURE']:
            o.modifiers.remove(m)
        o.parent = None
    body = C.join(parts, name)
    C.bind(body, rig)
    return body, dict(face=face_mat, skin=skin, under=under, socks=socks, pants=pants_mat), J


# ───────────────────────────────────────────────────────────── export


def write_poses(rig, poses):
    """One action per posture (two identical keys), so the GLB carries every posture as an
    animation of that name; performer.ts blends between them."""
    from reference import set_pose

    rig.animation_data_create()
    bpy.context.preferences.edit.keyframe_new_interpolation_type = 'LINEAR'
    for name, pose in poses.items():
        set_pose(rig, pose)
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        rig.animation_data.action = act
        for pb in rig.pose.bones:
            for f in (0, 1):
                pb.keyframe_insert('rotation_quaternion', frame=f)
                pb.keyframe_insert('location', frame=f)
        rig.animation_data.action = None
    for pb in rig.pose.bones:
        pb.matrix_basis = mathutils.Matrix.Identity(4)
    bpy.context.view_layer.update()


def export(path, rig, meshes):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    rig.select_set(True)
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = rig
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_apply=False,
        export_yup=True,
        export_skins=True,
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_optimize_animation_size=False,
        export_force_sampling=False,
        export_frame_range=False,
        export_cameras=False,
        export_lights=False,
        export_normals=True,
        export_texcoords=True,
        export_tangents=False,
        export_vertex_color='NONE',
        export_all_influences=False,
        export_influence_nb=4,
        export_def_bones=False,
        export_morph=True,
        export_morph_normal=True,
        export_extras=False,
        export_image_format='JPEG',
        export_jpeg_quality=88,
    )
    log('exported', path, f'{os.path.getsize(path) / 1024:.0f} KB')
    compress(path)


def compress(path):
    """Meshopt-compress the GLB in place (the app's loader decodes it): about a third of the
    size, morph targets included. Needs npx (Node); skipped without it."""
    import shutil
    import subprocess

    if os.environ.get('COMPRESS', '1') == '0' or not shutil.which('npx'):
        return
    tmp = path + '.meshopt.glb'
    r = subprocess.run(['npx', '-y', '@gltf-transform/cli@4', 'meshopt', path, tmp], capture_output=True, text=True)
    if r.returncode == 0 and os.path.exists(tmp):
        os.replace(tmp, path)
        log('compressed', path, f'{os.path.getsize(path) / 1024:.0f} KB')
    else:
        log('compression skipped:', (r.stderr or r.stdout).strip()[-200:])
