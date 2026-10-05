"""Build-time phoneme targets for the voice follower.

Writes src/content/phonemes.json: for every line in src/content/recitations.ts,
the phoneme string of each displayed word, in the phonetic script the Quran
Lab zipformer CTC model emits (the 42/43-symbol repeat-encoded convention of
quran_transcript, produced here by quran-g2p's oracle expander).

Usage (needs a checkout of quran-g2p; nothing else):

    python scripts/gen-phonemes.py [--g2p C:/path/to/quran-g2p]

Quran lines are phonemized from quran-g2p's pinned Tanzil Uthmani text (the
orthography its rules are written against). The adhkar are phonemized from the
fully vowelled Arabic in recitations.ts after a small, explicit conversion to
that orthography (hamzat al-wasl -> alef wasla, madda alef -> hamza + alef).
Each line is read as one breath group: ibtida at the start, waqf at the end.
Words are grouped by the G2P's own word index, so the word count always equals
the displayed word count (the script fails loudly otherwise).
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

# Lines whose displayed Quran text starts with the basmala (Tanzil simple puts it
# in verse 1 of every surah but al-Fatiha); recited as basmala, pause, verse.
BASMALA_PREFIXED = {"kawthar-1", "ikhlas-1"}

FATHA, DAMMA, KASRA, SUKUN, SHADDA = "\u064e", "\u064f", "\u0650", "\u0652", "\u0651"
HARAKAT = {FATHA, DAMMA, KASRA, SUKUN, SHADDA, "\u064b", "\u064c", "\u064d", "\u0670"}


def parse_recitations() -> list[tuple[str, str]]:
    src = (ROOT / "src/content/recitations.ts").read_text(encoding="utf-8")
    pairs = re.findall(r"id:\s*'([^']+)',\s*arabic:\s*'([^']+)'", src)
    if len(pairs) < 30:
        raise SystemExit(f"parsed only {len(pairs)} lines from recitations.ts")
    refs = dict(re.findall(r"'([a-z]+-\d)':\s*'(\d+:\d+)'", src))
    verses = json.loads((ROOT / "src/content/quran/ar.json").read_text(encoding="utf-8"))["verses"]
    out = []
    for line_id, arabic in pairs:
        out.append((line_id, verses.get(line_id, arabic), refs.get(line_id)))
    return out


def to_uthmani_min(text: str) -> str:
    """Bring imlaei adhkar text into the orthography quran-g2p's census expects."""
    words = text.split()
    out = []
    for w in words:
        # Madda alef: always hamza + fatha + madd alef in this text (aamin, aal).
        w = w.replace("\u0622", "\u0621" + FATHA + "\u0627")
        # Hamzat al-wasl: a bare alef (no haraka after it) at the start of the
        # word, optionally after a one-letter prefix (wa/fa/bi/li/ka) carrying a
        # haraka, and followed by a consonant that has sukun or is the article lam.
        m = re.match(r"^((?:[\u0648\u0641\u0628\u0643\u0644][\u064e\u0650])?)\u0627(?=[^\u064e\u064f\u0650\u0652\u0651])", w)
        if m:
            rest = w[m.end():]
            nxt = rest[1:2] if rest else ""
            if rest.startswith("\u0644") or nxt == SUKUN:
                w = m.group(1) + "\u0671" + rest
        # Final yeh carrying no haraka after kasra is a madd; Tanzil writes alef maksura.
        out.append(w)
    return " ".join(out)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--g2p", default=os.environ.get("QURAN_G2P") or next(
        (str(d / "quran-g2p") for d in ROOT.parents if (d / "quran-g2p/src/quran_g2p").exists()), ""),
                    help="path to a quran-g2p checkout (default: $QURAN_G2P or a sibling of any parent dir)")
    ap.add_argument("--out", default=str(ROOT / "src/content/phonemes.json"))
    args = ap.parse_args()
    g2p = Path(args.g2p)
    if not (g2p / "src/quran_g2p").exists():
        raise SystemExit(f"quran-g2p not found at {g2p} (pass --g2p)")
    sys.path.insert(0, str(g2p / "src"))
    sys.path.insert(0, str(g2p))
    from quran_g2p.phonemize import phonemize
    from quran_g2p.textbank import AyahRef, TextBank
    from oracle.expand import expand

    try:
        rev = subprocess.run(["git", "-C", str(g2p), "rev-parse", "--short", "HEAD"],
                             capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        rev = "unknown"

    tb = TextBank.load("tanzil")

    def words_of(text: str, ref=None) -> list[str]:
        (seg,) = phonemize(text, edition="tanzil", ref=ref).segments
        n_words = len(text.split())
        groups: list[list] = [[] for _ in range(n_words)]
        for p in seg.phones:
            groups[p.word_index].append(p)
        return [expand(g, ghunna_repeat=2, ikhfa_repeat=2) if g else "" for g in groups]

    lines: dict[str, dict] = {}
    for line_id, arabic, ref in parse_recitations():
        shown = len(arabic.split())
        if ref:
            s, a = map(int, ref.split(":"))
            words = []
            if line_id in BASMALA_PREFIXED:
                words += words_of(tb.ayah(AyahRef(1, 1)), AyahRef(1, 1))
            words += words_of(tb.ayah(AyahRef(s, a)), AyahRef(s, a))
            source = f"quran {ref}"
        else:
            words = words_of(to_uthmani_min(arabic))
            source = "adhkar"
        if len(words) != shown:
            raise SystemExit(f"{line_id}: {len(words)} phoneme words for {shown} displayed words")
        if any(not w for w in words):
            raise SystemExit(f"{line_id}: a word produced no phonemes: {words}")
        lines[line_id] = {"words": words}
        print(f"{line_id:12} {source:12} {' | '.join(words)}")

    payload = {
        "version": 1,
        "generator": f"scripts/gen-phonemes.py via quran-g2p {rev} (oracle.expand, ghunna 2, ikhfa 2)",
        "script": "quran_transcript phonetic script (the zipformer v3.1 CTC output alphabet)",
        "lines": lines,
    }
    Path(args.out).write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {args.out} ({len(lines)} lines)")


if __name__ == "__main__":
    main()
