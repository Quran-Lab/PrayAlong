import type { Posture } from '@/sequence/types'

/**
 * The companion's postures. Each one is authored once, in the character file itself (one glTF
 * animation per posture, from tools/characters/poses.py): the reference figure's own prayer, set
 * right where it differs from al-Albani's Talkhis Sifat Salat an-Nabi.
 *
 * Besides the postures of the prayer there are three on the way between them: `descend` (the
 * hands on the mat before the knees), `rise` (up from the sitting of rest on clenched fists) and
 * `rest` (standing, before the prayer). `tawarruk` is the final sitting.
 */
export type PoseName = Posture | 'rest' | 'tawarruk' | 'descend' | 'rise'

export const POSE_NAMES: readonly PoseName[] = [
  'rest', 'takbir', 'qiyam', 'ruku', 'itidal', 'descend', 'sujud', 'jalsah', 'tashahhud', 'tawarruk',
  'salam-right', 'salam-left', 'rise',
]

export const isPoseName = (name: string): name is PoseName => (POSE_NAMES as readonly string[]).includes(name)

const STANDING = new Set<PoseName>(['rest', 'takbir', 'qiyam', 'ruku', 'itidal'])
const SITTING = new Set<PoseName>(['jalsah', 'tashahhud', 'tawarruk', 'salam-right', 'salam-left'])

/** A pose on the way to another one, and how long to stay in it (seconds). */
export interface Waypoint {
  pose: PoseName
  hold: number
}

/**
 * The way from one posture to the next, as the Sunnah moves (Talkhis Sifat Salat an-Nabi):
 * - the hands rise to the shoulders before bowing, and when rising from it (al-Bukhari 735);
 * - into prostration the hands go down before the knees (Abu Dawud 840);
 * - up from a prostration: the sitting of rest, then up on the fists (al-Bukhari 823);
 * - up from the first tashahhud: the hands rise again (al-Bukhari 739).
 */
export function waypoints(from: PoseName, to: PoseName): Waypoint[] {
  const raise = { pose: 'takbir' as const, hold: 0.45 }
  const final = { pose: to, hold: 0 }
  if (from === 'qiyam' && to === 'ruku') return [raise, final]
  if (from === 'ruku' && to === 'itidal') return [raise, final]
  if (STANDING.has(from) && !STANDING.has(to)) return [{ pose: 'descend', hold: 0.12 }, final]
  if (!STANDING.has(to)) return [final]
  if (from === 'sujud') return [{ pose: 'jalsah', hold: 0.5 }, { pose: 'rise', hold: 0.15 }, final]
  if (from === 'tashahhud') return [{ pose: 'rise', hold: 0.1 }, raise, final]
  if (SITTING.has(from) || from === 'descend') return [{ pose: 'rise', hold: 0.15 }, final]
  return [final]
}
