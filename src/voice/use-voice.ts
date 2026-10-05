import { useEffect, useRef, useState } from 'react'
import { PACE_FACTOR, useSession } from '@/state/session'
import { VoiceCore } from './core'
import type { DriverAction, DriverMode, SessionView } from './driver'
import { VoiceEngine, type VoiceEngineOptions } from './engine'
import type { Evidence, FollowerEvent, VoiceError, VoiceStatus } from './types'

export interface UseVoiceOptions {
  enabled: boolean
  /** 'full' when the camera is off, 'lines' when it is on, 'evidence' to only listen. */
  mode: DriverMode
  /**
   * True while the companion's recitation is playing. With `ignoreCompanion`
   * the microphone is replaced by silence for that time (plus a short tail).
   */
  companionSpeaking?: boolean
  ignoreCompanion?: boolean
  onEvidence?: (e: Evidence) => void
  /** Every follower event (lab view). */
  onEvent?: (e: FollowerEvent) => void
  /** Raw decoder tokens (lab view). */
  onTokens?: (tokens: string[], at: number) => void
  engine?: VoiceEngineOptions
}

export interface VoiceState {
  status: VoiceStatus
  error?: VoiceError
  /** Model download progress 0..1 while loading. */
  progress: number
  /** Microphone hears speech right now. */
  speaking: boolean
  /** Step and word the follower thinks the person is on. */
  cursor: { step: number; wordIndex: number; rep: number } | null
  /**
   * The timer fallback for the current step (ms), for the visible progress
   * slider while voice leads; null when the step has no timer.
   */
  timerMs: number | null
}

const COMPANION_TAIL_MS = 350

const view = (): SessionView => {
  const s = useSession.getState()
  return { phase: s.phase, index: s.index, steps: s.sequence.steps }
}

/** Apply a driver action to the session store, forward only. */
export function applyAction(a: DriverAction) {
  const s = useSession.getState()
  if (a.type === 'begin') {
    if (s.phase === 'ready') s.begin()
  } else if (a.type === 'finish') {
    if (s.phase === 'praying' && s.index === s.sequence.steps.length - 1) s.next()
  } else if (s.phase === 'praying' && a.index > s.index) {
    s.goTo(a.index)
  }
}

export function toEvidence(e: FollowerEvent, now: number): Evidence {
  const base = { source: 'voice' as const, confidence: e.confidence, at: now }
  if (e.kind === 'word') return { ...base, kind: 'word', step: e.step, lineId: e.lineId, wordIndex: e.wordIndex }
  if (e.kind === 'lineDone' || e.kind === 'lineStart') return { ...base, kind: e.kind, step: e.step, lineId: e.lineId }
  return { ...base, kind: e.kind }
}

/**
 * Listens while `enabled`, follows the prayer in the session store and
 * (depending on `mode`) moves it. Lazy: nothing is downloaded until enabled.
 */
export function useVoiceFollow(opts: UseVoiceOptions): VoiceState {
  const [state, setState] = useState<VoiceState>({ status: 'idle', progress: 0, speaking: false, cursor: null, timerMs: null })
  const engineRef = useRef<VoiceEngine | null>(null)
  const coreRef = useRef<VoiceCore | null>(null)
  const optsRef = useRef(opts)
  optsRef.current = opts

  useEffect(() => {
    if (!opts.enabled) return
    const engine = new VoiceEngine()
    engineRef.current = engine
    const core = new VoiceCore(
      useSession.getState().sequence.steps,
      {
        mode: optsRef.current.mode,
        stepMs: (step) => Math.max(step.timing.minMs, step.timing.expectedMs * PACE_FACTOR[useSession.getState().settings.pace]),
      },
      {
        view,
        apply: applyAction,
        onEvent: (e, now) => {
          optsRef.current.onEvidence?.(toEvidence(e, now))
          optsRef.current.onEvent?.(e)
        },
      },
    )
    coreRef.current = core
    const onSession = () => {
      core.sync(performance.now())
      const timerMs = core.driver.timeoutMs(view())
      setState((st) => (st.timerMs === timerMs ? st : { ...st, timerMs }))
    }
    const unsubSession = useSession.subscribe(onSession)
    onSession()
    const cursor = () => {
      const snap = core.follower.snapshot()
      setState((st) =>
        st.cursor?.step === snap.step && st.cursor.wordIndex === snap.wordIndex && st.cursor.rep === snap.rep ? st : { ...st, cursor: { step: snap.step, wordIndex: snap.wordIndex, rep: snap.rep } },
      )
    }

    const off = engine.on((e) => {
      core.driver.cfg.mode = optsRef.current.mode
      switch (e.type) {
        case 'status':
          setState((st) => ({ ...st, status: e.status, error: e.error }))
          break
        case 'progress':
          setState((st) => ({ ...st, progress: e.total ? e.loaded / e.total : 0 }))
          break
        case 'tokens':
          optsRef.current.onTokens?.(e.tokens, e.at)
          core.tokens(e.tokens, e.at, performance.now())
          cursor()
          break
        case 'endpoint':
          core.endpoint(e.at, performance.now())
          cursor()
          break
        case 'level':
          core.level(e.speech, e.at, performance.now())
          setState((st) => (st.speaking === e.speech ? st : { ...st, speaking: e.speech }))
          break
      }
    })
    void engine.start(optsRef.current.engine)
    const timer = window.setInterval(() => {
      core.driver.cfg.mode = optsRef.current.mode
      core.tick(performance.now())
    }, 250)

    return () => {
      window.clearInterval(timer)
      off()
      unsubSession()
      engine.stop()
      engineRef.current = null
      coreRef.current = null
      setState({ status: 'idle', progress: 0, speaking: false, cursor: null, timerMs: null })
    }
  }, [opts.enabled])

  // Companion speaking: hold the line timers (always) and silence the
  // microphone (with ignoreCompanion), each released after a short tail for
  // room reverb.
  const speaking = !!opts.companionSpeaking
  const gateOn = !!opts.ignoreCompanion && speaking
  useEffect(() => {
    const engine = engineRef.current
    const core = coreRef.current
    const apply = (on: boolean) => {
      core?.companion(on, performance.now())
      if (gateOn || !on) engine?.setGate(on && gateOn)
    }
    if (speaking) return apply(true)
    const id = window.setTimeout(() => apply(false), COMPANION_TAIL_MS)
    return () => window.clearTimeout(id)
  }, [speaking, gateOn, state.status])

  return state
}
