// Copy the Quran Lab ASR package (sherpa-onnx WASM + Zipformer v3.1 int8, ~85 MB) into public/asr.
// It is not in git: the model is gated (NPL-1.2) and large. Point ASR_DIR at a folder that has
//   sherpa-onnx-asr.js, sherpa-onnx-wasm-main-asr.{js,wasm,data}
// (the PrayAlong web prototype keeps one in ../PrayAlong/web/public/asr).
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const FILES = ['sherpa-onnx-asr.js', 'sherpa-onnx-wasm-main-asr.js', 'sherpa-onnx-wasm-main-asr.wasm', 'sherpa-onnx-wasm-main-asr.data']
const from = process.env.ASR_DIR ?? join(homedir(), 'Documents/PrayAlong/web/public/asr')

const have = new Set(await readdir(from).catch(() => []))
const missing = FILES.filter((f) => !have.has(f))
if (missing.length) {
  console.error(`ASR_DIR=${from} is missing: ${missing.join(', ')}`)
  process.exit(1)
}
await mkdir('public/asr', { recursive: true })
for (const f of FILES) {
  await copyFile(join(from, f), join('public/asr', f))
  console.log(`public/asr/${f} (${((await stat(join(from, f))).size / 1e6).toFixed(1)} MB)`)
}
