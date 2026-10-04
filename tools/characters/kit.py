"""
Shared body kit for the PrayAlong cast: one head, face, hands and feet in a
common chibi style, a weight field for skinning, and the build pipeline.

Head pieces are authored in "kid space" (Yusuf's proportions) and placed on
each character with `xform` (translate + uniform scale).
"""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from common import *  # noqa: E402,F401,F403
import common as C  # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PREVIEW_DIR = os.environ.get('PREVIEW_DIR', '/tmp/prayalong-characters')

# Head centre in kid space; head-relative features are positioned from it.
HEAD_O = np.array([0.0, 0.008, 0.878])


# ════════════════════════════════════════════════════════════ placement


@dataclass
class Place:
    """Where a kid-space head goes on a character: p' = t + s·(p - HEAD_O)."""

    centre: tuple = (0.0, 0.008, 0.878)
    scale: float = 1.0

    def pt(self, p):
        return tuple(np.asarray(self.centre) + self.scale * (np.asarray(p, float) - HEAD_O))

    def sdf(self, f):
        t = np.asarray(self.centre) - self.scale * HEAD_O
        return C.xform(f, t, self.scale)

    def xz(self, pts):
        return [(x * self.scale, self.centre[2] + self.scale * (z - HEAD_O[2])) for x, z in pts]

    def r(self, radii):
        return [r * self.scale for r in radii]


# ════════════════════════════════════════════════════════════ head


@dataclass
class HeadStyle:
    cheek: float = 0.046  # cheek fullness
    jaw: float = 1.0  # jaw width factor (adults slightly narrower)
    chin_drop: float = 0.0  # longer chin for adults
    nose: float = 1.0
    ears: bool = True
    neck_r: float = 0.037
    neck_bottom: float = 0.70  # kid-space z of the neck capsule bottom


def head_parts(st: HeadStyle = HeadStyle()):
    """Kid-space SDFs: skull (face surface for strokes), head (+ears+neck), neck."""
    cranium = ellipsoid((0, 0.008, 0.878), (0.12, 0.118, 0.113))
    face = ellipsoid((0, -0.012, 0.832 - st.chin_drop * 0.3), (0.11 * st.jaw, 0.097, 0.086 + st.chin_drop * 0.3))
    jaw = ellipsoid((0, -0.018, 0.802 - st.chin_drop * 0.7), (0.098 * st.jaw, 0.084, 0.058))
    cheeks = mirror_x(sphere((0.058 * st.jaw, -0.054, 0.81 - st.chin_drop * 0.3), st.cheek))
    chin = ellipsoid((0, -0.048, 0.786 - st.chin_drop), (0.052, 0.046, 0.032))
    lids = mirror_x(ellipsoid((0.047, -0.096, 0.846), (0.019, 0.012, 0.011)))
    n = st.nose
    nose = ellipsoid((0, -0.107 - 0.004 * n, 0.82), (0.016 * n, 0.013 * n, 0.0125 * n))
    skull = union(cranium, face, k=0.06)
    skull = union(skull, jaw, k=0.05)
    skull = union(skull, cheeks, k=0.04)
    skull = union(skull, chin, k=0.04)
    skull = union(skull, lids, k=0.014)
    skull = union(skull, nose, k=0.008)
    head = skull
    if st.ears:
        ears = mirror_x(ellipsoid((0.118, 0.012, 0.836), (0.017, 0.027, 0.033), R=rot(y=-12, z=-32)))
        cup = mirror_x(ellipsoid((0.128, 0.0, 0.836), (0.008, 0.018, 0.022), R=rot(y=-12, z=-32)))
        head = union(head, subtract(ears, cup, k=0.006), k=0.014)
    neck = capsule((0, 0.012, st.neck_bottom), (0, 0.012, 0.80 - st.chin_drop), st.neck_r)
    head = union(head, neck, k=0.03)
    return dict(skull=skull, head=head, neck=neck)


@dataclass
class FaceStyle:
    lash: str = '#3b2219'
    brow: str = '#5a3727'
    mouth: str = '#9a4b44'
    brow_width: float = 1.0
    brow_thick: float = 1.0
    brow_lift: float = 0.0
    lashes: int = 2  # flicks at the outer corner
    smile: float = 1.0


def face_strokes(place: Place, skull_world, st: FaceStyle, mats):
    """Closed eyes (∪ lash lines + flicks), brows and a small smile."""
    out = []
    S = place.scale
    for s in (1, -1):
        e = stroke('eye', skull_world, place.xz([(s * 0.027, 0.8445), (s * 0.036, 0.8395), (s * 0.047, 0.8375), (s * 0.058, 0.8395), (s * 0.067, 0.8445)]),
                   place.r([0.0009, 0.0023, 0.0028, 0.0024, 0.0012]), sink=0.4)
        assign(e, mats['lash'])
        out.append(e)
        flicks = [((0.0655, 0.8440), (0.0718, 0.8402)), ((0.0622, 0.8417), (0.0664, 0.8366)), ((0.0588, 0.8402), (0.0612, 0.8350))][: st.lashes]
        for a, b in flicks:
            l = stroke('lash', skull_world, place.xz([(s * a[0], a[1]), (s * (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 0.0003), (s * b[0], b[1])]),
                       place.r([0.0012, 0.0009, 0.0004]), sink=0.4)
            assign(l, mats['lash'])
            out.append(l)
        bw, bt, bl = st.brow_width, st.brow_thick, st.brow_lift
        b = stroke('brow', skull_world, place.xz([(s * (0.046 - 0.015 * bw), 0.8815 + bl), (s * 0.046, 0.8865 + bl), (s * (0.046 + 0.015 * bw), 0.8845 + bl)]),
                   place.r([0.0028 * bt, 0.0037 * bt, 0.0022 * bt]), sink=0.5)
        assign(b, mats['brow'])
        out.append(b)
    sm = st.smile
    m = stroke('mouth', skull_world, place.xz([(-0.016, 0.7935 + 0.004 * sm), (-0.008, 0.7935 + 0.0003 * sm), (0.0, 0.7925), (0.008, 0.7935 + 0.0003 * sm), (0.016, 0.7935 + 0.004 * sm)]),
               place.r([0.0008, 0.0017, 0.0019, 0.0017, 0.0008]), sink=0.4)
    assign(m, mats['mouth'])
    out.append(m)
    return out


def blush_colors(P, place: Place, skin, blush='#ef8c7c', amount=0.55):
    base = np.array(srgb(skin)[:3])
    bl = np.array(srgb(blush)[:3])
    w = np.zeros(len(P))
    for s in (1, -1):
        c = np.array(place.pt((s * 0.064, -0.09, 0.81)))
        d = np.linalg.norm((P - c) / (np.array([1.0, 1.6, 1.25]) * place.scale), axis=1)
        w = np.maximum(w, np.exp(-((d / 0.021) ** 2)) * amount)
    cols = base[None] * (1 - w[:, None]) + bl[None] * w[:, None]
    return np.c_[cols, np.ones(len(P))]


# ════════════════════════════════════════════════════════════ hands & feet


def mitten(wrist, s=1.0, curl=10.0):
    """Left mitten hand in a T-pose, palm down, thumb forward (-Y).
    `wrist` is the wrist joint; everything scales with s."""
    w = np.asarray(wrist, float)
    p = lambda dx, dy, dz: tuple(w + s * np.array([dx, dy, dz]))  # noqa: E731
    cuff = capsule(p(-0.03, 0.0, 0.0), p(0.012, -0.001, -0.001), 0.0205 * s)
    palm = ellipsoid(p(0.03, -0.002, -0.002), (0.031 * s, 0.0305 * s, 0.0165 * s))
    fingers = ellipsoid(p(0.062, -0.002, -0.006), (0.031 * s, 0.0285 * s, 0.0135 * s), R=rot(y=curl))
    tips = ellipsoid(p(0.082, -0.002, -0.011), (0.014 * s, 0.026 * s, 0.0115 * s), R=rot(y=curl * 2))
    thumb = tube([p(0.018, -0.022, -0.004), p(0.038, -0.036, -0.006), p(0.052, -0.044, -0.009)], [0.0125 * s, 0.0108 * s, 0.0092 * s])
    h = union(cuff, palm, k=0.018 * s)
    h = union(h, fingers, k=0.014 * s)
    h = union(h, tips, k=0.01 * s)
    # Soft finger separation on the back of the hand and the palm.
    gaps = []
    for gy in (-0.012, 0.004, 0.019):
        gaps.append(capsule(p(0.06, gy, 0.0105), p(0.098, gy, 0.0005), 0.0024 * s))
        gaps.append(capsule(p(0.06, gy, -0.024), p(0.096, gy, -0.022), 0.0022 * s))
    h = subtract(h, union(*gaps), k=0.004 * s)
    h = union(h, thumb, k=0.012 * s)
    knuckles = dict(index=p(0.05, -0.016, -0.002), middle=p(0.052, 0.0, -0.002), pinky=p(0.049, 0.019, -0.002), tip=p(0.1, 0.0, -0.01))
    return h, knuckles


def bare_foot(ankle, s=1.0, shin_top=0.11):
    """Left bare foot standing flat on z = 0; ankle joint given."""
    a = np.asarray(ankle, float)
    p = lambda dx, dy, dz: (a[0] + s * dx, a[1] + s * dy, dz * s)  # noqa: E731
    shin = capsule(p(0, 0.0, shin_top), p(0, 0.002, 0.045), 0.0255 * s)
    body = ellipsoid(p(0.002, -0.03, 0.03), (0.034 * s, 0.062 * s, 0.03 * s), R=rot(z=-5))
    heel = sphere(p(-0.001, 0.012, 0.03), 0.03 * s)
    f = union(shin, heel, k=0.02 * s)
    f = union(f, body, k=0.025 * s)
    toes = []
    for i, (dx, dy, r) in enumerate([(-0.017, -0.083, 0.0125), (-0.002, -0.081, 0.0098), (0.01, -0.076, 0.009), (0.02, -0.069, 0.0085), (0.028, -0.061, 0.008)]):
        toes.append(sphere(p(dx, dy, 0.016 + 0.0015 * (i == 0)), r * s))
    f = union(f, union(*toes, k=0.004 * s), k=0.008 * s)
    f = intersect(f, plane((0, 0, -1), (0, 0, 0.0015)), k=0.012 * s)
    joints = dict(toe=p(0.004, -0.05, 0.02), toe_tip=p(0.004, -0.09, 0.02))
    return f, joints


# ════════════════════════════════════════════════════════════ kid body


def kid_body(knee_y=-0.012, hand_s=1.12, foot_s=1.08, shin_top=0.11):
    """The shared child skeleton (Yusuf, Maryam) plus mitten hands and feet.
    Feet stand on z = 0, the character faces -Y, about 0.985 tall with hair."""
    wrist = (0.294, 0.008, 0.60)
    ankle = (0.058, 0.008, 0.06)
    hand, kn = mitten(wrist, s=hand_s)
    foot, fj = bare_foot(ankle, s=foot_s, shin_top=shin_top)
    sk = Skeleton(
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
        wrist=wrist,
        hand_tip=kn['tip'],
        index=kn['index'],
        middle=kn['middle'],
        pinky=kn['pinky'],
        hip=(0.054, 0.005, 0.39),
        knee=(0.057, knee_y, 0.22),
        ankle=ankle,
        toe=fj['toe'],
        toe_tip=fj['toe_tip'],
    )
    return sk, hand, foot


def skin_colors(ob, skin):
    return np.tile(np.r_[srgb(skin)[:3], 1], (len(ob.data.vertices), 1))


# ════════════════════════════════════════════════════════════ weights


def body_field(sk: Skeleton, *, shoulder_bias=0.022, knee_bias=0.026, hip_back_bias=0.03, elbow_bias=0.018,
               wrist_shift=0.0, hip_width=0.032, hip_front_width=None, hip_front_bias=0.0, knee_width=0.017, arm_zone=None,
               neck_shift=0.0):
    """A left-side weight field (bone → weight) for points with x ≥ 0."""
    hips, spine, spine1, spine2, neck, head = (np.array(v) for v in (sk.hips, sk.spine, sk.spine1, sk.spine2, sk.neck, sk.head))
    sh, el, wr = np.array(sk.shoulder), np.array(sk.elbow), np.array(sk.wrist)
    hip, kn, an, toe = np.array(sk.hip), np.array(sk.knee), np.array(sk.ankle), np.array(sk.toe)
    Z = (0, 0, 1)
    J = Joint
    torso_j = [J(spine, Z, 0.03), J(spine1, Z, 0.03), J(spine2, Z, 0.03), J(neck + np.array([0, 0, neck_shift]), Z, 0.022), J(head, Z, 0.014)]
    arm_j = [J(sh, (1, 0, 0), 0.026, outer=(0, 0, 1), bias=shoulder_bias),
             J(el, (1, 0, 0), 0.02, outer=(0, 1, 0), bias=elbow_bias),
             J(wr + np.array([wrist_shift, 0, 0]), (1, 0, 0), 0.012)]
    leg_j = [J(hip, (0, 0, -1), hip_width, outer=(0, 1, 0), bias=hip_back_bias, inner_bias=hip_front_bias, inner_width=hip_front_width),
             J(kn, (0, 0, -1), knee_width, outer=(0, -1, 0), bias=knee_bias),
             J(an + np.array([0, 0, 0.016]), (0, 0, -1), 0.014),
             J(toe, (0, -1, 0), 0.012)]
    armpit_z = sh[2] - 0.035
    zone = arm_zone or (np.array([sh[0] - 0.016, 0, armpit_z]), np.array([1.0, 0, 1.1]))

    def field(P):
        torso = chain_weights(P, ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head'], torso_j)
        arm = chain_weights(P, ['Spine2', 'LeftArm', 'LeftForeArm', 'LeftHand'], arm_j)
        leg = chain_weights(P, ['Hips', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase'], leg_j)
        n = zone[1] / np.linalg.norm(zone[1])
        a = smoothstep(-0.008, 0.008, (P - zone[0]) @ n)
        g = smoothstep(hip[2] + 0.015, hip[2] + 0.06, P[:, 2])
        W = {}
        add_into(W, leg, (1 - g) * (1 - a))
        add_into(W, torso, g * (1 - a))
        add_into(W, arm, a)
        return W

    return field


def skirt_weights(P, field, knee_y, blend=0.05, back_share=0.5):
    """Long skirts: no foot weights, and the back of the lower skirt keeps half
    its shin weight on the thigh so it can't flip forward when sitting on the heels."""
    W = sided(P, field, blend=blend)
    frac = back_share * smoothstep(knee_y, knee_y + 0.07, P[:, 1])
    for side in ('Left', 'Right'):
        for b in (f'{side}Foot', f'{side}ToeBase'):
            if b in W:
                W[f'{side}Leg'] = W.get(f'{side}Leg', 0) + W.pop(b)
        if f'{side}Leg' in W:
            moved = W[f'{side}Leg'] * frac
            W[f'{side}Leg'] = W[f'{side}Leg'] - moved
            W[f'{side}UpLeg'] = W.get(f'{side}UpLeg', 0) + moved
    return W


def blend_to_head(P, field, z0, z1):
    """Field weights below z0, rigid Head above z1 (hijabs, beards, caps)."""
    W = sided(P, field)
    h = smoothstep(z0, z1, P[:, 2])
    out = {}
    add_into(out, W, 1 - h)
    out['Head'] = out.get('Head', 0) + h
    return out


def head_weights(P, sk: Skeleton, skull_world, neck_world, field):
    """Head rigid; neck blends from the collar to the head."""
    W = sided(P, field)
    rigid = smoothstep(-0.004, 0.004, neck_world(P) - skull_world(P))
    rigid = np.maximum(rigid, smoothstep(sk.head[2] - 0.004, sk.head[2] + 0.012, P[:, 2]) * 0)
    out = {}
    add_into(out, W, 1 - rigid)
    out['Head'] = out.get('Head', 0) + rigid
    return out


# ════════════════════════════════════════════════════════════ pipeline


@dataclass
class Part:
    name: str
    obj: object
    weights: dict  # bone → per-vertex weights
    colors: np.ndarray | None = None


def finish_part(name, ob, mat, weight_fn, colors=None):
    P = get_verts(ob)
    assign(ob, mat)
    W = weight_fn(P)
    names, M = normalize_weights(W, len(P))
    apply_weights(ob, names, M)
    cols = colors if colors is not None else np.ones((len(P), 4))
    set_vertex_colors(ob, cols)
    return ob


def assemble(name, skel, parts, out_glb):
    arm = build_armature(skel)
    body = join(parts, name)
    bind(body, arm)
    tris = triangulated_count(body)
    log(f'{name}: {len(body.data.vertices)} verts, {tris} triangles, {len(body.data.materials)} materials')
    export_glb(out_glb, arm, [body])
    return arm, body, tris


def pose_relaxed(arm_ob, arm_down=72.0, elbow=18.0):
    """Pose the arms down for hero renders (the exported rest pose stays a T-pose)."""
    import math
    import mathutils

    def pose_world(name, R):
        pb = arm_ob.pose.bones[name]
        bpy.context.view_layer.update()
        h = pb.head.copy()
        T = mathutils.Matrix.Translation(h)
        pb.matrix = T @ R.to_4x4() @ T.inverted() @ pb.matrix
        bpy.context.view_layer.update()

    for side, s in (('Left', 1), ('Right', -1)):
        pose_world(f'{side}Arm', mathutils.Matrix.Rotation(math.radians(s * arm_down), 3, 'Y') @ mathutils.Matrix.Rotation(math.radians(-8), 3, 'X'))
        pose_world(f'{side}ForeArm', mathutils.Matrix.Rotation(math.radians(-elbow), 3, 'X'))


def hero_renders(prefix, height=1.0, face_z=None, views=((0, 4), (30, 6), (-32, 6), (180, 6)), arm_ob=None):
    os.makedirs(os.path.dirname(prefix), exist_ok=True)
    if arm_ob is not None:
        pose_relaxed(arm_ob)
    tgt = (0, 0, height * 0.5)
    outs = []
    for az, el in views:
        orbit_camera(az, el, 2.55 * height, tgt, lens=70)
        out = f'{prefix}_{az:+04d}.png'
        render(out, res=(600, 800), samples=40)
        outs.append(out)
    # Face close-up.
    fz = face_z if face_z is not None else height * 0.83
    orbit_camera(20, 3, 1.05 * height, (0, 0, fz), lens=85)
    out = f'{prefix}_face.png'
    render(out, res=(600, 600), samples=40)
    outs.append(out)
    return outs


# ════════════════════════════════════════════════════════════ app poses (preview)

# Forward-kinematics part of src/components/stage/rig/prayer-poses.ts, in the
# app's normalized space (degrees, Euler XYZ, glTF axes). Arms are IK in the
# app; here they just hang so the legs and clothes can be inspected.
def _kneeling(hips, flex, lift=16):
    knee = 90 + lift + flex - hips
    return {'LeftUpLeg': (-flex, 0, 3), 'RightUpLeg': (-flex, 0, -3), 'LeftLeg': (knee, 0, 0), 'RightLeg': (knee, 0, 0),
            'LeftFoot': (-lift, 0, 0), 'RightFoot': (-lift, 0, 0), 'LeftToeBase': (-80, 0, 0), 'RightToeBase': (-80, 0, 0)}


APP_POSES = {
    'ruku': {'Hips': (70, 0, 0), 'Spine': (3, 0, 0), 'Spine1': (2, 0, 0), 'Neck': (-8, 0, 0), 'Head': (-4, 0, 0),
             'LeftUpLeg': (-72, 0, 1.5), 'RightUpLeg': (-72, 0, -1.5), 'LeftLeg': (4, 0, 0), 'RightLeg': (4, 0, 0),
             'LeftFoot': (-4, 6, 0), 'RightFoot': (-4, -6, 0)},
    'kneel': {'Hips': (12, 0, 0), 'Spine': (4, 0, 0), 'Neck': (8, 0, 0), 'Head': (8, 0, 0), **_kneeling(12, 12)},
    'sujud': {'Hips': (100, 0, 0), 'Spine': (3, 0, 0), 'Spine1': (3, 0, 0), 'Spine2': (2, 0, 0), 'Neck': (4, 0, 0), 'Head': (8, 0, 0),
              **_kneeling(100, 108)},
    'jalsah': {'LeftUpLeg': (-84, 0, 4), 'RightUpLeg': (-84, 0, -4), 'LeftLeg': (172, 0, 0), 'RightLeg': (172, 0, 0),
               'LeftFoot': (92, 0, 0), 'RightFoot': (8, 0, 0), 'RightToeBase': (-70, 0, 0),
               'Spine': (3, 0, 0), 'Spine1': (2, 0, 0), 'Neck': (4.8, 0, 0), 'Head': (7.2, 0, 0)},
}


def apply_app_pose(arm_ob, name, arms=True):
    import math
    import mathutils

    fk = APP_POSES[name]
    Cm = mathutils.Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))  # glTF → Blender axes
    bones = arm_ob.data.bones
    world = {}
    head = {}
    for pb in arm_ob.pose.bones:
        pb.matrix_basis = mathutils.Matrix.Identity(4)
    bpy.context.view_layer.update()

    def order(b):
        d, p = 0, b.parent
        while p:
            d, p = d + 1, p.parent
        return d

    for b in sorted(bones, key=order):
        e = fk.get(b.name, (0, 0, 0))
        q = mathutils.Euler([math.radians(a) for a in e], 'XYZ').to_matrix()
        # three.js 'XYZ' = Rx·Ry·Rz; Blender's Euler 'XYZ' matrix is Rz·Ry·Rx, so build it explicitly.
        rx = mathutils.Matrix.Rotation(math.radians(e[0]), 3, 'X')
        ry = mathutils.Matrix.Rotation(math.radians(e[1]), 3, 'Y')
        rz = mathutils.Matrix.Rotation(math.radians(e[2]), 3, 'Z')
        q = Cm @ (rx @ ry @ rz) @ Cm.transposed()
        rest_head = b.head_local
        if b.parent:
            W = world[b.parent.name] @ q
            h = head[b.parent.name] + world[b.parent.name] @ (rest_head - b.parent.head_local)
        else:
            W = q
            h = rest_head.copy()
        world[b.name], head[b.name] = W, h
        M = mathutils.Matrix.Translation(h) @ (W @ b.matrix_local.to_3x3()).to_4x4()
        arm_ob.pose.bones[b.name].matrix = M
        bpy.context.view_layer.update()
    if arms:
        pose_relaxed(arm_ob, arm_down=70, elbow=30)


def ground(arm_ob, mesh_ob):
    """Move the armature so the posed mesh rests on z = 0 (for previews)."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = mesh_ob.evaluated_get(dg)
    me = ev.to_mesh()
    zs = [ (ev.matrix_world @ v.co).z for v in me.vertices]
    ev.to_mesh_clear()
    arm_ob.location.z -= min(zs)
    bpy.context.view_layer.update()


def pose_renders(prefix, arm_ob, mesh_ob, poses=('jalsah', 'kneel', 'sujud'), height=1.0):
    """Render app postures (legs/spine) from a few angles for skinning checks."""
    outs = []
    for name in poses:
        arm_ob.location = (0, 0, 0)
        apply_app_pose(arm_ob, name)
        ground(arm_ob, mesh_ob)
        for az in (35, 90, 150):
            orbit_camera(az, 14, 2.4 * height, (0, -0.05, 0.25 * height), lens=60)
            out = f'{prefix}_{name}_{az:03d}.png'
            render(out, res=(480, 400), samples=24)
            outs.append(out)
    return outs


def previews(name, arm, body, height=0.985, face_z=0.83):
    """NO_RENDER=1: none. POSES=1: posture checks only. Default: hero renders."""
    if os.environ.get('NO_RENDER'):
        return
    preview_setup()
    prefix = os.path.join(PREVIEW_DIR, name)
    if os.environ.get('POSES'):
        pose_renders(prefix, arm, body, height=height)
    else:
        hero_renders(prefix, height=height, face_z=face_z, arm_ob=arm)
