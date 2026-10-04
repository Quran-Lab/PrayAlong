/**
 * Core vocabulary shared by the UI, the 3D stage and the hands-free engine.
 * The JSON shape of a built sequence is described in `schema.json`.
 */

export type PrayerId = 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha'

/** Body positions the avatar can take. One posture can span many recited lines. */
export type Posture =
  | 'takbir'
  | 'qiyam'
  | 'ruku'
  | 'itidal'
  | 'sujud'
  | 'jalsah'
  | 'tashahhud'
  | 'salam-right'
  | 'salam-left'

/**
 * What a camera can coarsely tell apart. Several postures share one class
 * (qiyam and i'tidal are both "standing"), which is why hands-free only uses
 * pose changes to jump between posture groups, never between lines.
 */
export type PoseClass = 'hands-raised' | 'standing' | 'bowing' | 'prostrating' | 'sitting'

export type Voice = 'aloud' | 'quiet'

/** Runs of lines, labelled in the UI via the `group.*` messages. */
export type GroupId =
  | 'openingTakbir' | 'opening' | 'fatiha' | 'amin' | 'kawthar' | 'ikhlas'
  | 'ruku' | 'itidal' | 'sujud' | 'jalsah' | 'tashahhud' | 'salawat' | 'salam'

/** Movement instructions, shown via the `cue.*` messages. */
export type CueId =
  | 'begin' | 'fold' | 'rise' | 'bow' | 'rising' | 'prostrate' | 'sitUp' | 'prostrateAgain' | 'sit' | 'right' | 'left'

export interface StepTiming {
  /** How long a typical worshipper stays on this line, before pace scaling. */
  expectedMs: number
  /** Never auto-advance sooner than this, even on the brisk pace. */
  minMs: number
}

export interface Step {
  id: string
  /** 1-based rak'ah this line belongs to. */
  rakah: number
  posture: Posture
  /** The pose the camera should see while this line is recited. */
  pose: PoseClass
  recitationId: string
  /** The run of lines this belongs to, e.g. "fatiha". */
  group: GroupId
  /** 0-based position inside `group`, and the group's length. */
  groupIndex: number
  groupSize: number
  /** Say the line this many times (tasbīḥ is usually ×3). */
  repeat: number
  voice: Voice
  /** Short instruction shown when this line starts a new movement. */
  cue?: CueId
  timing: StepTiming
}

export interface PrayerSequence {
  version: 1
  prayer: PrayerId
  rakahs: number
  steps: Step[]
}
