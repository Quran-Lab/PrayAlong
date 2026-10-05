// Encodes the stage backdrops (assets/backgrounds/<prayer>.jpg, from Pixabay)
// into JPEG XL and AVIF at several widths, plus a WebP fallback, and writes
// src/content/backdrops.json for the <picture> sources.
//
//   brew install jpeg-xl libavif webp   (cjxl, avifenc, cwebp)
//   npm run backgrounds
//
// Sources are git-ignored; only the encoded files are committed.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SRC = 'assets/backgrounds'
const OUT = 'public/backgrounds'
const WIDTHS = [960, 1280, 1920, 2560, 3840]
const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']
const sources = JSON.parse(readFileSync(join(SRC, 'sources.json'), 'utf8')).photos

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'] })
const size = (file) => execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim().split(',').map(Number)

mkdirSync(OUT, { recursive: true })
const tmp = join(tmpdir(), 'prayalong-bg')
mkdirSync(tmp, { recursive: true })
const manifest = {}

for (const prayer of PRAYERS) {
  const src = join(SRC, `${prayer}.jpg`)
  if (!existsSync(src)) throw new Error(`missing ${src}`)
  const [w0, h0] = size(src)
  const widths = WIDTHS.filter((w) => w <= w0)
  if (!widths.includes(w0) && w0 < WIDTHS.at(-1)) widths.push(w0)
  const entry = { width: w0, height: h0, ratio: +(w0 / h0).toFixed(4), jxl: [], avif: [], fallback: '', ...sources[prayer] }
  for (const w of widths) {
    // Resize once to a lossless PNG, then encode each format from it.
    const png = join(tmp, `${prayer}-${w}.png`)
    run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-vf', `scale=${w}:-2:flags=lanczos`, png])
    const jxl = `${prayer}-${w}.jxl`
    const avif = `${prayer}-${w}.avif`
    run('cjxl', [png, join(OUT, jxl), '-d', '2.2', '-e', '7', '--quiet'])
    run('avifenc', ['--speed', '5', '-q', '58', '--yuv', '420', '-j', 'all', png, join(OUT, avif)])
    entry.jxl.push([jxl, w])
    entry.avif.push([avif, w])
    if (w === Math.min(1920, Math.max(...widths))) {
      entry.fallback = `${prayer}-${w}.webp`
      run('cwebp', ['-quiet', '-q', '72', png, '-o', join(OUT, entry.fallback)])
    }
    rmSync(png)
  }
  manifest[prayer] = entry
  const kb = (f) => (statSync(join(OUT, f)).size / 1024).toFixed(0)
  console.log(`${prayer} ${w0}×${h0}: ` + entry.avif.map(([f, w], i) => `${w}w avif ${kb(f)} KB / jxl ${kb(entry.jxl[i][0])} KB`).join(' · '))
}
writeFileSync('src/content/backdrops.json', JSON.stringify(manifest, null, 2) + '\n')
console.log('wrote src/content/backdrops.json')
