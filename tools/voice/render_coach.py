"""
Render the voice coach's English lines (src/voice/coach-lines.json) with
Inflect-Nano-v2 into public/audio/coach/<key>.m4a.

The lines are a fixed set, so they are rendered once here and the browser
only plays ~10 KB clips: no TTS model is downloaded or run on the device.
Quran and dhikr are never spoken by TTS (human qari only).

    pip install sherpa-onnx soundfile
    python3 tools/voice/render_coach.py            # downloads the model once

Model: csukuangfj/vits-inflect-en-nano-v2 (the sherpa-onnx packaging of
owensong/Inflect-Nano-v2, Apache-2.0), FP32. The author does not release
INT8/FP16 because naive quantization audibly damages the waveform decoder;
measured here INT8 is 5.8 MB but 2.3x slower on CPU, and FP16 does not
convert cleanly. Offline rendering makes the size moot anyway.
"""
import json
import os
import subprocess
import sys
import urllib.request

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CACHE = os.environ.get('TTS_CACHE', os.path.join(os.path.expanduser('~'), '.cache', 'prayalong-tts'))
REPO = 'https://huggingface.co/csukuangfj/vits-inflect-en-nano-v2/resolve/main/'
FILES = ['model.onnx', 'tokens.txt'] + [f'espeak-ng-data/{f}' for f in (
    'phondata', 'phonindex', 'phontab', 'intonations', 'en_dict', 'phondata-manifest', 'lang/gmw/en', 'lang/gmw/en-US')]
SPEED = 0.92  # a calm teacher's pace


def fetch():
    for f in FILES:
        path = os.path.join(CACHE, f)
        if not os.path.exists(path):
            os.makedirs(os.path.dirname(path), exist_ok=True)
            print('download', f)
            urllib.request.urlretrieve(REPO + f, path)


def main():
    import sherpa_onnx
    import soundfile as sf

    fetch()
    vits = sherpa_onnx.OfflineTtsVitsModelConfig(
        model=os.path.join(CACHE, 'model.onnx'), tokens=os.path.join(CACHE, 'tokens.txt'),
        data_dir=os.path.join(CACHE, 'espeak-ng-data'), noise_scale=0.5, noise_scale_w=0.6)
    tts = sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(vits=vits, num_threads=4)))
    lines = json.load(open(os.path.join(ROOT, 'src', 'voice', 'coach-lines.json')))['lines']
    out_dir = os.path.join(ROOT, 'public', 'audio', 'coach')
    os.makedirs(out_dir, exist_ok=True)
    only = set(sys.argv[1:])
    for key, text in lines.items():
        if only and key not in only:
            continue
        a = tts.generate(text, sid=0, speed=SPEED)
        x = np.array(a.samples, dtype=np.float32)
        x = np.concatenate([np.zeros(int(0.05 * a.sample_rate), np.float32), x, np.zeros(int(0.12 * a.sample_rate), np.float32)])
        wav = os.path.join(CACHE, f'{key}.wav')
        sf.write(wav, x, a.sample_rate)
        out = os.path.join(out_dir, f'{key}.m4a')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', wav, '-af', 'loudnorm=I=-18:TP=-2', '-ar', '24000', '-ac', '1',
                        '-c:a', 'aac', '-b:a', '48k', '-movflags', '+faststart', out], check=True)
        print(f'{key:16} {len(x) / a.sample_rate:4.1f}s {os.path.getsize(out) // 1024:3d} KB  {text}')


if __name__ == '__main__':
    main()
