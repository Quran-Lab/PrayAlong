// Real-voice evaluation of the follower on short surahs (al-Kawthar,
// al-Ikhlas and the six others), from recordings of real people prepared by
// scripts/voice-real-set.py (local only). Runs the real worker, follower and
// driver in Chromium, several pages in parallel.
//
//   python scripts/voice-real-set.py           # once
//   node scripts/voice-real.mjs [--out name] [--parallel 3]
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d)
const SET = resolve(opt('set', join(ROOT, 'test-results/realvoice')))
const OUT = join(ROOT, 'test-results/voice', opt('out', 'realvoice'))
const parallel = Number(opt('parallel', '3'))

const only = opt('only', '')
const items = JSON.parse(await readFile(join(SET, 'set.json'), 'utf8')).filter((x) => x.file.includes(only))
const server = await createServer({
  root: ROOT,
  server: { port: 5201, strictPort: false, hmr: false, watch: null, headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' } },
  logLevel: 'error',
})
await server.listen()
const base = server.resolvedUrls.local[0]
await mkdir(OUT, { recursive: true })

const shards = Array.from({ length: parallel }, (_, k) => items.filter((_, i) => i % parallel === k))
const results = []
await Promise.all(
  shards.map(async (shard, k) => {
    const browser = await chromium.launch()
    const page = await browser.newPage()
    page.on('pageerror', (e) => console.log(`  [${k}] pageerror`, e.message))
    await page.route((u) => u.pathname.startsWith('/realvoice/'), async (route) => {
      const file = join(SET, decodeURIComponent(new URL(route.request().url()).pathname.replace('/realvoice/', '')))
      if (!existsSync(file)) return route.fulfill({ status: 404 })
      await route.fulfill({ body: await readFile(file), contentType: 'audio/wav' })
    })
    await page.goto(base + '?lab&voice&batch')
    await page.waitForFunction(() => !!window.__voiceRealBatch)
    const list = shard.map((x) => ({ url: `/realvoice/${x.file}`, surah: x.surah, ayahs: x.ayahs }))
    const res = await page.evaluate((l) => window.__voiceRealBatch(l), list)
    res.forEach((r, i) => results.push({ ...shard[i], ...r }))
    console.log(`  shard ${k}: ${res.length} done`)
    await browser.close()
  }),
)
await server.close()
await writeFile(join(OUT, 'results.json'), JSON.stringify(results, null, 1))

// Aggregate per group.
const groups = new Map()
for (const r of results) {
  const key = r.source === 'tlog' ? `TLOG verse ${r.surah}` : `el-mohafez ${r.surah}${r.band && r.band !== 'mixed' ? ` (${r.band})` : ''}`
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(r)
}
const pct = (xs, p) => {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.round(p * (s.length - 1)))]
}
console.log('| set | n | all lines done | lines done | words shown | surah named right | end lag p50/p95 (s) | timer moves |')
console.log('|---|---|---|---|---|---|---|---|')
for (const [key, rs] of [...groups].sort()) {
  const all = rs.filter((r) => r.done.length === r.expected.length).length
  const lines = rs.reduce((n, r) => n + r.done.length, 0)
  const linesT = rs.reduce((n, r) => n + r.expected.length, 0)
  const words = rs.reduce((n, r) => n + r.words[0], 0)
  const wordsT = rs.reduce((n, r) => n + r.words[1], 0)
  const planned = (r) => (r.surah === 'ikhlas' ? 'ikhlas' : 'kawthar')
  const named = rs.filter((r) => r.source !== 'tlog').filter((r) => (r.surah === planned(r) ? r.switchedTo === null : r.switchedTo === r.surah)).length
  const namedT = rs.filter((r) => r.source !== 'tlog').length
  const lags = rs.map((r) => r.endLag).filter((x) => x !== null)
  const timers = rs.reduce((n, r) => n + r.timerMoves, 0)
  console.log(`| ${key} | ${rs.length} | ${all}/${rs.length} | ${lines}/${linesT} | ${(words / Math.max(1, wordsT)).toFixed(2)} | ${namedT ? `${named}/${namedT}` : '-'} | ${pct(lags, 0.5)?.toFixed(2)}/${pct(lags, 0.95)?.toFixed(2)} | ${timers} |`)
}
