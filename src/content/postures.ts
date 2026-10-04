import type { PoseClass, Posture } from '@/sequence/types'

export interface PostureInfo {
  label: string
  /** One-line, plain-language description for learners. */
  hint: string
  pose: PoseClass
}

export const POSTURES: Record<Posture, PostureInfo> = {
  takbir: { label: 'Takbir', hint: 'Raise your hands to your ears', pose: 'hands-raised' },
  qiyam: { label: 'Qiyam', hint: 'Stand with your right hand over your left', pose: 'standing' },
  ruku: { label: 'Ruku', hint: 'Bow with a straight back, hands on knees', pose: 'bowing' },
  itidal: { label: "I'tidal", hint: 'Rise and stand upright', pose: 'standing' },
  sujud: { label: 'Sujud', hint: 'Forehead, nose, palms, knees and toes on the ground', pose: 'prostrating' },
  jalsah: { label: 'Jalsah', hint: 'Sit calmly between the two prostrations', pose: 'sitting' },
  tashahhud: { label: 'Tashahhud', hint: 'Sit and raise your right index finger', pose: 'sitting' },
  'salam-right': { label: 'Salam', hint: 'Turn your face to the right', pose: 'sitting' },
  'salam-left': { label: 'Salam', hint: 'Turn your face to the left', pose: 'sitting' },
}
