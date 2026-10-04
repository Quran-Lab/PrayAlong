import type { Keypoint } from '../types'
import type { PoseEngine } from './types'

/** BlazePose's 33 landmarks → COCO-17 order. */
const COCO_FROM_BLAZE = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28] as const

const base = import.meta.env.BASE_URL

/**
 * Google MediaPipe Pose Landmarker (BlazePose, "lite"). Fast on laptops and
 * phones; runs on the GPU when it can and falls back to the CPU. The wasm
 * runtime and model are self-hosted.
 */
export async function createMediaPipeEngine(): Promise<PoseEngine> {
  const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision')
  const fileset = await FilesetResolver.forVisionTasks(`${base}mediapipe`)
  const create = (delegate: 'GPU' | 'CPU') =>
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${base}models/pose_landmarker_lite.task`, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    })
  let landmarker: Awaited<ReturnType<typeof create>>
  try {
    landmarker = await create('GPU')
  } catch {
    landmarker = await create('CPU')
  }

  let last = 0
  return {
    id: 'mediapipe',
    async detect(video, timestamp) {
      // Timestamps must strictly increase.
      last = Math.max(last + 1, Math.round(timestamp))
      const result = landmarker.detectForVideo(video, last)
      const landmarks = result.landmarks[0]
      if (!landmarks) return null
      return COCO_FROM_BLAZE.map((i): Keypoint => {
        const p = landmarks[i]!
        return { x: p.x, y: p.y, v: p.visibility ?? 1 }
      })
    },
    dispose() {
      landmarker.close()
    },
  }
}
