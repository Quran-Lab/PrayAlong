"""
The prayer postures, taken from the reference figure's own prayer (reference.py) and set right
where it differs from al-Albani's Talkhis Sifat Salat an-Nabi (docs/characters.md has the list):

  takbir     palms level with the shoulders, fingertips at the tops of the ears, fingers
             outstretched, palms to the qibla (the clip raises them above the head, fingers splayed)
  qiyam      right hand over the left, on the chest (the clip holds them at the stomach)
  ruku       back flat and level, head in line with it, palms on the knees, fingers apart
             (the clip rounds the back and lets the head hang)
  descend    hands on the mat before the knees (the clip puts both down together)
  sujud      forehead and nose down, palms beside the shoulders, fingers together towards the
             qibla, elbows up and out, heels together, toes bent (as the clip, fingers fixed)
  jalsah     iftirash, palms on the thighs (as the clip)
  tashahhud  iftirash; right hand closed, index finger pointing; left palm open on the thigh
  tawarruk   the final sitting, left hip on the mat, left foot out under the right shin (as the
             clip), hands as in tashahhud
  salam-*    the head turned until the cheek shows, about 75° (the clip turns ~45°)
  rise       from the sitting of rest, up on clenched fists (the clip stands straight from sujud)

Every posture is a dict {bone: 4×4 world matrix} in the reference space (metres, the mat at
z = 0, facing -Y). build() writes them as one glTF animation per posture.
"""
from __future__ import annotations

import math

import bpy
import mathutils
import numpy as np

import reference as ref_mod
from reference import set_pose

V = mathutils.Vector
QIBLA = V((0, -1, 0))
UP = V((0, 0, 1))

#: The clip frame each posture starts from (reference.FPS = 30).
FRAMES = {
    'rest': 0,
    'takbir': 24,
    'qiyam': 64,
    'ruku': 157,
    'itidal': 229,
    'descend': 262,
    'sujud': 294,
    'jalsah': 353,
    'tashahhud': 353,
    'tawarruk': 990,
    'salam-right': 990,
    'salam-left': 990,
    'rise': 451,
}

POSES = list(FRAMES)


# ───────────────────────────────────────────────────────────── reading and moving bones


def world(rig, bone):
    return rig.matrix_world @ rig.pose.bones[bone].matrix


def head(rig, bone):
    return world(rig, bone).to_translation()


def tail(rig, bone):
    pb = rig.pose.bones[bone]
    return (rig.matrix_world @ pb.matrix @ V((0, pb.bone.length, 0, 1))).to_3d()


def axis(rig, bone):
    return (tail(rig, bone) - head(rig, bone)).normalized()


def snapshot(rig):
    bpy.context.view_layer.update()
    return {pb.name: np.array(rig.matrix_world @ pb.matrix) for pb in rig.pose.bones}


def turn(rig, bone, R, pivot=None):
    """Rotate `bone` (and everything it carries) by the world rotation R about `pivot` (its head)."""
    pb = rig.pose.bones[bone]
    M = rig.matrix_world @ pb.matrix
    p = pivot if pivot is not None else M.to_translation()
    T = mathutils.Matrix.Translation(p)
    pb.matrix = rig.matrix_world.inverted() @ (T @ R.to_matrix().to_4x4() @ T.inverted() @ M)
    bpy.context.view_layer.update()


def aim(rig, bone, direction):
    """Swing `bone` (shortest way) so it points along `direction`."""
    turn(rig, bone, axis(rig, bone).rotation_difference(V(direction).normalized()))


def orient(rig, bone, R3):
    """Give `bone` the world orientation R3 (3×3), keeping its head where it is."""
    pb = rig.pose.bones[bone]
    M = rig.matrix_world @ pb.matrix
    N = R3.to_4x4()
    N.translation = M.to_translation()
    pb.matrix = rig.matrix_world.inverted() @ N
    bpy.context.view_layer.update()


def frame3(y, z):
    """A rotation whose Y axis is `y` and whose Z axis is as close to `z` as possible."""
    y = V(y).normalized()
    x = y.cross(V(z)).normalized()
    z = x.cross(y)
    return mathutils.Matrix((x, y, z)).transposed()


# ───────────────────────────────────────────────────────────── limbs


def arm_ik(rig, side, wrist, pole):
    """Two-bone IK: put the `side` wrist at `wrist`, the elbow bent towards `pole`."""
    up, lo = f'{side}Arm', f'{side}ForeArm'
    s = head(rig, up)
    a = (head(rig, lo) - s).length
    b = (head(rig, f'{side}Hand') - head(rig, lo)).length
    to = V(wrist) - s
    d = min(max(to.length, abs(a - b) + 1e-4), a + b - 1e-4)
    u = to.normalized()
    cos_a = (a * a + d * d - b * b) / (2 * a * d)
    bend = V(pole) - u * V(pole).dot(u)
    bend = bend.normalized() if bend.length > 1e-6 else V((0, 0, -1))
    elbow = s + u * (a * cos_a) + bend * (a * math.sqrt(max(0.0, 1 - cos_a * cos_a)))
    aim(rig, up, elbow - s)
    aim(rig, lo, (s + u * d) - head(rig, lo))


def hand_frame(rig, side, fingers, palm):
    """Orient the hand so its fingers point along `fingers` and its palm faces `palm`."""
    hand = f'{side}Hand'
    f = V(fingers).normalized()
    p = V(palm).normalized()
    p = (p - f * p.dot(f)).normalized()
    # The hand bone's Y axis runs along the hand; find the current palm normal from the knuckles.
    cur_f = (head(rig, f'{side}HandMiddle1') - head(rig, hand)).normalized()
    cur_p = _palm(rig, side)
    A = frame3(cur_f, cur_p)
    B = frame3(f, p)
    R = (B @ A.transposed()).to_quaternion()
    turn(rig, hand, R)
    # Share the twist with the forearm so the wrist does not corkscrew.
    lo = f'{side}ForeArm'
    ax = axis(rig, lo)
    q = world(rig, hand).to_quaternion() @ world(rig, lo).to_quaternion().inverted()
    tw = 2 * math.atan2(V((q.x, q.y, q.z)).dot(ax), q.w)
    tw = (tw + math.pi) % (2 * math.pi) - math.pi
    keep = world(rig, hand).to_3x3()
    turn(rig, lo, mathutils.Quaternion(ax, tw * 0.5))
    orient(rig, hand, keep)


def _palm(rig, side):
    """Unit normal out of the palm."""
    h = head(rig, f'{side}Hand')
    i = head(rig, f'{side}HandIndex1')
    p = head(rig, f'{side}HandPinky1')
    m = head(rig, f'{side}HandMiddle1')
    n = (m - h).cross(i - p) if side == 'Left' else (i - p).cross(m - h)
    return n.normalized()


def fingers(rig, side, curl=0.0, spread=0.0, thumb=0.0, point=False):
    """Curl the fingers (0 straight … 1 a fist), spread them (degrees between neighbours), tuck the
    thumb; `point` keeps the index straight while the others close."""
    palm = _palm(rig, side)
    s = 1 if side == 'Left' else -1
    for k, f in enumerate(('Index', 'Middle', 'Ring', 'Pinky')):
        c = 0.0 if (point and f == 'Index') else curl
        base = f'{side}Hand{f}1'
        # Fan the fingers out from the middle, in the plane of the palm.
        fan = (k - 1.2) * spread * s
        if fan:
            turn(rig, base, mathutils.Quaternion(palm, math.radians(fan)))
        for seg, amount in ((1, 75), (2, 95), (3, 70)):
            b = f'{side}Hand{f}{seg}'
            bend = axis(rig, b).cross(palm).normalized()
            turn(rig, b, mathutils.Quaternion(bend, math.radians(amount * c)))
    if thumb:
        for seg, amount in ((1, 25), (2, 35), (3, 40)):
            b = f'{side}HandThumb{seg}'
            bend = axis(rig, b).cross(palm).normalized()
            turn(rig, b, mathutils.Quaternion(bend, math.radians(amount * thumb)))


def straighten_fingers(rig, side):
    """Lay every finger along the back of the hand (a flat, open hand)."""
    hand_y = axis(rig, f'{side}Hand')
    palm = _palm(rig, side)
    for f in ('Index', 'Middle', 'Ring', 'Pinky'):
        for seg in (1, 2, 3):
            b = f'{side}Hand{f}{seg}'
            d = axis(rig, b)
            # Keep the finger's sideways direction, drop its curl towards the palm.
            flat = d - palm * d.dot(palm)
            if flat.length > 1e-4 and seg == 1:
                aim(rig, b, flat + hand_y * 0.6)
            elif flat.length > 1e-4:
                aim(rig, b, axis(rig, f'{side}Hand{f}{seg - 1}'))


def turn_head(rig, yaw_deg, pitch_deg=0.0):
    """Turn the head about the vertical (positive = to the figure's right), 35 % in the neck."""
    for bone, share in (('Neck', 0.35), ('Head', 0.65)):
        turn(rig, bone, mathutils.Quaternion(UP, -math.radians(yaw_deg * share)))
    if pitch_deg:
        right = axis(rig, 'Head').cross(QIBLA).normalized()
        turn(rig, 'Head', mathutils.Quaternion(right, math.radians(pitch_deg)))


# ───────────────────────────────────────────────────────────── the postures


def _sides():
    return (('Left', 1), ('Right', -1))


def fix_takbir(rig):
    shoulder = {s: head(rig, f'{s}Arm') for s, _ in _sides()}
    for side, sx in _sides():
        sh = shoulder[side]
        # The wrist just above the shoulder, a hand's width out from the cheek, a little forward.
        wrist = V((sh.x * 0.86, sh.y - 0.1, sh.z + 0.015))
        arm_ik(rig, side, wrist, pole=V((sx * 0.6, 0.2, -1)))
        hand_frame(rig, side, fingers=V((sx * 0.06, -0.05, 1)), palm=QIBLA)
        straighten_fingers(rig, side)
        fingers(rig, side, curl=0.06, spread=4)


def fix_qiyam(rig):
    """Left hand on the chest, the right one over its wrist and forearm."""
    chest = (head(rig, 'Spine2') * 0.45 + head(rig, 'Neck') * 0.55)
    front = _front_of(rig, chest.z) - 0.02
    # The left palm flat on the chest, fingers towards the right shoulder.
    arm_ik(rig, 'Left', V((0.075, front - 0.025, chest.z - 0.035)), pole=V((1, 0.4, -0.6)))
    hand_frame(rig, 'Left', fingers=V((-1, -0.05, 0.12)), palm=V((0, 1, 0)))
    straighten_fingers(rig, 'Left')
    # The right one over the back of the left hand, wrist and forearm.
    arm_ik(rig, 'Right', V((-0.045, front - 0.055, chest.z - 0.02)), pole=V((-1, 0.4, -0.6)))
    hand_frame(rig, 'Right', fingers=V((1, 0.05, 0.04)), palm=V((0, 1, -0.05)))
    straighten_fingers(rig, 'Right')
    fingers(rig, 'Right', curl=0.12)


_FRONT = {}


def _front_of(rig, z):
    """How far forward (min y) the torso surface reaches at height z, from the collider body."""
    pts = _FRONT.get('pts')
    if pts is None:
        return head(rig, 'Spine2').y - 0.11
    band = pts[np.abs(pts[:, 2] - z) < 0.02]
    band = band[np.abs(band[:, 0]) < 0.08]
    return float(band[:, 1].min()) if len(band) else head(rig, 'Spine2').y - 0.11


def fix_ruku(rig):
    """A flat back, level from the hips to the shoulders, the head in line, legs straight. As in a
    real ruku the hips go back over the heels (the straight legs lean back a little), so the palms
    reach the knees with the back level."""
    ankles = (head(rig, 'LeftFoot') + head(rig, 'RightFoot')) / 2
    feet = {s: world(rig, f'{s}Foot').to_3x3() for s, _ in _sides()}
    turn(rig, 'Hips', mathutils.Quaternion(V((1, 0, 0)), math.radians(-13)), pivot=ankles)
    for side, _ in _sides():
        orient(rig, f'{side}Foot', feet[side])
    level = V((0, -1, -0.12)).normalized()
    for b in ('Spine', 'Spine1', 'Spine2'):
        aim(rig, b, level)
    # The head joint on the line of the back (the neck bone's own axis runs behind it), the
    # crown forward: the face to the mat, neither raised nor dropped.
    v = head(rig, 'Head') - head(rig, 'Neck')
    turn(rig, 'Neck', v.rotation_difference(V((0, -1, 0.03))))
    aim(rig, 'Head', V((0, -1, 0.0)))
    for side, sx in _sides():
        knee = head(rig, f'{side}Leg')
        # The wrist just above the knee, the fingers spread down over the kneecap.
        wrist = knee + V((sx * 0.012, -0.06, 0.12))
        arm_ik(rig, side, wrist, pole=V((sx * 1, 0.3, 0.2)))
        hand_frame(rig, side, fingers=V((sx * 0.08, -0.25, -1)), palm=V((0, 1, 0.1)))
        straighten_fingers(rig, side)
        fingers(rig, side, curl=0.18, spread=9)


def fix_descend(rig):
    """Hands down on the mat first, shoulder width, in front of the knees still in the air."""
    reach = (head(rig, 'LeftForeArm') - head(rig, 'LeftArm')).length + (head(rig, 'LeftHand') - head(rig, 'LeftForeArm')).length
    for _ in range(14):
        sh = head(rig, 'LeftArm')
        if (sh - V((sh.x * 1.05, sh.y - 0.06, 0.06))).length < reach * 0.97:
            break
        # Lean further over until the palms reach the mat.
        turn(rig, 'Spine', mathutils.Quaternion(V((1, 0, 0)), math.radians(3)))
    for side, sx in _sides():
        sh = head(rig, f'{side}Arm')
        wrist = V((sh.x * 1.05, sh.y - 0.06, 0.06))
        arm_ik(rig, side, wrist, pole=V((sx * 0.6, 1, 0)))
        hand_frame(rig, side, fingers=V((sx * 0.1, -1, 0)), palm=V((0, 0, -1)))
        straighten_fingers(rig, side)
        fingers(rig, side, curl=0.05, spread=2)


def fix_sujud(rig):
    """Palms flat beside the shoulders, fingers together towards the qibla, elbows up and out."""
    for side, sx in _sides():
        w = head(rig, f'{side}Hand')
        sh = head(rig, f'{side}Arm')
        wrist = V((w.x, sh.y - 0.12, 0.05))
        arm_ik(rig, side, wrist, pole=V((sx * 1, 0.4, 1.2)))
        hand_frame(rig, side, fingers=V((sx * 0.06, -1, 0)), palm=V((0, 0, -1)))
        straighten_fingers(rig, side)
        fingers(rig, side, curl=0.04, spread=0)


def _thigh_hand(rig, side, sx, lift=0.045, back=0.07):
    """The wrist over the thigh, a little behind the knee."""
    knee = head(rig, f'{side}Leg')
    hip = head(rig, f'{side}UpLeg')
    along = (knee - hip).normalized()
    return knee - along * back + V((0, 0, lift))


def fix_sitting(rig, point):
    for side, sx in _sides():
        wrist = _thigh_hand(rig, side, sx)
        arm_ik(rig, side, wrist, pole=V((sx * 0.4, 0.6, -1)))
        thigh = (head(rig, f'{side}Leg') - head(rig, f'{side}UpLeg')).normalized()
        if point and side == 'Right':
            # A closed hand on the thigh, the index finger pointing to the qibla.
            hand_frame(rig, side, fingers=thigh + V((0, 0, -0.12)), palm=V((-sx, 0, -0.45)))
            straighten_fingers(rig, side)
            fingers(rig, side, curl=0.95, point=True, thumb=0.7)
        else:
            hand_frame(rig, side, fingers=thigh + V((0, 0, -0.25)), palm=V((0, 0, -1)))
            straighten_fingers(rig, side)
            fingers(rig, side, curl=0.12, spread=3)


def fix_rise(rig):
    """Knees still down, hips up, the weight on clenched fists on the mat (al-'ajn)."""
    for side, sx in _sides():
        w = head(rig, f'{side}Hand')
        arm_ik(rig, side, V((w.x, w.y + 0.04, 0.085)), pole=V((sx * 0.6, 1, 0)))
        hand_frame(rig, side, fingers=V((sx * 0.1, -1, 0)), palm=V((0, 0, -1)))
        straighten_fingers(rig, side)
        fingers(rig, side, curl=0.95, thumb=0.8)


SITTING = ('jalsah', 'tashahhud', 'tawarruk', 'salam-right', 'salam-left')


def settle(rig, body, clearance=0.002):
    """Lift the whole figure until its lowest point (skin, trousers) rests on the mat instead of
    in it: the reference's sitting postures sink a little."""
    if body is None:
        return
    bpy.context.view_layer.update()
    ev = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
    z = min((body.matrix_world @ v.co).z for v in ev.data.vertices)
    if z < clearance:
        pb = rig.pose.bones['Hips']
        M = rig.matrix_world @ pb.matrix
        M.translation.z += clearance - z
        pb.matrix = rig.matrix_world.inverted() @ M
        bpy.context.view_layer.update()


_BODY = {}


def author(ref, name):
    """Pose the reference rig in `name` and return its world matrices."""
    rig = ref.arm
    set_pose(rig, ref.pose_at(FRAMES[name]))
    if name == 'takbir':
        fix_takbir(rig)
    elif name == 'qiyam':
        fix_qiyam(rig)
    elif name == 'ruku':
        fix_ruku(rig)
    elif name == 'descend':
        fix_descend(rig)
    elif name == 'sujud':
        fix_sujud(rig)
    elif name == 'jalsah':
        fix_sitting(rig, point=False)
    elif name in ('tashahhud', 'tawarruk'):
        fix_sitting(rig, point=True)
    elif name.startswith('salam'):
        fix_sitting(rig, point=True)
        turn_head(rig, 75 if name == 'salam-right' else -75)
    elif name == 'rise':
        fix_rise(rig)
    if name in SITTING:
        settle(rig, _BODY.get('body'))
    return snapshot(rig)


def author_all(ref, body_points=None, body=None):
    if body_points is not None:
        _FRONT['pts'] = body_points
    _BODY['body'] = body
    return {name: author(ref, name) for name in POSES}
