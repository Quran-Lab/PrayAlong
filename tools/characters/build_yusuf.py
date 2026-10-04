"""
Yusuf — the hero companion: a boy with swoopy brown hair, a cream kurta with
a small buttoned placket, dark olive trousers with rolled cuffs, bare feet.

    python3 tools/characters/build_yusuf.py            # build + export + previews
    NO_RENDER=1 python3 tools/characters/build_yusuf.py # export only
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from kit import *  # noqa: E402,F403

NAME = 'yusuf'
OUT_GLB = os.path.join(REPO, 'public', 'avatars', f'{NAME}.glb')

COLORS = dict(
    skin='#f6caa9',
    hair='#6a4430',
    kurta='#efe6d6',
    trousers='#4b553d',
    buttons='#dcc9a3',
)

# ───────────────────────────────────────────────────────────── skeleton

WRIST = (0.294, 0.008, 0.60)
ANKLE = (0.058, 0.008, 0.06)
hand_sdf, knuckles = mitten(WRIST, s=1.12)
foot_sdf, foot_j = bare_foot(ANKLE, s=1.08)

SK = Skeleton(
    hips=(0, 0.005, 0.43),
    spine=(0, 0.004, 0.475),
    spine1=(0, 0.006, 0.522),
    spine2=(0, 0.008, 0.568),
    neck=(0, 0.012, 0.642),
    head=(0, 0.012, 0.702),
    head_top=(0, 0.012, 0.93),
    clavicle=(0.022, 0.008, 0.622),
    shoulder=(0.088, 0.008, 0.60),
    elbow=(0.192, 0.012, 0.60),
    wrist=WRIST,
    hand_tip=knuckles['tip'],
    index=knuckles['index'],
    middle=knuckles['middle'],
    pinky=knuckles['pinky'],
    hip=(0.054, 0.005, 0.39),
    knee=(0.057, -0.012, 0.22),
    ankle=ANKLE,
    toe=foot_j['toe'],
    toe_tip=foot_j['toe_tip'],
)

# ───────────────────────────────────────────────────────────── head & hair

HEAD = head_parts(HeadStyle(nose=1.2))
PLACE = Place(centre=(0.0, 0.008, 0.818), scale=1.08)


def hair_sdf():
    """Kid-space hair: a cap cut to a soft hairline, plus combed locks."""
    Cc, Rr = (0, 0.008, 0.878), (0.124, 0.122, 0.117)
    cap = ellipsoid((0, 0.009, 0.88), (0.13, 0.128, 0.122))
    window = ellipsoid((0, -0.118, 0.806), (0.104, 0.11, 0.118))
    ear_zone = mirror_x(ellipsoid((0.128, 0.0, 0.826), (0.05, 0.034, 0.038)))
    nape = plane((0, -0.5, -1), (0, 0, 0.80))
    base = subtract(cap, window, k=0.016)
    base = subtract(base, ear_zone, k=0.016)
    base = intersect(base, nape, k=0.025)
    L = []
    lk = lambda *a, **k: lock(Cc, Rr, *a, samples=22, overlap=1.6, k=0.01, **k)  # noqa: E731
    # Front: rooted at the hairline, rising and sweeping to his left (+X) into a soft quiff.
    L.append(lk([(-0.1, -0.075, 0.895), (-0.072, -0.11, 0.952), (-0.025, -0.112, 0.995), (0.02, -0.088, 1.02)], [0.02, 0.025, 0.023, 0.013], [0.008, 0.011, 0.012, 0.008], [0.002, 0.01, 0.02, 0.026]))
    L.append(lk([(-0.052, -0.12, 0.9), (-0.015, -0.128, 0.962), (0.03, -0.108, 1.0), (0.07, -0.072, 1.02)], [0.021, 0.027, 0.025, 0.014], [0.009, 0.012, 0.013, 0.008], [0.003, 0.014, 0.028, 0.032]))
    L.append(lk([(0.0, -0.126, 0.905), (0.037, -0.12, 0.96), (0.077, -0.092, 0.99), (0.108, -0.052, 1.0)], [0.021, 0.026, 0.023, 0.013], [0.009, 0.012, 0.012, 0.007], [0.003, 0.013, 0.024, 0.026]))
    L.append(lk([(0.052, -0.116, 0.9), (0.087, -0.097, 0.943), (0.114, -0.062, 0.96), (0.128, -0.027, 0.955)], [0.019, 0.023, 0.019, 0.01], [0.008, 0.01, 0.009, 0.005], [0.002, 0.008, 0.012, 0.012]))
    # Top: from the crown forward.
    for x in (-0.07, -0.025, 0.02, 0.065):
        L.append(lk([(x * 0.9, 0.075, 1.0), (x, 0.02, 1.0), (x + 0.015, -0.045, 1.0), (x + 0.04, -0.08, 0.99)], [0.022, 0.026, 0.024, 0.013], [0.009, 0.011, 0.011, 0.007], [0.002, 0.008, 0.014, 0.016]))
    # Back: from the crown down to the nape.
    for x in (-0.09, -0.045, 0.0, 0.045, 0.09):
        L.append(lk([(x * 0.4, 0.06, 1.0), (x * 0.9, 0.11, 0.94), (x * 1.05, 0.13, 0.87), (x * 1.0, 0.125, 0.81)], [0.022, 0.028, 0.026, 0.013], [0.008, 0.009, 0.009, 0.006], [0.002, 0.004, 0.005, 0.004]))
    # Sides: down to the ears.
    for s in (1, -1):
        L.append(lk([(s * 0.07, -0.03, 1.0), (s * 0.115, -0.03, 0.94), (s * 0.126, -0.03, 0.885), (s * 0.122, -0.04, 0.85)], [0.022, 0.024, 0.018, 0.009], [0.007, 0.008, 0.007, 0.005], [0.001, 0.003, 0.003, 0.003]))
        L.append(lk([(s * 0.07, 0.03, 1.0), (s * 0.118, 0.04, 0.93), (s * 0.13, 0.05, 0.87), (s * 0.126, 0.07, 0.83)], [0.022, 0.026, 0.02, 0.01], [0.007, 0.008, 0.008, 0.005], [0.001, 0.003, 0.004, 0.004]))
    locks = union(*L, k=0.007)
    locks = subtract(locks, window, k=0.012)
    locks = subtract(locks, ear_zone, k=0.012)
    return union(base, locks, k=0.007)


# ───────────────────────────────────────────────────────────── clothes

def kurta_sdf():
    chest = ellipsoid((0, 0.008, 0.565), (0.09, 0.068, 0.08))
    belly = ellipsoid((0, -0.004, 0.485), (0.096, 0.077, 0.08))
    skirt = elliptic_frustum(0.30, 0.47, (0, 0.006), (0, 0.004), (0.118, 0.091), (0.096, 0.074), cap=0.012)
    torso = union(chest, belly, k=0.05)
    torso = union(torso, skirt, k=0.05)
    sleeve = tube([(0.05, 0.008, 0.60), (0.192, 0.012, 0.60), (0.278, 0.008, 0.60), (0.293, 0.008, 0.60)], [0.042, 0.035, 0.0325, 0.0345])
    k = union(torso, mirror_x(sleeve), k=0.035)
    collar = torus((0, 0.012, 0.639), 0.0395, 0.0088, R=rot(x=8))
    k = union(k, collar, k=0.008)
    placket = intersect(offset(torso, 0.0032), box((0, -0.09, 0.592), (0.0115, 0.06, 0.046), r=0.004), k=0.002)
    k = union(k, placket, k=0.0025)
    hem_cut = elliptic_frustum(0.265, 0.317, (0, 0.006), (0, 0.006), (0.106, 0.08), (0.103, 0.077))
    k = subtract(k, hem_cut, k=0.006)
    cuff_cut = mirror_x(capsule((0.282, 0.008, 0.60), (0.33, 0.008, 0.60), 0.026))
    k = subtract(k, cuff_cut, k=0.004)
    neck_cut = capsule((0, 0.012, 0.62), (0, 0.012, 0.69), 0.0335)
    k = subtract(k, neck_cut, k=0.004)
    return k, torso


def trousers_sdf():
    leg = tube([(0.05, 0.004, 0.43), (0.054, 0.005, 0.39), (0.057, 0.0, 0.22), (0.058, 0.004, 0.093)], [0.048, 0.048, 0.042, 0.041])
    pelvis = ellipsoid((0, 0.005, 0.415), (0.09, 0.068, 0.05))
    t = union(pelvis, mirror_x(leg), k=0.03)
    t = intersect(t, plane((0, 0, 1), (0, 0, 0.435)), k=0.015)  # hidden under the kurta
    cuffs = mirror_x(torus((0.058, 0.004, 0.091), 0.037, 0.012))
    t = union(t, cuffs, k=0.007)
    cut = mirror_x(capsule((0.058, 0.004, 0.035), (0.058, 0.004, 0.102), 0.028))
    t = subtract(t, cut, k=0.004)
    return t


def buttons_sdf(kurta):
    pts = raycast(kurta, [(0, -0.3, z) for z in (0.622, 0.598, 0.574)], (0, 1, 0))
    return union(*[sphere(tuple(p + np.array([0, 0.0012, 0])), 0.0042) for p in pts])


# ───────────────────────────────────────────────────────────── build

def build(render_previews=True):
    reset_scene()
    mats = dict(
        skin=material('Skin', COLORS['skin'], roughness=0.6, vertex_color=True, glow=0.07),
        hair=material('Hair', COLORS['hair'], roughness=0.55),
        kurta=material('Kurta', COLORS['kurta'], roughness=0.78, sheen=0.2, sheen_tint='#fff1dc'),
        trousers=material('Trousers', COLORS['trousers'], roughness=0.85, sheen=0.2, sheen_tint='#e8ecd8'),
        buttons=material('Buttons', COLORS['buttons'], roughness=0.45),
        lash=material('Lash', FaceStyle.lash, roughness=0.6),
        brow=material('Brow', FaceStyle.brow, roughness=0.7),
        mouth=material('Mouth', FaceStyle.mouth, roughness=0.6),
    )
    field = body_field(SK, hip_front_width=0.06)
    field_cuff = body_field(SK, hip_front_width=0.06, wrist_shift=0.012, neck_shift=0.03)
    every = lambda P: sided(P, field)  # noqa: E731
    head_only = lambda P: {'Head': np.ones(len(P))}  # noqa: E731

    parts = []
    skull_w, head_w, neck_w = PLACE.sdf(HEAD['skull']), PLACE.sdf(HEAD['head']), PLACE.sdf(HEAD['neck'])
    head = sdf_mesh('Head', head_w, voxel=0.0014, faces=3700, symmetric=True)
    finish_part('Head', head, mats['skin'], lambda P: head_weights(P, SK, skull_w, neck_w, field),
                colors=blush_colors(get_verts(head), PLACE, COLORS['skin']))
    parts.append(head)

    hair = sdf_mesh('Hair', PLACE.sdf(hair_sdf()), voxel=0.0013, faces=4600)
    finish_part('Hair', hair, mats['hair'], head_only)
    parts.append(hair)

    for s in face_strokes(PLACE, skull_w, FaceStyle(brow_thick=1.25), mats):
        finish_part(s.name, s, s.data.materials[0], head_only)
        parts.append(s)

    kurta, torso = kurta_sdf()
    kob = sdf_mesh('Kurta', kurta, voxel=0.0018, faces=3100, symmetric=True)
    finish_part('Kurta', kob, mats['kurta'], lambda P: sided(P, field_cuff, blend=0.04))
    parts.append(kob)

    bob = sdf_mesh('Buttons', buttons_sdf(kurta), voxel=0.0006, faces=150, remesh=False, relax_iters=0)
    finish_part('Buttons', bob, mats['buttons'], every)
    parts.append(bob)

    tob = sdf_mesh('Trousers', trousers_sdf(), voxel=0.0018, faces=1900, symmetric=True)
    finish_part('Trousers', tob, mats['trousers'], every)
    parts.append(tob)

    for side, mir in (('L', False), ('R', True)):
        h = sdf_mesh(f'Hand{side}', flip_x(hand_sdf) if mir else hand_sdf, voxel=0.0011, faces=520)
        finish_part(h.name, h, mats['skin'], every, colors=np.tile(np.r_[srgb(COLORS['skin'])[:3], 1], (len(h.data.vertices), 1)))
        parts.append(h)
        f = sdf_mesh(f'Foot{side}', flip_x(foot_sdf) if mir else foot_sdf, voxel=0.0011, faces=480)
        finish_part(f.name, f, mats['skin'], every, colors=np.tile(np.r_[srgb(COLORS['skin'])[:3], 1], (len(f.data.vertices), 1)))
        parts.append(f)

    arm, body, tris = assemble('Yusuf', SK, parts, OUT_GLB)
    if render_previews:
        preview_setup()
        hero_renders(os.path.join(PREVIEW_DIR, NAME), height=0.985, face_z=0.83, arm_ob=arm)
    return tris


if __name__ == '__main__':
    build(render_previews=not os.environ.get('NO_RENDER'))
