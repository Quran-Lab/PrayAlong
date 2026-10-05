"""
Sister: the reference figure (reference.py: "MUSLIM PRAYER ISLAM SALAH" by sameka, CC BY 4.0),
faceless with hamzah eyes, in a loose abaya to the floor and a khimar with a niqab (an opening at
the eyes only) that falls from the head over the shoulders, the chest and the arms to the
thighs; black socks. Nothing is tight: both garments hang from the shoulders and the head.

    python3 tools/characters/build_sister.py      # → public/avatars/sister.glb

The postures are poses.py's (al-Albani: a woman prays as a man does); abaya and khimar are draped
in each of them by a cloth simulation (drape.py, ~30 min; CHAR_CACHE=<dir> keeps it between
runs). DRAPE=0 skips it (a quick look).
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
from common import capsule, ellipsoid, log, loft, material, mirror_x, tube, union  # noqa: E402
from wardrobe import along_arm, cape_weights, chain, cuff_length, finish_cloth, open_sheet, robe_weights, snap_cuffs, snap_plane_z  # noqa: E402

NAME = 'sister'
OUT_GLB = os.environ.get('OUT') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'public', 'avatars', f'{NAME}.glb')

HEM_Z = 0.015  # the abaya: to the floor
NECK_C = (0.048, 0.071, 0.098)


# ───────────────────────────────────────────────────────────── abaya


def abaya_sdf(J):
    """Wide from the shoulders down, flaring to the floor; straight sleeves, loose at the wrist."""
    torso = loft([
        (HEM_Z - 0.012, 0, 0.09, 0.3, 0.25),
        (0.30, 0, 0.09, 0.27, 0.22),
        (0.60, 0, 0.09, 0.236, 0.19),
        (0.85, 0, 0.088, 0.208, 0.168),
        (1.00, 0, 0.086, 0.196, 0.154),
        (1.15, 0, 0.084, 0.193, 0.15),
        (1.28, 0, 0.083, 0.195, 0.148),
        (1.36, 0, 0.087, 0.19, 0.137),
        (1.41, 0, 0.09, 0.172, 0.12),
        (1.445, 0, 0.075, 0.125, 0.115),
        (1.49, 0, 0.055, 0.1, 0.112),
        (1.515, 0, 0.048, 0.082, 0.105),
    ], cap=0.01)
    sh, el, wr = (np.array(J[f'Left{b}'], float) for b in ('Arm', 'ForeArm', 'Hand'))
    d = (wr - sh) / np.linalg.norm(wr - sh)
    sleeve = tube([(0.1, sh[1], 1.42), tuple(sh), tuple(el), tuple(wr + d * 0.02)], [0.085, 0.078, 0.072, 0.07])
    return union(torso, mirror_x(sleeve), k=0.04)


def abaya_keep(J):
    reach = cuff_length(J) + 0.004

    def keep(c):
        neck = (c[:, 2] > 1.5) & (((c[:, 0] / NECK_C[1]) ** 2 + ((c[:, 1] - NECK_C[0]) / NECK_C[2]) ** 2) < 1.0)
        cuffs = (np.abs(c[:, 0]) > 0.25) & (along_arm(J, c) > reach)
        return (c[:, 2] > HEM_Z) & ~cuffs & ~neck
    return keep


def abaya_pin(J):
    def pin(Pv):
        z, x = Pv[:, 2], Pv[:, 0]
        body = C.smoothstep(1.18, 1.40, z) * (np.abs(x) < 0.24)
        arm = (np.abs(x) >= 0.24) * (0.8 - 0.5 * np.clip(along_arm(J, Pv) / cuff_length(J), 0, 1))
        return np.maximum(body, arm)
    return pin


# ───────────────────────────────────────────────────────────── khimar


def khimar_hem(x):
    """Mid-thigh at the front and the back, rising over the arms to the hips."""
    return 0.69 + 1.2 * x ** 2


def khimar_sdf():
    """A hood over the whole head and the face (the niqab), and a wide bell from it over the
    shoulders, the chest and the arms. Only the outside of this is the cloth."""
    m = 0.013
    cranium = ellipsoid((0, 0.006, 1.645), (0.088 + m, 0.097 + m, 0.107 + m))
    jaw = ellipsoid((0, 0.015, 1.56), (0.066 + m, 0.088 + m, 0.062 + m))
    neck = capsule((0, 0.065, 1.47), (0, 0.04, 1.56), 0.1)
    hood = union(union(cranium, jaw, k=0.03), neck, k=0.03)
    cape = loft([
        (0.62, 0, 0.09, 0.63, 0.34),
        (0.85, 0, 0.09, 0.63, 0.33),
        (1.02, 0, 0.09, 0.62, 0.31),
        (1.12, 0, 0.09, 0.575, 0.29),
        (1.23, 0, 0.09, 0.47, 0.26),
        (1.32, 0, 0.09, 0.4, 0.23),
        (1.39, 0, 0.09, 0.32, 0.19),
        (1.43, 0, 0.088, 0.26, 0.165),
        (1.46, 0, 0.083, 0.2, 0.14),
        (1.49, 0, 0.075, 0.12, 0.12),
    ], cap=0.004)
    return union(hood, cape, k=0.035)


def khimar_keep(eye_z):
    def keep(c):
        hem = c[:, 2] > khimar_hem(c[:, 0])
        # The niqab's opening: a narrow band at the eyes, on the front of the face only.
        eyes = (np.abs(c[:, 2] - eye_z) < 0.0095) & (np.abs(c[:, 0]) < 0.043) & (c[:, 1] < -0.03)
        return hem & ~eyes
    return keep


def snap_hem(V, boundary):
    V = V.copy()
    m = boundary & (V[:, 2] < 1.3)
    V[m, 2] = khimar_hem(V[m, 0])
    return V


# ───────────────────────────────────────────────────────────── build


def build():
    ref = reference.load(1.75)
    eye_z = float(np.mean([e[2] for e in ref.eyes])) if len(ref.eyes) else 1.618
    body, mats, J = figure.build_body(ref, name='Sister', feet='socks', hair=False, trousers='Pants')
    rig = ref.arm
    sheen = dict(roughness=0.84, sheen=0.12, sheen_tint='#5e6068')

    abaya = open_sheet('Abaya', abaya_sdf(J), abaya_keep(J), faces=6000, voxel=0.004,
                       lo=(-0.66, -0.2, -0.01), hi=(0.66, 0.36, 1.56),
                       snap=chain(snap_plane_z(HEM_Z, 0.015), snap_cuffs(J, cuff_length(J) + 0.004, 0.02)))
    robe_weights(abaya, body, J, skirt_from=0.86)
    finish_cloth(abaya, material('Abaya', '#1f1f22', **sheen), abaya_pin(J))
    C.bind(abaya, rig)

    khimar = open_sheet('Khimar', khimar_sdf(), khimar_keep(eye_z), faces=6500, voxel=0.004,
                        lo=(-0.68, -0.38, 0.6), hi=(0.68, 0.46, 1.8), snap=snap_hem)
    names, M = C.normalize_weights(cape_weights(C.get_verts(khimar), J, 1.47, 1.535), len(khimar.data.vertices))
    C.apply_weights(khimar, names, M)
    finish_cloth(khimar, material('Khimar', '#1c1c1f', **sheen), lambda Pv: C.smoothstep(1.47, 1.53, Pv[:, 2]))
    C.bind(khimar, rig)

    # The postures; in qiyam the hands rest on the abaya, under the khimar.
    poses = P.author_all(ref, body_points=C.get_verts(abaya), body=body)
    if os.environ.get('DRAPE', '1') != '0':
        drape.bake(NAME, rig, body, [
            dict(ob=abaya, bending=0.8, mass=0.25, self=True, collider=True),
            dict(ob=khimar, bending=0.5, mass=0.2, self=True, outside=('Abaya',)),
        ], poses, settle=60)
    figure.write_poses(rig, poses)
    meshes = [body, abaya, khimar]
    tris = sum(C.triangulated_count(o) for o in meshes)
    log(f'Sister: {tris} triangles')
    figure.export(OUT_GLB, rig, meshes)
    return tris


if __name__ == '__main__':
    build()
