"""
Cut the example recordings into one clip per line, checked with the Quran Lab ASR (Zipformer v3.1).

    pip install sherpa-onnx numpy
    export ASR_MODEL=<folder with zipformer2-ctc.onnx and tokens.txt>
    python3 tools/voice/cut_lines.py check <audio files>   # the model's symbols with times, and the silences
    python3 tools/voice/cut_lines.py cut                    # lines.json → public/audio/<folder>/<line>.m4a, then checks each clip

Cut points are the silent gaps between lines (lines.json, read off `check`), never published
timings: mp3quran's ayah timings put "Qul" in the basmalah clip and the "wa" of each verse of Al-Falaq
in the verse before it. A gap is [silence start, silence end]; a clip starts 0.12 s before the speech
and keeps 0.25 s of its tail. One gain per source recording (to -18 LUFS, like the qari) keeps lines
cut from one recording equally loud. Encoding matches the other clips: AAC 64 kb/s, 44.1 kHz mono.
"""
import json, os, re, subprocess, sys
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
LEAD, TAIL, GUARD, TARGET = 0.12, 0.25, 0.08, -18.0
_rec = None


def recognizer():
    global _rec
    if _rec is None:
        import sherpa_onnx
        d = os.environ.get('ASR_MODEL')
        if not d or not os.path.exists(os.path.join(d, 'zipformer2-ctc.onnx')):
            sys.exit('Set ASR_MODEL to a folder with zipformer2-ctc.onnx and tokens.txt (the Quran Lab ASR, NPL-1.2)')
        _rec = sherpa_onnx.OnlineRecognizer.from_zipformer2_ctc(
            tokens=os.path.join(d, 'tokens.txt'), model=os.path.join(d, 'zipformer2-ctc.onnx'), num_threads=4,
            sample_rate=16000, feature_dim=80, decoding_method='greedy_search')
    return _rec


def pcm(path, sr=16000):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(sr), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32)


def symbols(x):
    """The model's symbols and their times (s)."""
    rec = recognizer()
    st = rec.create_stream()
    st.accept_waveform(16000, x)
    st.accept_waveform(16000, np.zeros(16000, np.float32))
    st.input_finished()
    while rec.is_ready(st):
        rec.decode_stream(st)
    r = rec.get_result_all(st)
    return list(zip(r.tokens, r.timestamps))


def silences(x, sr=16000, hop=0.01, min_len=0.08, rel_db=-32):
    """Stretches at least 80 ms long, 32 dB under the loud part of the recording."""
    n = int(sr * hop)
    db = 20 * np.log10(np.array([np.sqrt(np.mean(x[i:i + n] ** 2)) + 1e-9 for i in range(0, len(x) - n, n)]))
    quiet = list(db < np.percentile(db, 95) + rel_db) + [False]
    out, start = [], None
    for i, q in enumerate(quiet):
        if q and start is None:
            start = i
        if not q and start is not None:
            if (i - start) * hop >= min_len:
                out.append((round(start * hop, 2), round(i * hop, 2)))
            start = None
    return out


def check(paths):
    for f in paths:
        x = pcm(f)
        print(f'== {os.path.basename(f)}  {len(x) / 16000:.2f}s')
        print('  ' + ' '.join(f'{t}@{s:.2f}' for t, s in symbols(x)))
        print('  silences:', ' '.join(f'{a}-{b}' for a, b in silences(x)))


def loudness(src):
    err = subprocess.run(['ffmpeg', '-v', 'info', '-i', src, '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True).stderr
    return float(re.findall(r'I:\s+(-?[\d.]+) LUFS', err)[-1])


def source(job):
    """A recording, or several consecutive clips of one recording joined back together."""
    files = [os.path.expanduser(f) for f in (job['src'] if isinstance(job['src'], list) else [job['src']])]
    if len(files) == 1:
        return files[0]
    joined = os.path.join(os.environ.get('TMPDIR', '/tmp'), f"prayalong-{job['names'][0]}.wav")
    lst = joined + '.txt'
    open(lst, 'w').write(''.join(f"file '{f}'\n" for f in files))
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lst, '-c:a', 'pcm_s16le', joined], check=True)
    return joined


def cut(spec):
    for job in json.load(open(spec))['recordings']:
        src = source(job)
        out_dir = os.path.join(ROOT, 'public', 'audio', job['folder'])
        os.makedirs(out_dir, exist_ok=True)
        total = len(pcm(src)) / 16000
        gain = TARGET - loudness(src)
        gaps = job['gaps']  # null = the recording's own edge
        for i, name in enumerate(job['names']):
            start = 0.0 if gaps[i] is None else max(0.0, gaps[i][1] - LEAD)
            end = total if gaps[i + 1] is None else min(gaps[i + 1][0] + TAIL, gaps[i + 1][1] - GUARD)
            dur = end - start
            af = f'volume={gain:.2f}dB,alimiter=limit=0.89:level=false,afade=t=in:d=0.012,afade=t=out:st={dur - 0.05:.3f}:d=0.05,apad=pad_dur=0.12'
            out = os.path.join(out_dir, f'{name}.m4a')
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{start:.3f}', '-t', f'{dur:.3f}', '-i', src, '-af', af, '-ar', '44100', '-ac', '1',
                            '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', out], check=True)
            heard = ''.join(t for t, _ in symbols(pcm(out)))
            print(f"{job['folder']}/{name:12} {start:6.2f}–{end:6.2f}s  {heard}")


if __name__ == '__main__':
    cmd, *rest = sys.argv[1:] or ['cut']
    if cmd == 'check':
        check(rest)
    else:
        cut(rest[0] if rest else os.path.join(os.path.dirname(__file__), 'lines.json'))
