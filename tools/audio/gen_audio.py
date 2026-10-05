"""Generate PrayAlong's voice and ambience files into public/audio/.

    EL=<elevenlabs key> python tools/audio/gen_audio.py voices.json content.json [--only yusuf,ahmad]

voices.json maps each companion to a voice:
  {"yusuf": {"voice_id": "..."} | {"generated_voice_id": "...", "description": "..."}, ...,
   "ambience": {"fajr": ["path/a.mp3", ...], ...}}
content.json comes from scripts/content-dump.test.ts (lines + guide texts).

Every line is spoken with eleven_v4 with character timestamps, which become
per-word timings for the karaoke highlight. Each clip gets the same gentle
voice EQ (low-cut, de-boom, a little clarity) and loudness normalisation.
"""
import base64, concurrent.futures as cf, json, os, subprocess, sys, tempfile, time
import requests

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'public', 'audio')
K = os.environ['EL']
H = {'xi-api-key': K}
API = 'https://api.elevenlabs.io/v1'
EQ = 'highpass=f=95,highpass=f=95,highpass=f=95,equalizer=f=170:t=q:w=1.0:g=-5,equalizer=f=3200:t=q:w=1.2:g=2.5,loudnorm=I=-17:TP=-1.5:LRA=7'
SETTINGS = {'stability': 0.62, 'similarity_boost': 0.8, 'style': 0.0, 'speed': 0.9, 'use_speaker_boost': True}
LANG = {'en': 'en', 'de': 'de', 'fr': 'fr', 'es': 'es', 'tr': 'tr', 'id': 'id', 'nl': 'nl', 'ur': 'ur', 'ar': 'ar'}


def save_voice(name, spec):
    if 'voice_id' in spec:
        return spec['voice_id']
    r = requests.post(f'{API}/text-to-voice', headers=H, json={
        'voice_name': f'PrayAlong {name}', 'voice_description': spec.get('description', f'PrayAlong companion {name}'),
        'generated_voice_id': spec['generated_voice_id']}, timeout=120)
    r.raise_for_status()
    return r.json()['voice_id']


def tts(voice_id, text, lang):
    for attempt in range(6):
        r = requests.post(f'{API}/text-to-speech/{voice_id}/with-timestamps?output_format=mp3_44100_128', headers=H, json={
            'text': text, 'model_id': 'eleven_v4', 'language_code': lang, 'voice_settings': SETTINGS,
            'apply_text_normalization': 'off' if lang == 'ar' else 'auto'}, timeout=300)
        if r.status_code == 429:
            time.sleep(2 + attempt * 2)
            continue
        r.raise_for_status()
        return r.json()
    raise RuntimeError('rate limited')


def words_from_alignment(text, al):
    chars, starts, ends = al['characters'], al['character_start_times_seconds'], al['character_end_times_seconds']
    words, cur = [], None
    for c, s, e in zip(chars, starts, ends):
        if c.isspace():
            if cur: words.append(cur); cur = None
            continue
        if cur is None: cur = [s, e]
        else: cur[1] = e
    if cur: words.append(cur)
    return [[round(a, 3), round(b, 3)] for a, b in words]


def finish(mp3_bytes, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as f:
        f.write(mp3_bytes); tmp = f.name
    subprocess.run(['ffmpeg', '-v', 'quiet', '-y', '-i', tmp, '-af', EQ, '-ac', '1', '-ar', '44100', '-b:a', '96k', dst], check=True)
    os.unlink(tmp)
    dur = float(subprocess.run(['ffprobe', '-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', dst], capture_output=True, text=True).stdout)
    return round(dur, 3)


def job(companion, voice_id, kind, key, text, lang, locale=None):
    rel = f'voices/{companion}/{key}.mp3' if kind == 'line' else f'guide/{companion}/{locale}/{key.replace(".", "-")}.mp3'
    res = tts(voice_id, text, lang)
    dur = finish(base64.b64decode(res['audio_base64']), os.path.join(OUT, rel))
    clip = {'src': rel, 'dur': dur}
    if kind == 'line':
        clip['words'] = words_from_alignment(text, res['alignment'])
    return companion, kind, key, locale, clip


def main():
    voices = json.load(open(sys.argv[1], encoding='utf-8'))
    content = json.load(open(sys.argv[2], encoding='utf-8'))
    only = sys.argv[sys.argv.index('--only') + 1].split(',') if '--only' in sys.argv else None
    man_path = os.path.join(OUT, 'manifest.json')
    manifest = json.load(open(man_path, encoding='utf-8')) if os.path.exists(man_path) else {'version': 1, 'voices': {}, 'ambience': {}}
    jobs = []
    for companion, spec in voices.items():
        if companion == 'ambience' or (only and companion not in only):
            continue
        vid = save_voice(companion, spec)
        print(companion, 'voice', vid, flush=True)
        guide_only = '--guide-only' in sys.argv or '--add-guide' in sys.argv
        old = manifest['voices'].get(companion, {'lines': {}, 'guide': {}})
        manifest['voices'][companion] = {'lines': old['lines'] if guide_only else {}, 'guide': old['guide'] if '--add-guide' in sys.argv else {}}
        for line in ([] if guide_only else content['lines']):
            jobs.append((companion, vid, 'line', line['id'], line['arabic'], 'ar'))
        for locale, msgs in content['guide'].items():
            for key, text in msgs.items():
                if key.startswith('voice.'):
                    jobs.append((companion, vid, 'guide', key, text, LANG[locale], locale))
    with cf.ThreadPoolExecutor(2) as ex:
        futs = [ex.submit(job, *j) for j in jobs]
        for n, f in enumerate(cf.as_completed(futs)):
            companion, kind, key, locale, clip = f.result()
            v = manifest['voices'][companion]
            if kind == 'line': v['lines'][key] = clip
            else: v['guide'].setdefault(locale, {})[key] = clip
            if n % 20 == 0: print(f'{n + 1}/{len(jobs)}', flush=True)
    for prayer, takes in voices.get('ambience', {}).items():
        manifest['ambience'][prayer] = []
        for i, src in enumerate(takes):
            rel = f'ambience/{prayer}/{i}.mp3'
            os.makedirs(os.path.join(OUT, 'ambience', prayer), exist_ok=True)
            subprocess.run(['ffmpeg', '-v', 'quiet', '-y', '-i', src, '-af', 'loudnorm=I=-24:TP=-3:LRA=8', '-ac', '2', '-ar', '44100', '-b:a', '96k', os.path.join(OUT, rel)], check=True)
            manifest['ambience'][prayer].append(rel)
    json.dump(manifest, open(man_path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('wrote', man_path)


if __name__ == '__main__':
    main()
