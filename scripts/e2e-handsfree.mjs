// End-to-end hands-free check: the whole app in Chromium, with a video of
// someone praying as the webcam, scored against the video's labels.
//
//   npm run build && npx vite preview --port 4173 &
//   node scripts/e2e-handsfree.mjs <video.y4m|.mjpeg> [labels.json] [--seconds N]
//
// A synthetic clip from scripts/synth/render.mjs comes as .mjpeg + .json;
// convert it for Chrome's fake camera first (15 fps):
//   ffmpeg -i clip.mjpeg -r 15 -pix_fmt yuv420p clip.y4m
// Without labels it just logs what the app follows.
//
// The app needs a few seconds to load its models before it can see the
// opening takbir, so give the clip a still lead-in and say how long:
//   ffmpeg -framerate 15 -f mjpeg -i clip.mjpeg -vf tpad=start_duration=15:start_mode=clone -pix_fmt yuv420p clip.y4m
//   node scripts/e2e-handsfree.mjs clip.y4m clip.json --lead 15
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const video = args[0]
const labelsPath = args[1] && !args[1].startsWith('--') ? args[1] : null
const labels = labelsPath ? JSON.parse(readFileSync(labelsPath, 'utf8')) : null
const leadIn = args.includes('--lead') ? Number(args[args.indexOf('--lead') + 1]) : 0
const seconds = args.includes('--seconds') ? Number(args[args.indexOf('--seconds') + 1]) : labels ? labels.frames.length / labels.fps + 4 + leadIn : 60
const lead = args.includes('--lead') ? Number(args[args.indexOf('--lead') + 1]) : 0
const base = process.env.BASE_URL ?? 'http://127.0.0.1:4173'
const WINDOW = 1.5

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [
    '--use-angle=d3d11',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--enable-unsafe-webgpu',
    '--disable-dawn-features=use_dxc',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-video-capture=${video}`,
  ],
})
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['camera'] })
const page = await context.newPage()
page.on('pageerror', (e) => console.log('pageerror', e.message))
page.on('console', (m) => /\[vision\]|\[hands-free\]/.test(m.text()) && console.log('console', m.text().slice(0, 200)))
await page.goto(base + '/?prayer=fajr', { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await page.keyboard.press('h') // hands-free on: opens the setup sheet and starts the camera
await page.waitForTimeout(800)
await page.keyboard.press('Escape') // close the sheet, keep following

const t0 = Date.now()
let last = ''
while (Date.now() - t0 < seconds * 1000) {
  const state = await page.evaluate(() => {
    const active = document.querySelector('[aria-current="step"]')?.textContent?.trim() ?? '-'
    const bubble = document.querySelector('.frosted')?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    return `dock: ${active} | camera: ${bubble}`
  })
  if (state !== last) console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s  ${state}`)
  last = state
  await page.waitForTimeout(500)
}
const log = await page.evaluate(() => window.__handsFree?.log ?? [])
await page.screenshot({ path: process.env.SHOT ?? 'screenshots/e2e-handsfree.png' }).catch(() => {})
await browser.close()

const start = log.find((e) => e.type === 'stream')?.t
const advances = log.filter((e) => e.type === 'advance').map((e) => ({ ...e, v: (e.t - start) / 1000 - lead }))
console.log('\nadvances (video time):')
for (const a of advances) console.log(`  ${a.v.toFixed(2)} s  segment ${a.segment} ${a.kind} [${a.reason}]`)

if (labels) {
  // Same scoring as scripts/eval/evaluate.ts.
  const real = labels.segments.filter((s) => !s.distractor && s.posture !== 'rest')
  const gtAt = (t) => real.reduce((g, s, i) => (s.onset <= t + 1e-6 ? i : g), -1)
  const detected = new Array(real.length).fill(null)
  const falseAdv = []
  const duration = labels.frames.length / labels.fps
  for (const a of advances) {
    if (a.v > duration) break // the fake camera loops the file
    if (a.segment > gtAt(a.v)) falseAdv.push(a)
    else if (detected[a.segment] === null) detected[a.segment] = a.v
  }
  let ok = 0
  const lat = []
  real.forEach((s, i) => {
    const d = detected[i]
    if (d !== null && d <= (s.settled ?? s.onset + 1) + WINDOW) {
      ok++
      lat.push(d - s.onset)
    }
  })
  lat.sort((a, b) => a - b)
  console.log(
    `\n${labels.name}: detected ${ok}/${real.length} within ${WINDOW} s, false advances ${falseAdv.length}, median latency from movement start ${lat.length ? lat[lat.length >> 1].toFixed(2) : '-'} s`,
  )
  console.log(JSON.stringify({ clip: labels.name, detected: ok, transitions: real.length, falseAdvances: falseAdv.length, latencies: lat }))
}
