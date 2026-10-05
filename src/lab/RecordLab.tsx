import { useEffect, useRef, useState } from 'react'
import { ResilientCamera } from '@/handsfree/camera'
import { VisionEngine } from '@/handsfree/engines/vision'
import type { FeatureVec } from '@/handsfree/features'
import type { Observation } from '@/handsfree/observation'
import { Perception } from '@/handsfree/pipeline'
import { posterior } from '@/handsfree/posterior'

/**
 * Dev tool: record a real prayer for the hands-free evaluation.
 *
 *   /?lab&record[&name=fatima-floor-rugedge]
 *
 * Put the laptop where it will really be (on the floor at the rug), stand
 * still for 3 seconds, then pray. Press Space as you START each movement
 * (it marks the next posture of a two-rak'ah prayer), or the number keys
 * for a specific posture; D marks a distractor (hands raised before ruku,
 * adjusting your clothes). Save downloads the observations (keypoints, face,
 * features) and the marks as JSON, plus the video as WebM. Drop the JSON
 * into .eval/recorded/ and run scripts/eval/run.mjs evaluate.
 */

const ORDER = [
  'takbir', 'qiyam', 'ruku', 'itidal', 'sujud', 'jalsah', 'sujud',
  'qiyam', 'ruku', 'itidal', 'sujud', 'jalsah', 'sujud', 'tashahhud', 'salam-right', 'salam-left',
] as const
const KEYS: Record<string, string> = {
  '0': 'rest', '1': 'takbir', '2': 'qiyam', '3': 'ruku', '4': 'itidal', '5': 'sujud', '6': 'jalsah', '7': 'tashahhud', '8': 'salam-right', '9': 'salam-left',
}

interface Mark {
  t: number
  posture: string
  distractor?: boolean
}

export function RecordLab() {
  const params = new URLSearchParams(location.search)
  const video = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState('starting')
  const [recording, setRecording] = useState(false)
  const [marks, setMarks] = useState<Mark[]>([])
  const [live, setLive] = useState('')
  const state = useRef({ frames: [] as { t: number; obs: Observation | null; features: FeatureVec | null }[], marks: [] as Mark[], recording: false, t0: 0 })
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const nextMark = marks.filter((m) => !m.distractor && m.posture !== 'rest').length

  useEffect(() => {
    let stopped = false
    let engine: VisionEngine | null = null
    let timer = 0
    const perception = new Perception()
    const cam = new ResilientCamera({
      facingMode: 'user',
      onStream: (s) => {
        if (video.current) video.current.srcObject = s
        if (s) {
          void video.current?.play()
          const rec = new MediaRecorder(s, { mimeType: 'video/webm' })
          rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data)
          recorder.current = rec
        }
      },
      onState: (s) => setStatus(s),
    })
    ;(async () => {
      await cam.start()
      engine = await VisionEngine.create({ pose: 'full', face: true })
      setStatus(`live · ${engine.label}`)
      const loop = async () => {
        if (stopped) return
        const t = performance.now()
        const v = video.current
        if (v && v.readyState >= 2 && engine?.ready) {
          const obs = await engine.detect(await createImageBitmap(v), t)
          const s = state.current
          if (obs) {
            obs.t = t
            // Calibrate on the first 3 s of a recording (stand still, look at the screen).
            const r = perception.push(obs, { calibrating: s.recording && t - s.t0 < 3000 })
            const post = posterior(t, r.features, r.measures)
            if (s.recording) s.frames.push({ t, obs, features: r.features })
            const best = Object.entries(post.p).sort((a, b) => b[1] - a[1])[0]!
            setLive(`${r.features ? `${best[0]} ${(best[1] * 100).toFixed(0)}%` : 'calibrating'} · body ${obs.body ? 'yes' : 'no'} · face ${obs.face ? 'yes' : 'no'} · ${obs.ms} ms`)
          } else if (s.recording) s.frames.push({ t, obs: null, features: null })
        }
        timer = window.setTimeout(loop, Math.max(0, 1000 / 15 - (performance.now() - t)))
      }
      void loop()
    })()
    return () => {
      stopped = true
      clearTimeout(timer)
      engine?.dispose()
      cam.stop()
    }
  }, [])

  const mark = (posture: string, distractor = false) => {
    if (!state.current.recording) return
    const m = { t: performance.now(), posture, distractor }
    state.current.marks.push(m)
    setMarks([...state.current.marks])
  }

  useEffect(() => {
    let distractorNext = false
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        e.preventDefault()
        const n = state.current.marks.filter((m) => !m.distractor && m.posture !== 'rest').length
        const p = distractorNext ? 'takbir' : ORDER[n]
        if (p) mark(p, distractorNext)
        distractorNext = false
      } else if (e.key === 'd') distractorNext = true
      else if (KEYS[e.key]) mark(KEYS[e.key]!, distractorNext)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const start = () => {
    state.current = { frames: [], marks: [], recording: true, t0: performance.now() }
    state.current.marks.push({ t: state.current.t0, posture: 'rest' })
    setMarks([...state.current.marks])
    chunks.current = []
    recorder.current?.start(1000)
    setRecording(true)
  }

  const save = () => {
    state.current.recording = false
    setRecording(false)
    const name = params.get('name') ?? `recording-${new Date().toISOString().replace(/[:.]/g, '-')}`
    const data = {
      format: 'prayalong-recording/1',
      name,
      meta: { userAgent: navigator.userAgent, aspect: (video.current?.videoWidth ?? 4) / (video.current?.videoHeight ?? 3) },
      frames: state.current.frames,
      marks: state.current.marks,
    }
    const download = (blob: Blob, file: string) => {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = file
      a.click()
    }
    download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `${name}.json`)
    const rec = recorder.current
    if (rec && rec.state !== 'inactive') {
      rec.onstop = () => download(new Blob(chunks.current, { type: 'video/webm' }), `${name}.webm`)
      rec.stop()
    }
  }

  return (
    <div className="fixed inset-0 flex flex-col items-center gap-3 bg-[#0a0d0c] p-4 text-sm text-white">
      <video ref={video} muted playsInline className="w-full max-w-xl -scale-x-100 rounded-xl bg-black" />
      <div id="record-status" className="text-white/70">{status} · {live}</div>
      <div className="flex gap-2">
        {!recording ? (
          <button onClick={start} className="rounded-lg bg-white px-4 py-2 text-black">Start recording</button>
        ) : (
          <button onClick={save} className="rounded-lg bg-amber-300 px-4 py-2 text-black">Stop and save</button>
        )}
      </div>
      <p className="max-w-xl text-center text-white/60">
        Stand still and look at the screen for 3 seconds, then pray. Press Space as you start each movement
        {recording && ORDER[nextMark] ? ` (next: ${ORDER[nextMark]})` : ''}. D then Space marks hands raised that are not a step. Keys 0 to 9 mark a specific posture.
      </p>
      <ol className="max-h-48 overflow-auto text-xs text-white/50">
        {marks.map((m, i) => (
          <li key={i}>
            {((m.t - (marks[0]?.t ?? 0)) / 1000).toFixed(1)} s {m.posture}
            {m.distractor ? ' (distractor)' : ''}
          </li>
        ))}
      </ol>
    </div>
  )
}
