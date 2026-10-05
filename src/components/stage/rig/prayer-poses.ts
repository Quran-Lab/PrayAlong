import type { Posture } from '@/sequence/types'
import type { HumanBone } from './humanoid'

/**
 * The prayer postures, authored once for every character.
 *
 * Spine, head and legs are forward kinematics in normalized humanoid space
 * (degrees, Euler XYZ; +X pitches forward, the character faces +Z, its left
 * is +X). Hands are placed with IK against body landmarks of the loaded
 * character — so palms land on *its* knees and *its* chest whatever its
 * proportions — and oriented with an explicit palm frame.
 */

export type Deg3 = readonly [x: number, y: number, z: number]
export type Dir3 = readonly [x: number, y: number, z: number]

export type HandAnchor =
  | 'side' // arms hanging naturally
  | 'ears' // takbir
  | 'chest' // folded over the upper stomach
  | 'knees' // gripping the knees in ruku
  | 'thighs' // resting on the thighs while sitting
  | 'ground' // flat beside the head in sujud

export interface HandSpec {
  anchor: HandAnchor
  /** Fine offset in fractions of body height (character space). */
  offset?: Dir3
  /** Which way the elbow should point. */
  pole: Dir3
  /** Direction the fingers point, and the direction the palm faces. */
  fingers: Dir3
  palm: Dir3
}

export interface PrayerPose {
  fk: Partial<Record<HumanBone, Deg3>>
  left: HandSpec
  right: HandSpec
  /** 0 = eyes open, 1 = closed. Characters with expressions close their eyes in prayer. */
  eyesClosed: number
  /** Where the body touches the mat, for grounding. */
  contacts: readonly ('toes' | 'feet' | 'knees')[]
}

export type PoseName = Posture | 'rest' | 'kneel' | 'tawarruk'

const straightLegs = {
  leftUpperLeg: [0, 0, 1.5],
  rightUpperLeg: [0, 0, -1.5],
  leftFoot: [0, 6, 0],
  rightFoot: [0, -6, 0],
} as const

/**
 * Knees and toes on the mat, feet upright, toes bent towards the qibla.
 * `hips` is the whole-body pitch and `hipFlex` the thigh angle relative to
 * it; the shins rise slightly from knee to ankle so the feet can stand on
 * their toes. Angles are solved so the feet stay vertical.
 */
const kneelingLegs = (hips: number, hipFlex: number, shinLift = 2) => {
  const knee = 90 + shinLift + hipFlex - hips
  return {
    leftUpperLeg: [-hipFlex, 0, 3],
    rightUpperLeg: [-hipFlex, 0, -3],
    leftLowerLeg: [knee, 0, 0],
    rightLowerLeg: [knee, 0, 0],
    leftFoot: [-shinLift, 0, 0],
    rightFoot: [-shinLift, 0, 0],
    leftToes: [-90, 0, 0],
    rightToes: [-90, 0, 0],
  } as const
}

/**
 * Sitting on the left foot with the right foot upright, toes bent (iftirash).
 * Thighs forward, shins folded back under them.
 */
const sittingLegs = {
  leftUpperLeg: [-77, 0, 3],
  rightUpperLeg: [-77, 0, -3],
  leftLowerLeg: [166, 0, 0],
  rightLowerLeg: [166, 0, 0],
  leftFoot: [87, 0, -16],
  rightFoot: [1, 0, 0],
  rightToes: [-90, 0, 0],
} as const

const handsOnThighs: Pick<PrayerPose, 'left' | 'right'> = {
  left: { anchor: 'thighs', pole: [0.35, 0, -1], fingers: [0, -0.2, 1], palm: [0, -1, 0] },
  right: { anchor: 'thighs', pole: [-0.35, 0, -1], fingers: [0, -0.2, 1], palm: [0, -1, 0] },
}

const armsAtSides: Pick<PrayerPose, 'left' | 'right'> = {
  left: { anchor: 'side', pole: [0.2, 0, -1], fingers: [0, -1, 0.05], palm: [-1, 0, 0] },
  right: { anchor: 'side', pole: [-0.2, 0, -1], fingers: [0, -1, 0.05], palm: [1, 0, 0] },
}

const sitting = (headPitch: number, headYaw = 0): PrayerPose => ({
  fk: {
    ...sittingLegs,
    spine: [0, 0, 0],
    chest: [0, 0, 0],
    neck: [headPitch * 0.4, headYaw * 0.4, 0],
    head: [headPitch * 0.6, headYaw * 0.6, 0],
  },
  ...handsOnThighs,
  eyesClosed: 0,
  contacts: ['knees', 'toes'],
})

export const PRAYER_POSES: Record<PoseName, PrayerPose> = {
  rest: {
    fk: { ...straightLegs, neck: [3, 0, 0], head: [4, 0, 0] },
    ...armsAtSides,
    eyesClosed: 0,
    contacts: ['feet', 'toes'],
  },
  takbir: {
    fk: { ...straightLegs, neck: [2, 0, 0], head: [3, 0, 0] },
    left: { anchor: 'ears', pole: [0.8, -1, -0.1], fingers: [0.05, 1, 0.05], palm: [0, 0, 1] },
    right: { anchor: 'ears', pole: [-0.8, -1, -0.1], fingers: [-0.05, 1, 0.05], palm: [0, 0, 1] },
    eyesClosed: 0,
    contacts: ['feet', 'toes'],
  },
  qiyam: {
    // Gaze lowered towards the place of prostration.
    fk: { ...straightLegs, neck: [8, 0, 0], head: [10, 0, 0] },
    left: { anchor: 'chest', offset: [0.044, -0.008, 0.012], pole: [1, -0.5, -0.4], fingers: [-1, 0, 0], palm: [0, 0, -1] },
    right: { anchor: 'chest', offset: [-0.044, 0.008, 0.038], pole: [-1, -0.5, -0.4], fingers: [1, 0, 0], palm: [0, 0, -1] },
    eyesClosed: 0,
    contacts: ['feet', 'toes'],
  },
  ruku: {
    // The back flat and level (about 90° at the hips), the head in line with it, the legs
    // straight: "if water were poured on his back it would stay" (Ibn Majah 872).
    fk: {
      hips: [90, 0, 0],
      spine: [0, 0, 0],
      chest: [0, 0, 0],
      // Neither raised nor lowered: level with the back (the shoulders sit a little above it).
      neck: [0, 0, 0],
      head: [0, 0, 0],
      leftUpperLeg: [-90, 0, 1.5],
      rightUpperLeg: [-90, 0, -1.5],
      leftLowerLeg: [0, 0, 0],
      rightLowerLeg: [0, 0, 0],
      leftFoot: [0, 0, 0],
      rightFoot: [0, 0, 0],
    },
    left: { anchor: 'knees', pole: [0.5, 0.2, -1], fingers: [0.05, -1, 0.15], palm: [0, 0, -1] },
    right: { anchor: 'knees', pole: [-0.5, 0.2, -1], fingers: [-0.05, -1, 0.15], palm: [0, 0, -1] },
    eyesClosed: 0,
    contacts: ['feet', 'toes'],
  },
  itidal: {
    fk: { ...straightLegs, neck: [5, 0, 0], head: [6, 0, 0] },
    ...armsAtSides,
    eyesClosed: 0,
    contacts: ['feet', 'toes'],
  },
  kneel: {
    fk: { hips: [12, 0, 0], spine: [4, 0, 0], neck: [8, 0, 0], head: [8, 0, 0], ...kneelingLegs(12, 12) },
    ...handsOnThighs,
    eyesClosed: 0,
    contacts: ['knees', 'toes'],
  },
  sujud: {
    // Forehead and nose down, elbows lifted off the mat and away from the sides.
    fk: {
      // A long back that slopes down to the head — the forehead solver in
      // performer.ts adds the last few degrees for each body shape.
      hips: [100, 0, 0],
      spine: [3, 0, 0],
      chest: [3, 0, 0],
      upperChest: [2, 0, 0],
      neck: [-10, 0, 0],
      head: [-8, 0, 0],
      ...kneelingLegs(100, 108),
    },
    left: { anchor: 'ground', pole: [1, 3, 2], fingers: [0, 0, 1], palm: [0, -1, 0] },
    right: { anchor: 'ground', pole: [-1, 3, 2], fingers: [0, 0, 1], palm: [0, -1, 0] },
    eyesClosed: 0,
    contacts: ['knees', 'toes'],
  },
  jalsah: sitting(12),
  tashahhud: sitting(12),
  tawarruk: sitting(12),
  'salam-right': sitting(6, -76),
  'salam-left': sitting(6, 76),
}

const KNEELING = new Set<PoseName>(['sujud', 'jalsah', 'tashahhud', 'tawarruk', 'salam-right', 'salam-left'])
const STANDING = new Set<PoseName>(['rest', 'takbir', 'qiyam', 'ruku', 'itidal'])

/** A pose on the way to another one, and how long to stay in it (seconds). */
export interface Waypoint {
  pose: PoseName
  hold: number
}

/**
 * Intermediate poses so the body goes down knees-first and rises naturally, and the hands are
 * raised to the ears where the Sunnah raises them (Sifat Salat an-Nabi; al-Bukhari 735, 739):
 * before bowing, when rising from it ("sami‘allāhu liman hamidah"), and when standing up from
 * the first tashahhud. The opening takbir is a posture of its own.
 */
export function waypoints(from: PoseName, to: PoseName): Waypoint[] {
  const raise = { pose: 'takbir' as const, hold: 0.45 }
  const final = { pose: to, hold: 0 }
  if (from === 'qiyam' && to === 'ruku') return [raise, final]
  if (from === 'ruku' && to === 'itidal') return [raise, final]
  if (from === 'tashahhud' && to === 'qiyam') return [{ pose: 'kneel', hold: 0 }, raise, final]
  if ((STANDING.has(from) && KNEELING.has(to)) || (KNEELING.has(from) && STANDING.has(to))) return [{ pose: 'kneel', hold: 0 }, final]
  return [final]
}

/** Syafi‘i teaching profile: compact arms for women; final sitting is tawarruk. */
export function prayerPose(name: PoseName, compact = false): PrayerPose {
  const source = PRAYER_POSES[name]
  const pose: PrayerPose = { ...source, fk: { ...source.fk }, left: { ...source.left }, right: { ...source.right } }
  if (name === 'tawarruk' || name.startsWith('salam')) {
    Object.assign(pose.fk, {
      leftUpperLeg: [-80, -18, -12], rightUpperLeg: [-77, 0, -8],
      leftLowerLeg: [162, 0, 0], rightLowerLeg: [166, 0, 0],
      leftFoot: [90, 0, -30], rightFoot: [1, 0, 0],
    })
  }
  if (compact) {
    for (const side of ['left', 'right'] as const) {
      const sign = side === 'left' ? 1 : -1
      if (name === 'sujud') pose[side].pole = [sign * 0.3, 3, 2]
      if (name === 'takbir') pose[side].pole = [sign * 0.3, -1, 0]
      if (name === 'qiyam') pose[side].pole = [sign * 0.55, -1, 0.1]
    }
  }
  return pose
}
