// Renders synthetic "laptop on the floor" webcam videos of a companion
// praying, with frame-exact ground truth, for the hands-free evaluation.
//
//   npx vite --port 5191 &
//   node scripts/synth/render.mjs --out <dir> [--only <name>] [--probe]
//
// Each video is <dir>/<name>.mjpeg (concatenated JPEGs, 15 fps) plus
// <dir>/<name>.json (config, timeline and per-frame labels). See
// docs/hands-free.md, "Evaluation".
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { conditions, timeline } from './conditions.mjs'

const args = process.argv.slice(2)
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d)
const out = opt('--out', 'synth')
const only = opt('--only', null)
const shard = Number(opt('--shard', '0'))
const shards = Number(opt('--shards', '1'))
const base = process.env.BASE_URL ?? 'http://127.0.0.1:5191'
const FPS = 15
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 640, height: 480 } })
page.on('pageerror', (e) => console.log('pageerror', e.message))
await page.goto(`${base}/?lab&synth`, { waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.__synth)

if (args.includes('--probe')) {
  // Stills of every posture for one condition, to eyeball the framing.
  const c = conditions().find((x) => !only || x.name === only) ?? conditions()[0]
  console.log(await page.evaluate((cfg) => window.__synth.init(cfg), c.config))
  let t = 0
  for (const p of ['rest', 'takbir', 'qiyam', 'ruku', 'itidal', 'sujud', 'jalsah', 'tashahhud', 'salam-right', 'salam-left']) {
    await page.evaluate(([tt, pp]) => window.__synth.frame(tt, pp), [(t += 0.05), p])
    let r
    for (let i = 0; i < 60; i++) r = await page.evaluate((tt) => window.__synth.frame(tt), (t += 1 / FPS))
    writeFileSync(join(out, `probe-${c.name}-${p}.jpg`), Buffer.from(r.jpeg.split(',')[1], 'base64'))
  }
  await browser.close()
  process.exit(0)
}

const list = conditions().filter((c, i) => (!only || c.name === only) && i % shards === shard)
for (const c of list) {
  const file = join(out, `${c.name}.mjpeg`)
  if (existsSync(join(out, `${c.name}.json`)) && !only) {
    console.log('skip', c.name)
    continue
  }
  const t0 = Date.now()
  const metrics = await page.evaluate((cfg) => window.__synth.init(cfg), c.config)
  const tl = timeline(c.seed, c.timing)
  const duration = tl.at(-1).t + tl.at(-1).hold
  const jpegs = []
  const frames = []
  const segments = tl.map((s) => ({ posture: s.posture, onset: s.t, settled: null, distractor: !!s.distractor }))
  let next = 0
  let current = -1
  const n = Math.round(duration * FPS)
  for (let f = 0; f < n; f++) {
    const t = f / FPS
    let cmd
    while (next < tl.length && tl[next].t <= t + 1e-9) {
      cmd = tl[next].posture
      current = next
      next++
    }
    const r = await page.evaluate(([tt, pp]) => window.__synth.frame(tt, pp), [t, cmd ?? null])
    if (r.settled && segments[current].settled === null) segments[current].settled = t
    jpegs.push(Buffer.from(r.jpeg.split(',')[1], 'base64'))
    frames.push({ t: +t.toFixed(4), segment: current, posture: tl[current].posture, settled: r.settled })
  }
  writeFileSync(file, Buffer.concat(jpegs))
  writeFileSync(join(out, `${c.name}.json`), JSON.stringify({ name: c.name, fps: FPS, config: c.config, meta: c.meta, metrics, segments, frames }))
  console.log(`${c.name}: ${n} frames, ${(Date.now() - t0) / 1000}s`)
}
await browser.close()
