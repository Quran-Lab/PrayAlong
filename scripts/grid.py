import sys
from PIL import Image
out_path, *paths = sys.argv[1:]
ims = [Image.open(p) for p in paths]
w, h = ims[0].size
cols = 2 if len(ims) > 1 else 1
rows = (len(ims) + cols - 1) // cols
out = Image.new('RGB', (w * cols, h * rows))
for i, im in enumerate(ims):
    out.paste(im, ((i % cols) * w, (i // cols) * h))
scale = min(1, 1600 / out.size[0])
out = out.resize((int(out.size[0] * scale), int(out.size[1] * scale)))
out.save(out_path)
