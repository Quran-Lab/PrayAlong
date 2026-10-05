import os, sys, json, time, base64, requests
KEY = os.environ['MESHY_KEY']; H = {'Authorization': f'Bearer {KEY}'}; API = 'https://api.meshy.ai/openapi/v1'
name = sys.argv[1]; views = sys.argv[2:]
uri = lambda p: ('data:image/png;base64,' if open(p, 'rb').read(4) == b'\x89PNG' else 'data:image/jpeg;base64,') + base64.b64encode(open(p, 'rb').read()).decode()
body = {'image_urls': [uri(p) for p in views], 'ai_model': 'meshy-7.1', 'should_texture': True, 'enable_pbr': False,
        'should_remesh': True, 'topology': 'triangle', 'target_polycount': 40000, 'pose_mode': 'a-pose',
        'texture_resolution': '2k', 'texture_image_urls': [uri(views[0])], 'target_formats': ['glb']}
r = requests.post(f'{API}/multi-image-to-3d', headers=H, json=body, timeout=180); print(r.status_code, r.text[:300]); tid = r.json()['result']
while True:
    t = requests.get(f'{API}/multi-image-to-3d/{tid}', headers=H, timeout=60).json()
    if t['status'] in ('SUCCEEDED', 'FAILED', 'CANCELED'): break
    time.sleep(15)
json.dump(t, open(f'meshy/{name}_mv.json', 'w'), indent=1); print(t['status'], 'credits', t.get('consumed_credits'), t.get('task_error'))
if t['status'] == 'SUCCEEDED': open(f'meshy/{name}_mv.glb', 'wb').write(requests.get(t['model_urls']['glb'], timeout=300).content); print('saved')
