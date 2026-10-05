import os, base64, requests, concurrent.futures as cf
from PIL import Image, ImageDraw, ImageFont
KEY = os.environ['QL_KEY']; URL = 'https://backend-router.quranlab.ai/v1/images/generations'
STYLE = ('Full-body 3D character render in the soft, rounded style of a modern Pixar animated film, smooth matte materials, soft studio lighting, slightly large head. '
 'Standing straight facing the camera, front view, arms held a little away from the body (relaxed A-pose), small soft hands with fingers. Whole body head to toes in frame. Plain pure white background, no props, no text. '
 'FACE: a smooth, perfectly flat rounded face surface with ONLY two soft, gentle eyebrows. Absolutely NO eyes, NO eye sockets or hollows, NO eyelids, NO nose (no bump at all), NO mouth, NO lips, NO blush, NO rosy cheeks.')
CAST = {
 'Ahmad': 'A kind young Muslim man with warm skin, short neat dark hair and a short neat dark beard along the jaw, wearing a plain loose light sand-beige thobe with long sleeves reaching his ankles and a white knitted kufi cap. Bare feet.',
 'Maryam': 'A young Muslim woman wearing a soft sage-green hijab that fully covers her hair, ears, neck and chest and frames her face, and a loose, flowing, opaque modest abaya in muted dusty blue with long sleeves, reaching the floor and covering her feet. Only the face and hands are visible.',
 'Aisha': 'A 9-year-old Muslim girl wearing a soft lilac hijab that fully covers her hair, ears, neck and chest and frames her face, and a loose modest cream long dress with long sleeves reaching the floor and covering her feet. Only the face and hands are visible.',
}
def one(k, i):
    body = {'model': 'ag/gemini-3.1-flash-image', 'prompt': f'{CAST[k]} {STYLE}', 'n': 1, 'size': 'auto', 'quality': 'auto', 'background': 'auto', 'image_detail': 'high', 'output_format': 'png'}
    for _ in range(3):
        try:
            r = requests.post(URL, headers={'Authorization': f'Bearer {KEY}'}, json=body, timeout=300); r.raise_for_status(); d = r.json()['data'][0]
            img = base64.b64decode(d['b64_json']) if d.get('b64_json') else requests.get(d['url'], timeout=120).content
            p = f'concepts/cast_{k}_{i}.png'; open(p, 'wb').write(img); return list(CAST).index(k), i, k, p
        except Exception as e: err = e
    raise err
with cf.ThreadPoolExecutor(6) as ex: res = sorted(f.result() for f in [ex.submit(one, k, i) for k in CAST for i in range(3)])
h = 600; ims = [Image.open(p).convert('RGB') for *_, p in res]; ims = [im.resize((int(im.width*h/im.height), h)) for im in ims]
w = max(im.width for im in ims); sheet = Image.new('RGB', (w*3, (h+48)*3), 'white'); dr = ImageDraw.Draw(sheet); f = ImageFont.truetype('arial.ttf', 30)
for n, ((_, i, k, _), im) in enumerate(zip(res, ims)):
    r, c = divmod(n, 3); sheet.paste(im, (c*w, r*(h+48)+48)); dr.text((c*w+14, r*(h+48)+8), f'{k}  ({i+1})', fill='black', font=f)
sheet.save('concepts/cast_sheet.png'); print('ok')
