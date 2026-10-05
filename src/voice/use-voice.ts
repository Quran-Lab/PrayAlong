import { useCallback, useEffect, useRef, useState } from 'react'
import { PACE_FACTOR, useSession } from '@/state/session'
import { VoiceCore } from './core'
import type { DriverAction, DriverMode, SessionView } from './driver'
import { VoiceEngine, type VoiceEngineOptions } from './engine'
import { targetWord } from './follower'
import { latin } from './phonetic'
import { download, recordingName, SessionRecorder, wavFromInt16 } from './recorder'
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
  /**
   * Opt-in: keep the microphone audio (16 kHz) and the full engine log in
   * memory so `saveRecording()` can download them. Nothing is uploaded.
   */
  record?: boolean
}

export interface VoiceControls {
  /** Recording is on and has audio to save. */
  recording: boolean
  /** Download `<name>.wav` (16 kHz mic) and `<name>.json` (engine log). Local only. */
  saveRecording: () => Promise<void>
}

export interface VoiceState {
  status: VoiceStatus
  error?: VoiceError
  /** Model download progress 0..1 while loading. */
  progress: number
  /** Microphone hears speech right now. */
  speaking: boolean
  /** Step and word the follower thinks the person is on. */
  /**
   * Where the person is: step, repetition, the word IN PROGRESS and how far
   * through it (fill 0..1, by phonemes). The last word of a line reaches fill
   * 1 before the line completes.
   */
  cursor: { step: number; wordIndex: number; rep: number; fill: number; repsDone: number } | null
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
/**
 * Debug log in the browser console: what the recognizer heard (phonemes),
 * what line it expected and where the follower is. On while Listen mode is
 * in beta; turn off with localStorage.setItem('prayalong:voiceDebug', '0').
 */
function voiceDebug() {
  try {
    return localStorage.getItem('prayalong:voiceDebug') !== '0'
  } catch {
    return true
  }
}

export function useVoiceFollow(opts: UseVoiceOptions): VoiceState & VoiceControls {
  const [state, setState] = useState<VoiceState>({ status: 'idle', progress: 0, speaking: false, cursor: null, timerMs: null })
  const engineRef = useRef<VoiceEngine | null>(null)
  const coreRef = useRef<VoiceCore | null>(null)
  const recRef = useRef<SessionRecorder | null>(null)
  const optsRef = useRef(opts)
  optsRef.current = opts

  useEffect(() => {
    if (!opts.enabled) return
    const engine = new VoiceEngine()
    engineRef.current = engine
    const rec = () => recRef.current
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
          rec()?.add('event', e)
          if (voiceDebug()) console.log('%c[voice] event', 'color:#7fd18b', e.kind, JSON.stringify(e), 'snapshot', JSON.stringify(core.follower.snapshot()))
          optsRef.current.onEvidence?.(toEvidence(e, now))
          optsRef.current.onEvent?.(e)
        },
        onAction: (a) => {
          rec()?.add('action', a)
          // Every session move, and why: timer moves are the ones to question.
          if (!voiceDebug()) return
          const s = useSession.getState()
          if (a.type === 'goTo' && a.reason === 'timer') console.log('%c[voice] timer advance', 'color:#e0a050', `step ${s.index} ${s.sequence.steps[s.index]?.recitationId} -> ${a.index}`)
          else console.log('[voice] move', JSON.stringify(a), `from step ${s.index}`)
        },
      },
    )
    coreRef.current = core
    let lastSession = ''
    const onSession = () => {
      const s = useSession.getState()
      const key = `${s.prayer}:${s.phase}:${s.index}`
      if (key !== lastSession) rec()?.add('session', { prayer: s.prayer, phase: s.phase, index: s.index, line: s.sequence.steps[s.index]?.recitationId })
      lastSession = key
      core.sync(performance.now())
      const timerMs = core.driver.timeoutMs(view())
      setState((st) => (st.timerMs === timerMs ? st : { ...st, timerMs }))
    }
    const unsubSession = useSession.subscribe(onSession)
    onSession()
    const cursor = () => {
      const snap = core.follower.snapshot()
      setState((st) =>
        st.cursor?.step === snap.step && st.cursor.wordIndex === snap.wordIndex && st.cursor.rep === snap.rep && st.cursor.fill === snap.fill && st.cursor.repsDone === snap.repsDone
          ? st
          : { ...st, cursor: { step: snap.step, wordIndex: snap.wordIndex, rep: snap.rep, fill: snap.fill, repsDone: snap.repsDone } },
      )
    }

    const off = engine.on((e) => {
      core.driver.cfg.mode = optsRef.current.mode
      switch (e.type) {
        case 'status':
          if (e.status === 'listening' && optsRef.current.record) {
            recRef.current = new SessionRecorder(useSession.getState().prayer)
            engine.setRecording(true)
            onSession()
          }
          setState((st) => ({ ...st, status: e.status, error: e.error }))
          break
        case 'progress':
          setState((st) => ({ ...st, progress: e.total ? e.loaded / e.total : 0 }))
          break
        case 'tokens':
          if (voiceDebug() && e.tokens.length) {
            const s = useSession.getState()
            const step = s.sequence.steps[s.index]
            const snap = core.follower.snapshot()
            const cursorLine = s.sequence.steps[snap.step]?.recitationId ?? ''
            console.log(
              '[voice] heard',
              latin(e.tokens.join(' ')),
              '| expected',
              step?.recitationId,
              `x${step?.repeat}`,
              '| cursor',
              `${cursorLine}#${snap.wordIndex} "${latin(targetWord(cursorLine, snap.wordIndex))}" rep ${snap.rep} done ${snap.repsDone} fill ${snap.fill} cost ${snap.cost}`,
            )
          }
          optsRef.current.onTokens?.(e.tokens, e.at)
          rec()?.add('tokens', { tokens: e.tokens, segment: e.segment, decodeMs: e.decodeMs }, e.at)
          core.tokens(e.tokens, e.at, performance.now())
          cursor()
          break
        case 'endpoint':
          rec()?.add('endpoint', { segment: e.segment }, e.at)
          core.endpoint(e.at, performance.now())
          cursor()
          break
        case 'level':
          rec()?.level(e.speech, e.rms, e.at)
          core.level(e.speech, e.at, performance.now())
          setState((st) => (st.speaking === e.speech ? st : { ...st, speaking: e.speech }))
          cursor()
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
      recRef.current = null
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
      recRef.current?.add('companion', { on, gate: on && gateOn })
      if (gateOn || !on) engine?.setGate(on && gateOn)
    }
    if (speaking) return apply(true)
    const id = window.setTimeout(() => apply(false), COMPANION_TAIL_MS)
    return () => window.clearTimeout(id)
  }, [speaking, gateOn, state.status])

  // Turning recording on while already listening starts it now.
  useEffect(() => {
    const engine = engineRef.current
    if (!engine || state.status !== 'listening') return
    if (opts.record && !recRef.current) {
      recRef.current = new SessionRecorder(useSession.getState().prayer)
      engine.setRecording(true)
    } else if (!opts.record && recRef.current) {
      engine.setRecording(false)
    }
  }, [opts.record, state.status])

  const saveRecording = useCallback(async () => {
    const engine = engineRef.current
    const r = recRef.current
    if (!engine || !r) return
    const audio = await engine.takeRecording()
    const name = recordingName(r.prayer, r.startedAt)
    download(wavFromInt16(audio.pcm, audio.sampleRate), `${name}.wav`)
    download(new Blob([JSON.stringify(r.file(audio.startAt, audio.sampleRate))], { type: 'application/json' }), `${name}.json`)
  }, [])

  return { ...state, recording: !!opts.record && state.status === 'listening', saveRecording }
}
