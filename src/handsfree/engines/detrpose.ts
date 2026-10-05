import type { Keypoint } from '../types'
import type { WorkerOut } from '../pose-worker'
import type { PoseEngine } from './types'

export const DETRPOSE_URL = import.meta.env.VITE_POSE_MODEL_URL ?? `${import.meta.env.BASE_URL}models/detrpose.onnx`

/**
 * DETRPose (ONNX) in a Web Worker, on WebGPU when the device has it — see
 * docs/hands-free.md for the model contract. With `maxFrameMs`, it declines
 * (and the app falls back) if a frame takes longer than that on this device.
 */
export async function createDetrPoseEngine({
  maxFrameMs,
  letterbox = false,
  frameTimeoutMs = 1500,
}: { maxFrameMs?: number; letterbox?: boolean; frameTimeoutMs?: number } = {}): Promise<PoseEngine> {
  const worker = new Worker(new URL('../pose-worker.ts', import.meta.url), { type: 'module' })
  const waiting = new Map<number, (kp: Keypoint[] | null) => void>()

  let backend = 'wasm'
  try {
    await new Promise<void>((resolve, reject) => {
      // A GPU that hangs must never block hands-free: give up and fall back.
      // Downloads get two minutes; the speed test itself gets 15 seconds.
      let timer = setTimeout(() => reject(new Error('DETRPose took too long to load')), 120_000)
      const done = (fn: () => void) => () => (clearTimeout(timer), fn())
      worker.onmessage = (e: MessageEvent<WorkerOut>) => {
        const msg = e.data
        if (msg.type === 'benchmarking') {
          clearTimeout(timer)
          timer = setTimeout(() => reject(new Error('DETRPose is too slow on this device')), 15_000)
        } else if (msg.type === 'ready') {
          console.info(`[detrpose] ${msg.backend}, ${msg.ms.toFixed(0)} ms/frame`)
          backend = msg.backend
          if (maxFrameMs && msg.ms > maxFrameMs) done(() => reject(new Error(`DETRPose too slow here (${msg.ms.toFixed(0)} ms on ${msg.backend})`)))()
          else done(resolve)()
        } else if (msg.type === 'missing') done(() => reject(new Error('DETRPose model not found')))()
        else if (msg.type === 'error') done(() => reject(new Error(msg.message)))()
      }
      // Resolve against the page — relative URLs inside a worker resolve
      // against the worker script's folder instead.
      worker.postMessage({ type: 'load', url: new URL(DETRPOSE_URL, location.href).href })
    })
  } catch (err) {
    worker.terminate()
    throw err
  }

  // Consecutive failures (errors, timeouts, a crashed worker or a lost GPU device).
  let failures = 0
  worker.onerror = (e) => {
    e.preventDefault()
    failures = Infinity
    for (const resolve of waiting.values()) resolve(null)
    waiting.clear()
  }
  worker.onmessage = (e: MessageEvent<WorkerOut>) => {
    const msg = e.data
    if (msg.type !== 'pose' && msg.type !== 'none' && msg.type !== 'failed') return
    if (msg.type === 'failed') {
      failures++
      console.warn('[detrpose] frame failed', msg.message)
    } else failures = 0
    waiting.get(msg.timestamp)?.(msg.type === 'pose' ? msg.keypoints : null)
    waiting.delete(msg.timestamp)
  }

  return {
    id: 'detrpose',
    label: `DETRPose · ${backend === 'webgpu' ? 'WebGPU' : 'WebAssembly'}`,
    async detect(video, timestamp) {
      const bitmap = await createImageBitmap(video)
      return new Promise((resolve) => {
        waiting.set(timestamp, resolve)
        worker.postMessage({ type: 'frame', bitmap, timestamp, letterbox }, [bitmap])
        // A busy worker drops frames; don't wait forever.
        setTimeout(() => {
          if (!waiting.get(timestamp)) return
          waiting.delete(timestamp)
          failures++
          resolve(null)
        }, frameTimeoutMs)
      })
    },
    get healthy() {
      return failures < 5
    },
    dispose() {
      worker.terminate()
    },
  }
}
