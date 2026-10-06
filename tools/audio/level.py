"""Level every voice clip to the same loudness (EBU R128, -16 LUFS, true peak
-1.5 dBTP): measure each clip, then apply one fixed gain and a gentle
limiter, so every line and every companion sounds equally loud.

    python tools/audio/level.py public/audio/voices public/audio/guide
"""
import concurrent.futures as cf, glob, os, re, subprocess, sys, tempfile
TARGET = -16.0

def measure(f):
    e = subprocess.run(['ffmpeg', '-i', f, '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True).stderr
    m = re.findall(r'I:\s+(-?[\d.]+) LUFS', e)
    return float(m[-1]) if m else None

def level(f):
    i = measure(f)
    if i is None or i < -60: return f, None
    gain = TARGET - i
    fd, tmp = tempfile.mkstemp(suffix='.mp3')
    os.close(fd)
    subprocess.run(['ffmpeg', '-v', 'quiet', '-y', '-i', f, '-af', f'volume={gain:.2f}dB,alimiter=limit=0.84:attack=3:release=60:level=disabled', '-ac', '1', '-ar', '44100', '-b:a', '96k', tmp], check=True)
    import shutil
    shutil.move(tmp, f)
    return f, round(gain, 1)

# Folders (every .mp3 inside) or single files.
files = [f for d in sys.argv[1:] for f in ([d] if d.endswith('.mp3') else glob.glob(os.path.join(d, '**', '*.mp3'), recursive=True))]
with cf.ThreadPoolExecutor(8) as ex:
    gains = [g for _, g in ex.map(level, files) if g is not None]
print(len(files), 'clips; gain applied min', min(gains), 'max', max(gains))
