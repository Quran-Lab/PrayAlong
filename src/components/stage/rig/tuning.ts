import saved from './tuning.json'
import type { PoseName } from './prayer-poses'

/**
 * Per character, per posture fine-tuning, set by eye in the Tune screen
 * (/?lab&tune) and saved to tuning.json:
 *  - sink: lower the whole body into the rug (fractions of body height), so
 *    folded cloth goes under the rug instead of floating above it;
 *  - handUp / handFwd / handIn: move the hands up, forwards and inwards (fractions of body height);
 *  - handPitch / handRoll / handTurn: tilt the hands (degrees; mirrored for the right hand);
 *  - thigh / shin / foot / spread: extra leg bend in degrees (both legs);
 *  - legDrop: push the legs down from the hips (fractions of body height),
 *    so folded legs go under the rug while the upper body stays where it is.
 */
export interface Tune {
  sink: number
  handUp: number
  handFwd: number
  handIn: number
  handPitch: number
  handRoll: number
  handTurn: number
  thigh: number
  shin: number
  foot: number
  spread: number
  legDrop: number
  /** Move the whole body (fractions of body height): sideways, up, forwards. */
  move: [number, number, number]
  /** Any bone, rotated further by [x, y, z] degrees (on top of the posture). */
  bones: Partial<Record<string, [number, number, number]>>
}
export type Tuning = Record<string, Partial<Record<PoseName, Partial<Tune>>>>

export const ZERO: Tune = { sink: 0, handUp: 0, handFwd: 0, handIn: 0, handPitch: 0, handRoll: 0, handTurn: 0, thigh: 0, shin: 0, foot: 0, spread: 0, legDrop: 0, move: [0, 0, 0], bones: {} }
export const TUNING = saved as Tuning
export const LOCAL_KEY = 'prayalong:tuning'

/** Saved tuning, with any unsaved edits from the Tune screen on this device. */
export function currentTuning(): Tuning {
  try {
    const local = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? 'null') as Tuning | null
    if (local) return local
  } catch {
    /* no storage */
  }
  return TUNING
}

export function tuneFor(t: Tuning, character: string, pose: PoseName): Tune {
  return { ...ZERO, ...(t[character]?.[pose] ?? {}) }
}
