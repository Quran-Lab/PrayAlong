"""
Shared toolkit for PrayAlong's companion characters.

Characters are modelled as signed distance fields (soft primitives blended
with smooth unions), polygonized with marching cubes, retopologised with
QuadriFlow, snapped back onto the exact surface and given analytic normals,
so every form is perfectly smooth with a modest triangle count. Face lines
(closed eyes, brows, mouth) are tapered curve strokes laid on the face.

The skeleton uses Mixamo bone names in a T-pose. Skin weights are computed
from a body-wide weight *field* (so garments get the same weights as the body
underneath and move with it), with joint blends biased towards the outside
of each bend so knees, elbows and hips stay round when folded.

Requirements (build machine only):  pip install bpy==5.0.1 scikit-image
Run a character script with plain Python, e.g.  python3 tools/characters/build_yusuf.py

Blender space: Z up, the character faces -Y, its left is +X.
glTF export converts this to Y up, facing +Z, left = +X.
"""
from __future__ import annotations

import math
import os
import time
from dataclasses import dataclass, field

import numpy as np

F32 = np.float32


def _v(a):
    return np.asarray(a, dtype=F32)


def log(*a):
    print('[char]', *a, flush=True)


# ════════════════════════════════════════════════════════════════════ SDF


def rot(x=0.0, y=0.0, z=0.0):
    """Rotation matrix (local → world) from XYZ Euler degrees."""
    x, y, z = (math.radians(a) for a in (x, y, z))
    cx, sx, cy, sy, cz, sz = math.cos(x), math.sin(x), math.cos(y), math.sin(y), math.cos(z), math.sin(z)
    rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return (rz @ ry @ rx).astype(F32)


def _local(P, c, R):
    q = P - c
    return q @ R if R is not None else q


def sphere(c, r):
    c = _v(c)
    return lambda P: np.sqrt(((P - c) ** 2).sum(1)) - F32(r)


def ellipsoid(c, r, R=None):
    """Approximate (iq) ellipsoid distance; exact on the surface."""
    c, r = _v(c), _v(r)
    R = None if R is None else _v(R)
    r2 = r * r

    def f(P):
        q = _local(P, c, R)
        k0 = np.sqrt(((q / r) ** 2).sum(1))
        k1 = np.sqrt(((q / r2) ** 2).sum(1))
        return k0 * (k0 - 1) / np.maximum(k1, F32(1e-9))

    return f


def round_cone(a, b, ra, rb):
    """Exact distance to a cone between spheres (a, ra) and (b, rb)."""
    a, b = _v(a), _v(b)
    ba = b - a
    l2 = F32(ba @ ba)
    rr = F32(ra - rb)
    a2 = l2 - rr * rr
    il2 = F32(1.0) / l2
    ra, rb = F32(ra), F32(rb)

    def f(P):
        pa = P - a
        y = pa @ ba
        z = y - l2
        xv = pa * l2 - np.outer(y, ba)
        x2 = (xv * xv).sum(1)
        y2 = y * y * l2
        z2 = z * z * l2
        k = np.sign(rr) * rr * rr * x2
        d1 = np.sqrt(x2 + z2) * il2 - rb
        d2 = np.sqrt(x2 + y2) * il2 - ra
        d3 = (np.sqrt(np.maximum(x2 * a2 * il2, 0)) + y * rr) * il2 - ra
        return np.where(np.sign(z) * a2 * z2 > k, d1, np.where(np.sign(y) * a2 * y2 < k, d2, d3)).astype(F32)

    return f


def capsule(a, b, r):
    a, b = _v(a), _v(b)
    ba = b - a
    l2 = F32(ba @ ba)

    def f(P):
        pa = P - a
        h = np.clip((pa @ ba) / l2, 0, 1)
        return np.sqrt(((pa - np.outer(h, ba)) ** 2).sum(1)) - F32(r)

    return f


def tube(points, radii, k=0.0):
    """Union of round cones along a polyline with per-point radii."""
    pts = [_v(p) for p in points]
    parts = [round_cone(pts[i], pts[i + 1], radii[i], radii[i + 1]) for i in range(len(pts) - 1)]
    return union(*parts, k=k)


def box(c, half, r=0.0, R=None):
    """Rounded box: half extents include the rounding radius."""
    c, half = _v(c), _v(half) - F32(r)
    R = None if R is None else _v(R)

    def f(P):
        q = np.abs(_local(P, c, R)) - half
        outside = np.sqrt((np.maximum(q, 0) ** 2).sum(1))
        inside = np.minimum(q.max(1), 0)
        return outside + inside - F32(r)

    return f


def torus(c, R_major, r_minor, R=None):
    """Torus around the local Z axis."""
    c = _v(c)
    Rm = None if R is None else _v(R)

    def f(P):
        q = _local(P, c, Rm)
        xy = np.sqrt(q[:, 0] ** 2 + q[:, 1] ** 2) - F32(R_major)
        return np.sqrt(xy * xy + q[:, 2] ** 2) - F32(r_minor)

    return f


def elliptic_frustum(z0, z1, c0, c1, r0, r1, cap=0.0):
    """Vertical elliptic cylinder whose centre (x, y) and radii (rx, ry) vary
    linearly from z0 to z1. Approximate distance (fine for blending)."""
    c0, c1, r0, r1 = _v(c0), _v(c1), _v(r0), _v(r1)
    z0, z1 = F32(z0), F32(z1)

    def f(P):
        t = np.clip((P[:, 2] - z0) / (z1 - z0), 0, 1)[:, None]
        c = c0 + (c1 - c0) * t
        r = r0 + (r1 - r0) * t
        q = (P[:, :2] - c) / r
        k0 = np.sqrt((q ** 2).sum(1))
        side = (k0 - 1) * r.min(1)
        zc = np.maximum(z0 - P[:, 2], P[:, 2] - z1)
        return smax(side, zc, F32(cap))

    return f


def plane(n, p):
    """Half-space behind a plane: negative where (x - p)·n < 0."""
    n = _v(n) / np.linalg.norm(n)
    p = _v(p)
    return lambda P: (P - p) @ n


def bounded(f, lo, hi, pad):
    """Evaluate f only inside a box; outside, return the distance to the box
    plus pad (still a lower bound when the shape is at least pad inside the
    box), which is all a union needs far from the shape. pad must be at
    least the smoothing radius of any union the shape takes part in."""
    lo, hi = _v(lo) + F32(pad * 0), _v(hi)

    def g(P):
        q = np.maximum(np.maximum(lo - P, P - hi), 0)
        d = np.sqrt((q * q).sum(1))
        inside = d <= 0
        out = (d + F32(pad)).astype(F32)
        if inside.any():
            out[inside] = f(P[inside])
        return out

    return g


def catmull(points, n):
    """n samples along a centripetal-ish Catmull-Rom spline through points."""
    P = np.asarray(points, float)
    P = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
    segs = len(P) - 3
    out = []
    for i in range(n):
        t = i / (n - 1) * segs
        s = min(int(t), segs - 1)
        u = t - s
        p0, p1, p2, p3 = P[s], P[s + 1], P[s + 2], P[s + 3]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3))
    return np.array(out)


def interp(values, n):
    v = np.asarray(values, float)
    return np.interp(np.linspace(0, len(v) - 1, n), np.arange(len(v)), v)


def lock(ref_c, ref_r, waypoints, width, thick, lift=0.0, samples=12, k=0.006, overlap=1.25, pad=0.02):
    """A flattened lock of hair (or fold of cloth) lying on an ellipsoid.

    waypoints are rough 3D points, projected radially onto the ellipsoid
    (ref_c, ref_r); width/thick/lift are half-width, half-thickness and the
    height above the surface, per waypoint (or scalars).
    """
    c, r = np.asarray(ref_c, float), np.asarray(ref_r, float)
    W = np.asarray(waypoints, float)
    q = (W - c) / r
    W = c + (W - c) / np.linalg.norm(q, axis=1, keepdims=True)
    path = catmull(W, samples)
    q = (path - c) / r
    path = c + (path - c) / np.linalg.norm(q, axis=1, keepdims=True)
    nrm = (path - c) / (r * r)
    nrm /= np.linalg.norm(nrm, axis=1, keepdims=True)
    nw = len(W)
    as_list = lambda x: x if np.ndim(x) else [x] * nw  # noqa: E731
    wd, th, lf = interp(as_list(width), samples), interp(as_list(thick), samples), interp(as_list(lift), samples)
    parts = []
    lo, hi = np.full(3, 1e9), np.full(3, -1e9)
    for i in range(samples):
        a = path[max(i - 1, 0)]
        b = path[min(i + 1, samples - 1)]
        t = b - a
        t -= nrm[i] * (t @ nrm[i])
        seg = np.linalg.norm(t) / (2 if 0 < i < samples - 1 else 1)
        t /= max(np.linalg.norm(t), 1e-9)
        bn = np.cross(nrm[i], t)
        R = np.stack([t, bn, nrm[i]], axis=1)
        centre = path[i] + nrm[i] * (lf[i] + th[i] * 0.5)
        radii = (max(seg * overlap, th[i]), wd[i], th[i])
        parts.append(ellipsoid(centre, radii, R=R))
        ext = max(radii) + k + pad
        lo, hi = np.minimum(lo, centre - ext), np.maximum(hi, centre + ext)
    return bounded(union(*parts, k=k), lo, hi, pad)


def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    k = F32(k)
    h = np.maximum(k - np.abs(a - b), 0) / k
    return np.minimum(a, b) - h * h * k * F32(0.25)


def smax(a, b, k):
    return -smin(-a, -b, k)


def union(*fs, k=0.0):
    def f(P):
        d = fs[0](P)
        for g in fs[1:]:
            d = smin(d, g(P), k)
        return d

    return f


def subtract(f, *gs, k=0.0):
    def h(P):
        d = f(P)
        for g in gs:
            d = smax(d, -g(P), k)
        return d

    return h


def intersect(f, *gs, k=0.0):
    def h(P):
        d = f(P)
        for g in gs:
            d = smax(d, g(P), k)
        return d

    return h


def offset(f, d):
    return lambda P: f(P) - F32(d)


def mirror_x(f):
    """Make a left-side shape symmetric (evaluates f at |x|)."""

    def g(P):
        Q = P.copy()
        Q[:, 0] = np.abs(Q[:, 0])
        return f(Q)

    return g


def flip_x(f):
    def g(P):
        Q = P.copy()
        Q[:, 0] = -Q[:, 0]
        return f(Q)

    return g


def xform(f, t=(0, 0, 0), s=1.0):
    """Translate and uniformly scale a shape: f'(p) = s·f((p - t)/s)."""
    t = _v(t)
    s = F32(s)
    if s == 1:
        return lambda P: f(P - t)
    return lambda P: f((P - t) / s) * s


def displace(f, fn):
    return lambda P: f(P) + fn(P).astype(F32)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# ════════════════════════════════════════════════════════════ polygonize


def evaluate_grid(f, lo, hi, voxel, chunk=1_500_000):
    lo, hi = np.asarray(lo, float), np.asarray(hi, float)
    n = np.maximum(np.ceil((hi - lo) / voxel).astype(int) + 1, 2)
    xs = lo[0] + np.arange(n[0]) * voxel
    ys = lo[1] + np.arange(n[1]) * voxel
    zs = lo[2] + np.arange(n[2]) * voxel
    vol = np.empty((n[0], n[1], n[2]), dtype=F32)
    per_x = max(1, chunk // (n[1] * n[2]))
    Y, Z = np.meshgrid(ys, zs, indexing='ij')
    for i in range(0, n[0], per_x):
        xi = xs[i : i + per_x]
        X = np.repeat(xi, n[1] * n[2])
        P = np.stack([X, np.tile(Y.ravel(), len(xi)), np.tile(Z.ravel(), len(xi))], 1).astype(F32)
        vol[i : i + len(xi)] = f(P).reshape(len(xi), n[1], n[2])
    return vol, lo


def find_bounds(f, lo=(-0.6, -0.4, -0.05), hi=(0.6, 0.4, 1.15), voxel=0.008, pad=0.012):
    vol, o = evaluate_grid(f, lo, hi, voxel)
    idx = np.argwhere(vol < voxel)
    if not len(idx):
        raise ValueError('empty SDF')
    a = o + idx.min(0) * voxel - pad
    b = o + idx.max(0) * voxel + pad
    return a, b


def marching(f, voxel, lo=None, hi=None):
    from skimage.measure import marching_cubes

    if lo is None:
        lo, hi = find_bounds(f)
    vol, o = evaluate_grid(f, lo, hi, voxel)
    # Close the surface at the grid boundary.
    vol[0, :, :] = vol[-1, :, :] = vol[:, 0, :] = vol[:, -1, :] = vol[:, :, 0] = vol[:, :, -1] = voxel
    verts, faces, _, _ = marching_cubes(vol, level=0.0, spacing=(voxel, voxel, voxel), gradient_direction='ascent')
    return (verts + o).astype(F32), faces.astype(np.int32)


def gradient(f, P, eps=4e-4):
    e = F32(eps)
    g = np.empty_like(P)
    for i in range(3):
        d = np.zeros(3, F32)
        d[i] = e
        g[:, i] = (f(P + d) - f(P - d)) / (2 * e)
    return g


def project(f, P, iters=4):
    """Snap points onto the zero level set (Newton steps along the gradient)."""
    P = P.astype(F32).copy()
    for _ in range(iters):
        d = f(P)
        g = gradient(f, P)
        gg = np.maximum((g * g).sum(1), F32(1e-8))
        P -= (d / gg)[:, None] * g
    return P


# ════════════════════════════════════════════════════════════ Blender side

import bpy  # noqa: E402
import bmesh  # noqa: E402


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mesh_object(name, verts, faces):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts.tolist(), [], faces.tolist())
    me.validate()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def _ctx(ob):
    return bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob], selected_editable_objects=[ob])


def quadriflow(ob, faces, symmetric=False, seed=0):
    # QuadriFlow rejects edges shorter than 1e-4 units, so work at 100x.
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=2e-6)
    bmesh.ops.scale(bm, vec=(100, 100, 100), verts=bm.verts)
    bm.to_mesh(ob.data)
    bm.free()
    with _ctx(ob):
        r = bpy.ops.object.quadriflow_remesh(
            target_faces=int(faces),
            use_mesh_symmetry=symmetric,
            use_preserve_sharp=False,
            use_preserve_boundary=False,
            smooth_normals=False,
            mode='FACES',
            seed=seed,
        )
    set_verts(ob, get_verts(ob) / F32(100))
    return r


def get_verts(ob):
    co = np.empty(len(ob.data.vertices) * 3, F32)
    ob.data.vertices.foreach_get('co', co)
    return co.reshape(-1, 3)


def set_verts(ob, P):
    ob.data.vertices.foreach_set('co', P.astype(F32).ravel())
    ob.data.update()


def set_sdf_normals(ob, f):
    P = get_verts(ob)
    g = gradient(f, P)
    g /= np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-8)
    me = ob.data
    me.shade_smooth()
    me.normals_split_custom_set_from_vertices(g.tolist())


def relax(ob, f, iters=2, factor=0.5):
    """Laplacian relax in the surface then re-project (evens out spacing)."""
    me = ob.data
    n = len(me.vertices)
    ed = np.empty(len(me.edges) * 2, np.int32)
    me.edges.foreach_get('vertices', ed)
    ed = ed.reshape(-1, 2)
    P = get_verts(ob)
    deg = np.bincount(ed.ravel(), minlength=n).astype(F32)
    for _ in range(iters):
        acc = np.zeros_like(P)
        np.add.at(acc, ed[:, 0], P[ed[:, 1]])
        np.add.at(acc, ed[:, 1], P[ed[:, 0]])
        avg = acc / np.maximum(deg, 1)[:, None]
        P = P + (avg - P) * F32(factor)
        P = project(f, P, iters=3)
    set_verts(ob, P)


def triangulated_count(ob):
    me = ob.data
    return sum(len(p.vertices) - 2 for p in me.polygons)


def recalc_outward(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()


def sdf_mesh(name, f, voxel=0.002, faces=3000, symmetric=False, relax_iters=2, lo=None, hi=None, remesh=True):
    """SDF → marching cubes → QuadriFlow → snapped, smooth-normal mesh object."""
    t = time.time()
    if lo is None:
        lo, hi = find_bounds(f)
    V, Fc = marching(f, voxel, lo, hi)
    ob = mesh_object(name, V, Fc)
    if remesh:
        r = quadriflow(ob, faces, symmetric=symmetric)
        if 'FINISHED' not in r or len(ob.data.polygons) < 10:
            log('QuadriFlow failed for', name, '- decimating instead')
            dec = ob.modifiers.new('dec', 'DECIMATE')
            dec.ratio = min(1.0, faces * 2 / max(1, len(ob.data.polygons)))
            with _ctx(ob):
                bpy.ops.object.modifier_apply(modifier='dec')
    else:
        dec = ob.modifiers.new('dec', 'DECIMATE')
        dec.ratio = min(1.0, faces * 2 / max(1, len(ob.data.polygons)))
        with _ctx(ob):
            bpy.ops.object.modifier_apply(modifier='dec')
    set_verts(ob, project(f, get_verts(ob)))
    if relax_iters:
        relax(ob, f, iters=relax_iters)
    recalc_outward(ob)
    set_sdf_normals(ob, f)
    log(f'{name}: {len(ob.data.vertices)} verts, {triangulated_count(ob)} tris ({time.time() - t:.1f}s)')
    return ob


def mirror_object(ob, name):
    """Duplicate a mesh mirrored across X (normals and winding fixed)."""
    me = ob.data.copy()
    me.name = name
    new = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(new)
    P = get_verts(new)
    P[:, 0] *= -1
    set_verts(new, P)
    # Flip winding.
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    # Mirror the custom normals.
    if ob.data.has_custom_normals:
        n = np.empty(len(ob.data.loops) * 3, F32)
        ob.data.corner_normals.foreach_get('vector', n)
        # Per-vertex: average loops.
        loops_v = np.empty(len(ob.data.loops), np.int32)
        ob.data.loops.foreach_get('vertex_index', loops_v)
        vn = np.zeros((len(ob.data.vertices), 3), F32)
        np.add.at(vn, loops_v, n.reshape(-1, 3))
        vn /= np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), 1e-8)
        vn[:, 0] *= -1
        me.shade_smooth()
        me.normals_split_custom_set_from_vertices(vn.tolist())
    return new


# ───────────────────────────────────────────────────────────── strokes


def surface_points(f, xz, y_from=-0.4, along=(0, 1, 0), steps=200):
    """Ray-cast points (x, z) along +Y onto the surface of f (front faces)."""
    pts = []
    d = np.asarray(along, F32)
    for x, z in xz:
        p = np.array([x, y_from, z], F32)
        for _ in range(steps):
            dist = float(f(p[None])[0])
            if dist < 1e-5:
                break
            p = p + d * F32(max(dist * 0.9, 1e-5))
        pts.append(p)
    return np.array(pts, F32)


def raycast(f, origins, direction, steps=300, max_dist=1.0):
    """Sphere-trace rays from origins along a direction onto the surface of f."""
    d = np.asarray(direction, F32)
    d = d / np.linalg.norm(d)
    P = np.asarray(origins, F32).copy()
    travelled = np.zeros(len(P), F32)
    for _ in range(steps):
        dist = f(P)
        active = (dist > 1e-5) & (travelled < max_dist)
        if not active.any():
            break
        step = np.where(active, np.maximum(dist * F32(0.9), F32(1e-5)), 0)
        P += step[:, None] * d
        travelled += step
    return P


def groove(f, xy, depth=0.003, radius=0.005, z_from=1.3, taper=True):
    """A tube lying in the top surface of f, for carving (smooth subtract).
    xy: points in plan view; the tube is dropped onto the surface along -Z."""
    origins = [(x, y, z_from) for x, y in xy]
    pts = raycast(f, origins, (0, 0, -1))
    n = gradient(f, pts)
    n /= np.linalg.norm(n, axis=1, keepdims=True)
    k = len(pts)
    rs = [radius * (0.45 + 0.55 * math.sin(math.pi * i / (k - 1))) if taper else radius for i in range(k)]
    centres = pts + n * (np.asarray(rs, F32) - depth)[:, None]
    return tube([tuple(c) for c in centres], rs)


def stroke(name, f_surface, xz, radii, sink=0.35, flatten=1.0, resolution=4, bevel_res=2):
    """A tapered tube lying on a surface: lash lines, brows, mouths.

    xz: front-view control points; radii: per-point tube radius.
    sink: how much of the radius sits below the surface.
    flatten: scale of the tube normal to the surface (<1 = flatter ribbon).
    """
    pts = surface_points(f_surface, xz)
    nrm = gradient(f_surface, pts)
    nrm /= np.linalg.norm(nrm, axis=1, keepdims=True)
    radii = np.asarray(radii, F32)
    pts = pts - nrm * (radii * sink)[:, None]
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = 1.0
    cu.bevel_resolution = bevel_res
    cu.resolution_u = resolution
    cu.use_fill_caps = True
    sp = cu.splines.new('NURBS')
    sp.points.add(len(pts) - 1)
    for i, (p, r) in enumerate(zip(pts, radii)):
        sp.points[i].co = (float(p[0]), float(p[1]), float(p[2]), 1.0)
        sp.points[i].radius = float(r)
    sp.use_endpoint_u = True
    sp.order_u = min(4, len(pts))
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    # Convert to mesh.
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    mob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(mob)
    me.shade_smooth()
    return mob


# ════════════════════════════════════════════════════════════ materials


def srgb(h):
    """'#rrggbb' or (r, g, b) in sRGB 0-1 → linear RGBA."""
    if isinstance(h, str):
        h = h.lstrip('#')
        c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    else:
        c = list(h)
    lin = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return (*lin, 1.0)


def material(name, color, roughness=0.7, sheen=0.0, sheen_tint=None, vertex_color=False, specular=0.4, coat=0.0, glow=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = srgb(color)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Specular IOR Level'].default_value = specular
    if sheen:
        bsdf.inputs['Sheen Weight'].default_value = sheen
        bsdf.inputs['Sheen Roughness'].default_value = 0.6
        bsdf.inputs['Sheen Tint'].default_value = srgb(sheen_tint or '#ffffff')
    if coat:
        bsdf.inputs['Coat Weight'].default_value = coat
        bsdf.inputs['Coat Roughness'].default_value = 0.35
    if glow:
        # A faint self-lit lift (soft "subsurface" feel) so skin never goes muddy in shade.
        bsdf.inputs['Emission Color'].default_value = srgb(color)
        bsdf.inputs['Emission Strength'].default_value = glow
    if vertex_color:
        ca = nt.nodes.new('ShaderNodeVertexColor')
        ca.layer_name = 'Col'
        nt.links.new(ca.outputs['Color'], bsdf.inputs['Base Color'])
    m.diffuse_color = srgb(color)
    return m


def assign(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)


# ════════════════════════════════════════════════════════════ rig


MIXAMO_PARENT = {
    'Hips': None,
    'Spine': 'Hips',
    'Spine1': 'Spine',
    'Spine2': 'Spine1',
    'Neck': 'Spine2',
    'Head': 'Neck',
    'LeftShoulder': 'Spine2',
    'LeftArm': 'LeftShoulder',
    'LeftForeArm': 'LeftArm',
    'LeftHand': 'LeftForeArm',
    'LeftHandIndex1': 'LeftHand',
    'LeftHandMiddle1': 'LeftHand',
    'LeftHandPinky1': 'LeftHand',
    'RightShoulder': 'Spine2',
    'RightArm': 'RightShoulder',
    'RightForeArm': 'RightArm',
    'RightHand': 'RightForeArm',
    'RightHandIndex1': 'RightHand',
    'RightHandMiddle1': 'RightHand',
    'RightHandPinky1': 'RightHand',
    'LeftUpLeg': 'Hips',
    'LeftLeg': 'LeftUpLeg',
    'LeftFoot': 'LeftLeg',
    'LeftToeBase': 'LeftFoot',
    'RightUpLeg': 'Hips',
    'RightLeg': 'RightUpLeg',
    'RightFoot': 'RightLeg',
    'RightToeBase': 'RightFoot',
}

CONNECTED = {'Spine1', 'Spine2', 'Neck', 'Head', 'LeftForeArm', 'LeftHand', 'RightForeArm', 'RightHand',
             'LeftLeg', 'LeftFoot', 'LeftToeBase', 'RightLeg', 'RightFoot', 'RightToeBase', 'LeftArm', 'RightArm'}


@dataclass
class Skeleton:
    """Joint positions (left side; the right side is mirrored)."""

    hips: tuple
    spine: tuple
    spine1: tuple
    spine2: tuple
    neck: tuple
    head: tuple
    head_top: tuple
    clavicle: tuple  # LeftShoulder head
    shoulder: tuple  # LeftArm head
    elbow: tuple
    wrist: tuple
    hand_tip: tuple
    index: tuple
    middle: tuple
    pinky: tuple
    hip: tuple  # LeftUpLeg head
    knee: tuple
    ankle: tuple
    toe: tuple  # LeftToeBase head
    toe_tip: tuple
    extra: dict = field(default_factory=dict)

    def bones(self):
        """name → (head, tail) for the full Mixamo skeleton."""
        m = lambda p: (-p[0], p[1], p[2])  # noqa: E731
        b = {
            'Hips': (self.hips, self.spine),
            'Spine': (self.spine, self.spine1),
            'Spine1': (self.spine1, self.spine2),
            'Spine2': (self.spine2, self.neck),
            'Neck': (self.neck, self.head),
            'Head': (self.head, self.head_top),
        }
        fin = lambda p: (p, (p[0] + 0.025, p[1], p[2]))  # noqa: E731
        left = {
            'Shoulder': (self.clavicle, self.shoulder),
            'Arm': (self.shoulder, self.elbow),
            'ForeArm': (self.elbow, self.wrist),
            'Hand': (self.wrist, self.hand_tip),
            'HandIndex1': fin(self.index),
            'HandMiddle1': fin(self.middle),
            'HandPinky1': fin(self.pinky),
            'UpLeg': (self.hip, self.knee),
            'Leg': (self.knee, self.ankle),
            'Foot': (self.ankle, self.toe),
            'ToeBase': (self.toe, self.toe_tip),
        }
        for k, (h, t) in left.items():
            b['Left' + k] = (h, t)
            b['Right' + k] = (m(h), m(t))
        return b


def build_armature(skel: Skeleton, name='Armature'):
    arm = bpy.data.armatures.new(name)
    ob = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    with _ctx(ob):
        bpy.ops.object.mode_set(mode='EDIT')
    bones = skel.bones()
    eb = {}
    for n in MIXAMO_PARENT:
        h, t = bones[n]
        e = arm.edit_bones.new(n)
        e.head = h
        e.tail = t
        eb[n] = e
    for n, p in MIXAMO_PARENT.items():
        if p:
            eb[n].parent = eb[p]
            eb[n].use_connect = False
    # Sensible rolls: Z axis of limbs points back/up like Mixamo-ish rigs.
    for n, e in eb.items():
        d = (e.tail - e.head).normalized()
        if abs(d.z) > 0.7:
            e.align_roll((0, 1, 0) if 'Foot' not in n else (0, 0, 1))
        elif abs(d.x) > 0.7:
            e.align_roll((0, 1, 0))
        else:
            e.align_roll((0, 0, 1))
    with _ctx(ob):
        bpy.ops.object.mode_set(mode='OBJECT')
    return ob


# ───────────────────────────────────────────────────────────── weights


@dataclass
class Joint:
    """A blend boundary between a parent and a child bone.

    point: joint position; axis: direction from parent into child;
    width: half-width of the blend; outer: direction (perpendicular to the
    bone) of the outside of the bend; bias: how far the boundary is pushed
    into the child on the outer side (keeps that side round when folded).
    """

    point: tuple
    axis: tuple
    width: float
    outer: tuple = (0, 0, 0)
    bias: float = 0.0
    inner_bias: float = 0.0
    inner_width: float | None = None  # blend half-width on the inside of the bend

    def past(self, P):
        p = _v(self.point)
        ax = _v(self.axis) / np.linalg.norm(self.axis)
        d = (P - p) @ ax
        w = np.full(len(P), self.width, F32)
        if self.bias or self.inner_bias or self.inner_width is not None:
            o = _v(self.outer)
            o = o / max(np.linalg.norm(o), 1e-9)
            r = P - p
            r = r - np.outer(r @ ax, ax)
            rl = np.maximum(np.linalg.norm(r, axis=1), 1e-6)
            c = (r @ o) / rl  # cos of angle to the outer side
            shift = np.where(c > 0, self.bias * c, self.inner_bias * (-c))
            d = d - shift
            if self.inner_width is not None:
                w = w + (self.inner_width - self.width) * np.clip(-c, 0, 1)
        t = np.clip((d + w) / (2 * w), 0, 1)
        return t * t * (3 - 2 * t)


def chain_weights(P, bones, joints):
    """Partition of unity along a chain of bones separated by joints."""
    W = {}
    carry = np.ones(len(P), F32)
    for i, b in enumerate(bones):
        if i < len(joints):
            s = joints[i].past(P)
            W[b] = W.get(b, 0) + carry * (1 - s)
            carry = carry * s
        else:
            W[b] = W.get(b, 0) + carry
    return W


def add_into(acc, W, scale):
    for b, w in W.items():
        acc[b] = acc.get(b, 0) + w * scale
    return acc


def mirror_bone(name):
    if name.startswith('Left'):
        return 'Right' + name[4:]
    if name.startswith('Right'):
        return 'Left' + name[5:]
    return name


def sided(P, fn, blend=0.012):
    """Evaluate a left-side weight function on both sides (mirrored) and blend
    across the midline."""
    left = smoothstep(-blend, blend, P[:, 0])
    Q = P.copy()
    Q[:, 0] = np.abs(Q[:, 0])
    W = fn(Q)
    out = {}
    for b, w in W.items():
        out[b] = out.get(b, 0) + w * left
        mb = mirror_bone(b)
        out[mb] = out.get(mb, 0) + w * (1 - left)
    return out


def normalize_weights(W, n, max_influences=4, min_weight=0.01):
    names = list(W.keys())
    M = np.zeros((n, len(names)), F32)
    for i, b in enumerate(names):
        w = W[b]
        M[:, i] = w if np.ndim(w) else np.full(n, w, F32)
    M[M < min_weight] = 0
    if M.shape[1] > max_influences:
        idx = np.argsort(-M, axis=1)[:, max_influences:]
        np.put_along_axis(M, idx, 0, axis=1)
    s = M.sum(1, keepdims=True)
    M = M / np.maximum(s, 1e-8)
    return names, M


def apply_weights(ob, names, M):
    vgs = {}
    for i, b in enumerate(names):
        if not np.any(M[:, i] > 0):
            continue
        vg = ob.vertex_groups.get(b) or ob.vertex_groups.new(name=b)
        vgs[i] = vg
    for i, vg in vgs.items():
        col = M[:, i]
        nz = np.nonzero(col > 0)[0]
        # Group vertices by identical weight is overkill; add one by one.
        for vi in nz:
            vg.add([int(vi)], float(col[vi]), 'REPLACE')


def bind(mesh_ob, arm_ob):
    mesh_ob.parent = arm_ob
    mod = mesh_ob.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm_ob
    mod.use_vertex_groups = True


# ════════════════════════════════════════════════════════════ assembly


def join(objects, name):
    """Join meshes (keeping materials and custom normals)."""
    base = objects[0]
    with bpy.context.temp_override(active_object=base, object=base, selected_objects=objects, selected_editable_objects=objects):
        bpy.ops.object.join()
    base.name = name
    base.data.name = name
    return base


def set_vertex_colors(ob, colors):
    me = ob.data
    if 'Col' in me.color_attributes:
        me.color_attributes.remove(me.color_attributes['Col'])
    attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    attr.data.foreach_set('color', np.asarray(colors, F32).ravel())
    me.color_attributes.active_color = attr
    me.color_attributes.render_color_index = me.color_attributes.active_color_index


def export_glb(path, arm_ob, mesh_obs):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    arm_ob.select_set(True)
    for m in mesh_obs:
        m.select_set(True)
    bpy.context.view_layer.objects.active = arm_ob
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_skins=True,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_normals=True,
        export_texcoords=False,
        export_tangents=False,
        export_vertex_color='ACTIVE',
        export_all_influences=False,
        export_influence_nb=4,
        export_def_bones=False,
        export_morph=False,
        export_extras=False,
    )
    log('exported', path, f'{os.path.getsize(path) / 1024:.0f} KB')


# ════════════════════════════════════════════════════════════ preview


def preview_setup(world=(0.045, 0.06, 0.055), rim=(0.55, 1.0, 0.8)):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 48
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    sc.cycles.max_bounces = 6
    sc.view_settings.view_transform = 'Khronos PBR Neutral'
    sc.view_settings.look = 'None'
    if not sc.world:
        sc.world = bpy.data.worlds.new('World')
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (*world, 1)
    bg.inputs['Strength'].default_value = 1.0

    def area(name, loc, energy, size, color, target=(0, 0, 0.55)):
        L = bpy.data.lights.new(name, 'AREA')
        L.energy = energy
        L.size = size
        L.color = color
        o = bpy.data.objects.new(name, L)
        sc.collection.objects.link(o)
        o.location = loc
        d = np.array(target) - np.array(loc)
        import mathutils

        o.rotation_euler = mathutils.Vector(d).to_track_quat('-Z', 'Y').to_euler()
        return o

    area('Key', (-1.4, -2.0, 2.2), 260, 1.6, (1.0, 0.95, 0.88))
    area('Fill', (1.8, -1.6, 1.0), 90, 2.0, (0.92, 0.95, 1.0))
    area('Rim', (1.0, 2.0, 1.8), 220, 1.2, rim)
    area('Floor', (0, -1.0, -0.6), 25, 3, (1, 0.97, 0.92), target=(0, 0, 0.5))
    # Ground plane to catch a soft shadow.
    bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, 0))
    g = bpy.context.active_object
    g.name = 'Ground'
    gm = material('Ground', '#14201b', roughness=0.9)
    assign(g, gm)


def camera(name='Cam', loc=(0.0, -3.5, 0.6), target=(0, 0, 0.5), lens=85):
    import mathutils

    sc = bpy.context.scene
    cam = bpy.data.cameras.new(name)
    cam.lens = lens
    o = bpy.data.objects.new(name, cam)
    sc.collection.objects.link(o)
    o.location = loc
    d = mathutils.Vector(target) - mathutils.Vector(loc)
    o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    sc.camera = o
    return o


def render(path, res=(640, 800), samples=48):
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.cycles.samples = samples
    sc.render.filepath = path
    sc.render.image_settings.file_format = 'PNG'
    t = time.time()
    bpy.ops.render.render(write_still=True)
    log('rendered', path, f'{time.time() - t:.1f}s')


def orbit_camera(az_deg, el_deg, dist, target, lens=85):
    a, e = math.radians(az_deg), math.radians(el_deg)
    loc = (target[0] + dist * math.cos(e) * math.sin(a), target[1] - dist * math.cos(e) * math.cos(a), target[2] + dist * math.sin(e))
    return camera(loc=loc, target=target, lens=lens)
