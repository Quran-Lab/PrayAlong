// Live-App replay: the real App (?voice), with every layer it wires (phoneme
// follower, driver, speech-burst follow, stuck and posture fallbacks), hearing
// a rendered prayer through Chromium's fake microphone in real time.
//
//   node scripts/voice-app.mjs --set std|real|amin [--parallel 3] [--out name] [--only substring]
//
// Scores every session move against the timeline: early (before the person
// had finished what comes before, by more than 0.3 s), late (more than 3 s
// after), skipped steps, and repeated lines (tasbih) left before their last
// repetition ended. Reasons come from the App's console ("[voice] burst
// advance", "[voice] timer advance", "[voice] move ...").
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { extname, join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { augment } from './voice-augment.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (k) => args.includes(`--${k}`)
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d)
const OUT = join(ROOT, 'test-results/voice', opt('out', `app-${opt('set', 'std')}`))
const parallel = Number(opt('parallel', '1'))
/** Silence before the prayer: the model loads meanwhile (audio before it is ready is dropped). */
const LEAD = Number(opt('lead', '15'))

const C = (prayer, speaker, extra = {}) => ({ prayer, speaker, snr: null, gain: '1', quiet: '1', seed: '1', perturb: false, aug: null, tight: false, joined: false, amin: null, ...extra })
const SETS = {
  std: [
    ...['aisha', 'yusuf', 'ahmad'].map((s) => C('fajr', s)),
    C('maghrib', 'yusuf', { seed: '2' }),
    C('fajr', 'aisha', { snr: '10' }),
    C('fajr', 'aisha', { snr: '5' }),
    C('fajr', 'aisha', { gain: '0.1' }),
    C('dhuhr', 'ahmad', { quiet: '0.2', seed: '3' }),
  ],
  real: [
    ...['aisha', 'yusuf', 'ahmad', 'maryam'].map((speaker, k) => C('fajr', speaker, { aug: 'real', seed: String(11 + k), tight: true, joined: k % 2 === 0, perturb: true })),
    C('maghrib', 'yusuf', { aug: 'fast', seed: '21', tight: true, joined: true }),
    C('isha', 'aisha', { aug: 'slow', seed: '22' }),
    C('fajr', 'ahmad', { aug: 'room', seed: '23', tight: true }),
    C('fajr', 'maryam', { aug: 'quiet', seed: '24', snr: '15' }),
    C('dhuhr', 'yusuf', { aug: 'real', seed: '25', quiet: '0.3', tight: true }),
  ],
  amin: ['skip', 'pause', 'joined'].flatMap((amin, k) => [C('fajr', 'aisha', { amin, seed: String(31 + k) }), C('maghrib', 'yusuf', { amin, seed: String(34 + k) })]),
}
const only = opt('only', '')
const configs = (SETS[opt('set', 'std')] ?? []).filter((c) => !only || name(c).includes(only))
function name(c) {
  return `${c.prayer}-${c.speaker}-${c.snr ? `snr${c.snr}` : 'clean'}-g${c.gain}${c.quiet !== '1' ? `-q${c.quiet}` : ''}${c.perturb ? `-perturb${c.seed}` : ''}${c.aug ? `-${c.aug}${c.seed}` : ''}${c.tight ? '-tight' : ''}${c.joined ? '-joined' : ''}${c.amin ? `-amin-${c.amin}` : ''}`
}
const query = (c) =>
  `?lab&voice&replay&prayer=${c.prayer}&speaker=${c.speaker}&seed=${c.seed}&gain=${c.gain}&quietGain=${c.quiet}` +
  `${c.snr ? `&snr=${c.snr}` : ''}${c.perturb ? '&perturb' : ''}${c.tight ? '&tight' : ''}${c.joined ? '&joined' : ''}${c.amin ? `&amin=${c.amin}` : ''}`

const AUDIO = [join(ROOT, 'public/audio'), join(ROOT, '../../../public/audio')].find((d) => existsSync(join(d, 'manifest.json')))
const server = await createServer({
  root: ROOT,
  server: { port: 5205, strictPort: false, hmr: false, watch: null, headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' } },
  logLevel: 'error',
})
await server.listen()
const base = server.resolvedUrls.local[0]
await mkdir(OUT, { recursive: true })

const TYPES = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.json': 'application/json' }
async function serveAudio(page, c) {
  const dir = c.aug ? await augment({ audioDir: AUDIO, outDir: join(ROOT, 'test-results/aug'), preset: c.aug, voices: [c.speaker], seed: Number(c.seed) }) : AUDIO
  await page.route((u) => u.pathname.startsWith('/audio/'), async (route) => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^.*?\/audio\//, ''))
    const file = join(dir, rel)
    if (!existsSync(file)) return route.fulfill({ status: 404 })
    await route.fulfill({ body: await readFile(file), contentType: TYPES[extname(file)] ?? 'application/octet-stream' })
  })
}

/** 16-bit mono WAV with `lead` seconds of silence in front. */
function withLead(wav, lead) {
  const sr = wav.readUInt32LE(24)
  const dataAt = wav.indexOf('data') + 8
  const pcm = wav.subarray(dataAt)
  const pad = Buffer.alloc(Math.round(lead * sr) * 2)
  const out = Buffer.alloc(44 + pad.length + pcm.length)
  wav.copy(out, 0, 0, 44)
  out.write('RIFF', 0)
  out.writeUInt32LE(36 + pad.length + pcm.length, 4)
  out.write('data', 36)
  out.writeUInt32LE(pad.length + pcm.length, 40)
  pad.copy(out, 44)
  pcm.copy(out, 44 + pad.length)
  return { buf: out, seconds: (pad.length + pcm.length) / 2 / sr }
}

async function runOne(c) {
  const label = name(c)
  // 1. Render the take and its timeline in the lab page.
  const b = await chromium.launch()
  const p = await b.newPage()
  await serveAudio(p, c)
  await p.goto(base + query(c))
  await p.waitForFunction(() => !!window.__voiceRender)
  const { wav, timeline } = await p.evaluate(() => window.__voiceRender())
  await b.close()
  fixEnds(timeline, Buffer.from(wav, 'base64'), 0)
  const { buf, seconds } = withLead(Buffer.from(wav, 'base64'), LEAD)
  const wavPath = join(OUT, `${label}.wav`)
  await writeFile(wavPath, buf)

  // 2. The App, hearing it as the microphone.
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wavPath}%noloop`, '--autoplay-policy=no-user-gesture-required'],
  })
  const context = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1280, height: 800 } })
  // Listen mode without the companion talking over the take (the take cannot wait for it).
  await context.addInitScript(() => {
    try {
      const k = 'prayalong:session'
      const s = JSON.parse(localStorage.getItem(k) || 'null') ?? { state: {}, version: 0 }
      s.state.settings = { ...(s.state.settings ?? {}), mode: 'pray', sounds: false }
      s.state.demo = true
      localStorage.setItem(k, JSON.stringify(s))
    } catch {}
    window.__logs = []
    const log = console.log.bind(console)
    console.log = (...a) => {
      const msg = a.filter((x) => typeof x === 'string' && !x.startsWith('color:')).join(' ').replace(/%c/g, '')
      if (msg.includes('[voice]')) window.__logs.push({ t: performance.now(), msg: msg.slice(0, 300) })
      log(...a)
    }
    // When the speech model is ready (audio before that is not decoded).
    const W = window.Worker
    window.Worker = class extends W {
      constructor(...a) {
        super(...a)
        this.addEventListener('message', (e) => {
          if (e.data?.type === 'ready' && window.__readyAt === undefined) window.__readyAt = performance.now()
        })
      }
    }
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async (cs) => {
      const s = await gum(cs)
      if (cs?.audio && window.__micT0 === undefined) window.__micT0 = performance.now()
      return s
    }
  })
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log(`  ${label} pageerror`, e.message))
  await page.goto(`${base}?voice&prayer=${c.prayer}`)
  await page.evaluate(async () => {
    const m = await import('/src/state/session.ts')
    window.__moves = []
    const st = m.useSession.getState()
    window.__moves.push({ t: performance.now(), index: st.index, phase: st.phase, prayer: st.prayer })
    m.useSession.subscribe((s, prev) => {
      if (s.index !== prev.index || s.phase !== prev.phase) window.__moves.push({ t: performance.now(), index: s.index, phase: s.phase, prayer: s.prayer })
    })
  })
  const t0 = Date.now()
  for (;;) {
    await page.waitForTimeout(2000)
    const done = await page.evaluate(() => window.__moves.at(-1)?.phase === 'complete')
    if (done || Date.now() - t0 > (seconds + 25) * 1000) break
  }
  const { moves, logs, micT0, readyAt } = await page.evaluate(() => ({ moves: window.__moves, logs: window.__logs, micT0: window.__micT0, readyAt: window.__readyAt }))
  await browser.close()
  const result = { label, config: c, timeline, moves, logs, micT0, lead: LEAD, readyAt }
  // The model must be ready before the prayer audio starts, or the run measures the load, not the App.
  result.readyLate = readyAt === undefined || audioT(result, readyAt) > timeline.clips[0].start - 0.5
  // How far the decoder runs behind the microphone (CPU starved: the run measures the machine, not the App).
  const behind = logs
    .map((l) => {
      const m = /"at":([0-9.]+)/.exec(l.msg)
      return m && /\] event /.test(l.msg) ? (l.t - result.micT0) / 1000 - Number(m[1]) : null
    })
    .filter((x) => x !== null)
  // Relative to the best value (the clocks' fixed offset): seconds behind.
  const offset0 = Math.min(...behind)
  const rel = behind.map((x) => x - offset0).sort((a, b) => a - b)
  result.decoderBehind = rel.length ? { p50: +rel[Math.floor(rel.length / 2)].toFixed(2), p95: +rel[Math.floor(rel.length * 0.95)].toFixed(2), max: +rel.at(-1).toFixed(2) } : null
  result.lowPowerLogs = logs.filter((l) => l.msg.includes('decoder lag')).map((l) => `${audioT(result, l.t).toFixed(1)} ${l.msg}`)
  result.score = score(result)
  await writeFile(join(OUT, `${label}.json`), JSON.stringify(result, null, 1))
  return result
}

/** Audio seconds of the take (0 = start of the prayer audio, after the lead). */
const audioT = (r, perf) => (perf - r.micT0) / 1000 - r.lead

/**
 * Ground truth for where a line ends: its last word's label, or where the
 * audio is last audible inside that word if earlier (stretched takes carry a
 * faint labeled tail; see voice-augment.mjs). `lead`: seconds of silence the
 * WAV has before the timeline's zero.
 */
function fixEnds(tl, wav, lead) {
  const at = wav.indexOf('data')
  const sr = wav.readUInt32LE(24)
  const pcm = new Int16Array(wav.buffer.slice(wav.byteOffset + at + 8, wav.byteOffset + at + 8 + (wav.readUInt32LE(at + 4) & ~1)))
  const hop = Math.round(sr / 100)
  const rms = (j) => {
    let q = 0
    for (let k = j * hop; k < (j + 1) * hop && k < pcm.length; k++) q += pcm[k] * pcm[k]
    return Math.sqrt(q / hop)
  }
  for (const c of tl.clips) {
    const w = c.words?.at(-1)
    if (!w || (c.kind !== 'line' && c.kind !== 'takbir')) continue
    const a = Math.floor((w[0] + lead) * 100)
    const b = Math.ceil((w[1] + lead) * 100)
    let peak = 0
    for (let j = Math.floor((c.start + lead) * 100); j < b; j++) peak = Math.max(peak, rms(j))
    if (!peak) continue
    const floor = peak * 10 ** (-35 / 20)
    let last = -1
    for (let j = b; j >= a; j--) if (rms(j) > floor) { last = j; break }
    if (last >= 0) {
      const end = (last + 1) / 100 - lead + 0.05
      if (end < w[1]) w[1] = Math.max(w[0] + 0.05, end)
    }
  }
}

function score(r) {
  const tl = r.timeline
  const lineClips = tl.clips.filter((c) => c.kind === 'line')
  const lastEnd = (i) => {
    const c = lineClips.filter((x) => x.step === i).at(-1)
    return c ? c.words.at(-1)?.[1] ?? c.start + c.dur : null
  }
  const readyAt = (i) => {
    const takbir = tl.clips.find((c) => c.kind === 'takbir' && c.step === i)
    if (takbir) return takbir.words[0]?.[1] ?? takbir.start + takbir.dur / 2
    if (i === 0) return tl.clips[0].start
    for (let j = i - 1; j >= 0; j--) if (lastEnd(j) !== null) return lastEnd(j)
    return null
  }
  const reasonAt = (perf) => {
    const l = [...r.logs].reverse().find((x) => x.t <= perf + 5 && x.t >= perf - 60 && /burst advance|timer advance|stuck after|\] move|line done step|hold/.test(x.msg))
    if (!l) return 'other'
    if (l.msg.includes('burst advance')) return `burst:${/\(([^)]+)\)/.exec(l.msg)?.[1] ?? ''}`
    if (l.msg.includes('timer advance')) return 'timer'
    if (l.msg.includes('stuck after')) return 'stuck'
    const m = /"reason":"([^"]+)"/.exec(l.msg)
    return m ? `voice:${m[1]}` : 'other'
  }
  const arrivals = []
  let prev = null
  for (const m of r.moves) {
    if (prev && m.phase === 'praying' && (m.index !== prev.index || prev.phase !== 'praying')) {
      const t = audioT(r, m.t)
      const ready = readyAt(m.index)
      arrivals.push({ index: m.index, from: prev.phase === 'praying' ? prev.index : -1, t: +t.toFixed(2), ready: ready === null ? null : +ready.toFixed(2), lag: ready === null ? null : +(t - ready).toFixed(2), why: reasonAt(m.t), line: r.timeline.clips.find((c) => c.step === m.index)?.lineId ?? null })
    }
    prev = m
  }
  const early = arrivals.filter((a) => a.lag !== null && a.lag < -0.3)
  const late = arrivals.filter((a) => a.lag !== null && a.lag > 3)
  const skipped = arrivals.filter((a) => a.from >= 0 && a.index > a.from + 1)
  const back = arrivals.filter((a) => a.from >= 0 && a.index < a.from)
  // Repeated lines: left only after the last repetition said (extra ones
  // included), and not more than 3 s after the person was ready for the next
  // step (the end of its takbir's "Allahu" when one is said).
  const repSteps = [...new Set(lineClips.filter((c) => c.rep > 0).map((c) => c.step))]
  const reps = repSteps.map((i) => {
    const leave = arrivals.find((a) => a.from === i)
    const said = tl.clips.filter((c) => (c.kind === 'line' || c.kind === 'extra') && c.step === i)
    const end = said.at(-1).words.at(-1)?.[1] ?? said.at(-1).start + said.at(-1).dur
    const ready = Math.max(end, readyAt(i + 1) ?? end)
    if (!leave) return { step: i, said: said.length, result: 'never left' }
    return { step: i, said: said.length, lag: +(leave.t - end).toFixed(2), lateBy: +(leave.t - ready).toFixed(2), why: leave.why, result: leave.t < end - 0.3 ? 'early' : leave.t > ready + 3 ? 'late' : 'ok' }
  })
  const lags = arrivals.map((a) => a.lag).filter((x) => x !== null).sort((a, b) => a - b)
  const pct = (p) => (lags.length ? lags[Math.min(lags.length - 1, Math.round(p * (lags.length - 1)))] : NaN)
  const byWhy = {}
  for (const a of arrivals) byWhy[a.why] = (byWhy[a.why] ?? 0) + 1
  const earlyWhy = {}
  for (const a of early) earlyWhy[a.why] = (earlyWhy[a.why] ?? 0) + 1
  return {
    steps: new Set(tl.clips.map((c) => c.step)).size,
    arrivals: arrivals.length,
    early: early.length,
    earlyWhy,
    late: late.length,
    skipped: skipped.length,
    back: back.length,
    reps: { steps: reps.length, ok: reps.filter((x) => x.result === 'ok').length, early: reps.filter((x) => x.result === 'early').length, late: reps.filter((x) => x.result === 'late').length },
    lagP50: pct(0.5),
    lagP95: pct(0.95),
    completed: r.moves.at(-1)?.phase === 'complete',
    byWhy,
    detail: { early, late, skipped, reps },
  }
}

// --rescore: score the saved runs again (ground-truth line ends from their WAVs).
if (flag('rescore')) {
  const { readdir } = await import('node:fs/promises')
  for (const f of (await readdir(OUT)).filter((f) => f.endsWith('.json') && f !== 'summary.json')) {
    const r = JSON.parse(await readFile(join(OUT, f), 'utf8'))
    fixEnds(r.timeline, await readFile(join(OUT, f.replace(/\.json$/, '.wav'))), r.lead)
    r.score = score(r)
    await writeFile(join(OUT, f), JSON.stringify(r, null, 1))
    const s = r.score
    console.log(`rescored ${r.label}: early ${s.early} ${JSON.stringify(s.earlyWhy)} late ${s.late} | reps ok ${s.reps.ok}/${s.reps.steps} early ${s.reps.early} late ${s.reps.late} | lag p50 ${s.lagP50} p95 ${s.lagP95}`)
  }
  await server.close()
  process.exit(0)
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
        const s = r.score
        if (r.decoderBehind) console.log(`  ${r.label}: decoder behind the microphone p50 ${r.decoderBehind.p50} s p95 ${r.decoderBehind.p95} s max ${r.decoderBehind.max} s; low-power switches ${r.lowPowerLogs.length}`)
        if (r.readyLate) console.log(`  ${r.label}: model ready only at ${r.readyAt === undefined ? 'never' : audioT(r, r.readyAt).toFixed(1)} s of prayer audio (raise --lead)`)
        console.log(`done ${r.label}: early ${s.early} ${JSON.stringify(s.earlyWhy)} late ${s.late} skipped ${s.skipped} back ${s.back} | reps ok ${s.reps.ok}/${s.reps.steps} early ${s.reps.early} late ${s.reps.late} | lag p50 ${s.lagP50} p95 ${s.lagP95} | complete ${s.completed}`)
      } catch (e) {
        console.log(`FAIL ${name(c)}: ${e.message}`)
      }
    }
  }),
)
await server.close()
const rows = results.sort((a, b) => a.label.localeCompare(b.label)).map((r) => ({ run: r.label, ...r.score, detail: undefined, earlyWhy: JSON.stringify(r.score.earlyWhy), byWhy: undefined, reps: `${r.score.reps.ok}/${r.score.reps.steps} early ${r.score.reps.early} late ${r.score.reps.late}` }))
console.table(rows)
await writeFile(join(OUT, 'summary.json'), JSON.stringify(rows, null, 1))
