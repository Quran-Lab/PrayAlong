import { useEffect, useRef, useState } from 'react'
import type { PoseClass } from '@/sequence/types'
import { classifyPose, torsoLength } from './classify'
import type { WorkerOut } from './pose-worker'
import { PoseStabilizer } from './stabilizer'
import type { HandsFreeStatus } from './types'

const MODEL_URL = import.meta.env.VITE_POSE_MODEL_URL ?? '/models/detrpose.onnx'
const FPS = 12

const SIM_KEYS: Record<string, PoseClass> = {
  '1': 'hands-raised',
  '2': 'standing',
  '3': 'bowing',
  '4': 'prostrating',
  '5': 'sitting',
}

/**
 * Camera → DETRPose (worker) → pose class → stable pose changes.
 * Add `?simulate` to the URL to drive it from the keyboard (1–5) instead.
 */
export function useHandsFree(enabled: boolean, onPose: (pose: PoseClass) => void) {
  const [status, setStatus] = useState<HandsFreeStatus>('off')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [pose, setPose] = useState<PoseClass | null>(null)
  const onPoseRef = useRef(onPose)
  onPoseRef.current = onPose

  useEffect(() => {
    if (!enabled) {
      setStatus('off')
      setPose(null)
      return
    }
    const stabilizer = new PoseStabilizer()
    const emit = (p: PoseClass | null, t: number) => {
      const changed = stabilizer.push(p, t)
      if (changed) {
        setPose(changed)
        onPoseRef.current(changed)
      }
    }

    if (new URLSearchParams(location.search).has('simulate')) {
      setStatus('simulated')
      const onKey = (e: KeyboardEvent) => {
        const p = SIM_KEYS[e.key]
        if (!p) return
        // A held pose, as the camera would see it.
        const t0 = performance.now()
        for (let i = 0; i <= 10; i++) emit(p, t0 + i * 60)
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
    }

    let cancelled = false
    let media: MediaStream | null = null
    let timer = 0
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    const worker = new Worker(new URL('./pose-worker.ts', import.meta.url), { type: 'module' })
    let standingTorso: number | undefined

    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      const msg = e.data
      if (msg.type === 'missing') setStatus('no-model')
      else if (msg.type === 'error') setStatus('error')
      else if (msg.type === 'ready') setStatus('watching')
      else if (msg.type === 'none') emit(null, msg.timestamp)
      else if (msg.type === 'pose') {
        const reading = classifyPose(msg.keypoints, standingTorso)
        if (reading.pose === 'standing') {
          const len = torsoLength(msg.keypoints)
          standingTorso = standingTorso ? standingTorso * 0.9 + len * 0.1 : len
        }
        emit(reading.pose, msg.timestamp)
      }
    }

    const loop = async () => {
      if (cancelled) return
      if (video.readyState >= 2) {
        try {
          const bitmap = await createImageBitmap(video)
          worker.postMessage({ type: 'frame', bitmap, timestamp: performance.now() }, [bitmap])
        } catch {
          /* frame not ready */
        }
      }
      timer = window.setTimeout(loop, 1000 / FPS)
    }

    setStatus('starting')
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })
      .then(async (s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop())
        media = s
        setStream(s)
        video.srcObject = s
        await video.play().catch(() => {})
        worker.postMessage({ type: 'load', url: MODEL_URL })
        loop()
      })
      .catch(() => !cancelled && setStatus('no-camera'))

    return () => {
      cancelled = true
      clearTimeout(timer)
      worker.terminate()
      media?.getTracks().forEach((t) => t.stop())
      setStream(null)
    }
  }, [enabled])

  return { status, stream, pose }
}
