/// <reference lib="webworker" />
/**
 * Runs DETRPose off the main thread so the 3D stage never stutters.
 *
 * Model contract (DETRPose `tools/deployment/export_onnx.py`, opset 16):
 *   in   images             float32 [1,3,640,640]  RGB, 0..1, plain resize (no letterbox, no mean/std)
 *   in   orig_target_sizes  int64   [1,2]          [w, h] — we pass [1,1] to get normalized coords
 *   out  scores             float32 [1,Q]
 *   out  labels             int64   [1,Q]
 *   out  keypoints          float32 [1,Q,17,2]     COCO-17 (x, y)
 */
import type * as Ort from 'onnxruntime-web'

const SIZE = 640

type In = { type: 'load'; url: string } | { type: 'frame'; bitmap: ImageBitmap; timestamp: number }
export type WorkerOut =
  | { type: 'ready'; backend: 'webgpu' | 'wasm'; ms: number }
  | { type: 'benchmarking' }
  | { type: 'missing' }
  | { type: 'error'; message: string }
  | { type: 'pose'; keypoints: { x: number; y: number }[]; score: number; timestamp: number }
  | { type: 'none'; timestamp: number }

let ort: typeof Ort
let session: Ort.InferenceSession | null = null
let busy = false
const canvas = new OffscreenCanvas(SIZE, SIZE)
const ctx = canvas.getContext('2d', { willReadFrequently: true })!
const input = new Float32Array(3 * SIZE * SIZE)

const post = (msg: WorkerOut) => (self as unknown as Worker).postMessage(msg)

/**
 * The WebGPU runtime is ~28 MB — over Cloudflare's 25 MiB per-file limit —
 * so production builds ship it in parts (scripts/split-large-assets.mjs)
 * and we stitch it back together here. Still fully self-hosted.
 */
async function stitchedRuntime(): Promise<ArrayBuffer | undefined> {
  if (!import.meta.env.PROD) return undefined
  try {
    const manifestUrl = new URL('../ort/manifest.json', self.location.href)
    const res = await fetch(manifestUrl)
    if (!res.ok) return undefined
    const manifest = (await res.json()) as { files: { name: string; parts: string[] }[] }
    const entry = manifest.files.find((f) => f.name.includes('jsep')) ?? manifest.files[0]
    if (!entry) return undefined
    const parts = await Promise.all(entry.parts.map((p) => fetch(new URL(p, manifestUrl)).then((r) => r.arrayBuffer())))
    const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0))
    let offset = 0
    for (const p of parts) {
      out.set(new Uint8Array(p), offset)
      offset += p.byteLength
    }
    return out.buffer
  } catch {
    return undefined
  }
}

const zeros = () => ({
  images: new ort.Tensor('float32', new Float32Array(3 * SIZE * SIZE), [1, 3, SIZE, SIZE]),
  orig_target_sizes: new ort.Tensor('int64', new BigInt64Array([1n, 1n]), [1, 2]),
})

/** Warm up, then time one frame — the app uses this to pick the fastest engine. */
async function benchmark(s: Ort.InferenceSession) {
  await s.run(zeros())
  const t = performance.now()
  await s.run(zeros())
  return performance.now() - t
}

async function load(url: string) {
  try {
    const head = await fetch(url, { method: 'HEAD' })
    // Single-page hosts answer unknown paths with index.html — that's "missing" too.
    if (!head.ok || head.headers.get('content-type')?.includes('text/html')) return post({ type: 'missing' })
    const log = (m: string) => console.info(`[detrpose] ${m}`)
    log('loading runtime')
    // The JSEP WebGPU backend — verified to match PyTorch (tools/detrpose).
    ort = await import('onnxruntime-web')
    const binary = await stitchedRuntime()
    log(binary ? `stitched runtime ${(binary.byteLength / 1e6).toFixed(1)} MB` : 'default runtime')
    if (binary) ort.env.wasm.wasmBinary = binary

    // WebGPU first — fast and strong — then multi-threaded WebAssembly.
    // (Some WebGPU problems only show up on the first run, hence the warm-up.)
    if ('gpu' in navigator) {
      try {
        log('creating WebGPU session')
        session = await ort.InferenceSession.create(url, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' })
        log('benchmarking')
        post({ type: 'benchmarking' })
        return post({ type: 'ready', backend: 'webgpu', ms: await benchmark(session) })
      } catch (err) {
        console.warn('[detrpose] WebGPU unavailable, using WebAssembly', err)
        await session?.release().catch(() => {})
        session = null
      }
    }
    session = await ort.InferenceSession.create(url, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
    post({ type: 'benchmarking' })
    post({ type: 'ready', backend: 'wasm', ms: await benchmark(session) })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}

async function infer(bitmap: ImageBitmap, timestamp: number) {
  if (!session || busy) {
    bitmap.close()
    return post({ type: 'none', timestamp })
  }
  busy = true
  try {
    ctx.drawImage(bitmap, 0, 0, SIZE, SIZE)
    bitmap.close()
    const { data } = ctx.getImageData(0, 0, SIZE, SIZE)
    const plane = SIZE * SIZE
    for (let i = 0, p = 0; i < plane; i++, p += 4) {
      input[i] = data[p]! / 255
      input[plane + i] = data[p + 1]! / 255
      input[2 * plane + i] = data[p + 2]! / 255
    }
    const out = await session.run({
      images: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]),
      orig_target_sizes: new ort.Tensor('int64', new BigInt64Array([1n, 1n]), [1, 2]),
    })
    const scores = out.scores!.data as Float32Array
    const keypoints = out.keypoints!.data as Float32Array
    let best = 0
    for (let i = 1; i < scores.length; i++) if (scores[i]! > scores[best]!) best = i
    if (scores[best]! < 0.4) return post({ type: 'none', timestamp })
    const kps = Array.from({ length: 17 }, (_, k) => ({ x: keypoints[(best * 17 + k) * 2]!, y: keypoints[(best * 17 + k) * 2 + 1]! }))
    post({ type: 'pose', keypoints: kps, score: scores[best]!, timestamp })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  } finally {
    busy = false
  }
}

self.onmessage = (e: MessageEvent<In>) => {
  if (e.data.type === 'load') load(e.data.url)
  else infer(e.data.bitmap, e.data.timestamp)
}
