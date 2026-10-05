"""
Check exported companion GLBs against the runtime's expectations.

    python3 tools/characters/validate_glb.py <uncompressed>.glb [more.glb ...]

Run it on the uncompressed masters (meshopt buffers are not decoded here).

Checks: Mixamo bone names and hierarchy (full finger chains), T- or A-pose,
facing +Z, one skin with ≤ 4 influences per vertex summing to 1, triangle
count, file size, and no animations, cameras or lights. Pure Python + numpy.
"""
import json
import os
import struct
import sys

import numpy as np

PARENT = {
    'Spine': 'Hips', 'Spine1': 'Spine', 'Spine2': 'Spine1', 'Neck': 'Spine2', 'Head': 'Neck',
    'LeftShoulder': 'Spine2', 'LeftArm': 'LeftShoulder', 'LeftForeArm': 'LeftArm', 'LeftHand': 'LeftForeArm',
    **{f'LeftHand{f}1': 'LeftHand' for f in ('Thumb', 'Index', 'Middle', 'Ring', 'Pinky')},
    **{f'LeftHand{f}{i}': f'LeftHand{f}{i - 1}' for f in ('Thumb', 'Index', 'Middle', 'Ring', 'Pinky') for i in (2, 3)},
    'LeftUpLeg': 'Hips', 'LeftLeg': 'LeftUpLeg', 'LeftFoot': 'LeftLeg', 'LeftToeBase': 'LeftFoot',
}
PARENT.update({k.replace('Left', 'Right'): v.replace('Left', 'Right') for k, v in list(PARENT.items()) if 'Left' in k})
CTYPE = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def load(path):
    b = open(path, 'rb').read()
    n = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + n])
    bin_start = 20 + n + 8
    return j, b[bin_start:]


def accessor(j, blob, i):
    a = j['accessors'][i]
    v = j['bufferViews'][a['bufferView']]
    dt = CTYPE[a['componentType']]
    nc = NCOMP[a['type']]
    off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = v.get('byteStride')
    item = np.dtype(dt).itemsize * nc
    if stride and stride != item:
        raw = np.frombuffer(blob, np.uint8, count=stride * a['count'], offset=off).reshape(a['count'], stride)[:, :item]
        arr = np.frombuffer(raw.tobytes(), dt).reshape(a['count'], nc)
    else:
        arr = np.frombuffer(blob, dt, count=a['count'] * nc, offset=off).reshape(a['count'], nc)
    if a.get('normalized'):
        arr = arr.astype(np.float32) / np.iinfo(dt).max
    return arr


def world_positions(j):
    nodes = j['nodes']
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get('children', []):
            parent[c] = i

    def local(n):
        from math import isclose  # noqa: F401
        t = np.array(n.get('translation', [0, 0, 0]), float)
        x, y, z, w = n.get('rotation', [0, 0, 0, 1])
        r = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                      [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                      [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
        s = np.array(n.get('scale', [1, 1, 1]), float)
        m = np.eye(4)
        m[:3, :3] = r * s
        m[:3, 3] = t
        return m

    cache = {}

    def world(i):
        if i not in cache:
            m = local(nodes[i])
            cache[i] = world(parent[i]) @ m if i in parent else m
        return cache[i]

    return {n.get('name'): world(i)[:3, 3] for i, n in enumerate(nodes)}, parent


def check(path):
    j, blob = load(path)
    problems = []
    names = [n.get('name') for n in j['nodes']]
    idx = {n: i for i, n in enumerate(names)}
    for bone, par in [('Hips', None)] + list(PARENT.items()):
        if bone not in idx:
            problems.append(f'missing bone {bone}')
    _, parent = world_positions(j)
    for bone, par in PARENT.items():
        if bone in idx and par in idx and parent.get(idx[bone]) != idx[par]:
            problems.append(f'{bone} parent is {names[parent.get(idx[bone], -1)]}, expected {par}')
    pos, _ = world_positions(j)
    P = lambda n: pos[n]  # noqa: E731
    arm = P('LeftHand') - P('LeftArm')
    # T-pose (horizontal) or A-pose (up to ~60° down), always out along +X.
    if arm[0] <= 0 or arm[1] > 0.1 * np.linalg.norm(arm) or arm[1] < -0.87 * np.linalg.norm(arm):
        problems.append(f'left arm is not in a T- or A-pose along +X: {arm.round(3)}')
    leg = P('LeftFoot') - P('LeftUpLeg')
    if leg[1] > -0.8 * np.linalg.norm(leg):
        problems.append('legs are not pointing down')
    toe = P('LeftToeBase') - P('LeftFoot')
    if toe[2] <= 0:
        problems.append('feet do not point to +Z (character must face +Z)')
    if len(j.get('skins', [])) != 1:
        problems.append(f"expected 1 skin, found {len(j.get('skins', []))}")
    for key in ('animations', 'cameras'):
        if j.get(key):
            problems.append(f'has {key}')
    if 'KHR_lights_punctual' in json.dumps(j.get('extensions', {})):
        problems.append('has lights')
    tris = 0
    verts = 0
    for mesh in j['meshes']:
        for prim in mesh['primitives']:
            at = prim['attributes']
            verts += j['accessors'][at['POSITION']]['count']
            tris += j['accessors'][prim['indices']]['count'] // 3
            if 'JOINTS_1' in at:
                problems.append('more than 4 influences per vertex (three.js uses 4)')
            w = accessor(j, blob, at['WEIGHTS_0']).astype(np.float64)
            s = w.sum(1)
            if np.abs(s - 1).max() > 0.02:
                problems.append(f'weights do not sum to 1 (max error {np.abs(s - 1).max():.3f})')
    size = os.path.getsize(path)
    height = pos['Head'][1]
    print(f'{os.path.basename(path)}: {size / 1024:.0f} KB, {tris} triangles, {verts} vertices, '
          f'{len(j["materials"])} materials, {len(j["skins"][0]["joints"])} joints')
    print('  joints (glTF, +Y up, +Z forward): ' + ', '.join(f'{n}={pos[n].round(3).tolist()}' for n in ('Hips', 'Head', 'LeftArm', 'LeftHand', 'LeftLeg', 'LeftFoot')))
    if size > 8 * 1024 * 1024:
        problems.append('larger than 8 MB before compression')
    if tris > 50000:
        problems.append(f'{tris} triangles is over budget')
    for p in problems:
        print('  PROBLEM:', p)
    if not problems:
        print('  ok')
    return not problems


if __name__ == '__main__':
    ok = all([check(p) for p in sys.argv[1:]])
    sys.exit(0 if ok else 1)
