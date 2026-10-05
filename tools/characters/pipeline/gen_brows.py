import os, base64, requests, concurrent.futures as cf
from PIL import Image, ImageDraw, ImageFont
KEY = os.environ['QL_KEY']; URL = 'https://backend-router.quranlab.ai/v1/images/generations'
P = ('Full-body 3D character render in the soft, rounded style of a modern Pixar animated film, smooth matte materials, soft studio lighting. '
 'A 10-year-old Muslim boy with warm light-brown skin and short neat dark brown hair, wearing a plain loose white thobe (long robe) with long sleeves reaching his ankles and a small white knitted kufi cap, bare feet. '
 'Standing straight facing the camera, front view, arms held a little away from the body (relaxed A-pose), small soft hands with fingers. Whole body head to toes in frame. Plain pure white background, no props, no text. '
 'FACE: a smooth, perfectly flat rounded face surface with ONLY two soft, gentle, friendly eyebrows. Absolutely NO eyes, NO eye sockets or hollows, NO eyelids, NO nose (no bump at all), NO mouth, NO lips. ')
VAR = {'J  Brows only': '', 'K  Brows + blush': 'Add two soft rosy blush spots on the cheeks.'}
def one(k, i):
    body = {'model': 'ag/gemini-3.1-flash-image', 'prompt': P + VAR[k], 'n': 1, 'size': 'auto', 'quality': 'auto', 'background': 'auto', 'image_detail': 'high', 'output_format': 'png'}
    r = requests.post(URL, headers={'Authorization': f'Bearer {KEY}'}, json=body, timeout=300); r.raise_for_status(); d = r.json()['data'][0]
    img = base64.b64decode(d['b64_json']) if d.get('b64_json') else requests.get(d['url'], timeout=120).content
    p = f'concepts/brows_{k[0]}_{i}.png'; open(p, 'wb').write(img); return k, i, p
with cf.ThreadPoolExecutor(6) as ex: res = sorted(f.result() for f in [ex.submit(one, k, i) for k in VAR for i in range(3)])
h = 640; ims = [Image.open(p).convert('RGB') for *_, p in res]; ims = [im.resize((int(im.width*h/im.height), h)) for im in ims]
w = max(im.width for im in ims); sheet = Image.new('RGB', (w*3, (h+48)*2), 'white'); dr = ImageDraw.Draw(sheet); f = ImageFont.truetype('arial.ttf', 30)
for n, ((k, i, _), im) in enumerate(zip(res, ims)):
    r, c = divmod(n, 3); sheet.paste(im, (c*w, r*(h+48)+48)); dr.text((c*w+14, r*(h+48)+8), f'{k}  ({i+1})', fill='black', font=f)
sheet.save('concepts/brows_sheet.png'); print('ok')
