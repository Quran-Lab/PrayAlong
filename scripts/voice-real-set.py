"""Build a real-voice test set for the voice follower from local recitation data.

Real people, not TTS: learners and app users on phones (el-mohafez: whole
short surahs; TLOG, the Tarteel app logs: single verses). Audio is converted to
16 kHz mono WAV under test-results/realvoice/ (gitignored) with set.json. The
recordings stay on this machine; nothing is uploaded or committed.

Usage: python scripts/voice-real-set.py [--root F:/quran-recitations] [--seed 1]
"""
from __future__ import annotations

import argparse
import io
import json
import random
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "test-results" / "realvoice"
SURAH_AYAHS = {103: 3, 108: 3, 109: 6, 110: 3, 111: 5, 112: 4, 113: 5, 114: 6}
NAMES = {103: "asr", 108: "kawthar", 109: "kafirun", 110: "nasr", 111: "masad", 112: "ikhlas", 113: "falaq", 114: "nas"}


def to_wav(src_bytes_or_path, dst: Path) -> bool:
    args = ["ffmpeg", "-v", "error", "-y", "-i", "pipe:0" if isinstance(src_bytes_or_path, bytes) else str(src_bytes_or_path), "-ac", "1", "-ar", "16000", str(dst)]
    r = subprocess.run(args, input=src_bytes_or_path if isinstance(src_bytes_or_path, bytes) else None, capture_output=True)
    return r.returncode == 0 and dst.exists() and dst.stat().st_size > 16000


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="F:/quran-recitations")
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()
    root = Path(args.root)
    rnd = random.Random(args.seed)
    OUT.mkdir(parents=True, exist_ok=True)
    items = []

    # el-mohafez: whole surahs (1..last), deduplicated, split by age for 108 and 112.
    import pyarrow.parquet as pq
    pools: dict[tuple[int, str], list[dict]] = {}
    with open(root / "el_mohafez/index.jsonl", encoding="utf-8") as f:
        for line in f:
            r = json.loads(line)
            s = r.get("surah")
            if s in SURAH_AYAHS and r.get("ayah_start") == 1 and r.get("ayah_end") == SURAH_AYAHS[s] and not r.get("duplicate_of"):
                age = r.get("age_group") or ""
                band = "child" if age in ("5-10", "11-15") else "adult"
                pools.setdefault((s, band), []).append(r)
    picks = []
    for s in SURAH_AYAHS:
        if s in (108, 112):
            for band in ("adult", "child"):
                pool = pools.get((s, band), [])
                picks += [(s, band, r) for r in rnd.sample(pool, min(15, len(pool)))]
        else:
            for band, n in (("adult", 10), ("child", 5)):
                pool = pools.get((s, band), [])
                picks += [(s, band, r) for r in rnd.sample(pool, min(n, len(pool)))]
    by_shard: dict[str, list] = {}
    for p in picks:
        by_shard.setdefault(p[2]["shard"], []).append(p)
    for shard, ps in by_shard.items():
        # Stream small batches (big nested audio columns cannot be read whole).
        pf = pq.ParquetFile(root / "el_mohafez/data" / shard)
        wanted = {p[2]["row"]: p for p in ps}
        found: dict[int, object] = {}
        offset = 0
        for batch in pf.iter_batches(batch_size=32, columns=["audio"]):
            col = batch.column(0)
            for k in range(len(col)):
                if offset + k in wanted:
                    found[offset + k] = col[k].as_py()
            offset += len(col)
            if len(found) == len(wanted):
                break

        for s, band, r in sorted(ps, key=lambda p: p[2]["row"]):
            audio = found.get(r["row"])
            if audio is None:
                continue
            data = audio["bytes"] if isinstance(audio, dict) else audio
            name = f"em-{s}-{r['clip_id'].replace(':', '_')}.wav"
            if to_wav(data, OUT / name):
                items.append({"file": name, "source": "el-mohafez", "surah": NAMES[s], "ayahs": [1, SURAH_AYAHS[s]], "age": r.get("age_group"), "band": band, "country": r.get("country"), "tajweed": r.get("tajweed_level")})
        print(f"{shard}: {len(ps)}", file=sys.stderr)

    # TLOG: single verses of al-Kawthar and al-Ikhlas.
    audio_dir = root / "tlog_full/audio"
    files = [p.name for p in audio_dir.iterdir() if p.name.split("_")[0] in ("108", "112")]
    for s in (108, 112):
        for a in range(1, SURAH_AYAHS[s] + 1):
            pool = [f for f in files if f.startswith(f"{s}_{a}_")]
            for f in rnd.sample(pool, min(15, len(pool))):
                name = f"tlog-{f.replace('.flac', '.wav')}"
                if to_wav(audio_dir / f, OUT / name):
                    items.append({"file": name, "source": "tlog", "surah": NAMES[s], "ayahs": [a, a]})
    (OUT / "set.json").write_text(json.dumps(items, indent=1), encoding="utf-8")
    print(f"{len(items)} recordings in {OUT}")


if __name__ == "__main__":
    main()
