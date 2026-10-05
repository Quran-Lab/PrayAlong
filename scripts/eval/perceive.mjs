// Runs the real vision engines (in Chromium, via /?lab&perceive) over every
// frame of each synthetic or recorded video, and saves what they saw.
// Frame-exact and deterministic: each frame is processed at its own video
// time, regardless of how fast this machine is.
//
//   npx vite --port 5191 &
//   node scripts/eval/perceive.mjs --in .eval/synth --out .eval/obs [--only name] [--shard i --shards n]
//        [--engines vision,lite,detrpose]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d)
const input = opt('--in', '.eval/synth')
const out = opt('--out', '.eval/obs')
const only = opt('--only', null)
const shard = Number(opt('--shard', '0'))
const shards = Number(opt('--shards', '1'))
const engines = new Set(opt('--engines', 'vision,lite,detrpose').split(','))
const pose = opt('--pose', 'full')
const letterbox = args.includes('--letterbox')
const minConf = args.includes('--min-conf') ? Number(opt('--min-conf')) : undefined
const tag = opt('--tag', '')
const base = process.env.BASE_URL ?? 'http://127.0.0.1:5191'
mkdirSync(out, { recursive: true })

/** Split concatenated JPEGs (SOI ffd8 ... EOI ffd9). */
export function splitMjpeg(buf) {
  const frames = []
  let start = -1
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd8 && start < 0) start = i
    else if (buf[i] === 0xff && buf[i + 1] === 0xd9 && start >= 0) {
      // EOI may also appear inside embedded thumbnails; JPEGs from canvas have none.
      frames.push(buf.subarray(start, i + 2))
      start = -1
      i++
    }
  }
  return frames
}

const names = readdirSync(input)
  .filter((f) => f.endsWith('.json') && !f.endsWith('.obs.json'))
  .map((f) => f.slice(0, -5))
  .filter((n) => (!only || only.split(',').includes(n)) && existsSync(join(input, `${n}.mjpeg`)))
  .sort()
  .filter((_, i) => i % shards === shard)

const browser = await chromium.launch({
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--disable-dawn-features=use_dxc'],
})
for (const name of names) {
  const dest = join(out, `${name}${tag ? '.' + tag : ''}.obs.json`)
  if (existsSync(dest) && !only) {
    console.log('skip', name)
    continue
  }
  const labels = JSON.parse(readFileSync(join(input, `${name}.json`), 'utf8'))
  const jpegs = splitMjpeg(readFileSync(join(input, `${name}.mjpeg`)))
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log('pageerror', e.message))
  page.on('console', (m) => m.type() === 'error' && console.log('console', m.text().slice(0, 200)))
  await page.route('**/__frames/**', (route) => {
    const i = Number(route.request().url().split('/').pop().split('.')[0])
    route.fulfill({ status: 200, contentType: 'image/jpeg', body: jpegs[i] })
  })
  await page.goto(`${base}/?lab&perceive`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!window.__perceive)
  const t0 = Date.now()
  const engineLabels = await page.evaluate(
    (c) => window.__perceive.init(c),
    { pose: engines.has('vision') ? pose : null, face: engines.has('vision'), lite: engines.has('lite'), detrpose: engines.has('detrpose'), letterbox, minConf },
  )
  console.log(name, 'engines', JSON.stringify(engineLabels))
  const fps = labels.fps ?? 15
  const frames = []
  for (let i = 0; i < jpegs.length; i++) {
    const t = Math.round((i / fps) * 1000)
    const r = await page.evaluate(([u, tt]) => window.__perceive.run(u, tt), [`/__frames/${i}.jpg`, t])
    if (r.obs) r.obs.t = t
    frames.push({ t, obs: r.obs, lite: r.lite, detrpose: r.detrpose })
  }
  writeFileSync(dest, JSON.stringify({ name, engines: engineLabels, frames }))
  const ms = frames.reduce((s, f) => s + (f.obs?.ms ?? 0), 0) / frames.length
  console.log(`${name}: ${frames.length} frames in ${(Date.now() - t0) / 1000}s, vision ${ms.toFixed(1)} ms/frame, ${JSON.stringify(engineLabels)}`)
  await page.close()
}
await browser.close()
