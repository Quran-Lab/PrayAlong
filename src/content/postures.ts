import type { PoseClass, Posture } from '@/sequence/types'

/** The pose the camera should see in each posture. */
export const POSE_OF: Record<Posture, PoseClass> = {
  takbir: 'hands-raised',
  qiyam: 'standing',
  ruku: 'bowing',
  itidal: 'standing',
  sujud: 'prostrating',
  jalsah: 'sitting',
  tashahhud: 'sitting',
  'salam-right': 'sitting',
  'salam-left': 'sitting',
}

/** Label/hint message suffix: both salams read as one movement. */
export const postureKey = (p: Posture) => (p.startsWith('salam') ? 'salam' : (p as Exclude<Posture, 'salam-right' | 'salam-left'>))
