"""Minimal GLB reader/writer for uncompressed glTF binaries (no extensions on buffers)."""
import json, struct
import numpy as np

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


class Glb:
    def __init__(self, path):
        b = open(path, 'rb').read()
        L = struct.unpack('<I', b[12:16])[0]
        self.json = json.loads(b[20:20 + L])
        off = 20 + L
        BL = struct.unpack('<I', b[off:off + 4])[0]
        self.bin = bytearray(b[off + 8:off + 8 + BL])

    def _view(self, ai):
        a = self.json['accessors'][ai]
        bv = self.json['bufferViews'][a['bufferView']]
        dt = np.dtype(CT[a['componentType']])
        nc = NC[a['type']]
        stride = bv.get('byteStride') or dt.itemsize * nc
        start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        return a, dt, nc, stride, start

    def read(self, ai):
        a, dt, nc, stride, start = self._view(ai)
        n = a['count']
        raw = np.frombuffer(self.bin, dtype=np.uint8, count=(n - 1) * stride + dt.itemsize * nc, offset=start)
        out = np.lib.stride_tricks.as_strided(raw, shape=(n, nc * dt.itemsize), strides=(stride, 1)).copy()
        return out.view(dt).reshape(n, nc)

    def write(self, ai, arr):
        a, dt, nc, stride, start = self._view(ai)
        arr = np.ascontiguousarray(arr, dtype=dt).reshape(a['count'], nc)
        rb = arr.view(np.uint8).reshape(a['count'], -1)
        for i in range(a['count']):
            self.bin[start + i * stride:start + i * stride + rb.shape[1]] = rb[i].tobytes()
        if 'min' in a:
            a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()

    def add_accessor(self, arr, type_='VEC3', minmax=True):
        arr = np.ascontiguousarray(arr, dtype=np.float32)
        while len(self.bin) % 4: self.bin.append(0)
        off = len(self.bin)
        self.bin += arr.tobytes()
        self.json['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': arr.nbytes})
        acc = {'bufferView': len(self.json['bufferViews']) - 1, 'componentType': 5126, 'count': len(arr), 'type': type_}
        if minmax:
            acc['min'] = arr.reshape(len(arr), -1).min(0).tolist(); acc['max'] = arr.reshape(len(arr), -1).max(0).tolist()
        self.json['accessors'].append(acc)
        return len(self.json['accessors']) - 1

    def save(self, path):
        while len(self.bin) % 4: self.bin.append(0)
        self.json['buffers'][0]['byteLength'] = len(self.bin)
        js = json.dumps(self.json, separators=(',', ':')).encode()
        while len(js) % 4: js += b' '
        total = 12 + 8 + len(js) + 8 + len(self.bin)
        with open(path, 'wb') as f:
            f.write(struct.pack('<III', 0x46546C67, 2, total))
            f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
            f.write(struct.pack('<II', len(self.bin), 0x004E4942)); f.write(bytes(self.bin))
