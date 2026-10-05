// The picker portraits: public/avatars/<id>.avif, from portrait.ts (dev server running; avifenc).
//   node tools/characters/portrait.mjs brother sister
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const base = process.env.BASE_URL ?? 'http://localhost:5180'
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
for (const id of process.argv.slice(2).length ? process.argv.slice(2) : ['brother', 'sister']) {
  const page = await browser.newPage({ viewport: { width: 480, height: 480 } })
  page.on('pageerror', (e) => console.error(e.message))
  await page.goto(`${base}/tools/characters/portrait.html?char=${id}`)
  const url = await page.evaluate(() => window.__portrait)
  const png = join(tmpdir(), `${id}-portrait.png`)
  writeFileSync(png, Buffer.from(url.split(',')[1], 'base64'))
  const out = new URL(`../../public/avatars/${id}.avif`, import.meta.url).pathname
  execFileSync('avifenc', ['--speed', '6', '-q', '70', png, out])
  console.log(id, '→', out, png)
  await page.close()
}
await browser.close()
