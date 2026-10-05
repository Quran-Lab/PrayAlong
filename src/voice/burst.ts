import { useEffect, useRef, useState } from 'react'
import phonemes from '@/content/phonemes.json'
import { useSession } from '@/state/session'

/**
 * Speech-burst follow: a safety layer next to the phoneme follower that only
 * needs to know WHEN the person speaks, not what the recognizer made of it.
 *
 * A short line (takbir, tasbih, tasmi', "rabbighfir li") said with a pause
 * after it counts as said once the person has spoken about as long as the
 * line takes at a brisk pace; a repeated line counts one repetition per such
 * stretch of speech. After a line before a movement is said, the next burst of
 * speech is the takbir and moves the prayer on as it starts. Long lines are
 * left to the phoneme follower unless it has clearly lost the person.
 */

const LINES = (phonemes as { lines: Record<string, { words: string[]; optional?: number }> }).lines

/** Leading follower words that may be left out (the basmala before a surah). */
export const optionalWords = (lineId: string) => LINES[lineId]?.optional ?? 0

/** The line's own words (without the optional basmala). */
const ownWords = (lineId: string) => LINES[lineId]?.words.slice(optionalWords(lineId)) ?? []

/** Speech time a line needs at a brisk pace (ms): ~25 ms per phonetic character. */
export function briskMs(lineId: string): number | null {
  const words = ownWords(lineId)
  if (!words.length) return null
  return Math.max(350, words.join('').length * 25)
}

export const wordCount = (lineId: string) => ownWords(lineId).length

/** Silence after speech before a line counts as finished (ms). */
export const SILENCE_MS = 700
/** Speech at the start of the next burst before it counts as the takbir (ms). */
const TAKBIR_ONSET_MS = 250
/** Lines up to this many words are short enough to follow by speech alone. */
const SHORT_WORDS = 3

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
  const st = useRef({ step: -1, speechMs: 0, since: 0, done: false, onsetTimer: 0, silenceTimer: 0 })
  const followerRef = useRef(follower)
  followerRef.current = follower
  const doneRef = useRef(followerDone)
  doneRef.current = followerDone

  // New step: start counting afresh.
  useEffect(() => {
    const s = st.current
    window.clearTimeout(s.silenceTimer)
    window.clearTimeout(s.onsetTimer)
    st.current = { step: index, speechMs: 0, since: speaking ? performance.now() : 0, done: false, onsetTimer: 0, silenceTimer: 0 }
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
      s.since = now
      // The line before a movement is said: this burst is the takbir.
      if ((s.done || doneRef.current) && movesNext) {
        s.onsetTimer = window.setTimeout(() => advance('takbir onset'), TAKBIR_ONSET_MS)
      }
      return
    }

    // Speech just ended.
    window.clearTimeout(s.onsetTimer)
    if (s.since) s.speechMs += now - s.since
    s.since = 0
    const need = briskMs(step.recitationId)
    if (!need || s.done || doneRef.current) return
    s.silenceTimer = window.setTimeout(() => {
      const words = wordCount(step.recitationId)
      const f = followerRef.current
      const skip = optionalWords(step.recitationId)
      // Still in the basmala: that speech is not the line itself.
      if (f && f.wordIndex < skip) {
        s.speechMs = 0
        return
      }
      const frac = f && words ? (f.wordIndex - skip + 1) / words : 0
      const short = words <= SHORT_WORDS
      // Long lines: only when the follower is near the end, or has clearly lost the person.
      const trust = short || frac >= 0.7 || (frac < 0.35 && s.speechMs >= 1.3 * need * step.repeat)
      const counted = Math.min(step.repeat, Math.floor(s.speechMs / need))
      if (short) setReps(counted)
      if (!trust || counted < step.repeat) return
      s.done = true
      log(`[voice] burst line done step ${index} ${step.recitationId} speech ${Math.round(s.speechMs)} ms (need ${need} x${step.repeat}) follower ${f ? `#${f.wordIndex}` : 'lost'}`)
      // Same posture next: move on now. A movement next: wait for the takbir burst
      // (App's short fallback moves on if none comes).
      if (!movesNext) advance('line said')
      else setReps(step.repeat)
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
