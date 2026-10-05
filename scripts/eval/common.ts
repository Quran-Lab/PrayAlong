import type { PoseClass } from '../../src/sequence/types'
import type { GtPosture } from './dataset'

/** The coarse class the camera should see for each posture. */
export function classOf(p: GtPosture): PoseClass {
  switch (p) {
    case 'takbir':
      return 'hands-raised'
    case 'ruku':
      return 'bowing'
    case 'sujud':
      return 'prostrating'
    case 'jalsah':
    case 'tashahhud':
    case 'salam-right':
    case 'salam-left':
      return 'sitting'
    default:
      return 'standing'
  }
}
