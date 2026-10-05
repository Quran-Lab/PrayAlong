// Offline replay harness for the microphone engine.
//
// Builds whole prayers from the companion's per-line recordings (plus the
// movement takbirs between postures), runs them through the REAL ASR worker,
// follower and driver in Playwright Chromium, and scores them against the
// recordings' word timings: lag per word, lineDone accuracy, takbir recall,
// false keyword events.
//
//   node scripts/fetch-voice-model.mjs           # once: stage the model
//   node scripts/voice-replay.mjs                # default matrix
//   node scripts/voice-replay.mjs --prayer fajr --speaker aisha --snr 10 --gain 0.1
//   node scripts/voice-replay.mjs --mic          # through fake audio capture (real time)
//
// Audio: public/audio (or PRAYALONG_AUDIO_DIR). Output: test-results/voice/.
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { augment } from './voice-augment.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'test-results/voice', process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : '')
const args = process.argv.slice(2)
const flag = (k) => args.includes(`--${k}`)
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d)

function findAudio() {
  if (process.env.PRAYALONG_AUDIO_DIR) return process.env.PRAYALONG_AUDIO_DIR
  let dir = ROOT
  for (;;) {
    const c = join(dir, 'public/audio/manifest.json')
    if (existsSync(c)) return dirname(c)
    const up = dirname(dir)
    if (up === dir) throw new Error('no public/audio found; set PRAYALONG_AUDIO_DIR')
    dir = up
  }
}
const AUDIO = findAudio()

// Matrix: each speaker on a jahri prayer, clean / noisy / quiet / both.
const single = opt('prayer', null) || opt('speaker', null) || opt('snr', null) || opt('gain', null) || opt('quiet', null) || flag('perturb') || opt('companion', null) || opt('aug', null)
const C = (prayer, speaker, extra = {}) => ({ prayer, speaker, snr: null, gain: '1', quiet: '1', seed: '1', perturb: false, companion: null, gate: false, aug: null, tight: false, joined: false, amin: null, late: null, ...extra })
const configs = single
  ? [
      C(opt('prayer', 'fajr'), opt('speaker', 'aisha'), {
        snr: opt('snr', null),
        gain: opt('gain', '1'),
        quiet: opt('quiet', '1'),
        seed: opt('seed', '1'),
        perturb: flag('perturb'),
        companion: opt('companion', null),
        gate: flag('gate'),
        aug: opt('aug', null),
        tight: flag('tight'),
        joined: flag('joined'),
        amin: opt('amin', null),
        late: opt('late', null),
      }),
    ]
  : flag('real')
  ? [
      // Real-like takes (scripts/voice-augment.mjs): every speaker, every preset,
      // tasbih back to back and ayat joined where people join them.
      ...['aisha', 'yusuf', 'ahmad', 'maryam'].map((speaker, k) => C('fajr', speaker, { aug: 'real', seed: String(11 + k), tight: true, joined: k % 2 === 0, perturb: true })),
      C('maghrib', 'yusuf', { aug: 'fast', seed: '21', tight: true, joined: true }),
      C('isha', 'aisha', { aug: 'slow', seed: '22' }),
      C('fajr', 'ahmad', { aug: 'room', seed: '23', tight: true }),
      C('fajr', 'maryam', { aug: 'quiet', seed: '24', snr: '15' }),
      C('dhuhr', 'yusuf', { aug: 'real', seed: '25', quiet: '0.3', tight: true }),
    ]
  : flag('lateset')
  ? [
      // The model becomes ready 10-40 s into the prayer (resync).
      ...[10, 25, 40].flatMap((late, k) => [C('fajr', 'aisha', { late: String(late), seed: String(41 + k) }), C('maghrib', 'yusuf', { late: String(late), seed: String(44 + k) })]),
    ]
  : flag('amin')
  ? [
      // Amin left out, after a long pause, joined to the last verse (owner report: "I didn't say amin and it advanced").
      ...['skip', 'pause', 'joined'].flatMap((amin, k) => [C('fajr', 'aisha', { amin, seed: String(31 + k) }), C('maghrib', 'yusuf', { amin, seed: String(34 + k) })]),
    ]
  : flag('stress')
  ? [
      // Human imperfections, and the companion reciting from the speakers.
      C('fajr', 'aisha', { perturb: true, seed: '4' }),
      C('maghrib', 'ahmad', { perturb: true, seed: '5' }),
      C('isha', 'yusuf', { perturb: true, seed: '6', snr: '10' }),
      C('fajr', 'aisha', { companion: 'yusuf', gate: false }),
      C('fajr', 'aisha', { companion: 'yusuf', gate: true }),
    ]
  : [
      ...['aisha', 'yusuf', 'ahmad'].map((speaker) => C('fajr', speaker)),
      C('maghrib', 'yusuf', { seed: '2' }),
      C('fajr', 'aisha', { snr: '10' }),
      C('fajr', 'aisha', { snr: '5' }),
      C('fajr', 'aisha', { gain: '0.1' }),
      C('fajr', 'aisha', { snr: '10', gain: '0.1' }),
      // A silent prayer whispered: every line the sequence marks quiet at -14 dB.
      C('dhuhr', 'ahmad', { quiet: '0.2', seed: '3' }),
    ]
const mic = flag('mic')
const parallel = Number(opt('parallel', mic ? '2' : '3'))

// Same isolation headers as production (public/_headers), so the worker,
// the wasm runtime and the model fetch are exercised under COEP.
const server = await createServer({
  root: ROOT,
  server: {
    port: 5199,
    strictPort: false,
    // Long runs: editing a file must not reload the page mid-prayer.
    hmr: false,
    watch: null,
    headers: flag('no-isolation') ? {} : { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' },
  },
  logLevel: 'error',
})
await server.listen()
const base = server.resolvedUrls.local[0]
console.log(`vite ${base}  audio ${AUDIO}`)
await mkdir(OUT, { recursive: true })

const TYPES = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.json': 'application/json' }
async function serveAudio(page, c) {
  // Augmented takes are rendered once per preset + seed and served in place of public/audio.
  const dir = c?.aug
    ? await augment({ audioDir: AUDIO, outDir: join(ROOT, 'test-results/aug'), preset: c.aug, voices: [c.speaker, ...(c.companion ? [c.companion] : [])], seed: Number(c.seed) })
    : AUDIO
  // Only the site's /audio/ folder (not modules like /src/audio/engine.ts).
  await page.route((u) => u.pathname.startsWith('/audio/'), async (route) => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^.*?\/audio\//, ''))
    const file = join(dir, rel)
    if (!existsSync(file)) return route.fulfill({ status: 404 })
    await route.fulfill({ body: await readFile(file), contentType: TYPES[extname(file)] ?? 'application/octet-stream' })
  })
}

// Another model folder, e.g. --model voice/model-c8/ (scripts/fetch-voice-model.mjs --chunk 8).
const MODEL = opt('model', null)
const query = (c, extra = '') =>
  `?lab&voice&replay&run&prayer=${c.prayer}&speaker=${c.speaker}&seed=${c.seed}&gain=${c.gain}&quietGain=${c.quiet}` +
  `${c.snr ? `&snr=${c.snr}` : ''}${c.perturb ? '&perturb' : ''}${c.companion ? `&companion=${c.companion}` : ''}${c.gate ? '&gate' : ''}${c.tight ? '&tight' : ''}${c.joined ? '&joined' : ''}${c.amin ? `&amin=${c.amin}` : ''}${c.late ? `&late=${c.late}` : ''}${flag('noresync') ? '&noresync' : ''}${flag('notakbir') ? '&notakbir' : ''}` +
  `${MODEL ? `&model=${encodeURIComponent(MODEL)}` : ''}${extra}`
const name = (c) =>
  `${c.prayer}-${c.speaker}-${c.snr ? `snr${c.snr}` : 'clean'}-g${c.gain}${c.quiet !== '1' ? `-q${c.quiet}` : ''}` +
  `${c.perturb ? `-perturb${c.seed}` : ''}${c.companion ? `-companion-${c.gate ? 'gated' : 'open'}` : ''}${c.aug ? `-${c.aug}${c.seed}` : ''}${c.tight ? '-tight' : ''}${c.joined ? '-joined' : ''}${c.amin ? `-amin-${c.amin}` : ''}${c.late ? `-late${c.late}` : ''}${flag('notakbir') ? '-notakbir' : ''}${mic ? '-mic' : ''}`

async function waitResult(page, label) {
  const t0 = Date.now()
  let lastLog = 0
  for (;;) {
    const r = await page.evaluate(() => window.__voiceResult ?? null)
    if (r) return r
    if (Date.now() - lastLog > 30000) {
      const p = await page.evaluate(() => window.__voiceProgress ?? 0)
      console.log(`  ${label}: ${Math.round(p * 100)}% (${Math.round((Date.now() - t0) / 1000)} s)`)
      lastLog = Date.now()
    }
    if (Date.now() - t0 > 40 * 60 * 1000) throw new Error(`${label}: timed out`)
    await new Promise((r) => setTimeout(r, 1000))
  }
}

async function runOne(c) {
  const label = name(c)
  let wavPath = null
  if (mic) {
    // Render the WAV in a plain page first, then play it as the microphone.
    const b = await chromium.launch()
    const p = await b.newPage()
    await serveAudio(p, c)
    await p.goto(base + query(c).replace('&run', ''))
    await p.waitForFunction(() => !!window.__voiceWav)
    const b64 = await p.evaluate(() => window.__voiceWav())
    await b.close()
    wavPath = join(OUT, `${label}.wav`)
    await writeFile(wavPath, Buffer.from(b64, 'base64'))
  }
  const browser = await chromium.launch({
    args: mic
      ? ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wavPath}%noloop`, '--autoplay-policy=no-user-gesture-required']
      : [],
  })
  const context = await browser.newContext({ permissions: mic ? ['microphone'] : [] })
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log(`  ${label} pageerror`, e.message))
  page.on('console', (m) => m.type() === 'error' && console.log(`  ${label} console`, m.text().slice(0, 300)))
  await serveAudio(page, c)
  // --cpu-throttle N: Chrome slows this tab's CPU N times (a laptop-class machine is roughly 2 to 4).
  if (opt('cpu-throttle', null)) await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: Number(opt('cpu-throttle', '1')) })
  await page.goto(base + query(c, mic ? '&source=mic' : ''))
  const isolated = await page.evaluate(() => self.crossOriginIsolated)
  const result = await waitResult(page, label)
  result.crossOriginIsolated = isolated
  await browser.close()
  await writeFile(join(OUT, `${label}.json`), JSON.stringify(result, null, 1))
  if (result.error) throw new Error(`${label}: ${result.error}`)
  return { label, ...result }
}

const results = []
const queue = [...configs]
await Promise.all(
  Array.from({ length: Math.min(parallel, queue.length) }, async () => {
    while (queue.length) {
      const c = queue.shift()
      try {
        const r = await runOne(c)
        results.push(r)
        const m = r.metrics
        console.log(`done ${r.label}: words ${m.words.recall} lag p50 ${m.words.lagP50}s p95 ${m.words.lagP95}s | lineDone ${m.lineDone.accuracy} | takbir ${m.keywords.takbirHit}/${m.keywords.takbirTotal} | false ${m.keywords.falseEvents} | complete ${m.session.completed} (${r.wallSeconds}s wall)`)
      } catch (e) {
        console.log(`FAIL ${name(c)}: ${e.message}`)
        results.push({ label: name(c), error: e.message })
      }
    }
  }),
)
await server.close()

const rows = results
  .filter((r) => r.metrics)
  .sort((a, b) => a.label.localeCompare(b.label))
  .map((r) => {
    const m = r.metrics
    return {
      run: r.label,
      min: m.audioMinutes,
      wordRecall: m.words.recall,
      lagP50: m.words.lagP50,
      lagP95: m.words.lagP95,
      lineDone: `${m.lineDone.onTime}/${m.lineDone.total}`,
      beforeEnd: m.lineDone.beforeEnd,
      endLag: `${m.lineDone.lagP50}/${m.lineDone.lagP95}`,
      reps: `${m.reps.countExact}/${m.reps.steps} shown ${m.reps.repsShown}`,
      early: m.lineDone.early,
      takbir: `${m.keywords.takbirHit}/${m.keywords.takbirTotal}`,
      falseKw: m.keywords.falseEvents,
      falsePerMin: m.keywords.falsePerMin,
      premature: m.session.premature,
      late: m.session.late,
      arrivalP50: m.session.arrivalLagP50,
      arrivalP95: m.session.arrivalLagP95,
      timer: m.session.byReason.timer ?? 0,
      complete: m.session.completed,
      rtf: r.rtf,
    }
  })
console.table(rows)
await writeFile(join(OUT, `summary${mic ? '-mic' : ''}.json`), JSON.stringify(rows, null, 1))
