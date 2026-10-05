"""
The cloth bake: drape each garment in every prayer posture, then store the result as one morph
target per posture ("pose_ruku", "pose_sujud" …) that the app blends as the body moves.

1. The postures are poses.py's: the reference figure's own prayer, set right by the fiqh.
2. Blender walks the body through the prayer in order (standing, takbir, bowing, rising, hands
   down before the knees, prostrating, sitting, rising on the fists, the final sitting, the
   salams) while the garments are simulated as cloth around it: the body (and the trousers) and
   the mat are colliders; a khimar also collides with the abaya under it. Pinned parts (the
   shoulders, the hood) follow the skinning exactly.
3. At the end of each posture's hold the cloth is read back, pushed clear of the body where a
   fold still touches it, and un-skinned (inverse linear blend skinning with the garment's own
   weights) into the rest pose. Skinned again in the app with the same bones, it lands exactly
   where the simulation left it.
"""
from __future__ import annotations

import os

import bpy
import mathutils
import numpy as np

from common import get_verts, log

#: The walk, as (posture, frames to get there, frames to hold, keep it). Each kept posture is read
#: at the end of its hold. The hands rise before ruku and when rising from it; the body goes
#: down hands first and comes up from the sitting of rest on its fists, as in the app.
PATH = [
    ('rest', 0, 36, True),
    ('takbir', 14, 24, True),
    ('qiyam', 14, 24, True),
    ('takbir', 10, 6, False),
    ('ruku', 14, 24, True),
    ('takbir', 12, 6, False),
    ('itidal', 14, 24, True),
    ('descend', 16, 16, True),
    ('sujud', 14, 26, True),
    ('jalsah', 16, 26, True),
    ('sujud', 16, 14, False),
    ('jalsah', 16, 8, False),
    ('rise', 14, 18, True),
    ('qiyam', 18, 12, False),
    ('itidal', 10, 4, False),
    ('descend', 14, 8, False),
    ('sujud', 14, 14, False),
    ('tashahhud', 16, 26, True),
    ('sujud', 16, 14, False),
    ('tawarruk', 18, 28, True),
    ('salam-right', 14, 24, True),
    ('salam-left', 18, 26, True),
]


def skinning(arm, pose):
    """{bone: world matrix} → {bone: skinning matrix} (what moves a rest vertex there)."""
    out = {}
    for b in arm.data.bones:
        M = pose.get(b.name)
        if M is not None:
            out[b.name] = np.asarray(M) @ np.linalg.inv(np.array(b.matrix_local))
    return out


def _depth(b):
    d, p = 0, b.parent
    while p:
        d, p = d + 1, p.parent
    return d


def set_pose(arm, S):
    """Pose the armature so that bone i deforms a vertex by S[i] (armature space)."""
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.matrix_basis = mathutils.Matrix.Identity(4)
    bpy.context.view_layer.update()
    for b in sorted(arm.data.bones, key=_depth):
        M = S.get(b.name, np.eye(4)) @ np.array(b.matrix_local)
        arm.pose.bones[b.name].matrix = mathutils.Matrix(M.tolist())
        bpy.context.view_layer.update()


def _key(arm, frame, last):
    for pb in arm.pose.bones:
        q = pb.rotation_quaternion
        prev = last.get(pb.name)
        if prev is not None and prev.dot(q) < 0:
            pb.rotation_quaternion = -q
        last[pb.name] = pb.rotation_quaternion.copy()
        for path in ('location', 'rotation_quaternion', 'scale'):
            pb.keyframe_insert(path, frame=frame)


def skin_weights(ob, bone_names):
    """Normalised bone weights per vertex (n × bones), as the armature (and glTF) use them."""
    n = len(ob.data.vertices)
    W = np.zeros((n, len(bone_names)))
    col = {g.index: bone_names.index(g.name) for g in ob.vertex_groups if g.name in bone_names}
    for v in ob.data.vertices:
        for g in v.groups:
            j = col.get(g.group)
            if j is not None:
                W[v.index, j] = g.weight
    s = W.sum(1, keepdims=True)
    return W / np.maximum(s, 1e-9)


def pin_weights(ob, name='pin'):
    n = len(ob.data.vertices)
    w = np.zeros(n)
    g = ob.vertex_groups.get(name)
    if g:
        for v in ob.data.vertices:
            for e in v.groups:
                if e.group == g.index:
                    w[v.index] = e.weight
    return w


def unskin(P, W, S_list):
    """Inverse linear blend skinning: rest positions that skin to P."""
    S = np.stack(S_list)  # bones × 4 × 4
    M = np.einsum('nb,bij->nij', W, S)
    return np.linalg.solve(M[:, :3, :3], (P - M[:, :3, 3])[..., None])[..., 0]


def _evaluated(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    P = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('co', P)
    ev.to_mesh_clear()
    return P.reshape(-1, 3).astype(float)


def _clear_of(body, P, free, margin):
    """Push cloth vertices that still touch the body back out along the body's normal."""
    from mathutils.bvhtree import BVHTree

    dg = bpy.context.evaluated_depsgraph_get()
    tree = BVHTree.FromObject(body, dg)
    moved = 0
    for i in np.nonzero(free)[0]:
        hit = tree.find_nearest(mathutils.Vector(P[i]))
        if hit[0] is None:
            continue
        loc, nrm = np.array(hit[0]), np.array(hit[1])
        d = float((P[i] - loc) @ nrm)
        if d < margin:
            P[i] = loc + nrm * margin
            moved += 1
    return moved


def _clear_of_sheet(sheet, Q, P, free, margin):
    """Push vertices of P that are inside (or touching) another garment, posed at Q, outside it."""
    from mathutils.bvhtree import BVHTree

    faces = [list(p.vertices) for p in sheet.data.polygons]
    tree = BVHTree.FromPolygons(Q.tolist(), faces)
    moved = 0
    for i in np.nonzero(free)[0]:
        hit = tree.find_nearest(mathutils.Vector(P[i]), 0.03)
        if hit[0] is None:
            continue
        loc, nrm = np.array(hit[0]), np.array(hit[1])
        if float((P[i] - loc) @ nrm) < margin:
            P[i] = loc + nrm * margin
            moved += 1
    return moved


def _cache_path(name, garments, poses, path=PATH):
    import hashlib

    d = os.environ.get('CHAR_CACHE')
    if not d:
        return None
    h = hashlib.sha1()
    for k in sorted(poses):
        for b in sorted(poses[k]):
            h.update(np.round(poses[k][b], 5).tobytes())
    h.update(repr(path).encode())
    for g in garments:
        h.update(np.round(get_verts(g['ob']), 6).tobytes())
        h.update(np.round(pin_weights(g['ob']), 4).tobytes())
        h.update(repr(sorted((k, v) for k, v in g.items() if k != 'ob')).encode())
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, f'bake-{name}-{h.hexdigest()[:16]}.npz')


def simulate(arm, body, garments, poses, frames_scale=1.0, path=PATH):
    """Walk the body along PATH with the garments simulated around it; the posed cloth (armature
    space, mat at z = 0) per garment and kept posture."""
    import time

    sc = bpy.context.scene
    last, frame, keep = {}, 1, {}
    for pose, move, hold, kept in path:
        frame += int(round(move * frames_scale))
        set_pose(arm, poses[pose])
        _key(arm, frame, last)
        frame += int(round(hold * frames_scale))
        _key(arm, frame, last)
        if kept:
            keep[frame] = pose
    end = frame
    sc.frame_start, sc.frame_end = 1, end

    me = bpy.data.meshes.new('Floor')
    me.from_pydata([(-2, -2, 0), (2, -2, 0), (2, 2, 0), (-2, 2, 0)], [], [(0, 1, 2, 3)])
    floor = bpy.data.objects.new('Floor', me)
    sc.collection.objects.link(floor)
    for ob, thick in ((floor, 0.003), (body, 0.006)):
        c = ob.modifiers.new('Collision', 'COLLISION')
        c.settings.thickness_outer = thick
        c.settings.cloth_friction = 6.0
        c.settings.damping = 0.4
    for g in garments:
        ob = g['ob']
        cl = ob.modifiers.new('Cloth', 'CLOTH')
        st = cl.settings
        st.quality = g.get('quality', 8)
        st.mass = g.get('mass', 0.25)
        st.air_damping = g.get('air', 2.0)
        st.tension_stiffness = st.compression_stiffness = g.get('tension', 15.0)
        st.shear_stiffness = g.get('shear', 5.0)
        st.bending_stiffness = g.get('bending', 1.0)
        st.vertex_group_mass = 'pin'
        st.pin_stiffness = 1.0
        cs = cl.collision_settings
        cs.collision_quality = 4
        cs.distance_min = 0.005
        cs.use_self_collision = g.get('self', True)
        cs.self_distance_min = 0.004
        cl.point_cache.frame_start, cl.point_cache.frame_end = 1, end
        if g.get('collider'):
            c = ob.modifiers.new('Collision', 'COLLISION')
            c.settings.thickness_outer = 0.003
            c.settings.cloth_friction = 6.0

    shots = {}
    t0 = time.time()
    for f in range(1, end + 1):
        sc.frame_set(f)
        if f in keep:
            for g in garments:
                shots[f'{g["ob"].name}/{keep[f]}'] = _evaluated(g['ob']).astype(np.float32)
            log(f'  {keep[f]:12} frame {f:4d}  ({time.time() - t0:.0f}s)')

    for g in garments:
        ob = g['ob']
        for m in [m for m in ob.modifiers if m.type in ('CLOTH', 'COLLISION')]:
            ob.modifiers.remove(m)
    for m in [m for m in body.modifiers if m.type == 'COLLISION']:
        body.modifiers.remove(m)
    bpy.data.objects.remove(floor)
    walk = arm.animation_data.action if arm.animation_data else None
    arm.animation_data_clear()
    if walk:
        bpy.data.actions.remove(walk)
    return shots


def bake(name, arm, body, garments, world_poses, *, settle=None, frames_scale=1.0, margin=0.003, floor=0.0025):
    """Drape `garments` (list of dicts: ob, bending, mass, self, collider, outside) around `body`
    in `world_poses` ({posture: {bone: world matrix}}) and add a "pose_<posture>" shape key per
    kept posture to each garment. The simulation is reused from CHAR_CACHE while the garments,
    the poses and the walk are unchanged."""
    poses = {k: skinning(arm, v) for k, v in world_poses.items()}
    bone_names = [b.name for b in arm.data.bones]
    path = list(PATH)
    if settle:
        path[0] = (path[0][0], path[0][1], settle, path[0][3])
    cache = _cache_path(name, garments, world_poses, path)
    if cache and os.path.exists(cache):
        shots = dict(np.load(cache))
        log(f'cloth bake: simulation cached ({os.path.basename(cache)})')
    else:
        shots = simulate(arm, body, garments, poses, frames_scale, path)
        if cache:
            np.savez(cache, **shots)

    # Clear of the body (and of the garment underneath), on or above the mat, then un-skinned.
    for g in garments:
        ob = g['ob']
        W = skin_weights(ob, bone_names)
        free = pin_weights(ob) < 0.999
        if not ob.data.shape_keys:
            ob.shape_key_add(name='Basis')
        for pose in [p for p, _, _, kept in PATH if kept]:
            P = shots[f'{ob.name}/{pose}'].astype(float)
            S = poses[pose]
            set_pose(arm, S)
            moved = _clear_of(body, P, free, margin)
            for other in garments:
                if other is not g and other['ob'].name in g.get('outside', ()):
                    moved += _clear_of_sheet(other['ob'], shots[f'{other["ob"].name}/{pose}'].astype(float), P, free, margin)
            P[:, 2] = np.maximum(P[:, 2], floor)
            R = unskin(P, W, [S[b] for b in bone_names])
            key = ob.shape_key_add(name=f'pose_{pose}', from_mix=False)
            key.data.foreach_set('co', R.astype(np.float32).ravel())
            key.value = 0.0
            log(f'  {ob.name}: pose_{pose} ({moved} vertices pushed clear)')
    set_pose(arm, {})
    for pb in arm.pose.bones:
        pb.matrix_basis = mathutils.Matrix.Identity(4)
    bpy.context.view_layer.update()
    bpy.context.scene.frame_set(1)
