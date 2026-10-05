import type { SurahId } from '@/content/recitations'

/**
 * Vocabulary of the microphone engine. The follower and driver are pure and
 * run anywhere (tests, worker, main thread); only engine.ts touches the DOM.
 */

export type VoiceStatus = 'idle' | 'loading' | 'listening' | 'error'

/** Why listening stopped or never started, for a friendly message. */
export type VoiceError =
  | 'unsupported' // no AudioWorklet / WebAssembly / getUserMedia
  | 'mic-denied'
  | 'mic-missing'
  | 'model-unreachable' // model download failed (network, CORS)
  | 'engine-failed' // wasm runtime or recognizer failed to start

/** Movement phrases the follower listens for anywhere in the stream. */
export type KeywordKind = 'takbir' | 'tasmi' | 'salam' | 'amin'

/**
 * Everything the follower can tell the session. `at` is the audio clock in
 * seconds (time of the decoder emission that produced the event), so lag can
 * be measured offline; consumers that need wall time use `wallMs`.
 */
export type FollowerEvent =
  | { kind: 'word'; step: number; lineId: string; wordIndex: number; rep: number; confidence: number; at: number }
  | { kind: 'lineStart'; step: number; lineId: string; confidence: number; at: number }
  | { kind: 'lineDone'; step: number; lineId: string; confidence: number; reps: number; at: number }
  | { kind: KeywordKind; confidence: number; at: number; start: number }
  /** A different short surah than planned is being recited (`step`: where the planned one starts). */
  | { kind: 'surah'; surah: SurahId; step: number; confidence: number; at: number }

/**
 * The fusion API: one shape for camera and voice evidence so the main thread
 * can combine them. `confidence` is 0..1; `at` is performance.now() ms.
 */
export interface Evidence {
  source: 'voice' | 'camera'
  kind: 'takbir' | 'tasmi' | 'salam' | 'amin' | 'lineStart' | 'lineDone' | 'word' | 'pose' | 'surah'
  confidence: number
  at: number
  /** Step the evidence is about, when it is about a specific line. */
  step?: number
  lineId?: string
  wordIndex?: number
}

/** A step as the follower sees it: what will be said, and how. */
export interface FollowStep {
  lineId: string
  repeat: number
  voice: 'aloud' | 'quiet'
  /** The person says "Allahu akbar" while moving into this step (an optional takbir node before it). */
  takbirBefore?: boolean
}
