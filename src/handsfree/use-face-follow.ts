import { useCallback, useEffect, useRef, useState } from 'react'
import type { Step } from '@/sequence/types'
import { FaceEngine, type FaceEngineStatus, type FaceReading } from './face-engine'
import { FaceFollower, type FaceMove } from './face-logic'

export interface FaceDebug {
  reading: FaceReading | null
  state: string
  lastMove: FaceMove | null
}

/**
 * The camera toggle: face presence only (see face-logic.ts). Moves go
 * through `onAdvance`, the same single applier as every other follower
 * (session.followTo), and only ever forward.
 */
export function useFaceFollow({
  enabled,
  facingMode,
  steps,
  phase,
  index,
  onAdvance,
  debug = false,
}: {
  enabled: boolean
  facingMode: 'user' | 'environment'
  steps: readonly Step[]
  phase: 'ready' | 'praying' | 'complete'
  index: number
  onAdvance: (index: number, reason: FaceMove['reason']) => void
  debug?: boolean
}) {
  const [status, setStatus] = useState<FaceEngineStatus | 'off'>('off')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [hint, setHint] = useState<'no-face' | null>(null)
  const [dbg, setDbg] = useState<FaceDebug>({ reading: null, state: 'unknown', lastMove: null })
  const [attempt, setAttempt] = useState(0)
  const engine = useRef<FaceEngine | null>(null)
  const follower = useRef(new FaceFollower())
  const where = useRef({ phase, index, steps })
  where.current = { phase, index, steps }
  const onAdvanceRef = useRef(onAdvance)
  onAdvanceRef.current = onAdvance
  const debugRef = useRef(debug)
  debugRef.current = debug

  useEffect(() => {
    if (!enabled) {
      setStatus('off')
      setHint(null)
      return
    }
    const fl = new FaceFollower()
    follower.current = fl
    fl.sync(where.current.phase, where.current.index, where.current.steps, performance.now())
    const e = new FaceEngine(facingMode, {
      onStatus: setStatus,
      onStream: setStream,
      onReading: (r) => {
        const { phase: ph, index: i, steps: st } = where.current
        fl.sync(ph, i, st, r.t)
        const box = r.box
        const move = fl.push({ t: r.t, visible: r.visible, cy: box ? box.y + box.h / 2 : undefined, h: box?.h })
        setHint(fl.hint)
        if (move) {
          console.log(`[face] ${move.reason} -> step ${move.index}`)
          onAdvanceRef.current(move.index, move.reason)
        }
        if (debugRef.current) setDbg({ reading: r, state: fl.state, lastMove: fl.lastMove })
      },
    })
    engine.current = e
    void e.start()
    return () => {
      engine.current = null
      e.dispose()
      setStream(null)
    }
  }, [enabled, facingMode, attempt])

  // Keep the follower in step with the session (voice, timers, taps move it too).
  useEffect(() => {
    follower.current.sync(phase, index, steps, performance.now())
  }, [phase, index, steps])

  const retry = useCallback(() => {
    if (engine.current && status === 'camera-lost') engine.current.retryCamera()
    else setAttempt((n) => n + 1)
  }, [status])

  return { status, stream, hint, debug: dbg, video: engine.current?.video ?? null, retry }
}
