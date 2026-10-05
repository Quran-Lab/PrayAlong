import { useEffect, useMemo, useRef, useState } from 'react'
import { getLine } from '@/content/recitations'
import { PRAYERS } from '@/content/prayers'
import type { PrayerId } from '@/sequence/types'
import { currentStep, useSession } from '@/state/session'
import type { DriverMode } from '@/voice/driver'
import { prepareReplay, replayParams, replayRecording, runReplay, wavOf, type ReplayResult } from '@/voice/replay-run'
import type { FollowerEvent } from '@/voice/types'
import { useVoiceFollow } from '@/voice/use-voice'

/**
 * Dev tool for the microphone engine: /?lab&voice
 *
 * Live: listen to the microphone and drive the real session (transcript,
 * line/word cursor, every follower event).
 * Replay: /?lab&voice&replay&prayer=fajr&speaker=aisha&snr=10&gain=0.1&run
 * builds the prayer from the companion recordings and scores the follower.
 * The Playwright harness (scripts/voice-replay.mjs) reads window.__voiceResult.
 */

declare global {
  interface Window {
    __voiceResult?: ReplayResult | { error: string }
    __voiceProgress?: number
    __voiceWav?: () => Promise<string>
  }
}

const fmt = (e: FollowerEvent) => {
  switch (e.kind) {
    case 'word':
      return `word  ${e.lineId}#${e.wordIndex}${e.rep ? ` r${e.rep}` : ''} (${e.confidence})`
    case 'lineStart':
    case 'lineDone':
      return `${e.kind.padEnd(9)} ${e.lineId} @${e.step} (${e.confidence})`
    default:
      return `KEYWORD ${e.kind} (${e.confidence})`
  }
}

export function VoiceLab() {
  const params = useMemo(() => new URLSearchParams(location.search), [])
  return params.has('replay') ? <ReplayPanel params={params} /> : <LivePanel />
}

function LivePanel() {
  const session = useSession()
  const step = currentStep(session)
  const [enabled, setEnabled] = useState(false)
  const [mode, setMode] = useState<DriverMode>('full')
  const [transcript, setTranscript] = useState('')
  const [events, setEvents] = useState<{ t: number; text: string }[]>([])
  const t0 = useRef(performance.now())
  const [record, setRecord] = useState(false)
  const voice = useVoiceFollow({
    enabled,
    mode,
    record,
    onEvent: (e) => setEvents((ev) => [{ t: (performance.now() - t0.current) / 1000, text: fmt(e) }, ...ev].slice(0, 60)),
    onTokens: (tokens) => setTranscript((s) => (s + tokens.join('')).slice(-400)),
  })
  const words = getLine(step.recitationId).arabic.split(/\s+/)
  const cursor = voice.cursor?.step === session.index ? voice.cursor.wordIndex : -1

  return (
    <div className="min-h-full bg-canvas p-4 text-ink sm:p-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <header className="flex flex-wrap items-center gap-2 text-sm">
          <strong className="me-2">Voice lab</strong>
          <select className="rounded-md bg-raised px-2 py-1" value={session.prayer} onChange={(e) => session.choosePrayer(e.target.value as PrayerId)}>
            {PRAYERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select className="rounded-md bg-raised px-2 py-1" value={mode} onChange={(e) => setMode(e.target.value as DriverMode)}>
            <option value="full">mic leads (full)</option>
            <option value="lines">lines only (camera leads postures)</option>
            <option value="evidence">evidence only</option>
          </select>
          <button className="rounded-md bg-mint px-3 py-1 font-medium text-black" onClick={() => setEnabled((v) => !v)}>
            {enabled ? 'Stop listening' : 'Listen'}
          </button>
          <button className="rounded-md bg-raised px-3 py-1" onClick={() => session.restart()}>
            Restart
          </button>
          <label className="flex items-center gap-1.5 rounded-md bg-raised px-2 py-1">
            <input type="checkbox" checked={record} onChange={(e) => setRecord(e.target.checked)} />
            Record this session
          </label>
          {voice.recording && (
            <button className="rounded-md bg-raised px-3 py-1" onClick={() => void voice.saveRecording()}>
              Save recording (wav + log)
            </button>
          )}
          <WavReplay />
          <span id="voice-status" data-status={voice.status} className="text-ink-muted">
            {voice.status}
            {voice.status === 'loading' && ` ${Math.round(voice.progress * 100)}%`}
            {voice.error && ` (${voice.error})`}
          </span>
          <span className={`size-2.5 rounded-full ${voice.speaking ? 'bg-mint' : 'bg-white/15'}`} title="speech" />
        </header>

        <section className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-2 text-xs text-ink-muted">
            {session.phase} | step {session.index} / {session.sequence.steps.length} | {step.posture} | {step.recitationId} x{step.repeat} ({step.voice})
          </div>
          <p dir="rtl" lang="ar" className="font-quran text-3xl leading-loose">
            {words.map((w, i) => (
              <span key={i} className={i < cursor ? 'text-mint' : i === cursor ? 'underline decoration-mint underline-offset-8' : 'text-ink-soft'}>
                {w}{' '}
              </span>
            ))}
          </p>
          <div className="mt-3 flex gap-2 text-xs">
            <button className="rounded-md bg-raised px-2 py-1" onClick={() => session.prev()}>
              prev
            </button>
            <button className="rounded-md bg-raised px-2 py-1" onClick={() => session.next()}>
              next
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 text-xs text-ink-muted">Heard (phonetic script)</div>
          <p dir="rtl" lang="ar" className="min-h-8 break-all text-lg text-ink-soft">
            {transcript}
          </p>
        </section>

        <section className="rounded-xl border border-line bg-surface p-4 font-mono text-xs">
          <div className="mb-1 text-ink-muted">Events</div>
          {events.map((e, i) => (
            <div key={i} className={e.text.startsWith('KEYWORD') ? 'text-mint' : e.text.startsWith('line') ? 'text-ink' : 'text-ink-muted'}>
              {e.t.toFixed(1).padStart(6)}s {e.text}
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}

/**
 * Replay a recorded session WAV (from "Record this session") through the real
 * worker, follower and driver, against the prayer chosen above. Local only.
 */
function WavReplay() {
  const prayer = useSession((s) => s.prayer)
  const [out, setOut] = useState<string[]>([])
  const run = async (file: File) => {
    const lines: string[] = []
    const log = (s: string) => {
      lines.push(s)
      setOut([...lines].slice(-80))
    }
    const r = await replayRecording(file, prayer, log)
    log(`done: phase ${r.phase}, step ${r.index}, ${r.events} events, ${r.moves} moves (${r.timerMoves} by timer)`)
  }
  return (
    <span className="relative">
      <label className="cursor-pointer rounded-md bg-raised px-3 py-1">
        Replay a recording
        <input type="file" accept="audio/wav,.wav" className="hidden" onChange={(e) => e.target.files?.[0] && void run(e.target.files[0])} />
      </label>
      {out.length > 0 && (
        <pre className="absolute top-8 left-0 z-10 max-h-96 w-[36rem] overflow-auto rounded-md bg-raised p-2 text-[11px]">{out.join('\n')}</pre>
      )}
    </span>
  )
}

function ReplayPanel({ params }: { params: URLSearchParams }) {
  const p = useMemo(() => replayParams(params), [params])
  const [result, setResult] = useState<ReplayResult | null>(null)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState(0)
  const started = useRef(false)

  useEffect(() => {
    window.__voiceWav = async () => {
      const { pcm } = await prepareReplay(p)
      const bytes = wavOf(pcm)
      let bin = ''
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      return btoa(bin)
    }
    if (!params.has('run') || started.current) return
    started.current = true
    runReplay(p, (a, total) => {
      window.__voiceProgress = a / total
      setProgress(a / total)
    })
      .then((r) => {
        window.__voiceResult = r
        setResult(r)
      })
      .catch((e: Error) => {
        window.__voiceResult = { error: e.message }
        setError(e.message)
      })
  }, [p, params])

  return (
    <div className="min-h-full bg-canvas p-6 font-mono text-xs text-ink">
      <div id="voice-replay" data-done={result || error ? '1' : '0'}>
        replay {JSON.stringify(p)} {Math.round(progress * 100)}%
      </div>
      {error && <pre className="text-red-300">{error}</pre>}
      {result && <pre>{JSON.stringify(result.metrics, null, 2)}</pre>}
    </div>
  )
}
