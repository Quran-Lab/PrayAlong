"""
Aisha — a woman in a warm sand hijab (khimar to the waist, cream under-scarf)
and a long plum abaya with sand trim at the cuffs and hem.

    python3 tools/characters/build_aisha.py            # build + export + previews
    NO_RENDER=1 python3 tools/characters/build_aisha.py # export only
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from kit import *  # noqa: E402,F403

NAME = os.environ.get('NAME_OVERRIDE', 'aisha')
BACK_TO = eval(os.environ.get('BACK_TO', "(('Leg', 0.5), ('UpLeg', 0.4), ('Hips', 0.1))"))
OUT_GLB = os.path.join(REPO, 'public', 'avatars', f'{NAME}.glb') if NAME == 'aisha' else os.path.join(PREVIEW_DIR, f'{NAME}.glb')
HEIGHT = 1.15

COLORS = dict(
    skin='#e4ae88',
    hijab='#dfc9a8',
    under='#d9aea8',
    abaya='#73506a',
    trim='#dcc6a5',
)

# The abaya hides the legs, so the knee joint sits near the front of the skirt.
SK, HAND, FOOT = adult_body(knee_y=-0.035, hand_s=1.18, foot_s=1.2, shoulder_x=0.113)
HEAD = head_parts(HeadStyle(ears=False, cheek=0.043, jaw=0.97, chin_drop=0.008, nose=1.12, neck_r=0.039, neck_bottom=0.64))
PLACE = ADULT_PLACE

# Kid head space: a bell-shaped khimar that clears the adult shoulders and
# falls to the waist, a little longer in front.
HIJAB = HijabStyle(
    face=(0.091, 0.092, 0.832),
    hood_c=(0, 0.012, 0.872),
    hood_r=(0.139, 0.134, 0.118),
    cape_rings=((0.47, 0, 0.022, 0.19, 0.148), (0.62, 0, 0.016, 0.185, 0.142), (0.70, 0, 0.012, 0.168, 0.128),
                (0.755, 0, 0.01, 0.123, 0.106), (0.80, 0, 0.008, 0.094, 0.089)),
    hem=0.53,
    front_drop=0.45,
    under_down=0.048,
)


def abaya_sdf():
    chest = ellipsoid((0, 0.01, 0.765), (0.1, 0.078, 0.1))
    belly = ellipsoid((0, 0.0, 0.665), (0.101, 0.079, 0.09))
    skirt = loft([(0.085, 0, 0.03, 0.172, 0.106), (0.305, 0, 0.019, 0.142, 0.094), (0.62, 0, 0.004, 0.107, 0.08)], cap=0.018)
    torso = union(chest, belly, k=0.06)
    torso = union(torso, skirt, k=0.07)
    sx = SK.shoulder[0] - 0.125
    sleeve = tube([(0.07, 0.01, 0.83), (0.275 + sx, 0.016, 0.83), (0.392 + sx, 0.01, 0.83), (0.414 + sx, 0.01, 0.83)], [0.046, 0.04, 0.042, 0.049])
    a = union(torso, mirror_x(sleeve), k=0.04)
    a = subtract(a, loft([(0.05, 0, 0.031, 0.156, 0.092), (0.11, 0, 0.03, 0.155, 0.091)]), k=0.008)
    a = subtract(a, mirror_x(capsule((0.4 + sx, 0.01, 0.83), (0.46 + sx, 0.01, 0.83), 0.035)), k=0.005)
    return a, torso


def trim_sdf(torso):
    hem = intersect(offset(torso, 0.0035), box((0, 0.03, 0.127), (0.25, 0.2, 0.011), r=0.005), k=0.003)
    sx = SK.shoulder[0] - 0.125
    cuffs = mirror_x(torus((0.405 + sx, 0.01, 0.83), 0.0465, 0.0065, R=rot(y=90)))
    return union(hem, cuffs, k=0.003)


def build():
    reset_scene()
    mats = dict(
        skin=material('Skin', COLORS['skin'], roughness=0.6, vertex_color=True, glow=0.11),
        hijab=material('Hijab', COLORS['hijab'], roughness=0.82, sheen=0.3, sheen_tint='#fff1e0'),
        under=material('UnderScarf', COLORS['under'], roughness=0.8, sheen=0.2),
        abaya=material('Abaya', COLORS['abaya'], roughness=0.82, sheen=0.35, sheen_tint='#f0d9ea'),
        trim=material('Trim', COLORS['trim'], roughness=0.7, sheen=0.2),
        lash=material('Lash', FaceStyle.lash, roughness=0.6),
        brow=material('Brow', '#4a2f24', roughness=0.7),
        mouth=material('Mouth', '#a14d4a', roughness=0.6),
    )
    S = 1.2
    field = body_field(SK, hip_front_width=0.06, scale=S)
    cloth = body_field(SK, hip_front_width=0.06, wrist_shift=0.012, neck_shift=0.03, knee_bias=0.008, knee_width=0.03, scale=S)
    every = lambda P: sided(P, field)  # noqa: E731
    head_only = lambda P: {'Head': np.ones(len(P))}  # noqa: E731
    skirt = lambda P: skirt_weights(P, cloth, SK.knee[1], blend=0.06, back_to=BACK_TO)  # noqa: E731
    parts = []

    skull_w, head_w, neck_w = PLACE.sdf(HEAD['skull']), PLACE.sdf(HEAD['head']), PLACE.sdf(HEAD['neck'])
    head = sdf_mesh('Head', head_w, voxel=0.0014, faces=2900, symmetric=True)
    finish_part('Head', head, mats['skin'], lambda P: head_weights(P, SK, skull_w, neck_w, field),
                colors=blush_colors(get_verts(head), PLACE, COLORS['skin'], amount=0.5))
    parts.append(head)

    hijab_kid, under_kid = hijab_parts(HEAD['skull'], HIJAB)
    hij = sdf_mesh('Hijab', PLACE.sdf(hijab_kid), voxel=0.0017, faces=3900, symmetric=True)
    hem_world = PLACE.pt((0, 0, HIJAB.hem))[2]
    finish_part('Hijab', hij, mats['hijab'], lambda P: hijab_weights(P, field, hem_world, SK.head[2] + 0.005, arm_share=0.5))
    parts.append(hij)

    und = sdf_mesh('UnderScarf', PLACE.sdf(under_kid), voxel=0.0012, faces=900, symmetric=True)
    finish_part('UnderScarf', und, mats['under'], head_only)
    parts.append(und)

    face = FaceStyle(lashes=3, brow_thick=1.0, brow_lift=0.002, smile=0.9)
    for s in face_strokes(PLACE, skull_w, face, mats):
        finish_part(s.name, s, s.data.materials[0], head_only)
        parts.append(s)

    abaya, torso = abaya_sdf()
    aob = sdf_mesh('Abaya', abaya, voxel=0.002, faces=3800, symmetric=True)
    finish_part('Abaya', aob, mats['abaya'], skirt)
    parts.append(aob)

    tob = sdf_mesh('Trim', trim_sdf(torso), voxel=0.0013, faces=900, symmetric=True)
    finish_part('Trim', tob, mats['trim'], skirt)
    parts.append(tob)

    for side, mir in (('L', False), ('R', True)):
        h = sdf_mesh(f'Hand{side}', flip_x(HAND) if mir else HAND, voxel=0.0012, faces=520)
        finish_part(h.name, h, mats['skin'], every, colors=skin_colors(h, COLORS['skin']))
        parts.append(h)
        f = sdf_mesh(f'Foot{side}', flip_x(FOOT) if mir else FOOT, voxel=0.0013, faces=480)
        finish_part(f.name, f, mats['skin'], every, colors=skin_colors(f, COLORS['skin']))
        parts.append(f)

    arm, body, tris = assemble('Aisha', SK, parts, OUT_GLB)
    previews(NAME, arm, body, height=HEIGHT, face_z=1.03)
    return tris


if __name__ == '__main__':
    build()
