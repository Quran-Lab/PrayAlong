"""
Ahmad — a young man with a short neat beard, a white knitted kufi, a
stone-white thobe to mid-calf (band collar, buttoned placket) over light
sirwal trousers, bare feet.

    python3 tools/characters/build_ahmad.py            # build + export + previews
    NO_RENDER=1 python3 tools/characters/build_ahmad.py # export only
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from kit import *  # noqa: E402,F403

NAME = os.environ.get('NAME_OVERRIDE', 'ahmad')
BACK_TO = eval(os.environ.get('BACK_TO', "(('Leg', 0.5), ('UpLeg', 0.5))"))
OUT_GLB = os.path.join(REPO, 'public', 'avatars', f'{NAME}.glb') if NAME == 'ahmad' else os.path.join(PREVIEW_DIR, f'{NAME}.glb')
HEIGHT = 1.17

COLORS = dict(
    skin='#d39a72',
    hair='#2e211b',
    beard='#5a4033',
    kufi='#f7f4ec',
    thobe='#eeeadf',
    sirwal='#cfc6b4',
    buttons='#cbbfa6',
)

# The thobe hides the knees, so the knee joint sits near the front of the
# robe: the app grounds kneeling knees ~3% of body height below the joint.
SK, HAND, FOOT = adult_body(knee_y=-0.035)
HEAD = head_parts(HeadStyle(cheek=0.04, jaw=0.96, chin_drop=0.012, nose=1.25, neck_r=0.041, neck_bottom=0.64))
PLACE = ADULT_PLACE


# ───────────────────────────────────────────────────────────── head dressing (kid head space)

def hair_sdf():
    cap = ellipsoid((0, 0.009, 0.878), (0.1265, 0.1245, 0.1185))
    window = ellipsoid((0, -0.118, 0.806), (0.104, 0.11, 0.122))
    ear_zone = mirror_x(ellipsoid((0.128, 0.0, 0.828), (0.045, 0.032, 0.036)))
    nape = plane((0, -0.5, -1), (0, 0, 0.79))
    h = subtract(cap, window, k=0.01)
    h = subtract(h, ear_zone, k=0.01)
    h = intersect(h, nape, k=0.015)
    burns = mirror_x(tube([(0.112, -0.036, 0.875), (0.114, -0.035, 0.83)], [0.0105, 0.009]))
    return union(h, burns, k=0.01)


def kufi_sdf():
    """A white knitted cap: a soft dome with a slightly raised band at the rim
    (the band is a shell of the dome itself, so it hugs it all the way round)."""
    dome = ellipsoid((0, 0.011, 0.895), (0.1325, 0.1305, 0.108))
    edge = plane((0, 0.18, -1), (0, 0, 0.928))  # rim: lower at the front
    k = intersect(dome, edge, k=0.009)
    band = intersect(offset(dome, 0.0032), edge, plane((0, -0.18, 1), (0, 0, 0.943)), k=0.004)
    return union(k, band, k=0.003)


def beard_sdf():
    """A short, neat beard along the jaw and chin (moustache trimmed, sunnah style)."""
    skull = HEAD['skull']
    shell = offset(skull, 0.0048)
    zone = ellipsoid((0, -0.02, 0.758), (0.13, 0.124, 0.07))
    bare_cheeks = ellipsoid((0, -0.1, 0.822), (0.086, 0.085, 0.054))
    mouth = ellipsoid((0, -0.112, 0.7905), (0.024, 0.03, 0.0145))
    b = intersect(shell, zone, k=0.01)
    b = intersect(b, plane((0, 1, 0), (0, 0.03, 0)), k=0.01)  # in front of the ears
    b = subtract(b, bare_cheeks, k=0.018)
    b = subtract(b, mouth, k=0.006)
    return b


# ───────────────────────────────────────────────────────────── clothes (world space)

def thobe_sdf():
    chest = ellipsoid((0, 0.01, 0.765), (0.112, 0.082, 0.105))
    belly = ellipsoid((0, 0.0, 0.665), (0.108, 0.082, 0.09))
    skirt = loft([(0.185, 0, 0.026, 0.15, 0.1), (0.305, 0, 0.018, 0.138, 0.094), (0.62, 0, 0.004, 0.108, 0.082)], cap=0.016)
    torso = union(chest, belly, k=0.06)
    torso = union(torso, skirt, k=0.07)
    sleeve = tube([(0.07, 0.01, 0.83), (0.275, 0.016, 0.83), (0.4, 0.01, 0.83), (0.416, 0.01, 0.83)], [0.051, 0.043, 0.04, 0.042])
    t = union(torso, mirror_x(sleeve), k=0.04)
    collar = torus((0, 0.014, 0.862), 0.047, 0.0095)
    t = union(t, collar, k=0.012)
    t = union(t, mirror_x(torus((0.398, 0.01, 0.83), 0.04, 0.0068, R=rot(y=90))), k=0.004)
    placket = intersect(offset(torso, 0.0035), box((0, -0.11, 0.796), (0.013, 0.06, 0.052), r=0.0045), k=0.002)
    t = union(t, placket, k=0.003)
    t = subtract(t, loft([(0.15, 0, 0.027, 0.137, 0.088), (0.2, 0, 0.026, 0.136, 0.087)]), k=0.007)
    t = subtract(t, mirror_x(capsule((0.405, 0.01, 0.83), (0.46, 0.01, 0.83), 0.031)), k=0.004)
    t = subtract(t, capsule((0, 0.014, 0.84), (0, 0.014, 0.93), 0.0395), k=0.004)
    return t, torso


def buttons_sdf(thobe):
    pts = raycast(thobe, [(0, -0.4, z) for z in (0.845, 0.815, 0.785)], (0, 1, 0))
    return union(*[sphere(tuple(p + np.array([0, 0.0014, 0])), 0.0052) for p in pts])


def sirwal_sdf():
    leg = tube([(0.068, 0.005, 0.6), (0.07, 0.006, 0.555), (0.074, -0.004, 0.305), (0.074, 0.008, 0.115)], [0.06, 0.06, 0.051, 0.048])
    pelvis = ellipsoid((0, 0.006, 0.585), (0.11, 0.08, 0.06))
    s = union(pelvis, mirror_x(leg), k=0.035)
    s = intersect(s, plane((0, 0, 1), (0, 0, 0.62)), k=0.015)
    s = union(s, mirror_x(torus((0.074, 0.008, 0.112), 0.043, 0.0125)), k=0.008)
    s = subtract(s, mirror_x(capsule((0.074, 0.008, 0.05), (0.074, 0.008, 0.125), 0.0335)), k=0.004)
    return s


# ───────────────────────────────────────────────────────────── build

def build():
    reset_scene()
    mats = dict(
        skin=material('Skin', COLORS['skin'], roughness=0.6, vertex_color=True, glow=0.1),
        hair=material('Hair', COLORS['hair'], roughness=0.6),
        beard=material('Beard', COLORS['beard'], roughness=0.75, sheen=0.3, sheen_tint='#8a6a58'),
        kufi=material('Kufi', COLORS['kufi'], roughness=0.85, sheen=0.3),
        thobe=material('Thobe', COLORS['thobe'], roughness=0.78, sheen=0.2, sheen_tint='#fff6e8'),
        sirwal=material('Sirwal', COLORS['sirwal'], roughness=0.85, sheen=0.2),
        buttons=material('Buttons', COLORS['buttons'], roughness=0.45),
        lash=material('Lash', FaceStyle.lash, roughness=0.6),
        brow=material('Brow', '#2f211b', roughness=0.7),
        mouth=material('Mouth', '#8a4740', roughness=0.6),
    )
    S = 1.2  # adult joint blends
    field = body_field(SK, hip_front_width=0.06, scale=S)
    cloth = body_field(SK, hip_front_width=0.06, wrist_shift=0.012, neck_shift=0.03, knee_bias=0.008, knee_width=0.03, scale=S)
    every = lambda P: sided(P, field)  # noqa: E731
    head_only = lambda P: {'Head': np.ones(len(P))}  # noqa: E731
    parts = []

    skull_w, head_w, neck_w = PLACE.sdf(HEAD['skull']), PLACE.sdf(HEAD['head']), PLACE.sdf(HEAD['neck'])
    head = sdf_mesh('Head', head_w, voxel=0.0014, faces=2900, symmetric=True)
    finish_part('Head', head, mats['skin'], lambda P: head_weights(P, SK, skull_w, neck_w, field),
                colors=blush_colors(get_verts(head), PLACE, COLORS['skin'], blush='#e07f6f', amount=0.28))
    parts.append(head)

    for name, sdf, mat, faces, vox in (('Hair', hair_sdf(), 'hair', 1400, 0.0014), ('Kufi', kufi_sdf(), 'kufi', 1800, 0.001), ('Beard', beard_sdf(), 'beard', 1700, 0.001)):
        ob = sdf_mesh(name, PLACE.sdf(sdf), voxel=vox, faces=faces, symmetric=True)
        finish_part(name, ob, mats[mat], head_only)
        parts.append(ob)

    face = FaceStyle(lashes=1, brow_thick=1.55, brow_width=1.08, brow_lift=-0.001, smile=0.8)
    for s in face_strokes(PLACE, skull_w, face, mats):
        finish_part(s.name, s, s.data.materials[0], head_only)
        parts.append(s)

    thobe, torso = thobe_sdf()
    tob = sdf_mesh('Thobe', thobe, voxel=0.002, faces=3300, symmetric=True)
    finish_part('Thobe', tob, mats['thobe'], lambda P: skirt_weights(P, cloth, SK.knee[1], blend=0.06, back_to=BACK_TO))
    parts.append(tob)

    bob = sdf_mesh('Buttons', buttons_sdf(thobe), voxel=0.0007, faces=150, remesh=False, relax_iters=0)
    finish_part('Buttons', bob, mats['buttons'], every)
    parts.append(bob)

    sob = sdf_mesh('Sirwal', sirwal_sdf(), voxel=0.002, faces=1700, symmetric=True)
    finish_part('Sirwal', sob, mats['sirwal'], every)
    parts.append(sob)

    for side, mir in (('L', False), ('R', True)):
        h = sdf_mesh(f'Hand{side}', flip_x(HAND) if mir else HAND, voxel=0.0012, faces=520)
        finish_part(h.name, h, mats['skin'], every, colors=skin_colors(h, COLORS['skin']))
        parts.append(h)
        f = sdf_mesh(f'Foot{side}', flip_x(FOOT) if mir else FOOT, voxel=0.0013, faces=480)
        finish_part(f.name, f, mats['skin'], every, colors=skin_colors(f, COLORS['skin']))
        parts.append(f)

    arm, body, tris = assemble('Ahmad', SK, parts, OUT_GLB)
    previews(NAME, arm, body, height=HEIGHT, face_z=1.025)
    return tris


if __name__ == '__main__':
    build()
