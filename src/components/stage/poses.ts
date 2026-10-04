import type { Posture } from '@/sequence/types'

/**
 * Character space: y up, the worshipper faces +Z (towards the qibla and the
 * camera). The character's left is +X. Units are roughly metres for a
 * stylised, slightly big-headed figure ~1.55 tall.
 */
export type V3 = readonly [number, number, number]

export interface PoseSpec {
  pelvis: V3
  /** Forward tilt of the torso around the hips, radians (0 = upright). */
  torsoPitch: number
  /** Head relative to torso, radians. Positive pitch looks down, positive yaw turns left. */
  headPitch: number
  headYaw: number
  /** Wrist targets and the direction the fingers point. */
  handL: V3
  handR: V3
  handDirL: V3
  handDirR: V3
  /** Which way the elbows / knees should bend (direction hints). */
  elbowL: V3
  elbowR: V3
  ankleL: V3
  ankleR: V3
  footDirL: V3
  footDirR: V3
  kneeL: V3
  kneeR: V3
}

export const DIM = {
  shin: 0.3,
  thigh: 0.31,
  upperArm: 0.23,
  forearm: 0.21,
  hipX: 0.085,
  hipY: -0.04,
  shoulderX: 0.16,
  shoulderY: 0.355,
  neckY: 0.41,
  headLift: 0.21,
  headRadius: 0.19,
} as const

const deg = (d: number) => (d * Math.PI) / 180

// Standing feet sit at the back third of the mat.
const FEET_Z = -0.24
const standingLegs = {
  ankleL: [0.09, 0.075, FEET_Z],
  ankleR: [-0.09, 0.075, FEET_Z],
  footDirL: [0.12, 0, 1],
  footDirR: [-0.12, 0, 1],
  kneeL: [0, 0, 1],
  kneeR: [0, 0, 1],
} as const satisfies Partial<PoseSpec>

const standingBody = {
  pelvis: [0, 0.715, FEET_Z - 0.01],
  torsoPitch: deg(2),
} as const satisfies Partial<PoseSpec>

/** Feet tucked, toes on the ground — sujud and the moment of kneeling. */
const tuckedFeet = {
  ankleL: [0.09, 0.125, -0.36],
  ankleR: [-0.09, 0.125, -0.36],
  footDirL: [0, -0.92, 0.38],
  footDirR: [0, -0.92, 0.38],
} as const satisfies Partial<PoseSpec>

/** Kneeling sit on the heels (simplified iftirash), feet laid flat behind. */
const sittingLegs = {
  pelvis: [0, 0.265, -0.2],
  ankleL: [0.1, 0.06, -0.24],
  ankleR: [-0.1, 0.06, -0.24],
  footDirL: [0.05, -0.25, -1],
  footDirR: [-0.05, -0.25, -1],
  kneeL: [0.1, 0.4, 1],
  kneeR: [-0.1, 0.4, 1],
  torsoPitch: deg(4),
} as const satisfies Partial<PoseSpec>

const handsOnThighs = {
  handL: [0.11, 0.255, 0.04],
  handR: [-0.11, 0.255, 0.04],
  handDirL: [0, -0.35, 1],
  handDirR: [0, -0.35, 1],
  elbowL: [0.4, 0, -1],
  elbowR: [-0.4, 0, -1],
} as const satisfies Partial<PoseSpec>

export const POSES: Record<Posture | 'rest' | 'kneel', PoseSpec> = {
  /** Before and after prayer: standing at ease. */
  rest: {
    ...standingBody,
    ...standingLegs,
    headPitch: deg(6),
    headYaw: 0,
    handL: [0.2, 0.6, FEET_Z + 0.02],
    handR: [-0.2, 0.6, FEET_Z + 0.02],
    handDirL: [0.1, -1, 0.1],
    handDirR: [-0.1, -1, 0.1],
    elbowL: [0.3, 0, -1],
    elbowR: [-0.3, 0, -1],
  },
  takbir: {
    ...standingBody,
    ...standingLegs,
    headPitch: deg(4),
    headYaw: 0,
    handL: [0.215, 1.27, FEET_Z + 0.07],
    handR: [-0.215, 1.27, FEET_Z + 0.07],
    handDirL: [0.05, 1, 0.08],
    handDirR: [-0.05, 1, 0.08],
    elbowL: [0.7, -1, 0.15],
    elbowR: [-0.7, -1, 0.15],
  },
  qiyam: {
    ...standingBody,
    ...standingLegs,
    headPitch: deg(16),
    headYaw: 0,
    // Right hand over left, resting on the upper stomach.
    handL: [0.035, 0.93, FEET_Z + 0.135],
    handR: [-0.03, 0.95, FEET_Z + 0.16],
    handDirL: [-1, 0.12, 0.15],
    handDirR: [1, 0.08, 0.2],
    elbowL: [1, -0.4, -0.3],
    elbowR: [-1, -0.4, -0.3],
  },
  ruku: {
    ...standingLegs,
    pelvis: [0, 0.69, FEET_Z - 0.09],
    torsoPitch: deg(88),
    headPitch: deg(4),
    headYaw: 0,
    handL: [0.115, 0.425, FEET_Z + 0.03],
    handR: [-0.115, 0.425, FEET_Z + 0.03],
    handDirL: [0, -1, 0.15],
    handDirR: [0, -1, 0.15],
    elbowL: [0.6, 0, -0.4],
    elbowR: [-0.6, 0, -0.4],
  },
  itidal: {
    ...standingBody,
    ...standingLegs,
    headPitch: deg(10),
    headYaw: 0,
    handL: [0.195, 0.6, FEET_Z + 0.03],
    handR: [-0.195, 0.6, FEET_Z + 0.03],
    handDirL: [0.05, -1, 0.12],
    handDirR: [-0.05, -1, 0.12],
    elbowL: [0.3, 0, -1],
    elbowR: [-0.3, 0, -1],
  },
  /** Transitional: knees down, torso upright — used between standing and sujud. */
  kneel: {
    ...tuckedFeet,
    pelvis: [0, 0.42, -0.1],
    torsoPitch: deg(18),
    headPitch: deg(20),
    headYaw: 0,
    kneeL: [0.05, 0, 1],
    kneeR: [-0.05, 0, 1],
    handL: [0.13, 0.36, 0.08],
    handR: [-0.13, 0.36, 0.08],
    handDirL: [0, -0.6, 1],
    handDirR: [0, -0.6, 1],
    elbowL: [0.5, 0, -1],
    elbowR: [-0.5, 0, -1],
  },
  sujud: {
    ...tuckedFeet,
    pelvis: [0, 0.4, -0.085],
    torsoPitch: deg(104),
    headPitch: deg(20),
    headYaw: 0,
    kneeL: [0.05, 0, 1],
    kneeR: [-0.05, 0, 1],
    // Palms flat beside the head, elbows lifted away from the sides.
    handL: [0.19, 0.03, 0.42],
    handR: [-0.19, 0.03, 0.42],
    handDirL: [-0.05, 0, 1],
    handDirR: [0.05, 0, 1],
    elbowL: [1, 0.8, -0.2],
    elbowR: [-1, 0.8, -0.2],
  },
  jalsah: { ...sittingLegs, ...handsOnThighs, headPitch: deg(14), headYaw: 0 },
  tashahhud: { ...sittingLegs, ...handsOnThighs, headPitch: deg(18), headYaw: 0 },
  'salam-right': { ...sittingLegs, ...handsOnThighs, headPitch: deg(6), headYaw: deg(-68) },
  'salam-left': { ...sittingLegs, ...handsOnThighs, headPitch: deg(6), headYaw: deg(68) },
}

const KNEELING: ReadonlySet<string> = new Set(['sujud', 'jalsah', 'tashahhud', 'salam-right', 'salam-left'])
const STANDING: ReadonlySet<string> = new Set(['rest', 'takbir', 'qiyam', 'ruku', 'itidal'])

/** Intermediate poses so the body goes down knees-first and rises naturally. */
export function waypoints(from: keyof typeof POSES, to: keyof typeof POSES): (keyof typeof POSES)[] {
  if (STANDING.has(from) && KNEELING.has(to)) return ['kneel', to]
  if (KNEELING.has(from) && STANDING.has(to)) return ['kneel', to]
  return [to]
}

/** Flatten a pose to numbers so it can be sprung component-wise. */
const KEYS = Object.keys(POSES.rest) as (keyof PoseSpec)[]

export function flatten(pose: PoseSpec, out: number[] = []): number[] {
  out.length = 0
  for (const key of KEYS) {
    const v = pose[key]
    if (typeof v === 'number') out.push(v)
    else out.push(v[0], v[1], v[2])
  }
  return out
}

export function unflatten(values: readonly number[]): PoseSpec {
  const pose: Record<string, unknown> = {}
  let i = 0
  for (const key of KEYS) {
    if (typeof POSES.rest[key] === 'number') pose[key] = values[i++]
    else pose[key] = [values[i++], values[i++], values[i++]]
  }
  return pose as unknown as PoseSpec
}
