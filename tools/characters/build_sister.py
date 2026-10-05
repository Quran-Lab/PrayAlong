"""
Sister — a modest adult, faceless companion on the same seven-head body as
Brother: a black khimar falling to the waist over a long black abaya, a
loose opaque khimar covering the chin, neck, shoulders and chest. Cream hands,
black socks.

    python3 tools/characters/build_sister.py            # build + export + previews
    NO_RENDER=1 python3 tools/characters/build_sister.py # export only
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from kit import *  # noqa: E402,F403

NAME = 'sister'
OUT_GLB = os.path.join(REPO, 'public', 'avatars', f'{NAME}.glb')

COLORS = dict(
    skin='#f3e6d2',
    khimar='#1c1c1f',
    niqab='#18181a',
    band='#111113',
    abaya='#202023',
    socks='#18181a',
)

SK, HAND, FOOT = tall_body(knee_y=-0.016, hand_s=0.88, foot_s=0.86, shin_top=0.1, shoulder_x=0.102)
HEAD = tall_head(ears=False)

# ───────────────────────────────────────────────────────────── head covering

def hood_sdf():
    """The khimar around the head and under the chin."""
    hood = ellipsoid((0, 0.016, 0.906), (0.068, 0.076, 0.07))
    wrap = offset(HEAD['skull'], 0.0075)
    chin_wrap = ellipsoid((0, -0.004, 0.842), (0.056, 0.056, 0.042))
    h = union(hood, wrap, k=0.016)
    return union(h, chin_wrap, k=0.026)


def khimar_sdf():
    """The hood and a bell-shaped cape: it falls from the head over the
    shoulders and arms, with a rounded hem, longest at the centre front."""
    cape = loft([
        (0.39, 0, 0.014, 0.255, 0.17),
        (0.51, 0, 0.013, 0.245, 0.16),
        (0.64, 0, 0.012, 0.224, 0.145),
        (0.73, 0, 0.012, 0.190, 0.12),
        (0.79, 0, 0.012, 0.145, 0.085),
        (0.84, 0, 0.012, 0.054, 0.056),
    ], cap=0.004)
    h = union(hood_sdf(), cape, k=0.03)
    # Cloth, not a solid: hollow below the shoulders so the hem is a thin edge.
    inner = intersect(offset(cape, -0.0075), plane((0, 0, 1), (0, 0, 0.73)), k=0.03)
    h = subtract(h, inner, k=0.004)
    # A curved hem: lowest at the centre front and back, rising toward the arms.
    hem = lambda P: (0.43 + 0.85 * P[:, 0] ** 2 + 0.12 * P[:, 1]) - P[:, 2]  # noqa: E731
    h = intersect(h, hem, k=0.012)
    # Open face: forehead is uncovered for contact with the prayer mat.
    face_opening = ellipsoid((0, -0.073, 0.905), (0.047, 0.065, 0.048))
    return subtract(h, face_opening, k=0.004)


# ───────────────────────────────────────────────────────────── abaya

def abaya_sdf():
    torso = loft([
        (0.012, 0, 0.022, 0.177, 0.126),
        (0.15, 0, 0.018, 0.173, 0.122),
        (0.33, 0, 0.014, 0.166, 0.116),
        (0.5, 0, 0.01, 0.158, 0.108),
        (0.6, 0, 0.008, 0.151, 0.100),
        (0.69, 0, 0.008, 0.143, 0.09),
        (0.75, 0, 0.01, 0.11, 0.068),
        (0.79, 0, 0.012, 0.08, 0.054),
        (0.81, 0, 0.012, 0.036, 0.034),
    ], cap=0.012)
    sx = SK.shoulder[0] - 0.1
    sleeve = tube([(0.06, 0.01, 0.778), (0.12 + sx, 0.012, 0.782), (0.278 + sx, 0.014, 0.785), (0.39 + sx, 0.01, 0.785), (0.402 + sx, 0.01, 0.785)],
                  [0.049, 0.045, 0.036, 0.026, 0.026])
    a = union(torso, mirror_x(sleeve), k=0.03)
    hem_cut = loft([(-0.02, 0, 0.022, 0.165, 0.114), (0.011, 0, 0.022, 0.164, 0.113)])
    a = subtract(a, hem_cut, k=0.004)
    a = subtract(a, mirror_x(capsule((0.394 + sx, 0.01, 0.785), (0.45 + sx, 0.01, 0.785), 0.020)), k=0.003)
    a = subtract(a, capsule((0, 0.012, 0.76), (0, 0.012, 0.86), 0.027), k=0.003)
    return a, torso


# ───────────────────────────────────────────────────────────── build

def build():
    reset_scene()
    mats = dict(
        skin=material('Skin', COLORS['skin'], roughness=0.6, vertex_color=True, glow=0.05),
        khimar=material('Khimar', COLORS['khimar'], roughness=0.84, sheen=0.08, sheen_tint='#5e6068'),
        niqab=material('Niqab', COLORS['niqab'], roughness=0.82, sheen=0.25, sheen_tint='#c4c8d6'),
        band=material('Band', COLORS['band'], roughness=0.7, sheen=0.2, sheen_tint='#c4c8d6'),
        abaya=material('Abaya', COLORS['abaya'], roughness=0.84, sheen=0.08, sheen_tint='#5e6068'),
        socks=material('Socks', COLORS['socks'], roughness=0.9),
    )
    field = tall_field(SK)
    cloth = tall_field(SK, wrist_shift=0.012, neck_shift=0.03, knee_bias=0.008, knee_width=0.03)
    every = lambda P: sided(P, field)  # noqa: E731
    head_only = lambda P: {'Head': np.ones(len(P))}  # noqa: E731
    parts = []

    head = sdf_mesh('Head', HEAD['head'], voxel=0.0007, faces=2000, symmetric=True)
    finish_part('Head', head, mats['skin'], lambda P: head_weights(P, SK, HEAD['skull'], HEAD['neck'], field), colors=skin_colors(head, COLORS['skin']))
    parts.append(head)

    khi = sdf_mesh('Khimar', khimar_sdf(), voxel=0.0011, faces=4800, symmetric=True)
    finish_part('Khimar', khi, mats['khimar'], lambda P: hijab_weights(P, field, 0.77, 0.855, base=0.0, arm_share=0.65))
    parts.append(khi)

    abaya, _ = abaya_sdf()
    aob = sdf_mesh('Abaya', abaya, voxel=0.0014, faces=5600, symmetric=True)
    finish_part('Abaya', aob, mats['abaya'], lambda P: skirt_weights(P, cloth, SK.knee[1], blend=0.06))
    parts.append(aob)

    for side, mir in (('L', False), ('R', True)):
        h = sdf_mesh(f'Hand{side}', flip_x(HAND) if mir else HAND, voxel=0.0006, faces=900)
        finish_part(h.name, h, mats['skin'], every, colors=skin_colors(h, COLORS['skin']))
        parts.append(h)
        f = sdf_mesh(f'Foot{side}', flip_x(FOOT) if mir else FOOT, voxel=0.001, faces=480)
        finish_part(f.name, f, mats['socks'], every)
        parts.append(f)

    arm, body, tris = assemble('Sister', SK, parts, OUT_GLB)
    previews(NAME, arm, body, height=0.99, face_z=0.9)
    thumbnail(NAME, arm, height=0.99)
    return tris


if __name__ == '__main__':
    build()
