"""
Maryam — a girl in a soft dusty-rose hijab (with a cream under-scarf framing
her face) and a long dusty-blue dress with cream trim, bare feet.

    python3 tools/characters/build_maryam.py            # build + export + previews
    NO_RENDER=1 python3 tools/characters/build_maryam.py # export only
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from kit import *  # noqa: E402,F403

NAME = 'maryam'
OUT_GLB = os.path.join(REPO, 'public', 'avatars', f'{NAME}.glb')

COLORS = dict(
    skin='#ebb791',
    hijab='#c7a19b',
    under='#f5ece1',
    dress='#8b97b6',
    trim='#f1e4d0',
)

# The dress hides the legs, so the knee joint sits near the front of the
# skirt: the app grounds kneeling knees ~3% of body height below the joint.
SK, HAND, FOOT = kid_body(knee_y=-0.03, hand_s=1.08, foot_s=0.98, shin_top=0.16)
HEAD = head_parts(HeadStyle(ears=False, nose=1.1))
PLACE = Place(centre=(0.0, 0.008, 0.818), scale=1.08)


# ───────────────────────────────────────────────────────────── hijab (kid head space)

FACE_OVAL = dict(rx=0.088, rz=0.087, zc=0.835)


def hijab_sdf():
    hood = ellipsoid((0, 0.014, 0.882), (0.137, 0.135, 0.125))
    wrap = offset(HEAD['skull'], 0.0105)  # guarantees the cheeks stay covered
    chin_wrap = ellipsoid((0, -0.008, 0.79), (0.11, 0.104, 0.076))
    h = union(hood, wrap, k=0.03)
    h = union(h, chin_wrap, k=0.05)
    cape = elliptic_frustum(0.565, 0.80, (0, 0.014), (0, 0.01), (0.16, 0.132), (0.09, 0.086), cap=0.022)
    h = union(h, cape, k=0.055)
    # A little longer at the front, like a khimar.
    h = intersect(h, plane((0, 0.42, -1), (0, 0, 0.625)), k=0.03)
    o = FACE_OVAL
    h = subtract(h, oval_tunnel(o['rx'], o['rz'], o['zc'], y_max=-0.03), k=0.016)
    return h


def under_sdf():
    """Cream under-scarf: a crescent on the forehead just inside the hijab rim."""
    o = FACE_OVAL
    band = intersect(offset(HEAD['skull'], 0.0045), oval_tunnel(o['rx'] + 0.006, o['rz'] + 0.006, o['zc'], y_max=-0.03), k=0.003)
    band = subtract(band, oval_tunnel(o['rx'] - 0.011, o['rz'] - 0.013, o['zc'] + 0.004, y_max=0.2), k=0.004)
    return intersect(band, plane((0, 0, -1), (0, 0, o['zc'] + 0.012)), k=0.012)


# ───────────────────────────────────────────────────────────── dress (world space)

SKIRT = dict(z0=0.072, z1=0.47, c0=(0, 0.02), c1=(0, 0.003), r0=(0.132, 0.083), r1=(0.092, 0.071))


def dress_sdf():
    chest = ellipsoid((0, 0.008, 0.565), (0.086, 0.065, 0.08))
    belly = ellipsoid((0, -0.002, 0.49), (0.09, 0.07, 0.075))
    skirt = elliptic_frustum(SKIRT['z0'], SKIRT['z1'], SKIRT['c0'], SKIRT['c1'], SKIRT['r0'], SKIRT['r1'], cap=0.016)
    torso = union(chest, belly, k=0.05)
    torso = union(torso, skirt, k=0.06)
    sleeve = tube([(0.05, 0.008, 0.60), (0.192, 0.012, 0.60), (0.278, 0.008, 0.60), (0.293, 0.008, 0.60)], [0.041, 0.0345, 0.0322, 0.0342])
    d = union(torso, mirror_x(sleeve), k=0.035)
    hem_cut = elliptic_frustum(0.04, 0.095, (0, 0.021), (0, 0.02), (0.118, 0.07), (0.117, 0.069))
    d = subtract(d, hem_cut, k=0.007)
    cuff_cut = mirror_x(capsule((0.282, 0.008, 0.60), (0.33, 0.008, 0.60), 0.0255))
    d = subtract(d, cuff_cut, k=0.004)
    return d, torso


def trim_sdf(torso):
    hem = intersect(offset(torso, 0.0032), box((0, 0.02, 0.0935), (0.2, 0.15, 0.0095), r=0.004), k=0.003)
    cuffs = mirror_x(torus((0.281, 0.008, 0.60), 0.0312, 0.0052, R=rot(y=90)))
    return union(hem, cuffs, k=0.002)


# ───────────────────────────────────────────────────────────── build

def build():
    reset_scene()
    mats = dict(
        skin=material('Skin', COLORS['skin'], roughness=0.6, vertex_color=True, glow=0.07),
        hijab=material('Hijab', COLORS['hijab'], roughness=0.8, sheen=0.3, sheen_tint='#fff4ee'),
        under=material('UnderScarf', COLORS['under'], roughness=0.8, sheen=0.2),
        dress=material('Dress', COLORS['dress'], roughness=0.8, sheen=0.3, sheen_tint='#e8ecff'),
        trim=material('Trim', COLORS['trim'], roughness=0.7, sheen=0.2),
        lash=material('Lash', FaceStyle.lash, roughness=0.6),
        brow=material('Brow', FaceStyle.brow, roughness=0.7),
        mouth=material('Mouth', '#a5504b', roughness=0.6),
    )
    field = body_field(SK, hip_front_width=0.06)
    cloth = body_field(SK, hip_front_width=0.06, wrist_shift=0.012, neck_shift=0.03)
    every = lambda P: sided(P, field)  # noqa: E731
    head_only = lambda P: {'Head': np.ones(len(P))}  # noqa: E731
    parts = []

    skull_w, head_w, neck_w = PLACE.sdf(HEAD['skull']), PLACE.sdf(HEAD['head']), PLACE.sdf(HEAD['neck'])
    head = sdf_mesh('Head', head_w, voxel=0.0014, faces=3300, symmetric=True)
    finish_part('Head', head, mats['skin'], lambda P: head_weights(P, SK, skull_w, neck_w, field),
                colors=blush_colors(get_verts(head), PLACE, COLORS['skin'], amount=0.6))
    parts.append(head)

    hij = sdf_mesh('Hijab', PLACE.sdf(hijab_sdf()), voxel=0.0015, faces=4500, symmetric=True)
    finish_part('Hijab', hij, mats['hijab'], lambda P: blend_to_head(P, field, SK.neck[2] + 0.012, SK.head[2] + 0.012))
    parts.append(hij)

    und = sdf_mesh('UnderScarf', PLACE.sdf(under_sdf()), voxel=0.0012, faces=900, symmetric=True)
    finish_part('UnderScarf', und, mats['under'], head_only)
    parts.append(und)

    face = FaceStyle(lashes=3, brow_thick=0.95, brow_lift=0.002, mouth='#a5504b')
    for s in face_strokes(PLACE, skull_w, face, mats):
        finish_part(s.name, s, s.data.materials[0], head_only)
        parts.append(s)

    dress, torso = dress_sdf()
    dob = sdf_mesh('Dress', dress, voxel=0.0018, faces=4300, symmetric=True)
    finish_part('Dress', dob, mats['dress'], lambda P: skirt_weights(P, cloth, SK.knee[1]))
    parts.append(dob)

    tob = sdf_mesh('Trim', trim_sdf(torso), voxel=0.0011, faces=900, symmetric=True)
    finish_part('Trim', tob, mats['trim'], lambda P: skirt_weights(P, cloth, SK.knee[1]))
    parts.append(tob)

    for side, mir in (('L', False), ('R', True)):
        h = sdf_mesh(f'Hand{side}', flip_x(HAND) if mir else HAND, voxel=0.0011, faces=520)
        finish_part(h.name, h, mats['skin'], every, colors=skin_colors(h, COLORS['skin']))
        parts.append(h)
        f = sdf_mesh(f'Foot{side}', flip_x(FOOT) if mir else FOOT, voxel=0.0011, faces=500)
        finish_part(f.name, f, mats['skin'], every, colors=skin_colors(f, COLORS['skin']))
        parts.append(f)

    arm, body, tris = assemble('Maryam', SK, parts, OUT_GLB)
    previews(NAME, arm, body)
    return tris


if __name__ == '__main__':
    build()
