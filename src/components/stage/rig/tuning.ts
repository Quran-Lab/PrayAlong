import saved from './tuning.json'
import type { PoseName } from './prayer-poses'

/**
 * Per character, per posture fine-tuning, set by eye in the Tune screen
 * (/?lab&tune) and saved to tuning.json:
 *  - sink: lower the whole body into the rug (fractions of body height), so
 *    folded cloth goes under the rug instead of floating above it;
 *  - handUp / handFwd: move the hands up and forwards (fractions of body height).
 */
export interface Tune {
  sink: number
  handUp: number
  handFwd: number
}
export type Tuning = Record<string, Partial<Record<PoseName, Partial<Tune>>>>

export const ZERO: Tune = { sink: 0, handUp: 0, handFwd: 0 }
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
