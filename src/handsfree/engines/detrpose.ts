import type { Keypoint } from '../types'
import type { WorkerOut } from '../pose-worker'
import type { PoseEngine } from './types'

export const DETRPOSE_URL = import.meta.env.VITE_POSE_MODEL_URL ?? `${import.meta.env.BASE_URL}models/detrpose.onnx`

/** DETRPose (ONNX) in a Web Worker — see docs/hands-free.md for the model contract. */
export async function createDetrPoseEngine(): Promise<PoseEngine> {
  const worker = new Worker(new URL('../pose-worker.ts', import.meta.url), { type: 'module' })
  const waiting = new Map<number, (kp: Keypoint[] | null) => void>()

  await new Promise<void>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      const msg = e.data
      if (msg.type === 'ready') resolve()
      else if (msg.type === 'missing') reject(new Error('DETRPose model not found'))
      else if (msg.type === 'error') reject(new Error(msg.message))
    }
    worker.postMessage({ type: 'load', url: DETRPOSE_URL })
  })

  worker.onmessage = (e: MessageEvent<WorkerOut>) => {
    const msg = e.data
    if (msg.type !== 'pose' && msg.type !== 'none') return
    waiting.get(msg.timestamp)?.(msg.type === 'pose' ? msg.keypoints : null)
    waiting.delete(msg.timestamp)
  }

  return {
    id: 'detrpose',
    async detect(video, timestamp) {
      const bitmap = await createImageBitmap(video)
      return new Promise((resolve) => {
        waiting.set(timestamp, resolve)
        worker.postMessage({ type: 'frame', bitmap, timestamp }, [bitmap])
        // A busy worker drops frames; don't wait forever.
        setTimeout(() => waiting.get(timestamp) && (waiting.delete(timestamp), resolve(null)), 1500)
      })
    },
    dispose() {
      worker.terminate()
    },
  }
}
