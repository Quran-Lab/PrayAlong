// Stage the Quran Lab zipformer CTC model for same-origin serving.
//
// Cloudflare Workers static assets cap one file at 25 MiB, and the int8 model
// is 68 MB, so it is written as parts plus a manifest (sha256 per file); the
// ASR worker stitches and verifies them. Output: public/voice/model/ (ignored
// by git, copied into dist/ by Vite).
//
// Sources, first that exists wins:
//   VOICE_MODEL_SRC / VOICE_TOKENS_SRC   local files
//   ../quran-lab-app-wasm/... and ../quran-lab-app/... next to any parent dir
//   VOICE_MODEL_URL                      base URL serving zipformer2-ctc.onnx + tokens.txt
//
// Usage: node scripts/fetch-voice-model.mjs
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Streaming chunk variants of the same model (same export pipeline, see
// quran-lab-app-wasm/tools/asr-wasm/out/chunk-variants/*.provenance.json).
// --chunk 24 (480 ms, shipped), 16 (320 ms) or 8 (160 ms).
const VARIANTS = {
  24: { revision: 'v31-slim-int8-preopt-1', sha: '168a9430e7ce21d9bc52c9dae4f580e230134cf6a8f0b6ffca675d893dc0d704', rel: 'quran-lab-app-wasm/tools/asr-wasm/out/v31_static_slim_int8.preopt_ext.onnx', out: 'public/voice/model' },
  16: { revision: 'v31-slim-int8-preopt-c16-1', sha: 'bd24ac1e70ba04a6575ebdb3a60e057f3645aa79e63cf40ebde114909162f4b5', rel: 'quran-lab-app-wasm/tools/asr-wasm/out/chunk-variants/v31_static_slim_int8.preopt_ext.c16.onnx', out: 'public/voice/model-c16' },
  8: { revision: 'v31-slim-int8-preopt-c8-1', sha: 'e3007fcd2aa4f1f50d9d76ff04a8058201ea2724e8076cd71c9ce1d5f5f39b2c', rel: 'quran-lab-app-wasm/tools/asr-wasm/out/chunk-variants/v31_static_slim_int8.preopt_ext.c8.onnx', out: 'public/voice/model-c8' },
}
const chunkArg = process.argv.includes('--chunk') ? Number(process.argv[process.argv.indexOf('--chunk') + 1]) : 24
const VARIANT = VARIANTS[chunkArg]
if (!VARIANT) throw new Error(`--chunk must be one of ${Object.keys(VARIANTS).join(', ')}`)
const OUT = join(ROOT, VARIANT.out)
const PART = 20 * 1024 * 1024
const REVISION = VARIANT.revision
const MODEL_SHA = VARIANT.sha
const TOKENS_SHA = '252c10687e442aa9291973065fae19fa39bcd681c4f5612ec496a647e20b43a1'

function findUp(rel) {
  let dir = ROOT
  for (;;) {
    const candidate = join(dir, rel)
    if (existsSync(candidate)) return candidate
    const up = dirname(dir)
    if (up === dir) return null
    dir = up
  }
}

async function load(envPath, rel, urlName) {
  const local = process.env[envPath] || findUp(rel)
  if (local && existsSync(local)) {
    console.log(`  ${urlName}: ${local}`)
    return readFile(local)
  }
  const base = process.env.VOICE_MODEL_URL
  if (!base) throw new Error(`no source for ${urlName}: set ${envPath} or VOICE_MODEL_URL`)
  const url = new URL(urlName, base.endsWith('/') ? base : `${base}/`)
  console.log(`  ${urlName}: ${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

const model = await load('VOICE_MODEL_SRC', VARIANT.rel, 'zipformer2-ctc.onnx')
const tokens = await load('VOICE_TOKENS_SRC', 'quran-lab-app/apps/api/resources/inference/tokens.txt', 'tokens.txt')
for (const [name, buf, want] of [['model', model, MODEL_SHA], ['tokens', tokens, TOKENS_SHA]]) {
  const got = sha256(buf)
  if (got !== want) throw new Error(`${name} sha256 ${got} != pinned ${want}`)
}

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })
const files = []
for (const [name, buf] of [['zipformer2-ctc.onnx', model], ['tokens.txt', tokens]]) {
  const parts = []
  for (let i = 0, off = 0; off < buf.length; i++, off += PART) {
    const part = buf.length > PART ? `${name}.part${i}` : name
    await writeFile(join(OUT, part), buf.subarray(off, off + PART))
    parts.push(part)
  }
  files.push({ name, bytes: buf.length, sha256: sha256(buf), parts })
}
await writeFile(join(OUT, 'manifest.json'), JSON.stringify({ revision: REVISION, files }, null, 1))
console.log(`staged ${REVISION} in ${VARIANT.out} (${(model.length / 1e6).toFixed(1)} MB, ${files[0].parts.length} parts)`)
