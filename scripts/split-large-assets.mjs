// Cloudflare Workers serves files up to 25 MiB. Split anything bigger in
// dist/assets (the onnxruntime WebGPU runtime, ~28 MB) into parts under
// dist/ort/ with a manifest; the pose worker stitches them back together.
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const LIMIT = 24 * 1024 * 1024
const PART = 16 * 1024 * 1024
const files = []

await mkdir('dist/ort', { recursive: true })
for (const name of await readdir('dist/assets')) {
  const path = join('dist/assets', name)
  if ((await stat(path)).size <= LIMIT) continue
  const bytes = await readFile(path)
  const base = name.replace(/-[\w-]{8}(\.\w+)$/, '$1') // drop the content hash
  const parts = []
  for (let i = 0, offset = 0; offset < bytes.length; i++, offset += PART) {
    const part = `${base}.part${i}`
    await writeFile(join('dist/ort', part), bytes.subarray(offset, offset + PART))
    parts.push(part)
  }
  await rm(path)
  files.push({ name: base, parts })
  console.log(`split ${name} (${(bytes.length / 1e6).toFixed(1)} MB) → ${parts.length} parts`)
}
await writeFile('dist/ort/manifest.json', JSON.stringify({ files }, null, 2))
