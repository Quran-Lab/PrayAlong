import { useEffect, useRef, useState } from 'react'
import { postureKey } from '@/content/postures'
import type { Locale } from '@/i18n/locales'
import type { PrayerId, Step } from '@/sequence/types'
import type { Settings } from '@/state/session'
import { audio, getManifest, loadManifest, type Clip } from './engine'

/** Movements announced with a takbir (rising from ruku and the salams carry their own words). */
const TAKBIR_CUES = new Set(['bow', 'prostrate', 'sitUp', 'prostrateAgain', 'sit', 'rise'])
const REPEAT_GAP = 0.45
const QUIET_GAIN = 0.55
/** Room left for the user after each line, by pace. */
const PACE_ROOM = { slow: 1.35, normal: 1, brisk: 0.7 } as const

export interface Speaking {
  stepId: string
  clip: Clip
  /** AudioContext time the current repetition started. */
  startAt: number
}

function plan(step: Step, voice: string, locale: Locale, settings: Settings) {
  const m = getManifest()?.voices[voice]
  if (!m) return null
  const line = m.lines[step.recitationId]
  if (!line) return null
  const clips: { clip: Clip; gain: number; isLine: boolean }[] = []
  if (step.cue && TAKBIR_CUES.has(step.cue) && m.lines['takbir']) clips.push({ clip: m.lines['takbir'], gain: 1, isLine: false })
  if (settings.guide && step.cue && step.groupIndex === 0) {
    const g = m.guide[locale]?.[`hint.${postureKey(step.posture)}`]
    if (g) clips.push({ clip: g, gain: 1, isLine: false })
  }
  const gain = step.voice === 'quiet' ? QUIET_GAIN : 1
  for (let i = 0; i < step.repeat; i++) clips.push({ clip: line, gain, isLine: true })
  const spoken = clips.reduce((t, c) => t + c.clip.dur * 1000, 0) + REPEAT_GAP * 1000 * (clips.length - 1)
  // Pray at the user's pace, not the voice's: leave time to say the line
  // after the companion (repeat-after-me while learning, a breath otherwise).
  const yours = settings.guide ? line.dur * 1000 * step.repeat * PACE_ROOM[settings.pace] : line.dur * 1000 * 0.35
  return { clips, ms: spoken + yours }
}

/**
 * The companion's voice and the room's ambience, following the session.
 * Returns what is being spoken (for word highlighting) and how long the
 * current step's audio lasts (so timers never cut a recitation short).
 */
export function useCompanionAudio(opts: { phase: string; step: Step; next?: Step; prayer: PrayerId; voice: string; locale: Locale; settings: Settings }) {
  const { phase, step, next, prayer, voice, locale, settings } = opts
  const [ready, setReady] = useState(false)
  const [speaking, setSpeaking] = useState<Speaking | null>(null)
  const [unlocked, setUnlocked] = useState(false)

  useEffect(() => {
    void loadManifest().then((m) => setReady(m !== null))
  }, [])

  // Browsers only allow sound after a gesture: unlock on the first one.
  useEffect(() => {
    if (unlocked) return
    const on = () => {
      if (audio.unlock()) setUnlocked(true)
    }
    window.addEventListener('pointerdown', on)
    window.addEventListener('keydown', on)
    return () => {
      window.removeEventListener('pointerdown', on)
      window.removeEventListener('keydown', on)
    }
  }, [unlocked])

  useEffect(() => audio.setVolume(settings.volume), [settings.volume, unlocked])

  // The room: ambience of the hour.
  const takes = ready ? getManifest()?.ambience[prayer] : undefined
  useEffect(() => {
    if (!unlocked || !settings.ambience || !takes?.length) return audio.stopAmbience()
    void audio.startAmbience(prayer, takes)
  }, [unlocked, settings.ambience, prayer, takes])
  useEffect(() => () => audio.stopAmbience(0.5), [])

  // The voice: each line as it comes.
  const planned = ready && settings.voice ? plan(step, voice, locale, settings) : null
  const stepId = step.id
  const live = useRef(0)
  useEffect(() => {
    setSpeaking(null)
    if (phase !== 'praying' || !unlocked || !planned) {
      audio.stopSpeaking()
      return
    }
    const run = ++live.current
    void audio.speak(
      planned.clips.map((c) => ({ src: c.clip.src, gain: c.gain })),
      REPEAT_GAP,
      (i, startAt) => {
        const c = planned.clips[i]!
        if (run === live.current) setSpeaking(c.isLine ? { stepId, clip: c.clip, startAt } : null)
      },
    )
    // Warm the next line so there is no gap.
    const after = next && getManifest()?.voices[voice]?.lines[next.recitationId]
    if (after) audio.preload(after.src)
    return () => audio.stopSpeaking()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, stepId, unlocked, ready, settings.voice, settings.guide, voice, locale])

  return { speaking, audioMs: phase === 'praying' && unlocked ? (planned?.ms ?? null) : null }
}

/** Index of the Arabic word being said right now, or -1. */
export function useSpokenWord(speaking: Speaking | null) {
  const [word, setWord] = useState(-1)
  useEffect(() => {
    if (!speaking?.clip.words?.length) return setWord(-1)
    let raf = 0
    const words = speaking.clip.words
    const tick = () => {
      const t = audio.now - speaking.startAt
      let i = -1
      for (let k = 0; k < words.length; k++) if (t >= words[k]![0] - 0.04) i = k
      if (t > speaking.clip.dur + 0.2) i = -1
      setWord(i)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [speaking])
  return word
}
