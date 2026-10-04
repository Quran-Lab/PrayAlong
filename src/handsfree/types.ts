import type { PoseClass } from '@/sequence/types'

/** One COCO-17 keypoint in normalized image coordinates (0..1, y down). */
export interface Keypoint {
  x: number
  y: number
}

/** The most prominent person in a camera frame. */
export interface PoseFrame {
  keypoints: Keypoint[] // COCO-17 order
  score: number
  timestamp: number
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

export type HandsFreeStatus =
  | 'off'
  | 'starting' // asking for the camera / loading the model
  | 'watching' // running
  | 'simulated' // dev: poses come from the keyboard
  | 'no-camera' // permission denied or no device
  | 'no-model' // pose model not installed
  | 'error'
