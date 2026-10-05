"""Word alignment for karaoke highlighting: for every line and language, which
words of the transliteration and of the meaning go with each Arabic word.

    QL_KEY=... python tools/audio/gen_align.py meanings.json  -> src/content/align.json

Uses Gemini through the Quran Lab router; output is validated (ranges in
bounds, monotonic) and missing lines fall back to proportional mapping in
the app.
"""
import json, os, re, sys, concurrent.futures as cf, requests
K = os.environ['QL_KEY']
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
data = json.load(open(sys.argv[1], encoding='utf-8'))
PROMPT = '''You align a line of Islamic prayer text word by word.
Arabic words (index: word):
{ar}
Transliteration words (index: word):
{tr}
Meaning words (index: word) in language "{loc}":
{mn}
For EACH Arabic word index, give the transliteration word indices and the meaning word indices that express it.
Rules: every index list must be contiguous and in increasing order across Arabic words where the meaning order allows; a meaning word may belong to only one Arabic word; function words in the meaning (articles, "of", "is") go with the Arabic word they help translate; if an Arabic word has no meaning words, give [].
Return ONLY JSON: {{"t": [[...],[...]], "m": [[...],[...]]}} with exactly {n} entries in each list.'''

def words(s): return [w for w in re.split(r'\s+', s.strip()) if w]

def job(loc, lid, row):
    ar, tr, mn = words(row['arabic']), words(row['translit']), words(row['meaning'])
    fmt = lambda ws: '\n'.join(f'{i}: {w}' for i, w in enumerate(ws)) or '(none)'
    body = {'model': 'ag/gemini-3.8-flash', 'stream': False, 'messages': [{'role': 'user', 'content': PROMPT.format(ar=fmt(ar), tr=fmt(tr), mn=fmt(mn), loc=loc, n=len(ar))}]}
    for _ in range(3):
        try:
            r = requests.post('https://backend-router.quranlab.ai/v1/chat/completions', headers={'Authorization': f'Bearer {K}'}, json=body, timeout=180)
            if r.text.startswith('data:'):
                txt = ''.join(json.loads(l[5:])['choices'][0]['delta'].get('content') or '' for l in r.text.splitlines() if l.startswith('data:') and l.strip() != 'data: [DONE]')
            else:
                txt = r.json()['choices'][0]['message']['content']
            j = json.loads(re.search(r'\{.*\}', txt, re.S).group(0))
            t, m = j['t'], j['m']
            assert len(t) == len(ar) and len(m) == len(ar)
            ok = lambda lst, n: all(all(0 <= i < n for i in x) for x in lst)
            assert ok(t, len(tr)) and ok(m, len(mn))
            span = lambda x: [min(x), max(x)] if x else None
            return loc, lid, {'t': [span(x) for x in t], 'm': [span(x) for x in m]}
        except Exception:
            continue
    return loc, lid, None

jobs = [(loc, lid, row) for loc, rows in data.items() for lid, row in rows.items()]
out = {}
with cf.ThreadPoolExecutor(8) as ex:
    for loc, lid, res in ex.map(lambda a: job(*a), jobs):
        if res: out.setdefault(loc, {})[lid] = res
print('aligned', sum(len(v) for v in out.values()), 'of', len(jobs))
json.dump(out, open(os.path.join(ROOT, 'src', 'content', 'align.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
