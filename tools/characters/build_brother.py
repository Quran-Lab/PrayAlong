"""
Brother — a slim adult, faceless companion after the brief's pose sheet: a
black kufi over short black hair, a long black thobe with a mandarin collar,
a buttoned placket, cuffs and the Quran Lab mark on the chest, black trousers,
cream hands, face and bare feet.

    python3 tools/characters/build_brother.py            # build + export + previews
    NO_RENDER=1 python3 tools/characters/build_brother.py # export only
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from kit import *  # noqa: E402,F403

NAME = 'brother'
OUT_GLB = os.path.join(REPO, 'public', 'avatars', f'{NAME}.glb')

COLORS = dict(
    skin='#f3e6d2',
    hair='#16161a',
    cloth='#1c1c1f',
    kufi='#151517',
    buttons='#0d0d0f',
    mark='#f1efea',
)

SK, HAND, FOOT = tall_body(knee_y=-0.012, foot_s=0.9, shin_top=0.11)
HEAD = tall_head()
PLACE = TALL_PLACE


# ───────────────────────────────────────────────────────────── head

def hair_sdf():
    """Short hair: a thin shell over the cranium, seen at the temples and the
    back under the kufi, clear of the face."""
    shell = offset(HEAD['cranium'], 0.0032)
    h = intersect(shell, plane((0, 0, -1), (0, 0, 0.872)), k=0.004)
    brow = ellipsoid((0, -0.064, 0.9), (0.047, 0.05, 0.05))
    h = subtract(h, brow, k=0.008)
    sideburn = mirror_x(capsule((0.058, -0.012, 0.874), (0.058, -0.006, 0.9), 0.006))
    h = union(h, intersect(sideburn, offset(HEAD['cranium'], 0.0034)), k=0.004)
    return h


def kufi_sdf():
    """A straight, flat-topped cap with a softly rounded rim, sitting on the brow."""
    z0, z1 = 0.916, 0.99
    cap = elliptic_frustum(z0, z1, (0, 0.012), (0, 0.012), (0.0666, 0.0712), (0.0656, 0.07), cap=0.011)
    cap = subtract(cap, offset(HEAD['cranium'], -0.0015), k=0.002)
    # A stitched line just above the band.
    line = subtract(elliptic_frustum(0.9425, 0.9445, (0, 0.012), (0, 0.012), (0.074, 0.08), (0.074, 0.08)),
                    elliptic_frustum(0.9, 1.0, (0, 0.012), (0, 0.012), (0.0652, 0.0698), (0.0652, 0.0698)))
    return subtract(cap, line, k=0.0008)


# ───────────────────────────────────────────────────────────── thobe

def thobe_sdf():
    torso = loft([
        (0.07, 0, 0.012, 0.119, 0.09),
        (0.2, 0, 0.012, 0.116, 0.087),
        (0.36, 0, 0.011, 0.113, 0.084),
        (0.5, 0, 0.01, 0.111, 0.08),
        (0.6, 0, 0.008, 0.108, 0.076),
        (0.69, 0, 0.008, 0.117, 0.076),
        (0.75, 0, 0.01, 0.118, 0.072),
        (0.79, 0, 0.012, 0.09, 0.058),
        (0.81, 0, 0.012, 0.04, 0.036),
    ], cap=0.012)
    sx = SK.shoulder[0] - 0.1
    sleeve = tube([(0.06, 0.01, 0.778), (0.12 + sx, 0.012, 0.782), (0.278 + sx, 0.014, 0.785), (0.392 + sx, 0.01, 0.785), (0.404 + sx, 0.01, 0.785)],
                  [0.048, 0.042, 0.033, 0.0255, 0.026])
    t = union(torso, mirror_x(sleeve), k=0.03)
    collar = elliptic_frustum(0.802, 0.83, (0, 0.012), (0, 0.012), (0.0335, 0.033), (0.0315, 0.031), cap=0.004)
    t = union(t, collar, k=0.006)
    placket = intersect(offset(torso, 0.0018), box((0, -0.1, 0.738), (0.0105, 0.06, 0.074), r=0.0104), k=0.0015)
    t = union(t, placket, k=0.002)
    # Seams: the cuff band and the hem.
    for x in (0.381 + sx, -0.381 - sx):
        t = subtract(t, torus((x, 0.01, 0.785), 0.026, 0.0011, R=rot(y=90)), k=0.0008)
    hem_line = subtract(elliptic_frustum(0.098, 0.1, (0, 0.012), (0, 0.012), (0.14, 0.106), (0.14, 0.106)), offset(torso, -0.0012))
    t = subtract(t, hem_line, k=0.0008)
    hem_cut = elliptic_frustum(0.03, 0.076, (0, 0.012), (0, 0.012), (0.111, 0.082), (0.11, 0.081))
    t = subtract(t, hem_cut, k=0.004)
    cuff_cut = mirror_x(capsule((0.396 + sx, 0.01, 0.785), (0.45 + sx, 0.01, 0.785), 0.020))
    t = subtract(t, cuff_cut, k=0.003)
    neck_cut = capsule((0, 0.012, 0.76), (0, 0.012, 0.86), 0.0285)
    t = subtract(t, neck_cut, k=0.003)
    return t, torso


def trousers_sdf():
    leg = tube([(0.05, 0.004, 0.53), (0.054, 0.004, 0.5), (0.057, -0.004, 0.285), (0.06, 0.006, 0.08)], [0.05, 0.048, 0.036, 0.031])
    pelvis = ellipsoid((0, 0.005, 0.53), (0.098, 0.07, 0.06))
    t = union(pelvis, mirror_x(leg), k=0.025)
    t = intersect(t, plane((0, 0, 1), (0, 0, 0.56)), k=0.012)  # hidden under the thobe
    cut = mirror_x(capsule((0.06, 0.006, 0.03), (0.06, 0.006, 0.09), 0.023))
    return subtract(t, cut, k=0.003)


def buttons_sdf(thobe):
    pts = raycast(thobe, [(0, -0.3, z) for z in (0.785, 0.76, 0.735)], (0, 1, 0))
    return union(*[sphere(tuple(p + np.array([0, 0.0012, 0])), 0.0042) for p in pts])


# ───────────────────────────────────────────────────────────── build

def build():
    reset_scene()
    mats = dict(
        skin=material('Skin', COLORS['skin'], roughness=0.6, vertex_color=True, glow=0.05),
        hair=material('Hair', COLORS['hair'], roughness=0.6),
        cloth=material('Thobe', COLORS['cloth'], roughness=0.8, sheen=0.08, sheen_tint='#5e6068'),
        kufi=material('Kufi', COLORS['kufi'], roughness=0.72, sheen=0.08, sheen_tint='#5e6068'),
        trousers=material('Trousers', COLORS['cloth'], roughness=0.86, sheen=0.2, sheen_tint='#c4c8d6'),
        buttons=material('Buttons', COLORS['buttons'], roughness=0.35),
        mark=material('Mark', COLORS['mark'], roughness=0.5),
    )
    field = tall_field(SK)
    cloth = tall_field(SK, wrist_shift=0.012, neck_shift=0.03)
    every = lambda P: sided(P, field)  # noqa: E731
    head_only = lambda P: {'Head': np.ones(len(P))}  # noqa: E731
    parts = []

    head = sdf_mesh('Head', HEAD['head'], voxel=0.0007, faces=2600, symmetric=True)
    finish_part('Head', head, mats['skin'], lambda P: head_weights(P, SK, HEAD['skull'], HEAD['neck'], field), colors=skin_colors(head, COLORS['skin']))
    parts.append(head)

    hair = sdf_mesh('Hair', hair_sdf(), voxel=0.0006, faces=900, symmetric=True)
    finish_part('Hair', hair, mats['hair'], head_only)
    parts.append(hair)

    kufi = sdf_mesh('Kufi', kufi_sdf(), voxel=0.0006, faces=1500, symmetric=True)
    finish_part('Kufi', kufi, mats['kufi'], head_only)
    parts.append(kufi)

    thobe, torso = thobe_sdf()
    tob = sdf_mesh('Thobe', thobe, voxel=0.0014, faces=6000, symmetric=True)
    finish_part('Thobe', tob, mats['cloth'], lambda P: skirt_weights(P, cloth, SK.knee[1]))
    parts.append(tob)

    bob = sdf_mesh('Buttons', buttons_sdf(thobe), voxel=0.0005, faces=150, remesh=False, relax_iters=0)
    finish_part('Buttons', bob, mats['buttons'], every)
    parts.append(bob)

    mark = sdf_mesh('Mark', mark_sdf(thobe, 0.06, 0.735), voxel=0.0003, faces=300, remesh=False, relax_iters=0)
    finish_part('Mark', mark, mats['mark'], every)
    parts.append(mark)

    trs = sdf_mesh('Trousers', trousers_sdf(), voxel=0.0016, faces=1200, symmetric=True)
    finish_part('Trousers', trs, mats['trousers'], every)
    parts.append(trs)

    for side, mir in (('L', False), ('R', True)):
        h = sdf_mesh(f'Hand{side}', flip_x(HAND) if mir else HAND, voxel=0.0006, faces=900)
        finish_part(h.name, h, mats['skin'], every, colors=skin_colors(h, COLORS['skin']))
        parts.append(h)
        f = sdf_mesh(f'Foot{side}', flip_x(FOOT) if mir else FOOT, voxel=0.001, faces=500)
        finish_part(f.name, f, mats['skin'], every, colors=skin_colors(f, COLORS['skin']))
        parts.append(f)

    arm, body, tris = assemble('Brother', SK, parts, OUT_GLB)
    previews(NAME, arm, body, height=0.99, face_z=0.9)
    thumbnail(NAME, arm, height=0.99)
    return tris


if __name__ == '__main__':
    build()
