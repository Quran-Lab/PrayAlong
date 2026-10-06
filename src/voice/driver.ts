import { nextPoseChange } from '@/sequence/build'
import type { Step } from '@/sequence/types'
import type { SurahId } from '@/content/recitations'
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

/** Listen mode: the least time an aloud line nobody has started waits before the timer moves on. */
const UNSTARTED_MS = 8000
/** Words decoded this recently mean the person is audible, even on quiet lines. */
const AUDIBLE_RECENT_MS = 20_000
/** A repeated line with its count heard: silence before the next line (same posture) or the movement. */
export const REPS_DONE_SAME_MS = 1200
export const REPS_DONE_MOVE_MS = 2000
/** Listening began late: how long the one resync stays available, and what it needs. */
const RESYNC_WINDOW_MS = 90_000
const RESYNC_MIN_CONFIDENCE = 0.85
/** Lines shorter than this (phonetic characters) are too generic to jump on. */
const RESYNC_MIN_CHARS = 18

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
  /** Another short surah is being recited in this rak'ah: switch the session to it. */
  | { type: 'surah'; rakah: number; surah: SurahId; reason: string }

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
  /** A word of the next line heard at least this well moves there. */
  nextWordConfidence: number
  /** After the last line before a movement is done and no phrase was heard, move after this long. */
  postureAfterDoneMs: number
  /** A repeated line short of its count is only timed out after this much silence. */
  repeatSilenceMs: number
}

export const DEFAULT_DRIVER: Omit<DriverConfig, 'stepMs'> = {
  mode: 'full',
  keywordMinConfidence: 0.3,
  minDwellMs: 1200,
  postureGraceMs: 3000,
  speechHoldMs: 700,
  wordHoldMs: 1500,
  trackingSlack: 1.8,
  nextWordConfidence: 0.5,
  postureAfterDoneMs: 1200,
  repeatSilenceMs: 6000,
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
  private lineDoneAt = 0
  /** Furthest step a word was heard clearly in, and when. */
  private confidentStep = -1
  private confidentAt = -Infinity

  constructor(cfg: Partial<DriverConfig> & Pick<DriverConfig, 'stepMs'>) {
    this.cfg = { ...DEFAULT_DRIVER, ...cfg }
  }

  /** One resync (listening began after the prayer may have started): see resyncTarget(). */
  private resync = { armed: false, until: 0, target: -1 }
  /**
   * Optional: phonetic length of a line, to refuse resyncs on short generic
   * lines. 0 for a line that is also said inside others (the basmala of
   * al-Fatiha 1 opens every later surah).
   */
  lineChars: (lineId: string) => number = () => Infinity

  /**
   * Listening has just begun and the person may already be some way into the
   * prayer. Allow ONE jump forward, several steps if need be, on the first
   * line heard clearly and in full; anything else keeps the one-step rules.
   */
  armResync(now: number) {
    this.resync = { armed: true, until: now + RESYNC_WINDOW_MS, target: -1 }
    // Timers count from when listening started, not from when the step was reached.
    this.arrivedAt = now
  }

  /**
   * Where a clearly heard finished line puts the session, or -1. Disarms on
   * the first clear line: either it is ahead (the jump) or in step (no jump
   * needed any more).
   */
  private resyncTarget(e: FollowerEvent, s: SessionView, now: number): number {
    if (!this.resync.armed || this.cfg.mode !== 'full') return -1
    if (now > this.resync.until) {
      this.resync.armed = false
      return -1
    }
    if (e.kind !== 'lineDone' || e.confidence < RESYNC_MIN_CONFIDENCE || (e.why !== undefined && e.why !== 'quiet' && e.why !== 'next')) return -1
    const line = s.steps[e.step]
    if (!line || this.lineChars(line.recitationId) < RESYNC_MIN_CHARS) return -1
    const from = s.phase === 'praying' ? s.index : 0
    // The same line earlier on the way (a tasbih said in every sujud): ambiguous.
    for (let k = from; k < e.step; k++) if (s.steps[k]!.recitationId === line.recitationId) return -1
    this.resync.armed = false
    const target = e.step + 1
    return target > from + 1 && target < s.steps.length ? target : -1
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
    if (speech && !this.speechNow) this.speechOnsetAt = now
    this.speechNow = speech
    if (speech) this.lastSpeechAt = now
  }
  /** Decoded phonemes: the person is talking (extends the hold), but not a new start. */
  onTokens(now: number) {
    this.lastSpeechAt = now
  }
  private speechNow = false
  /** When the current stretch of speech began (speech still running from the previous line is not a start). */
  private speechOnsetAt = -Infinity

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
      if (e.confidence >= 0.6 && e.step >= this.confidentStep) {
        this.confidentStep = e.step
        this.confidentAt = now
      }
    }
    if (mode === 'evidence' || s.phase === 'complete') return null

    const jump = this.resyncTarget(e, s, now)
    if (jump >= 0) {
      if (s.phase === 'ready') {
        // Begin now; the jump follows on the next tick.
        this.resync.target = jump
        return { type: 'begin', reason: 'resync' }
      }
      return this.move(jump, 'resync')
    }

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
        // Only on a line that was actually heard, or (listening started late)
        // when words of a later line have been heard clearly: never on a line
        // merely inferred as skipped ahead of the voice.
        if (e.step > i) {
          const heardBeyond = this.confidentStep > e.step && now - this.confidentAt < 10_000
          return (e.confidence >= 0.5 || heardBeyond) && (mode === 'full' || after.pose === here.pose) ? this.move(i + 1, 'catchUp') : null
        }
        this.lineDone = true
        this.lineDoneAt = now
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
      case 'word': {
        // A word of the NEXT line heard clearly is evidence the person has
        // moved on (e.g. "subhana" of the sujud tasbih after i'tidal with no
        // takbir heard): one step, now.
        if (e.step !== i + 1 || !after || e.confidence < this.cfg.nextWordConfidence) return null
        if (mode === 'lines' && after.pose !== here.pose) return null
        // Within a repeated line, never cut it short on a stray match.
        if (here.repeat > 1 && !this.lineDone && (this.repsDone.get(i) ?? 0) < here.repeat) return null
        return this.move(i + 1, 'nextWords')
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
        // One phrase, one step: a movement phrase only moves from the last line
        // before that movement. If lines were left (the session is behind),
        // the line rules catch up first.
        if (t !== i + 1) return null
        return this.move(t, e.kind)
      }
      case 'surah': {
        // Only around where that surah starts: from the end of al-Fatiha
        // until the planned surah's second line.
        const planned = steps[e.step]
        if (!planned || planned.rakah !== here.rakah) return null
        if (i < e.step - 3 || i > e.step + 1) return null
        return { type: 'surah', rakah: planned.rakah, surah: e.surah, reason: 'surah' }
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

  /**
   * How long the timer fallback gives the current step (from arriving on it,
   * with nobody talking), for the visible progress slider. Null: no timer
   * (the step waits for the camera, or the driver only reports evidence).
   */
  timeoutMs(s: SessionView): number | null {
    if (this.cfg.mode === 'evidence' || s.phase !== 'praying') return null
    const here = s.steps[s.index]!
    const after = s.steps[s.index + 1]
    const expected = this.cfg.stepMs(here)
    if (!after || (after.pose === here.pose && (after.posture === here.posture || this.cfg.mode === 'full'))) return expected
    return this.cfg.mode === 'full' ? expected + this.cfg.postureGraceMs : null
  }

  /** Timer fallback; call a few times a second. */
  tick(s: SessionView, now: number): DriverAction | null {
    this.sync(s, now)
    const { mode } = this.cfg
    if (mode === 'evidence' || s.phase !== 'praying') return null
    if (this.resync.target >= 0) {
      const t = this.resync.target
      this.resync.target = -1
      if (t > s.index) return this.move(t, 'resync')
    }
    if (this.companionOn) {
      this.arrivedAt = now
      return null
    }
    const i = s.index
    const here = s.steps[i]!
    const after = s.steps[i + 1]
    const elapsed = now - this.arrivedAt
    // A repeated line (tasbih) whose count the follower has heard: once the person
    // is quiet, move on promptly (the next line in the same posture after
    // REPS_DONE_SAME_MS, a movement after REPS_DONE_MOVE_MS when its takbir was
    // not heard), instead of waiting for the long silence of an unfinished count.
    if (here.repeat > 1 && !this.lineDone && (this.repsDone.get(i) ?? 0) >= here.repeat) {
      const quiet = now - Math.max(this.lastSpeechAt, this.lastWordAt, this.arrivedAt)
      const same = !!after && after.pose === here.pose && after.posture === here.posture
      if (!same && mode !== 'full' && after) return null
      if (quiet < (same ? REPS_DONE_SAME_MS : REPS_DONE_MOVE_MS)) return null
      return after ? this.move(i + 1, 'repsDone') : { type: 'finish', reason: 'repsDone' }
    }
    const talking = now - this.lastSpeechAt < this.cfg.speechHoldMs
    const reading = now - this.lastWordAt < this.cfg.wordHoldMs
    if (talking || reading) return null
    // A repeated line (tasbih x3) is never timed out before its count is
    // reached, unless the person has been silent for a long while.
    const quietFor = now - Math.max(this.lastSpeechAt, this.lastWordAt, this.arrivedAt)
    const reps = this.repsDone.get(i) ?? 0
    if (here.repeat > 1 && !this.lineDone && reps < here.repeat && (reps > 0 || this.wordsOnStep > 0)) {
      return quietFor >= this.cfg.repeatSilenceMs ? (after ? this.move(i + 1, 'timer') : { type: 'finish', reason: 'timer' }) : null
    }
    // Slower when the line is being followed but not done, and on an aloud
    // line nobody has started yet (a pause before reciting is not silence).
    // Nobody has started this aloud line: speech that began on an earlier line (its tail
    // running on) does not count, and the wait is at least UNSTARTED_MS (a pause before
    // "amin" is not silence).
    // A quiet line counts too while the person has been audible lately (words
    // decoded in the last AUDIBLE_RECENT_MS): a silent rak'ah said under the
    // breath must not move on past an amin nobody has said yet.
    const audible = here.voice === 'aloud' || now - this.lastWordAt < AUDIBLE_RECENT_MS
    const notStarted = audible && this.speechOnsetAt < this.arrivedAt && this.wordsOnStep === 0
    const base = this.cfg.stepMs(here) * (this.wordsOnStep > 0 && !this.lineDone ? this.cfg.trackingSlack : notStarted ? 2 : 1)
    const expected = notStarted ? Math.max(base, UNSTARTED_MS) : base
    if (!after) return elapsed >= expected || (this.lineDone && now - this.lineDoneAt >= this.cfg.postureAfterDoneMs) ? { type: 'finish', reason: 'timer' } : null
    const samePosture = after.pose === here.pose && after.posture === here.posture
    if (samePosture || (mode === 'full' && after.pose === here.pose)) {
      return elapsed >= expected ? this.move(i + 1, 'timer') : null
    }
    if (mode !== 'full') return null
    // The line is done and the movement phrase was not heard: a short wait,
    // not the whole step timer, so a missed takbir never keeps anyone waiting.
    if (this.lineDone) return now - this.lineDoneAt >= this.cfg.postureAfterDoneMs ? this.move(i + 1, 'timer') : null
    return elapsed >= expected + this.cfg.postureGraceMs ? this.move(i + 1, 'timer') : null
  }

  private repsDone = new Map<number, number>()
  /** Repetitions of `step` said so far (from the follower). */
  setReps(step: number, n: number) {
    this.repsDone.set(step, Math.max(this.repsDone.get(step) ?? 0, n))
  }

  private move(index: number, reason: string): DriverAction | null {
    if (index <= this.index) return null
    return { type: 'goTo', index, reason }
  }
}
