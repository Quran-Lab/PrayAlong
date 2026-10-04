// End-to-end hands-free check: feeds a video of someone praying as the
// webcam and logs how PrayAlong follows along.
//   npm run build && npx vite preview --port 4173 &
//   node scripts/e2e-handsfree.mjs path/to/praying.mjpeg [seconds]
import { chromium } from 'playwright'

const [, , video, seconds = '40'] = process.argv
const base = process.env.BASE_URL ?? 'http://127.0.0.1:4173'
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-video-capture=${video}`,
  ],
})
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['camera'] })
const page = await context.newPage()
page.on('pageerror', (e) => console.log('pageerror', e.message))
await page.goto(base + '/', { waitUntil: 'networkidle' })
await page.waitForTimeout(4000)
await page.keyboard.press('h') // hands-free on → setup sheet
await page.waitForTimeout(1500)
await page.keyboard.press('Escape') // close the sheet, keep following

const t0 = Date.now()
let last = ''
while (Date.now() - t0 < Number(seconds) * 1000) {
  const state = await page.evaluate(() => {
    const active = document.querySelector('[aria-current="step"]')?.textContent?.trim() ?? '—'
    const bubble = document.querySelector('.frosted')?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    const ready = document.body.innerText.includes('Ready when you are')
    const hf = window.__handsFree
    const kp = hf?.keypoints
    const raw = kp ? `${hf.reading.pose ?? 'unknown'} (wristY ${kp[9].y.toFixed(2)}/${kp[10].y.toFixed(2)} shY ${kp[5].y.toFixed(2)} noseY ${kp[0].y.toFixed(2)} hipY ${kp[11].y.toFixed(2)} kneeY ${kp[13].y.toFixed(2)} ankleY ${kp[15].y.toFixed(2)})` : 'no person'
    return `${ready ? 'READY' : 'praying'} | dock: ${active} | camera: ${bubble} | raw: ${raw}`
  })
  if (state !== last) console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s  ${state}`)
  last = state
  await page.waitForTimeout(500)
}
await page.screenshot({ path: process.env.SHOT ?? 'screenshots/e2e-handsfree.png' })
await browser.close()
