"""Drop unused vertex attributes (Blender's empty COLOR_n, TEXCOORD_1) from a GLB.
python strip_attrs.py in.glb out.glb"""
import sys
from glbio import Glb
g = Glb(sys.argv[1])
for m in g.json['meshes']:
    for p in m['primitives']:
        for k in [k for k in p['attributes'] if k.startswith('COLOR_') or k == 'TEXCOORD_1']:
            del p['attributes'][k]
g.save(sys.argv[2])
print('stripped', sys.argv[2])
