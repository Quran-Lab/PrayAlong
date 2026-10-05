"""
Clothes for the companions (build_brother.py, build_sister.py): open sheets of cloth around the
figure's body, not solids. A gamis, an abaya and a khimar have a hem, cuffs and a neckline and
nothing inside them but the body; drape.py simulates them as cloth in every prayer posture, so
they hang loose (nothing tight on the body) and never pass through an arm, a leg or the mat.

Shapes are given for the reference figure standing 1.75 m and scaled by `k` (height / 1.75).
"""
from __future__ import annotations

import bmesh
import bpy
import numpy as np

import common as C
from common import log


# ════════════════════════════════════════════════════════════ cloth sheets


def open_sheet(name, f, keep, *, faces, voxel, lo, hi, snap=None, symmetric=True):
    """A garment as one sheet of cloth: the surface of `f`, less the faces whose centre fails
    `keep` (the hem, the cuffs and the neckline are cut open). `snap(P, boundary)` straightens
    the cut edges."""
    ob = C.sdf_mesh(name, f, voxel=voxel, faces=faces, symmetric=symmetric, relax_iters=2, lo=lo, hi=hi)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    centres = np.array([fc.calc_center_median()[:] for fc in bm.faces], np.float32)
    ok = keep(centres)
    bmesh.ops.delete(bm, geom=[fc for fc, k in zip(bm.faces, ok) if not k], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    # The largest connected piece only (no stray islands near a cut).
    bm.verts.ensure_lookup_table()
    seen, best = set(), []
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
        if len(comp) > len(best):
            best = comp
    keep_set = {v.index for v in best}
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.index not in keep_set], context='VERTS')
    bm.verts.ensure_lookup_table()
    V = np.array([v.co[:] for v in bm.verts], np.float32)
    boundary = np.array([v.is_boundary for v in bm.verts])
    F = [[v.index for v in fc.verts] for fc in bm.faces]
    bm.free()
    if snap is not None:
        V = snap(V, boundary)
    old = ob.data
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(old)
    me = bpy.data.meshes.new(name)
    me.from_pydata(V.tolist(), [], F)
    me.validate()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.shade_smooth()
    log(f'{name}: open sheet, {len(me.vertices)} verts, {int(boundary.sum())} on the edges')
    return ob


def snap_plane_z(z, tol):
    """Straighten a horizontal cut (a hem) at height z."""
    def snap(V, boundary):
        V = V.copy()
        m = boundary & (np.abs(V[:, 2] - z) < tol)
        V[m, 2] = z
        return V
    return snap


def chain(*snaps):
    def snap(V, boundary):
        for s in snaps:
            V = s(V, boundary)
        return V
    return snap


def along_arm(J, P):
    """Distance of each point along the arm on its side, from the shoulder joint (A-pose)."""
    out = np.zeros(len(P))
    for side, sx in (('Left', 1), ('Right', -1)):
        sh = np.array(J[f'{side}Arm'])
        wr = np.array(J[f'{side}Hand'])
        d = (wr - sh) / np.linalg.norm(wr - sh)
        m = np.sign(P[:, 0]) == sx
        out[m] = (P[m] - sh) @ d
    return out


def cuff_length(J):
    sh, wr = np.array(J['LeftArm']), np.array(J['LeftHand'])
    return float(np.linalg.norm(wr - sh))


def snap_cuffs(J, length, tol):
    """Straighten the cuffs: each cut vertex onto the plane across the arm at `length`."""
    def snap(V, boundary):
        V = V.copy()
        t = along_arm(J, V)
        m = boundary & (np.abs(t - length) < tol) & (np.abs(V[:, 0]) > 0.25)
        for side, sx in (('Left', 1), ('Right', -1)):
            sh = np.array(J[f'{side}Arm'])
            wr = np.array(J[f'{side}Hand'])
            d = (wr - sh) / np.linalg.norm(wr - sh)
            mm = m & (np.sign(V[:, 0]) == sx)
            V[mm] += np.outer(length - t[mm], d)
        return V
    return snap


# ════════════════════════════════════════════════════════════ weights


def robe_weights(ob, body, J, *, skirt_from):
    """Skin weights from the body underneath. Below `skirt_from` (the crotch) the skirt follows the
    thighs and the pelvis only: shins would fold it inside out when kneeling, and the cloth bake
    needs a skinning it can invert (drape.py). The cloth does the rest."""
    from figure import transfer_weights

    transfer_weights(ob, [body], k=6)
    P = C.get_verts(ob)
    names = [g.name for g in ob.vertex_groups]
    n = len(P)
    W = {g: np.zeros(n) for g in names}
    for v in ob.data.vertices:
        for g in v.groups:
            W[ob.vertex_groups[g.group].name][v.index] = g.weight
    for side in ('Left', 'Right'):
        for b in (f'{side}Leg', f'{side}Foot', f'{side}ToeBase'):
            if b in W:
                W.setdefault(f'{side}UpLeg', np.zeros(n))
                W[f'{side}UpLeg'] += W.pop(b)
    below = C.smoothstep(skirt_from + 0.03, skirt_from - 0.2, P[:, 2])
    W.setdefault('Hips', np.zeros(n))
    for side in ('Left', 'Right'):
        b = f'{side}UpLeg'
        if b in W:
            moved = W[b] * below * 0.4
            W[b] -= moved
            W['Hips'] += moved
    names, M = C.normalize_weights(W, n)
    ob.vertex_groups.clear()
    C.apply_weights(ob, names, M)


def cape_weights(P, J, z_neck, z_chin):
    """A khimar: the hood is the head's, the cape the upper body's (never the arms': they move
    under it and the cloth drapes it over them)."""
    h = C.smoothstep(z_neck, z_chin, P[:, 2])
    s1 = J['Spine1'][2]
    low = C.smoothstep(s1 + 0.06, s1 - 0.14, P[:, 2])
    return {'Head': h, 'Spine2': (1 - h) * (1 - 0.4 * low), 'Spine1': (1 - h) * 0.4 * low}


def pin_group(ob, w, name='pin'):
    """How firmly each vertex is held to its skinned place in the cloth bake (1 = exactly)."""
    g = ob.vertex_groups.get(name) or ob.vertex_groups.new(name=name)
    for i, x in enumerate(np.clip(w, 0, 1)):
        if x > 0.001:
            g.add([i], float(x), 'REPLACE')
    return g


def finish_cloth(ob, mat, pin):
    C.assign(ob, mat)
    pin_group(ob, pin(C.get_verts(ob)))
    C.set_vertex_colors(ob, np.ones((len(ob.data.vertices), 4)))
    return ob
