"""
The reference figure: "MUSLIM PRAYER ISLAM SALAH" by sameka (Sketchfab, CC BY 4.0), a man with a
Mixamo skeleton who prays two rak'ahs on a mat. Both companions are this figure: his body, his
proportions and his motion, dressed in their own clothes.

    tools/characters/source/muslim_prayer_islam_salah.glb      (not in git, 9 MB)
    https://sketchfab.com/3d-models/muslim-prayer-islam-salah-eb0f80a7278243b4988b159fc957bbd5

load() turns the file into a clean scene:
- one armature with the human bones only (Mixamo names without the prefix; the face rig and the
  animation controls are gone, their skin weights handed to the nearest human bone);
- the figure's meshes bound to it in a standing A-pose, at a real height, the balls of the feet
  at the origin and the face towards -Y (the qibla);
- every frame of his prayer, as one world matrix per bone, in that same space (poses.py picks the
  postures from it).

The importer is told not to guess the bind pose from the inverse bind matrices: this file's head
is bound with the face rig, and a guessed bind pose sends it to the sky.
"""
from __future__ import annotations

import math
import os
import re

import bpy
import mathutils
import numpy as np

from common import _ctx, log

SOURCE = os.path.join(os.path.dirname(__file__), 'source', 'muslim_prayer_islam_salah.glb')
#: The clip's own frame rate; the importer keys it at the scene's 24 fps.
FPS = 30
IMPORT_FPS = 24

_FINGERS = [f'{f}{i}' for f in ('Thumb', 'Index', 'Middle', 'Ring', 'Pinky') for i in (1, 2, 3)]
HUMAN = (
    ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head']
    + [f'{s}{b}' for s in ('Left', 'Right') for b in ['Shoulder', 'Arm', 'ForeArm', 'Hand'] + [f'Hand{f}' for f in _FINGERS]]
    + [f'{s}{b}' for s in ('Left', 'Right') for b in ('UpLeg', 'Leg', 'Foot', 'ToeBase')]
)

#: Meshes by material: what each one of the figure's parts is.
PARTS = {
    'Wolf3D_Skin': 'head',
    'Wolf3D_Eye': 'eye',
    'Wolf3D_Teeth': 'teeth',
    'Wolf3D_Body': 'hands',
    'Skin': 'feet',
    'Wolf3D_Outfit_Top': 'top',
    'Wolf3D_Outfit_Bottom': 'bottom',
}

_NAME = re.compile(r'^mixamorig:(.+?)_\d+$')


def clean_name(name):
    m = _NAME.match(name)
    return m.group(1) if m else None


class Reference:
    """The figure in a clean scene. `frames[k]` is {bone: 4×4 world matrix} at time k / FPS."""

    def __init__(self, arm, parts, frames, eyes=()):
        self.arm = arm
        self.eyes = eyes  # the centres of the figure's eyes (A-pose), for the face's marks
        self.parts = parts  # part name → list of mesh objects
        self.frames = frames  # np.ndarray (n, bones, 4, 4)
        self.bones = list(HUMAN)

    def pose_at(self, k):
        return {b: self.frames[k, i] for i, b in enumerate(self.bones)}

    def joint(self, k, bone):
        return self.frames[k, self.bones.index(bone), :3, 3]


def _sample(arm, names, n):
    """World matrices of `names` at each of the clip's n frames."""
    sc = bpy.context.scene
    out = np.zeros((n, len(names), 4, 4))
    bones = [arm.pose.bones[x] for x in names]
    for k in range(n):
        f = 1 + k * IMPORT_FPS / FPS
        sc.frame_set(int(f), subframe=f - int(f))
        W = arm.matrix_world
        for i, pb in enumerate(bones):
            out[k, i] = np.array(W @ pb.matrix)
    # The old armature is scaled; keep the scale in the positions only.
    out[:, :, :3, :3] /= np.linalg.norm(out[:, :, :3, :3], axis=2, keepdims=True)
    return out


def _a_pose(arm, raw, arm_down=42.0):
    """From the first frame (standing, hands by the sides): arms straight and lowered `arm_down`°
    from the horizontal, out to the sides, palms down — room for sleeves under the arms."""
    W = arm.matrix_world
    Wi = W.inverted()
    for side, sx in (('Left', 1), ('Right', -1)):
        a = math.radians(arm_down)
        goal = mathutils.Vector((sx * math.cos(a), 0.0, -math.sin(a)))
        for b in ('Arm', 'ForeArm', 'Hand'):
            pb = arm.pose.bones[raw[f'{side}{b}']]
            bpy.context.view_layer.update()
            M = W @ pb.matrix
            head = M.to_translation()
            tail = W @ (pb.matrix @ mathutils.Vector((0, pb.bone.length, 0, 1))).to_3d()
            d = (tail - head).normalized()
            R = d.rotation_difference(goal).to_matrix().to_4x4()
            T = mathutils.Matrix.Translation(head)
            pb.matrix = Wi @ (T @ R @ T.inverted() @ M)
        bpy.context.view_layer.update()


def load(height=1.75, keep=('head', 'hands', 'feet', 'top', 'bottom')):
    """The figure, `height` metres tall standing, and his prayer. See the module docstring."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SOURCE, guess_original_bind_pose=False)
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    raw = {}
    for b in arm.data.bones:
        n = clean_name(b.name)
        if n in HUMAN:
            raw[n] = b.name
    missing = [b for b in HUMAN if b not in raw]
    if missing:
        raise RuntimeError(f'reference rig lacks {missing}')

    # Which mesh is which, and away with everything else (camera, lights, the mat, a sky sphere).
    parts = {}
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and o.material_slots and o.material_slots[0].material:
            part = PARTS.get(o.material_slots[0].material.name.split('.')[0])
            if part:
                parts.setdefault(part, []).append(o)
                continue
        if o is not arm and o.type != 'EMPTY':
            bpy.data.objects.remove(o)

    act = arm.animation_data.action
    n = int(round((act.frame_range[1] - 1) * FPS / IMPORT_FPS)) + 1
    frames = _sample(arm, [raw[b] for b in HUMAN], n)
    log(f'reference: {n} frames ({n / FPS:.1f} s), {len(arm.data.bones)} bones → {len(HUMAN)}')

    # Bind everything in the A-pose. Skin each mesh there (as world coordinates)…
    bpy.context.scene.frame_set(1)
    _a_pose(arm, raw)
    dg = bpy.context.evaluated_depsgraph_get()
    W = arm.matrix_world.copy()
    rest = {b: W @ arm.pose.bones[raw[b]].matrix for b in HUMAN}
    tails = {b: W @ (arm.pose.bones[raw[b]].matrix @ mathutils.Vector((0, arm.pose.bones[raw[b]].bone.length, 0, 1))).to_3d() for b in HUMAN}
    meshes = [o for objs in parts.values() for o in objs]
    posed = {}
    for o in meshes:
        ev = o.evaluated_get(dg)
        posed[o.name] = np.array([tuple(o.matrix_world @ v.co) for v in ev.data.vertices])

    # …measure him there…
    P = np.concatenate([posed[o.name] for o in meshes])
    feet = [rest[f'{s}ToeBase'].to_translation() for s in ('Left', 'Right')]
    origin = np.array([(feet[0].x + feet[1].x) / 2, (feet[0].y + feet[1].y) / 2, P[:, 2].min()])
    s = height / (P[:, 2].max() - P[:, 2].min())
    log(f'reference: {P[:, 2].max() - P[:, 2].min():.3f} → {height} m (×{s:.3f})')

    def place(p):
        return s * (np.asarray(p, float) - origin)

    # …and give each mesh its posed shape as its rest shape, in that space.
    for o in meshes:
        if o.data.shape_keys:
            o.shape_key_clear()
        for m in list(o.modifiers):
            o.modifiers.remove(m)
        o.parent = None
        o.matrix_world = mathutils.Matrix.Identity(4)
        Q = place(posed[o.name])
        o.data.vertices.foreach_set('co', Q.astype(np.float32).ravel())
        o.data.update()

    eyes = sorted((place(posed[o.name]).mean(0) for o in parts.get('eye', [])), key=lambda c: -c[0])

    # Weights on bones that are going away go to the nearest human bone above them.
    parent_of = {b.name: (b.parent.name if b.parent else None) for b in arm.data.bones}
    human_raw = {v: k for k, v in raw.items()}

    def human_above(name):
        while name and name not in human_raw:
            name = parent_of.get(name)
        return human_raw.get(name, 'Hips')

    for o in meshes:
        groups = {g.index: g.name for g in o.vertex_groups}
        acc = {}
        for v in o.data.vertices:
            for g in v.groups:
                if g.weight <= 0:
                    continue
                b = human_above(groups[g.group])
                acc.setdefault(b, {}).setdefault(v.index, 0.0)
                acc[b][v.index] += g.weight
        o.vertex_groups.clear()
        for b, ws in acc.items():
            vg = o.vertex_groups.new(name=b)
            for i, w in ws.items():
                vg.add([i], w, 'REPLACE')

    # A fresh armature with the human bones, resting in the A-pose.
    data = bpy.data.armatures.new('Rig')
    rig = bpy.data.objects.new('Rig', data)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    with _ctx(rig):
        bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for b in HUMAN:
        e = data.edit_bones.new(b)
        M = rest[b]
        e.head = mathutils.Vector(place(M.to_translation()))
        e.tail = mathutils.Vector(place(tails[b]))
        e.align_roll(M.to_3x3() @ mathutils.Vector((0, 0, 1)))
        eb[b] = e
    for b in HUMAN:
        p = human_above(parent_of[raw[b]])
        if p != b and p in eb and b != 'Hips':
            eb[b].parent = eb[p]
    with _ctx(rig):
        bpy.ops.object.mode_set(mode='OBJECT')
    for pb in rig.pose.bones:
        pb.rotation_mode = 'QUATERNION'

    # The prayer in the same space: rotation as is, position moved and scaled.
    F = frames.copy()
    F[:, :, :3, 3] = s * (F[:, :, :3, 3] - origin)
    # The bones' own frames: the A-pose rest is the first frame with the arms lowered, so a pose
    # matrix sampled from the clip already is the bone's frame (no correction).
    bpy.data.objects.remove(arm)
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    for o in list(bpy.data.objects):
        if o.type == 'EMPTY':
            bpy.data.objects.remove(o)
    for name in [p for p in parts if p not in keep]:
        for o in parts.pop(name):
            bpy.data.objects.remove(o)
    for objs in parts.values():
        for o in objs:
            o.parent = rig
            mod = o.modifiers.new('Armature', 'ARMATURE')
            mod.object = rig
    return Reference(rig, parts, F, eyes)


def set_pose(rig, pose):
    """Pose `rig` with world matrices {bone: 4×4} (parents first)."""
    for b in rig.pose.bones:
        b.rotation_quaternion = (1, 0, 0, 0)
        b.location = (0, 0, 0)
    order = sorted(rig.pose.bones, key=lambda b: len(b.parent_recursive))
    for pb in order:
        if pb.name in pose:
            pb.matrix = mathutils.Matrix(np.asarray(pose[pb.name]).tolist())
            bpy.context.view_layer.update()
