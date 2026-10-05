import type { PoseClass } from '@/sequence/types'
import { KP, type Keypoint, type Reading } from './types'

const mid = (a: Keypoint, b: Keypoint): Keypoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const dist = (a: Keypoint, b: Keypoint) => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * Turn 17 keypoints into one of the five prayer pose classes using body
 * geometry only — no training data needed, and it works from the front or
 * the side. Thresholds are in units of the person's own torso length, so
 * distance from the camera doesn't matter.
 *
 * `standingTorso` is the torso length seen while standing (a quiet,
 * automatic calibration); it lets us recognise a bow seen head-on, where the
 * torso foreshortens instead of tilting.
 */
export function classifyPose(raw: readonly Keypoint[], standingTorso?: number, aspect = 1): Reading {
  // Square units: normalized x and y are different lengths on a 4:3 frame,
  // so scale x by the frame's aspect before measuring any distance.
  const kp = aspect === 1 ? raw : raw.map((k) => ({ ...k, x: k.x * aspect }))
  const p = (i: number) => kp[i]!
  const shoulders = mid(p(KP.leftShoulder), p(KP.rightShoulder))
  const hips = mid(p(KP.leftHip), p(KP.rightHip))
  const knees = mid(p(KP.leftKnee), p(KP.rightKnee))
  const ankles = mid(p(KP.leftAnkle), p(KP.rightAnkle))
  const nose = p(KP.nose)
  const torso = Math.max(dist(shoulders, hips), dist(p(KP.leftShoulder), p(KP.rightShoulder)) * 0.9, 1e-3)

  // 0° = upright, 90° = horizontal.
  const tilt = (Math.atan2(Math.abs(shoulders.x - hips.x), hips.y - shoulders.y) * 180) / Math.PI
  const kneeDrop = (knees.y - hips.y) / torso // how far the knees hang below the hips
  // Standing, the ankles hang a shin below the knees; kneeling or sitting on
  // the heels, they're tucked level with (or behind) the knees. This also
  // works head-on, where kneeling knees come towards the camera.
  const shinDrop = (ankles.y - knees.y) / torso
  const headDrop = (nose.y - hips.y) / torso // positive: head lower than the hips
  const foreshortened = standingTorso ? dist(shoulders, hips) / standingTorso : 1

  const wristsUp =
    p(KP.leftWrist).y < shoulders.y - 0.15 * torso &&
    p(KP.rightWrist).y < shoulders.y - 0.15 * torso &&
    p(KP.leftWrist).y < nose.y + 0.35 * torso &&
    p(KP.rightWrist).y < nose.y + 0.35 * torso

  let pose: PoseClass | null = null
  if (headDrop > 0.15 && (tilt > 55 || foreshortened < 0.55)) pose = 'prostrating'
  else if (kneeDrop > 0.55 && ((tilt > 45 && tilt < 125) || (foreshortened < 0.62 && nose.y > shoulders.y - 0.1 * torso))) pose = 'bowing'
  else if (tilt < 40 && (kneeDrop < 0.42 || shinDrop < 0.35)) pose = 'sitting'
  else if (tilt < 32 && wristsUp) pose = 'hands-raised'
  else if (tilt < 32 && kneeDrop > 0.55 && shinDrop > 0.5) pose = 'standing'

  // Salam: the nose swings past the ears. In the camera's (unmirrored)
  // frames the worshipper's right is image-left. Only the compatibility
  // engine uses this; the sequence decoder learns the direction from the
  // first salam instead (decoder.ts).
  const ears = mid(p(KP.leftEar), p(KP.rightEar))
  const shoulderWidth = Math.max(dist(p(KP.leftShoulder), p(KP.rightShoulder)), 1e-3)
  const swing = (nose.x - ears.x) / shoulderWidth
  const headTurn = swing < -0.22 ? 'right' : swing > 0.22 ? 'left' : null

  return { pose, headTurn }
}

/** Torso length, for the standing calibration (same units as classifyPose with this aspect). */
export function torsoLength(raw: readonly Keypoint[], aspect = 1) {
  const kp = aspect === 1 ? raw : raw.map((k) => ({ ...k, x: k.x * aspect }))
  return dist(mid(kp[KP.leftShoulder]!, kp[KP.rightShoulder]!), mid(kp[KP.leftHip]!, kp[KP.rightHip]!))
}
