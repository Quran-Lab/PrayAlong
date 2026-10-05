import { useEffect, useRef, useState } from 'react'
import phonemes from '@/content/phonemes.json'
import { useSession } from '@/state/session'
import { REPS_DONE_MOVE_MS, REPS_DONE_SAME_MS } from './driver'

/**
 * Speech-burst follow: a safety layer next to the phoneme follower that only
 * needs to know WHEN the person speaks, not what the recognizer made of it.
 *
 * A short line (takbir, tasbih, tasmi', "rabbighfir li") said with a pause
 * after it counts as said once the person has spoken about as long as the
 * line takes at a brisk pace. A repeated line counts one repetition per burst
 * of speech (bursts closer than GAP_MS are one burst; a burst shorter than
 * half the line is not a repetition), or the phoneme follower's count when it
 * is higher (repetitions said back to back, with no pause between them). After
 * a line before a movement is said, the next burst of speech is the takbir and
 * moves the prayer on as it starts. Long lines are left to the phoneme
 * follower unless it has clearly lost the person.
 */

const LINES = (phonemes as { lines: Record<string, { words: string[]; optional?: number }> }).lines

/** Leading follower words that may be left out (the basmala before a surah). */
export const optionalWords = (lineId: string) => LINES[lineId]?.optional ?? 0

/** The line's own words (without the optional basmala). */
const ownWords = (lineId: string) => LINES[lineId]?.words.slice(optionalWords(lineId)) ?? []

/**
 * A brisk pace, ms per phonetic character. The reciters in the app's audio
 * take 73-123 ms per character on these lines; 1.5x their speed is about 55.
 */
const MS_PER_CHAR = 50
/** Speech time a line needs at a brisk pace (ms); `withOptional` counts the basmala too. */
export function briskMs(lineId: string, withOptional = false): number | null {
  const words = withOptional ? LINES[lineId]?.words ?? [] : ownWords(lineId)
  if (!words.length) return null
  return Math.max(450, words.join('').length * MS_PER_CHAR)
}

export const wordCount = (lineId: string) => ownWords(lineId).length

/** Silence after speech before a line counts as finished (ms). */
export const SILENCE_MS = 700
/** Shorter silences than this do not split a burst (a breath inside a line). */
export const GAP_MS = 300
/** A burst shorter than this share of the line is not a repetition. */
const BURST_MIN = 0.5
/** Speech at the start of the next burst before it counts as the takbir (ms). */
const TAKBIR_ONSET_MS = 250
/** Lines up to this many words are short enough to follow by speech alone. */
const SHORT_WORDS = 3

/** Bursts of speech on one step (pure; the hook below drives it). */
export class BurstCount {
  /** Closed bursts (ms of speech each). */
  readonly bursts: number[] = []
  private cur = 0
  private since = 0
  private quietAt = -Infinity
  speechMs = 0

  private on = false

  speech(on: boolean, now: number) {
    if (on) {
      if (this.on) return
      // A short breath inside a line does not end the burst.
      if (this.cur > 0 && now - this.quietAt >= GAP_MS) this.close()
      this.on = true
      this.since = now
    } else if (this.on) {
      const d = now - this.since
      this.cur += d
      this.speechMs += d
      this.on = false
      this.quietAt = now
    }
  }

  /** End the open burst (after enough silence). */
  close() {
    if (this.cur > 0) this.bursts.push(this.cur)
    this.cur = 0
  }

  /** Repetitions said: one per burst at least half as long as the line. */
  reps(need: number): number {
    return this.bursts.filter((b) => b >= BURST_MIN * need).length + (this.cur >= BURST_MIN * need ? 1 : 0)
  }
}

export interface BurstInput {
  enabled: boolean
  index: number
  speaking: boolean
  /** Phoneme follower: where it is on this step (null when it is elsewhere). */
  follower: { wordIndex: number; repsDone: number } | null
  /** The follower already finished this step's line. */
  followerDone: boolean
  log: (msg: string) => void
}

/** Returns the repetitions counted by speech alone on the current step. */
export function useBurstFollow({ enabled, index, speaking, follower, followerDone, log }: BurstInput) {
  const [reps, setReps] = useState(0)
  const st = useRef({ step: -1, count: new BurstCount(), carry: false, done: false, confirmed: false, moveAfter: 0, moveWhy: '', onsetTimer: 0, silenceTimer: 0 })
  const followerRef = useRef(follower)
  followerRef.current = follower
  const doneRef = useRef(followerDone)
  doneRef.current = followerDone

  // New step: start counting afresh.
  useEffect(() => {
    const s = st.current
    window.clearTimeout(s.silenceTimer)
    window.clearTimeout(s.onsetTimer)
    // Speech already going when the step starts is the end of the previous line
    // (e.g. the last verse of al-Fatiha running into amin): it never counts here.
    st.current = { step: index, count: new BurstCount(), carry: speaking, done: false, confirmed: false, moveAfter: 0, moveWhy: '', onsetTimer: 0, silenceTimer: 0 }
    setReps(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, enabled])

  useEffect(() => {
    if (!enabled) return
    const s = st.current
    const now = performance.now()
    const session = useSession.getState()
    if (session.phase !== 'praying') return
    const step = session.sequence.steps[index]
    const after = session.sequence.steps[index + 1]
    if (!step) return
    const movesNext = !!after && after.posture !== step.posture
    const advance = (why: string) => {
      if (useSession.getState().index !== index || useSession.getState().phase !== 'praying') return
      log(`[voice] burst advance (${why}) step ${index} ${step.recitationId}`)
      useSession.getState().next()
    }

    if (speaking) {
      window.clearTimeout(s.silenceTimer)
      if (!s.carry) s.count.speech(true, now)
      // The line before a movement is said: this burst is the takbir. Only when
      // the follower agrees the line is complete (its lineDone, or its count of
      // the repetitions): a count by bursts alone cannot tell a fourth tasbih
      // from the takbir. Otherwise the driver's takbir and the posture timer move.
      if ((doneRef.current || (s.done && s.confirmed)) && movesNext) {
        s.onsetTimer = window.setTimeout(() => advance('takbir onset'), TAKBIR_ONSET_MS)
      }
      return
    }

    // Speech just ended.
    window.clearTimeout(s.onsetTimer)
    if (s.carry) {
      s.carry = false
      return
    }
    s.count.speech(false, now)
    if (doneRef.current || !briskMs(step.recitationId)) return
    // Counted earlier and the person spoke again (a fourth tasbih, or the takbir
    // not yet recognised): wait for the same silence again before moving.
    if (s.done) {
      if (s.moveAfter) s.silenceTimer = window.setTimeout(() => advance(s.moveWhy), s.moveAfter + SILENCE_MS)
      return
    }
    s.silenceTimer = window.setTimeout(() => {
      s.count.close()
      const words = wordCount(step.recitationId)
      const f = followerRef.current
      const skip = optionalWords(step.recitationId)
      // Still in the basmala: that speech is not the line itself.
      if (f && f.wordIndex < skip) return
      // Not known to be past the start of the line itself: the speech so far may
      // be mostly the basmala, so it must cover that as well.
      const need = briskMs(step.recitationId, skip > 0 && (!f || f.wordIndex <= skip))!
      const frac = f && words ? (f.wordIndex - skip + 1) / words : 0
      const short = words <= SHORT_WORDS
      const repeat = Math.max(1, step.repeat)
      const counted = Math.min(repeat, Math.max(s.count.reps(need), f?.repsDone ?? 0))
      // Long lines: only when the follower is near the end, or has clearly lost
      // the person (nothing of this line, and three times the brisk speech: a
      // slow reciter pausing mid-line is not done).
      const lost = !f || f.wordIndex <= skip
      const trust = short || frac >= 0.7 || (lost && s.count.speechMs >= 3 * need * repeat)
      if (short) setReps(counted)
      if (!trust || (short ? counted : Math.floor(s.count.speechMs / need)) < repeat) return
      // A repeated line counted by bursts: only once the follower has heard at
      // least one of its repetitions (the speech is this line, not something else).
      if (repeat > 1 && (f?.repsDone ?? 0) < 1) return
      s.done = true
      s.confirmed = (f?.repsDone ?? 0) >= repeat
      log(`[voice] burst line done step ${index} ${step.recitationId} bursts ${s.count.bursts.map(Math.round).join('+')} ms (need ${need} x${repeat}) follower ${f ? `#${f.wordIndex} reps ${f.repsDone}` : 'lost'}`)
      if (repeat > 1) {
        // Repetitions counted: after REPS_DONE_SAME_MS of silence the next line, or
        // REPS_DONE_MOVE_MS the movement when its takbir was not recognised.
        setReps(repeat)
        s.moveAfter = (movesNext ? REPS_DONE_MOVE_MS : REPS_DONE_SAME_MS) - SILENCE_MS
        s.moveWhy = movesNext ? 'reps counted, no takbir heard' : 'reps counted'
        s.silenceTimer = window.setTimeout(() => advance(s.moveWhy), s.moveAfter)
        return
      }
      // Same posture next: move on now. A movement next: wait for the takbir burst
      // (App's short fallback moves on if none comes).
      if (!movesNext) advance('line said')
      else setReps(repeat)
    }, SILENCE_MS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speaking, enabled])

  useEffect(
    () => () => {
      window.clearTimeout(st.current.silenceTimer)
      window.clearTimeout(st.current.onsetTimer)
    },
    [],
  )

  return { reps, done: () => st.current.done }
}
