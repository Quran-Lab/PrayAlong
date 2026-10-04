import type { Keypoint } from '../types'

export interface PoseEngine {
  readonly id: 'mediapipe' | 'detrpose'
  /** The most prominent person in the current frame, as COCO-17 keypoints. */
  detect(video: HTMLVideoElement, timestamp: number): Promise<Keypoint[] | null>
  dispose(): void
}
