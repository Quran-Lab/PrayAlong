import { useCallback, useEffect, useRef, useState } from 'react'
import type { PoseClass, Step } from '@/sequence/types'
import type { Blocker } from './advice'
import type { Advance, Evidence, SegmentKind } from './decoder'
import { HandsFreeEngine, type CheckResult, type EngineStatus, type Live } from './engine'
import { PoseStabilizer } from './stabilizer'
import type { Framing, HandsFreeStatus } from './types'

const DEMO_KEYS: Record<string, PoseClass> = { '1': 'hands-raised', '2': 'standing', '3': 'bowing', '4': 'prostrating', '5': 'sitting' }

const toStatus = (s: EngineStatus): HandsFreeStatus => (s === 'lost' ? 'camera-lost' : s)

export type CheckState = { state: 'idle' } | { state: 'running'; stage: 'bowing' | 'sitting' } | { state: 'done'; result: CheckResult }

/**
 * Camera -> vision worker (body + face) -> calibrated features -> sequence
 * decoder -> step changes. See docs/hands-free.md.
 *
 * The session tells the hook where the prayer is (`phase`, `index`) and the
 * hook reports movements through `onAdvance(index)`. Voice (or anything
 * else) can add evidence with `addEvidence`. Demo mode skips the camera and
 * reports poses through `onPose`, as before.
 */
export function useHandsFree({
  enabled,
  demo,
  facingMode,
  steps,
  phase,
  index,
  onPose,
  onAdvance,
}: {
  enabled: boolean
  demo: boolean
  facingMode: 'user' | 'environment'
  steps: readonly Step[]
  phase: 'ready' | 'praying' | 'complete'
  index: number
  /** Demo mode and the compatibility engine: a stable pose change. */
  onPose: (pose: PoseClass) => void
  /** A recognised movement: go to this step. */
  onAdvance: (index: number, reason: Advance['reason']) => void
}) {
  const [status, setStatus] = useState<HandsFreeStatus>('off')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [pose, setPose] = useState<PoseClass | null>(null)
  const [live, setLive] = useState<Live | null>(null)
  const [engineLabel, setEngineLabel] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [check, setCheck] = useState<CheckState>({ state: 'idle' })
  const onPoseRef = useRef(onPose)
  onPoseRef.current = onPose
  const onAdvanceRef = useRef(onAdvance)
  onAdvanceRef.current = onAdvance
  const engine = useRef<HandsFreeEngine | null>(null)
  const where = useRef({ phase, index, steps })
  where.current = { phase, index, steps }
  const stabilizer = useRef(new PoseStabilizer())

  const emit = useCallback((p: PoseClass | null, t: number) => {
    const changed = stabilizer.current.push(p, t)
    if (changed) {
      setPose(changed)
      onPoseRef.current(changed)
    }
  }, [])

  /** Demo: act out a pose as if the camera had seen it held for a moment. */
  const actOut = useCallback(
    (p: PoseClass) => {
      const t0 = performance.now()
      for (let i = 0; i <= 12; i++) emit(p, t0 + i * 60)
    },
    [emit],
  )

  // Demo mode
  useEffect(() => {
    if (!enabled || !demo) return
    stabilizer.current.reset()
    setStatus('demo')
    const onKey = (e: KeyboardEvent) => {
      const p = DEMO_KEYS[e.key]
      if (p && !(e.target as HTMLElement).closest('input, textarea')) actOut(p)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, demo, actOut])

  // Camera mode
  useEffect(() => {
    if (!enabled || demo) {
      if (!enabled) {
        setStatus('off')
        setPose(null)
        setLive(null)
      }
      return
    }
    stabilizer.current.reset()
    const e = new HandsFreeEngine(where.current.steps, facingMode, {
      onStatus: (s) => setStatus(toStatus(s)),
      onStream: setStream,
      onLabel: setEngineLabel,
      onLive: (l) => {
        setLive(l)
        setPose(l.pose)
      },
      onPose: (p) => {
        setPose(p)
        onPoseRef.current(p)
      },
      onAdvance: (adv) => {
        const { phase: ph, index: i, steps: st } = where.current
        if (adv.index >= 0) {
          // Forward only: never undo where the session already is.
          if (ph === 'praying' && adv.index <= i) return
          onAdvanceRef.current(adv.index, adv.reason)
        } else if (ph === 'praying' && st[i + 1] && st[i + 1]!.posture === st[i]!.posture) {
          onAdvanceRef.current(i + 1, 'line')
        }
      },
    })
    engine.current = e
    e.sync(where.current.phase, where.current.index)
    void e.start()
    return () => {
      engine.current = null
      e.dispose()
      setStream(null)
      setLive(null)
      setCheck({ state: 'idle' })
    }
    // The prayer's steps only change between prayers (a new engine then).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, demo, facingMode, attempt, steps])

  // Keep the decoder in step with the session.
  useEffect(() => {
    engine.current?.sync(phase, index)
  }, [phase, index])

  const retry = useCallback(() => {
    if (engine.current && status === 'camera-lost') engine.current.retryCamera()
    else setAttempt((n) => n + 1)
  }, [status])

  /** Voice or other evidence for the decoder (see decoder.ts). */
  const addEvidence = useCallback((ev: Omit<Evidence, 'at'> & { at?: number }) => engine.current?.addEvidence(ev), [])

  const recalibrate = useCallback(() => engine.current?.recalibrate(), [])

  const startCheck = useCallback(() => {
    const e = engine.current
    if (!e) return
    setCheck({ state: 'running', stage: 'bowing' })
    e.startCheck((result) => setCheck({ state: 'done', result }))
  }, [])

  // While the check runs, show which part it waits for.
  useEffect(() => {
    if (check.state !== 'running') return
    const id = setInterval(() => {
      const run = engine.current?.check
      if (run && !run.done && run.stage !== 'done' && run.stage !== check.stage) setCheck({ state: 'running', stage: run.stage })
    }, 200)
    return () => clearInterval(id)
  }, [check])

  const framing: Framing = !live ? 'none' : live.blocker === 'no-person' ? 'none' : live.blocker ? 'partial' : 'full'
  const expected: SegmentKind | null = live?.decoder.expected ?? null

  return {
    status,
    stream,
    pose,
    framing,
    engineLabel,
    actOut,
    retry,
    addEvidence,
    recalibrate,
    startCheck,
    check,
    /** What the camera waits for next, and how close it is (0..1). */
    expected,
    expectedPosture: live?.decoder.expectedPosture ?? null,
    progress: live?.decoder.progress ?? 0,
    blocker: (live?.blocker ?? null) as Blocker,
    calibrated: live?.calibrated ?? false,
    /** No usable view of the person for 8 s. */
    lost: live?.decoder.lost ?? false,
    /** Timers must not cross a posture boundary right now (sujud, nobody in view). */
    hold: live?.hold ?? false,
  }
}
