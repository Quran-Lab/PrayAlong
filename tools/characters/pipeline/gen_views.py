import os, sys, re, io, base64, requests, concurrent.futures as cf
from PIL import Image, ImageDraw, ImageFont
K = os.environ['QL_KEY']
FACE = 'The face must stay a perfectly smooth flat surface with only the two eyebrows: no eyes, no nose and no nose shading, no mouth, no blush.'
KEEP = 'Keep exactly the same character, the same relaxed A-pose with arms slightly away from the body and fingers visible, the same clothes, colours, proportions and lighting, full body head to toe, plain pure white background.'
VIEWS = {
 'front': f'Repeat this exact image as a clean front view. {KEEP} {FACE}',
 'side': f'Show this exact same character from their right side: a true 90 degree side profile view. {KEEP} {FACE}',
 'back': f'Show this exact same character from directly behind: a back view. {KEEP}',
 'threeq': f'Show this exact same character from a three-quarter front view, turned 40 degrees to their left. {KEEP} {FACE}',
}
def edit(ref, prompt):
    b = base64.b64encode(open(ref, 'rb').read()).decode()
    body = {'model': 'ag/gemini-3.1-flash-image', 'messages': [{'role': 'user', 'content': [
        {'type': 'text', 'text': prompt + ' Output one image.'}, {'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,' + b}}]}]}
    for _ in range(3):
        try:
            r = requests.post('https://backend-router.quranlab.ai/v1/chat/completions', headers={'Authorization': f'Bearer {K}'}, json=body, timeout=300)
            m = re.search(r'data:image/[a-z]+;base64,([A-Za-z0-9+/=]+)', r.text)
            if m: return Image.open(io.BytesIO(base64.b64decode(m.group(1)))).convert('RGB')
        except Exception: pass
    raise RuntimeError('no image')
name, ref = sys.argv[1], sys.argv[2]
def job(v):
    im = edit(ref, VIEWS[v]); p = f'concepts/views_{name}_{v}.png'; im.save(p); return v, p
with cf.ThreadPoolExecutor(4) as ex: res = dict(f.result() for f in [ex.submit(job, v) for v in VIEWS])
h = 700; order = ['front', 'threeq', 'side', 'back']
ims = [Image.open(res[v]) for v in order]; ims = [im.resize((int(im.width*h/im.height), h)) for im in ims]
w = max(im.width for im in ims); sheet = Image.new('RGB', (w*4, h+48), 'white'); dr = ImageDraw.Draw(sheet); f = ImageFont.truetype('arial.ttf', 30)
for i, (v, im) in enumerate(zip(order, ims)): sheet.paste(im, (i*w, 48)); dr.text((i*w+14, 8), v, fill='black', font=f)
sheet.save(f'concepts/views_{name}_sheet.png'); print('ok')
