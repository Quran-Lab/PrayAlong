import { useEffect, useState } from 'react'
import { createDetrPoseEngine } from '@/handsfree/engines/detrpose'
import { createMediaPipeEngine } from '@/handsfree/engines/mediapipe'
import type { PoseEngine } from '@/handsfree/engines/types'
import { VisionEngine } from '@/handsfree/engines/vision'
import type { Observation } from '@/handsfree/observation'
import type { Keypoint } from '@/handsfree/types'

/**
 * Dev tool for the evaluation: runs the real vision engines on frames the
 * harness serves, one at a time, and returns everything they saw.
 *
 *   /?lab&perceive
 *
 * window.__perceive.init({ pose, face, lite, detrpose, letterbox })
 * window.__perceive.run(frameUrl, tMs) -> { obs, lite, detrpose }
 */
interface Init {
  pose: 'full' | 'lite' | 'heavy' | null
  face: boolean
  /** The previous default engine (MediaPipe lite, main thread) for the baseline. */
  lite: boolean
  detrpose: boolean
  letterbox?: boolean
  delegate?: 'GPU' | 'CPU'
  minConf?: number
}

declare global {
  interface Window {
    __perceive?: {
      init: (c: Init) => Promise<Record<string, string>>
      run: (url: string, t: number) => Promise<{ obs: Observation | null; lite: Keypoint[] | null; detrpose: Keypoint[] | null }>
    }
  }
}

export function PerceiveLab() {
  const [status, setStatus] = useState('idle')
  useEffect(() => {
    let vision: VisionEngine | null = null
    let lite: PoseEngine | null = null
    let detr: PoseEngine | null = null
    window.__perceive = {
      async init(c) {
        if (c.pose || c.face) vision = await VisionEngine.create({ pose: c.pose, face: c.face, delegate: c.delegate ?? 'GPU', minConf: c.minConf, watchdogMs: 20_000 })
        if (c.lite) lite = await createMediaPipeEngine()
        if (c.detrpose) detr = await createDetrPoseEngine({ letterbox: c.letterbox ?? false, frameTimeoutMs: 20_000 })
        setStatus('ready')
        return { vision: vision?.label ?? '', lite: lite?.label ?? '', detrpose: detr?.label ?? '' }
      },
      async run(url, t) {
        const blob = await (await fetch(url)).blob()
        const bitmap = await createImageBitmap(blob)
        const liteKp = lite ? await lite.detect(bitmap as unknown as HTMLVideoElement, t) : null
        const detrKp = detr ? await detr.detect(bitmap as unknown as HTMLVideoElement, t) : null
        const obs = vision ? await vision.detect(bitmap, t) : (bitmap.close(), null)
        return { obs, lite: liteKp, detrpose: detrKp }
      },
    }
  }, [])
  return <div id="perceive-status">{status}</div>
}
