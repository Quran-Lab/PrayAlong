import { nextPoseChange } from '@/sequence/build'
import type { Step } from '@/sequence/types'
import { KEYWORD_LINES } from './follower'
import type { FollowerEvent, KeywordKind } from './types'

/**
 * Turns follower events into session moves, so the microphone alone can lead
 * the prayer. Pure: it reads a snapshot of the session and returns at most one
 * action per call; the hook applies it.
 *
 * Rules, all forward-only:
 *  - A finished line moves to the next line of the same posture.
 *  - Hearing the start of the NEXT line moves there (one step, any posture).
 *  - A movement phrase (takbir / tasmi / salam) moves to the next posture
 *    change, like the camera seeing the body move; only when that phrase is
 *    what that movement is announced with, after a short dwell, and not while
 *    the person is clearly mid-way through an aloud passage with lines left.
 *  - Silence (quiet parts, a whispered takbir nobody could hear) falls back to
 *    the line timers; posture changes get a little extra grace.
 */

export type DriverMode =
  /** Microphone only: voice leads lines and postures. */
  | 'full'
  /** Camera also on: voice leads lines within a posture, the camera leads postures. */
  | 'lines'
  /** Report evidence only; never move the session. */
  | 'evidence'

export interface SessionView {
  phase: 'ready' | 'praying' | 'complete'
  index: number
  steps: readonly Step[]
}

export type DriverAction =
  | { type: 'begin'; reason: string }
  | { type: 'goTo'; index: number; reason: string }
  | { type: 'finish'; reason: string }

export interface DriverConfig {
  mode: DriverMode
  /** Expected time on a step, pace-aware (the app's own timer value). */
  stepMs: (step: Step) => number
  keywordMinConfidence: number
  /** No keyword move within this long of arriving on a step (one phrase, one move). */
  minDwellMs: number
  /** Extra wait before a timed posture change when no phrase was heard. */
  postureGraceMs: number
  /** Count as "still talking" this long after the last voiced audio. */
  speechHoldMs: number
  /** Count as "still following a line" this long after the last word. */
  wordHoldMs: number
  /** Timer multiplier while the voice is being followed but the line is not done. */
  trackingSlack: number
}

export const DEFAULT_DRIVER: Omit<DriverConfig, 'stepMs'> = {
  mode: 'full',
  keywordMinConfidence: 0.3,
  minDwellMs: 1200,
  postureGraceMs: 3000,
  speechHoldMs: 700,
  wordHoldMs: 1500,
  trackingSlack: 1.8,
}

/** The phrase a worshipper says while moving INTO step `t` (null: none). */
export function announcedBy(steps: readonly Step[], t: number): KeywordKind | null {
  const step = steps[t]
  if (!step || t === 0) return null
  if (step.recitationId === 'tasmi') return 'tasmi'
  if (step.recitationId === 'salam') return 'salam'
  const prev = steps[t - 1]!
  if (prev.pose === step.pose && prev.posture === step.posture) return null
  if (prev.posture === 'takbir') return null // folding the hands after the opening takbir
  return 'takbir'
}

export class VoiceDriver {
  readonly cfg: DriverConfig
  private index = -1
  private phase: SessionView['phase'] = 'ready'
  private arrivedAt = 0
  private lastSpeechAt = -Infinity
  private lastWordAt = -Infinity
  private wordsOnStep = 0
  private lineDone = false

  constructor(cfg: Partial<DriverConfig> & Pick<DriverConfig, 'stepMs'>) {
    this.cfg = { ...DEFAULT_DRIVER, ...cfg }
  }

  /** Call whenever the session changes (from any source). */
  sync(s: SessionView, now: number) {
    if (s.index !== this.index || s.phase !== this.phase) {
      this.index = s.index
      this.phase = s.phase
      this.arrivedAt = now
      this.wordsOnStep = 0
      this.lineDone = false
    }
  }

  onLevel(speech: boolean, now: number) {
    if (speech) this.lastSpeechAt = now
  }

  private companionOn = false
  /**
   * The companion is reciting. Timers measure the worshipper's own time, so
   * they hold while it speaks and start counting when it stops.
   */
  setCompanion(on: boolean, now: number) {
    if (on === this.companionOn) return
    this.companionOn = on
    this.arrivedAt = now
  }

  onEvent(e: FollowerEvent, s: SessionView, now: number): DriverAction | null {
    this.sync(s, now)
    const { mode } = this.cfg
    if (e.kind === 'word') {
      this.lastWordAt = now
      if (e.step === s.index) this.wordsOnStep++
    }
    if (mode === 'evidence' || s.phase === 'complete') return null

    if (s.phase === 'ready') {
      // Any finished line means the prayer has started (listening may have
      // begun after the opening takbir); later lineDones catch up from there.
      const opening = e.kind === 'takbir' ? e.confidence >= this.cfg.keywordMinConfidence : e.kind === 'lineDone' || (e.kind === 'lineStart' && e.step === 0)
      return opening && mode === 'full' ? { type: 'begin', reason: e.kind } : null
    }

    const i = s.index
    const steps = s.steps
    const here = steps[i]!
    const after = steps[i + 1]

    switch (e.kind) {
      case 'lineDone': {
        // A later line finished means this one is over too (the session is
        // behind the voice): catch up, one step per event.
        if (e.step < i) return null
        if (!after) return { type: 'finish', reason: 'lineDone' }
        // The person already finished a line beyond the next one, so they are
        // past this step's posture change too.
        if (e.step > i && (mode === 'full' || after.pose === here.pose)) return this.move(i + 1, 'catchUp')
        this.lineDone = true
        const samePose = after.pose === here.pose
        if (samePose && (mode === 'full' || after.posture === here.posture)) return this.move(i + 1, 'lineDone')
        if (mode === 'full' && announcedBy(steps, i + 1) === null) return this.move(i + 1, 'lineDone')
        return null
      }
      case 'lineStart': {
        if (e.step !== i + 1 || !after) return null
        if (mode === 'lines' && after.pose !== here.pose) return null
        return this.move(i + 1, 'lineStart')
      }
      case 'takbir':
      case 'tasmi':
      case 'salam': {
        if (mode !== 'full' || e.confidence < this.cfg.keywordMinConfidence) return null
        // On the salam line, "as-salamu alaykum" is that line being said, not
        // the move to the next one (the follower tracks it as a line).
        if (here.recitationId === KEYWORD_LINES[e.kind]) return null
        if (now - this.arrivedAt < this.cfg.minDwellMs) return null
        const t = this.transitionTarget(e.kind, s)
        if (t <= i) return null
        // Lines still to go in this posture while the voice is being followed:
        // a phrase heard now is more likely a mishearing than a skipped passage.
        const linesLeft = t - i - 1
        const following = now - this.lastWordAt < 4000 && here.voice === 'aloud'
        if (linesLeft > 1 && following) return null
        return this.move(t, e.kind)
      }
      default:
        return null
    }
  }

  /** Where a movement phrase would take the session from here (-1: nowhere). */
  transitionTarget(kind: KeywordKind, s: SessionView): number {
    const i = s.index
    if (kind === 'salam') {
      const t = i + 1
      return s.steps[t]?.recitationId === 'salam' ? t : -1
    }
    const t = nextPoseChange(s.steps, i)
    if (t < 0) return -1
    return announcedBy(s.steps, t) === kind ? t : -1
  }

  /** Timer fallback; call a few times a second. */
  tick(s: SessionView, now: number): DriverAction | null {
    this.sync(s, now)
    const { mode } = this.cfg
    if (mode === 'evidence' || s.phase !== 'praying') return null
    if (this.companionOn) {
      this.arrivedAt = now
      return null
    }
    const i = s.index
    const here = s.steps[i]!
    const after = s.steps[i + 1]
    const elapsed = now - this.arrivedAt
    const talking = now - this.lastSpeechAt < this.cfg.speechHoldMs
    const reading = now - this.lastWordAt < this.cfg.wordHoldMs
    if (talking || reading) return null
    const expected = this.cfg.stepMs(here) * (this.wordsOnStep > 0 && !this.lineDone ? this.cfg.trackingSlack : 1)
    if (!after) return elapsed >= expected ? { type: 'finish', reason: 'timer' } : null
    const samePosture = after.pose === here.pose && after.posture === here.posture
    if (samePosture || (mode === 'full' && after.pose === here.pose)) {
      return elapsed >= expected ? this.move(i + 1, 'timer') : null
    }
    if (mode !== 'full') return null
    const grace = this.lineDone ? this.cfg.postureGraceMs / 2 : this.cfg.postureGraceMs
    return elapsed >= expected + grace ? this.move(i + 1, 'timer') : null
  }

  private move(index: number, reason: string): DriverAction | null {
    if (index <= this.index) return null
    return { type: 'goTo', index, reason }
  }
}
