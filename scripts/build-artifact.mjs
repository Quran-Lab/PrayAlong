// Packages dist/ as a claude.ai artifact: the page body (no html/head/body
// wrapper — the viewer adds it) plus a manifest of supporting files.
// Camera APIs aren't available inside artifacts, so the pose runtimes are
// left out; hands-free runs in demo mode there.
import { execSync } from 'node:child_process'
import { cp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'

// A separate build: binary assets the artifact host won't serve (.glb) are
// referenced as base64 text and decoded in the app.
execSync('npx vite build --outDir dist-packed --emptyOutDir', { stdio: 'inherit', env: { ...process.env, VITE_PACKED_ASSETS: '1' } })

const OUT = 'dist-artifact'
const SKIP = [/^mediapipe\//, /^models\//, /^avatars\/_local\//, /ort-wasm.*\.wasm$/, /\.map$/]
const TYPES = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
}

await rm(OUT, { recursive: true, force: true })
await cp('dist-packed', OUT, { recursive: true })
await rm('dist-packed', { recursive: true, force: true })

async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    else out.push(full)
  }
  return out
}

const files = {}
let total = 0
for (const full of await walk(OUT)) {
  const path = relative(OUT, full).split('\\').join('/')
  if (path === 'index.html') continue
  if (SKIP.some((re) => re.test(path))) {
    await rm(full)
    continue
  }
  if (path.endsWith('.glb')) {
    const packed = `${path}.b64.txt`
    await writeFile(join(OUT, packed), (await readFile(full)).toString('base64'))
    await rm(full)
    const size = (await stat(join(OUT, packed))).size
    total += size
    files[packed] = { from: join(OUT, packed), contentType: 'text/plain' }
    continue
  }
  const size = (await stat(full)).size
  if (size > 15 * 1024 * 1024) throw new Error(`${path} is ${size} bytes — over the artifact limit`)
  total += size
  files[path] = { from: join(OUT, path), contentType: TYPES[extname(path)] ?? 'application/octet-stream' }
}

// Turn Vite's index.html into a page body.
const html = await readFile(join(OUT, 'index.html'), 'utf8')
const tags = [...html.matchAll(/<(script|link)\b[^>]*>(<\/script>)?/g)].map((m) => m[0].replace(/ crossorigin/g, ''))
const page = [
  '<title>PrayAlong</title>',
  '<meta name="theme-color" content="#0a0d0c">',
  '<style>:root{color-scheme:dark;background:#0a0d0c}html,body{height:100%;background:#0a0d0c}</style>',
  ...tags.filter((t) => t.startsWith('<link rel="stylesheet"') || t.startsWith('<link rel="modulepreload"')),
  '<div id="root"></div>',
  ...tags.filter((t) => t.startsWith('<script')),
].join('\n')
await writeFile(join(OUT, 'page.html'), page + '\n')
await rm(join(OUT, 'index.html'))
await writeFile(join(OUT, 'files.json'), JSON.stringify(files, null, 2))
console.log(`${Object.keys(files).length} files, ${(total / 1e6).toFixed(1)} MB → ${OUT}/page.html`)
