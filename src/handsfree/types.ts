import type { PoseClass } from '@/sequence/types'

/** One COCO-17 keypoint in normalized image coordinates (0..1, y down). */
export interface Keypoint {
  x: number
  y: number
  /** 0..1 — how sure the model is this point is visible (1 if unknown). */
  v?: number
}

export const KP = {
  nose: 0, leftEye: 1, rightEye: 2, leftEar: 3, rightEar: 4,
  leftShoulder: 5, rightShoulder: 6, leftElbow: 7, rightElbow: 8, leftWrist: 9, rightWrist: 10,
  leftHip: 11, rightHip: 12, leftKnee: 13, rightKnee: 14, leftAnkle: 15, rightAnkle: 16,
} as const

export interface Reading {
  pose: PoseClass | null
  /** Head turned to the worshipper's right or left (for the salams). */
  headTurn: 'right' | 'left' | null
}

/** How much of the body the camera can see. */
export type Framing = 'full' | 'partial' | 'none'

export type HandsFreeStatus =
  | 'off'
  | 'starting' // asking for the camera
  | 'loading' // loading the pose model
  | 'watching' // running
  | 'demo' // poses come from on-screen buttons / keys 1–5
  | 'denied' // camera permission refused
  | 'no-camera' // no camera, or not a secure context
  | 'no-model' // pose tracking couldn't start on this device

export const isFollowing = (s: HandsFreeStatus) => s === 'watching' || s === 'demo'
export const isFallback = (s: HandsFreeStatus) => s === 'denied' || s === 'no-camera' || s === 'no-model'
