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
import type * as Ort from 'onnxruntime-web/wasm'

const SIZE = 640

type In = { type: 'load'; url: string } | { type: 'frame'; bitmap: ImageBitmap; timestamp: number }
export type WorkerOut =
  | { type: 'ready'; backend: string }
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

async function load(url: string) {
  try {
    const head = await fetch(url, { method: 'HEAD' })
    if (!head.ok) return post({ type: 'missing' })
    // The WebAssembly-only runtime (14 MB) — the WebGPU builds are over
    // Cloudflare's 25 MiB per-file limit. It runs multi-threaded when the
    // page is cross-origin isolated (see public/_headers).
    ort = await import('onnxruntime-web/wasm')
    session = await ort.InferenceSession.create(url, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
    post({ type: 'ready', backend: `wasm×${ort.env.wasm.numThreads ?? 1}` })
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
