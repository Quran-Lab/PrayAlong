import os, sys, json, time, base64, requests
K = os.environ['MESHY_KEY']; H = {'Authorization': f'Bearer {K}'}; API = 'https://api.meshy.ai/openapi/v1'
name, path, height = sys.argv[1], sys.argv[2], float(sys.argv[3])
uri = 'data:application/octet-stream;base64,' + base64.b64encode(open(path, 'rb').read()).decode()
r = requests.post(f'{API}/rigging', headers=H, json={'model_url': uri, 'height_meters': height}, timeout=300)
print(r.status_code, r.text[:300]); tid = r.json()['result']
while True:
    t = requests.get(f'{API}/rigging/{tid}', headers=H, timeout=60).json()
    if t['status'] in ('SUCCEEDED', 'FAILED', 'CANCELED'): break
    time.sleep(10)
json.dump(t, open(f'meshy/{name}_rig.json', 'w'), indent=1); print(t['status'], t.get('task_error'))
res = t.get('result', t)
url = res.get('rigged_character_glb_url') or t.get('rigged_character_glb_url')
if url: open(f'meshy/{name}_rigged.glb', 'wb').write(requests.get(url, timeout=300).content); print('saved')
