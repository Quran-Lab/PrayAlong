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

/**
 * How the fingers are held. Degrees of curl per finger (thumb, index,
 * middle, ring, little) for the three joints, root to tip.
 */
export type Grip = 'relaxed' | 'flat' | 'grip' | 'point'
export const GRIPS: Record<Grip, readonly (readonly [number, number, number])[]> = {
  // A soft, natural hand at rest.
  relaxed: [[8, 10, 6], [10, 14, 8], [14, 18, 10], [16, 20, 12], [20, 22, 14]],
  // Palms flat on the mat in sujud, fingers together towards the qibla.
  flat: [[4, 4, 2], [2, 2, 1], [2, 2, 1], [2, 2, 1], [3, 3, 1]],
  // Holding the knees in ruku.
  grip: [[14, 12, 8], [28, 30, 18], [32, 34, 20], [34, 36, 22], [36, 38, 24]],
  // Tashahhud: index finger straight, the others folded, thumb over the middle finger.
  point: [[30, 26, 18], [0, 2, 2], [80, 95, 55], [85, 95, 55], [88, 95, 55]],
}

export interface HandSpec {
  anchor: HandAnchor
  /** Fine offset in fractions of body height (character space). */
  offset?: Dir3
  /** Which way the elbow should point. */
  pole: Dir3
  /** Direction the fingers point, and the direction the palm faces. */
  fingers: Dir3
  palm: Dir3
  /** Finger shape (defaults to relaxed). */
  grip?: Grip
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

export type PoseName = Posture | 'rest' | 'kneel'

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
const kneelingLegs = (hips: number, hipFlex: number, shinLift = 16) => {
  const knee = 90 + shinLift + hipFlex - hips
  return {
    leftUpperLeg: [-hipFlex, 0, 3],
    rightUpperLeg: [-hipFlex, 0, -3],
    leftLowerLeg: [knee, 0, 0],
    rightLowerLeg: [knee, 0, 0],
    leftFoot: [-shinLift, 0, 0],
    rightFoot: [-shinLift, 0, 0],
    leftToes: [-80, 0, 0],
    rightToes: [-80, 0, 0],
  } as const
}

/**
 * Sitting on the left foot with the right foot upright, toes bent (iftirash).
 * Thighs forward, shins folded back under them.
 */
const sittingLegs = {
  leftUpperLeg: [-84, 0, 4],
  rightUpperLeg: [-84, 0, -4],
  leftLowerLeg: [172, 0, 0],
  rightLowerLeg: [172, 0, 0],
  leftFoot: [92, 0, 0],
  rightFoot: [8, 0, 0],
  rightToes: [-70, 0, 0],
} as const

const handsOnThighs: Pick<PrayerPose, 'left' | 'right'> = {
  left: { anchor: 'thighs', pole: [0.35, 0, -1], fingers: [0, -0.2, 1], palm: [0, -1, 0], grip: 'flat' },
  right: { anchor: 'thighs', pole: [-0.35, 0, -1], fingers: [0, -0.2, 1], palm: [0, -1, 0], grip: 'flat' },
}
/** Tashahhud: the right index finger points towards the qibla. */
const handsTashahhud: Pick<PrayerPose, 'left' | 'right'> = {
  left: handsOnThighs.left,
  right: { ...handsOnThighs.right, grip: 'point' },
}

const armsAtSides: Pick<PrayerPose, 'left' | 'right'> = {
  left: { anchor: 'side', pole: [0.2, 0, -1], fingers: [0, -1, 0.05], palm: [-1, 0, 0] },
  right: { anchor: 'side', pole: [-0.2, 0, -1], fingers: [0, -1, 0.05], palm: [1, 0, 0] },
}

const sitting = (headPitch: number, headYaw = 0, hands = handsOnThighs): PrayerPose => ({
  fk: {
    ...sittingLegs,
    spine: [3, headYaw * 0.06, 0],
    chest: [2, headYaw * 0.08, 0],
    neck: [headPitch * 0.4, headYaw * 0.4, 0],
    head: [headPitch * 0.6, headYaw * 0.5, 0],
  },
  ...hands,
  eyesClosed: headYaw ? 0.6 : 1,
  contacts: ['knees', 'toes', 'feet'],
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
    eyesClosed: 0.85,
    contacts: ['feet', 'toes'],
  },
  qiyam: {
    // Gaze lowered towards the place of prostration.
    fk: { ...straightLegs, neck: [8, 0, 0], head: [10, 0, 0] },
    left: { anchor: 'chest', offset: [0.004, 0, 0], pole: [1, -0.5, -0.4], fingers: [-1, 0.1, 0.1], palm: [0, 0, -1] },
    right: { anchor: 'chest', offset: [-0.006, 0.012, 0.016], pole: [-1, -0.5, -0.4], fingers: [1, 0.05, 0.1], palm: [0, 0, -1] },
    eyesClosed: 1,
    contacts: ['feet', 'toes'],
  },
  ruku: {
    // Back flat and level, head in line with the spine.
    fk: {
      hips: [70, 0, 0],
      spine: [3, 0, 0],
      chest: [2, 0, 0],
      neck: [-8, 0, 0],
      head: [-4, 0, 0],
      leftUpperLeg: [-72, 0, 1.5],
      rightUpperLeg: [-72, 0, -1.5],
      leftLowerLeg: [4, 0, 0],
      rightLowerLeg: [4, 0, 0],
      leftFoot: [-4, 6, 0],
      rightFoot: [-4, -6, 0],
    },
    left: { anchor: 'knees', pole: [0.5, 0.2, -1], fingers: [0.05, -1, 0.15], palm: [0, 0, -1], grip: 'grip' },
    right: { anchor: 'knees', pole: [-0.5, 0.2, -1], fingers: [-0.05, -1, 0.15], palm: [0, 0, -1], grip: 'grip' },
    eyesClosed: 1,
    contacts: ['feet', 'toes'],
  },
  itidal: {
    fk: { ...straightLegs, neck: [5, 0, 0], head: [6, 0, 0] },
    ...armsAtSides,
    eyesClosed: 1,
    contacts: ['feet', 'toes'],
  },
  kneel: {
    fk: { hips: [12, 0, 0], spine: [4, 0, 0], neck: [8, 0, 0], head: [8, 0, 0], ...kneelingLegs(12, 12) },
    ...handsOnThighs,
    eyesClosed: 1,
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
      neck: [4, 0, 0],
      head: [8, 0, 0],
      ...kneelingLegs(100, 108),
    },
    left: { anchor: 'ground', pole: [1, 0.9, -0.2], fingers: [0, 0, 1], palm: [0, -1, 0], grip: 'flat' },
    right: { anchor: 'ground', pole: [-1, 0.9, -0.2], fingers: [0, 0, 1], palm: [0, -1, 0], grip: 'flat' },
    eyesClosed: 1,
    contacts: ['knees', 'toes'],
  },
  jalsah: sitting(12),
  tashahhud: sitting(16, 0, handsTashahhud),
  'salam-right': sitting(6, -76),
  'salam-left': sitting(6, 76),
}

const KNEELING = new Set<PoseName>(['sujud', 'jalsah', 'tashahhud', 'salam-right', 'salam-left'])
const STANDING = new Set<PoseName>(['rest', 'takbir', 'qiyam', 'ruku', 'itidal'])

/** Intermediate poses so the body goes down knees-first and rises naturally. */
export function waypoints(from: PoseName, to: PoseName, raiseHands = false): PoseName[] {
  // Raising the hands (raf' al-yadayn) going into ruku and rising from it.
  if (raiseHands && ((from === 'qiyam' && to === 'ruku') || (from === 'ruku' && to === 'itidal'))) return ['takbir', to]
  if ((STANDING.has(from) && KNEELING.has(to)) || (KNEELING.has(from) && STANDING.has(to))) return ['kneel', to]
  return [to]
}
