"""
Brother: the reference figure (reference.py: "MUSLIM PRAYER ISLAM SALAH" by sameka, CC BY 4.0),
faceless with hamzah eyes, in a loose gamis above the ankles (a mandarin collar, a buttoned
placket, a chest pocket; no logo) over loose trousers that stop above the ankles, barefoot.

    python3 tools/characters/build_brother.py      # → public/avatars/brother.glb

The postures are poses.py's; the gamis is draped in each of them by a cloth simulation
(drape.py, ~15 min; CHAR_CACHE=<dir> keeps it between runs). DRAPE=0 skips it (a quick look).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import numpy as np  # noqa: E402

import common as C  # noqa: E402
import drape  # noqa: E402
import figure  # noqa: E402
import poses as P  # noqa: E402
import reference  # noqa: E402
from common import ellipsoid, log, loft, material, mirror_x, offset, sphere, subtract, intersect, box, tube, union  # noqa: E402,F401
from wardrobe import along_arm, chain, cuff_length, finish_cloth, open_sheet, robe_weights, snap_cuffs, snap_plane_z  # noqa: E402

NAME = 'brother'
OUT_GLB = os.environ.get('OUT') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'public', 'avatars', f'{NAME}.glb')

HEM_Z = 0.19  # above the ankles
NECK_C = (0.048, 0.071, 0.098)  # the neck where the collar stands: centre y, half-width, half-depth
BOUNDS = (-0.66, -0.2, 0.15), (0.66, 0.34, 1.56)


def gamis_sdf(J):
    """A straight, loose gamis: 3–4 cm off the body everywhere, a little wider at the hem."""
    torso = loft([
        (HEM_Z - 0.012, 0, 0.09, 0.235, 0.19),
        (0.45, 0, 0.09, 0.226, 0.18),
        (0.80, 0, 0.09, 0.207, 0.165),
        (0.95, 0, 0.088, 0.197, 0.155),
        (1.08, 0, 0.085, 0.19, 0.147),
        (1.22, 0, 0.083, 0.192, 0.147),
        (1.33, 0, 0.085, 0.192, 0.142),
        (1.40, 0, 0.088, 0.174, 0.12),
        (1.445, 0, 0.075, 0.125, 0.115),
        (1.49, 0, 0.055, 0.1, 0.112),
        (1.515, 0, 0.048, 0.082, 0.105),
    ], cap=0.01)
    sh, el, wr = (np.array(J[f'Left{b}'], float) for b in ('Arm', 'ForeArm', 'Hand'))
    d = (wr - sh) / np.linalg.norm(wr - sh)
    sleeve = tube([(0.1, sh[1], 1.42), tuple(sh), tuple(el), tuple(wr + d * 0.02)], [0.08, 0.074, 0.062, 0.05])
    return union(torso, mirror_x(sleeve), k=0.04)


def gamis_keep(J):
    reach = cuff_length(J) + 0.004

    def keep(c):
        neck = (c[:, 2] > 1.5) & (((c[:, 0] / NECK_C[1]) ** 2 + ((c[:, 1] - NECK_C[0]) / NECK_C[2]) ** 2) < 1.0)
        cuffs = (np.abs(c[:, 0]) > 0.25) & (along_arm(J, c) > reach)
        return (c[:, 2] > HEM_Z) & ~cuffs & ~neck
    return keep


def gamis_pin(J):
    """Held at the shoulders and the neck; the chest and back hang from there, the skirt is free.
    The placket and the pocket stay where they are sewn."""
    def pin(Pv):
        z, x, y = Pv[:, 2], Pv[:, 0], Pv[:, 1]
        body = C.smoothstep(1.16, 1.40, z) * (np.abs(x) < 0.24)
        t = along_arm(J, Pv)
        arm = (np.abs(x) >= 0.24) * (0.85 - 0.5 * np.clip(t / cuff_length(J), 0, 1))
        placket = (np.abs(x) < 0.03) & (y < 0.0) & (z > 1.17)
        pocket = (x > 0.03) & (x < 0.11) & (y < 0.02) & (z > 1.24) & (z < 1.35)
        return np.maximum(np.maximum(body, arm), (placket | pocket).astype(float))
    return pin


def trim_sdf(gamis):
    """The mandarin collar, the placket with its buttons and the chest pocket, sewn on the gamis."""
    cy, rx, ry = NECK_C
    outer = loft([(1.496, 0, cy, rx + 0.008, ry + 0.008), (1.528, 0, cy, rx + 0.005, ry + 0.005)], cap=0.003)
    inner = loft([(1.48, 0, cy, rx + 0.002, ry + 0.002), (1.54, 0, cy, rx - 0.001, ry - 0.001)])
    collar = subtract(outer, inner, k=0.002)
    collar = subtract(collar, box((0, cy - ry - 0.01, 1.512), (0.005, 0.03, 0.03), r=0.002), k=0.002)
    shell = lambda f, lift: subtract(intersect(offset(gamis, lift), f, k=0.0015), offset(gamis, -0.0006), k=0.0008)  # noqa: E731
    placket = shell(box((0, -0.15, 1.33), (0.015, 0.12, 0.16), r=0.012), 0.0022)
    pocket = shell(box((0.068, -0.15, 1.29), (0.03, 0.12, 0.034), r=0.006), 0.0016)
    return union(collar, placket, pocket)


def buttons(gamis_ob):
    """Four buttons down the placket, on the gamis' surface."""
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    import bpy

    tree = BVHTree.FromObject(gamis_ob, bpy.context.evaluated_depsgraph_get(), deform=False)
    fs = []
    for z in (1.445, 1.395, 1.345, 1.295):
        hit, nrm, _, _ = tree.ray_cast(Vector((0, -0.4, z)), Vector((0, 1, 0)))
        c = np.array(hit + nrm * 0.0042)
        fs.append(ellipsoid(tuple(c), (0.0055, 0.0032, 0.0055)))
    return union(*fs)


def build():
    ref = reference.load(1.75)
    body, mats, J = figure.build_body(ref, name='Brother', feet='skin')
    rig = ref.arm
    thobe = material('Thobe', '#1c1c1f', roughness=0.8, sheen=0.12, sheen_tint='#5e6068')
    mats['pants'].name = 'Sirwal'

    shape = gamis_sdf(J)
    gamis = open_sheet('Gamis', shape, gamis_keep(J), faces=6000, voxel=0.004, lo=BOUNDS[0], hi=BOUNDS[1],
                       snap=chain(snap_plane_z(HEM_Z, 0.015), snap_cuffs(J, cuff_length(J) + 0.004, 0.02)))
    robe_weights(gamis, body, J, skirt_from=0.86)
    finish_cloth(gamis, thobe, gamis_pin(J))
    C.bind(gamis, rig)

    trim = C.sdf_mesh('Trim', trim_sdf(shape), voxel=0.0012, faces=1600, symmetric=False, relax_iters=0,
                      lo=(-0.12, -0.12, 1.12), hi=(0.13, 0.17, 1.55))
    C.assign(trim, thobe)
    knobs = C.sdf_mesh('Buttons', buttons(gamis), voxel=0.0008, faces=240, remesh=False, relax_iters=0,
                       lo=(-0.02, -0.12, 1.27), hi=(0.02, -0.02, 1.47))
    C.assign(knobs, material('Buttons', '#0e0e10', roughness=0.35))
    trim = C.join([trim, knobs], 'Trim')
    figure.transfer_weights(trim, [gamis], k=3)
    C.bind(trim, rig)

    # The postures, the hands on the gamis (not on the body under it).
    poses = P.author_all(ref, body_points=C.get_verts(gamis), body=body)
    if os.environ.get('DRAPE', '1') != '0':
        drape.bake(NAME, rig, body, [dict(ob=gamis, bending=2.0, mass=0.3, self=True)], poses)
    figure.write_poses(rig, poses)
    meshes = [body, gamis, trim]
    tris = sum(C.triangulated_count(o) for o in meshes)
    log(f'Brother: {tris} triangles')
    figure.export(OUT_GLB, rig, meshes)
    return tris


if __name__ == '__main__':
    build()
