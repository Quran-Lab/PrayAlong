"""Shift only skin-coloured texels so their median matches a target skin colour (sRGB).
Usage: blenv/python.exe skin_tone.py -- in.glb out.glb r g b"""
import bpy, sys, os, numpy as np, colorsys
a = sys.argv[sys.argv.index('--') + 1:]
src, dst = os.path.abspath(a[0]), os.path.abspath(a[1]); target = np.array([float(x) for x in a[2:5]])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
img = [i for i in bpy.data.images if i.size[0] > 0][0]
W, H = img.size
px = np.array(img.pixels[:], np.float32).reshape(-1, 4)
rgb = np.clip(px[:, :3], 0, 1) ** (1 / 2.2)  # to sRGB-ish for classification
r, g, b = rgb.T
mx, mn = rgb.max(1), rgb.min(1); sat = (mx - mn) / np.maximum(mx, 1e-6)
hue = np.zeros(len(rgb)); m = mx > mn
hue[m & (mx == r)] = ((g - b)[m & (mx == r)] / (mx - mn)[m & (mx == r)]) % 6
hue *= 60
skin = (mx == r) & (hue < 45) & (sat > 0.05) & (sat < 0.6) & (mx > 0.35) & (r > b + 0.05)
med = np.median(rgb[skin], axis=0)
print('skin texels', skin.sum(), 'median', np.round(med, 3), '->', target)
# per-channel gain in sRGB, applied smoothly by how "skin-like" a texel is
gain = target / np.maximum(med, 1e-3)
new = rgb.copy(); new[skin] = np.clip(rgb[skin] * gain, 0, 1)
px[:, :3] = new ** 2.2
img.pixels[:] = px.ravel(); img.update(); img.pack()
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB')
print('wrote', dst)
