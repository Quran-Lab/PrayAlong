// Usage: node scripts/screenshots.mjs <url-path> <out.png> [width] [height] [waitMs]
import { chromium } from 'playwright'

const [, , path = '/', out = 'screenshots/shot.png', w = '1440', h = '900', wait = '2500'] = process.argv
const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173'

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 1 })
const logs = []
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))
await page.goto(base + path, { waitUntil: 'networkidle' })
if (process.env.CSS) await page.addStyleTag({ content: process.env.CSS })
if (process.env.CLIP) process.env.CLIP_RECT = process.env.CLIP
await page.waitForTimeout(Number(wait))
// KEYS="Space,Space,ArrowRight" presses keys (700ms apart) before the shot.
for (const key of (process.env.KEYS ?? '').split(',').filter(Boolean)) {
  await page.keyboard.press(key)
  await page.waitForTimeout(Number(process.env.KEY_DELAY ?? 700))
}
if (process.env.AFTER) await page.waitForTimeout(Number(process.env.AFTER))
const clip = process.env.CLIP?.split(',').map(Number)
await page.screenshot({ path: out, ...(clip ? { clip: { x: clip[0], y: clip[1], width: clip[2], height: clip[3] } } : {}) })
const errors = logs.filter((l) => /error|warn/i.test(l))
if (errors.length) console.log(errors.slice(0, 15).join('\n'))
await browser.close()
if (process.env.SHOW_LOGS) console.log(logs.join('\n'))
