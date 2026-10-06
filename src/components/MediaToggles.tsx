import { Mic, MicOff, Video, VideoOff } from 'lucide-react'
import { motion } from 'motion/react'
import type { FaceEngineStatus } from '@/handsfree/face-engine'
import type { FaceDebug } from '@/handsfree/use-face-follow'
import { useT } from '@/i18n'
import type { MessageKey } from '@/i18n/en'
import { cn } from '@/lib/cn'
import type { VoiceError, VoiceStatus } from '@/voice/types'
import { Tooltip } from './ui/primitives'

type Tone = 'on' | 'off' | 'warn' | 'busy'

function ToggleButton({ tone, pressed, label, tip, onClick, children }: { tone: Tone; pressed: boolean; label: string; tip: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip content={<span className="block max-w-60 leading-relaxed">{tip}</span>} side="bottom">
      <button
        onClick={onClick}
        aria-pressed={pressed}
        aria-label={`${label}: ${tip}`}
        className={cn(
          'relative flex size-10 cursor-pointer items-center justify-center rounded-full border transition-all duration-300',
          tone === 'on' && 'border-mint/70 bg-mint/[0.22] text-mint shadow-[0_0_22px_-8px_color-mix(in_oklab,var(--accent)_75%,transparent)]',
          tone === 'busy' && 'border-mint/40 bg-mint/[0.08] text-mint/80',
          tone === 'off' && 'glass border-line text-ink-muted hover:text-ink',
          tone === 'warn' && 'border-amber-300/60 bg-amber-300/[0.12] text-amber-200',
        )}
      >
        {children}
        {tone === 'on' && <span className="absolute end-1 top-1 size-1.5 animate-breathe rounded-full bg-mint" />}
        {tone === 'busy' && <span className="absolute end-1 top-1 size-1.5 animate-pulse rounded-full bg-mint/70" />}
        {tone === 'warn' && <span className="absolute end-1 top-1 size-1.5 rounded-full bg-amber-300" />}
      </button>
    </Tooltip>
  )
}

const MIC_ERROR: Record<VoiceError, MessageKey> = {
  'mic-denied': 'media.mic.blocked',
  'mic-missing': 'listen.missing',
  'model-unreachable': 'listen.model',
  'engine-failed': 'listen.model',
  unsupported: 'listen.unsupported',
}

export function MicToggle({ on, status, error, progress, onToggle }: { on: boolean; status: VoiceStatus; error?: VoiceError; progress: number; onToggle: () => void }) {
  const t = useT()
  const failed = on && status === 'error'
  const loading = on && status === 'loading'
  const tone: Tone = failed ? 'warn' : loading ? 'busy' : on ? 'on' : 'off'
  const tip = failed ? t(error ? MIC_ERROR[error] : 'listen.failed') : loading ? t('listen.loading', { p: Math.round(progress * 100) }) : on ? t('media.mic.on') : t('media.mic.off')
  return (
    <ToggleButton tone={tone} pressed={on && !failed} label={t('media.mic')} tip={tip} onClick={onToggle}>
      {on && !failed ? <Mic className="size-[18px]" /> : <MicOff className="size-[18px]" />}
    </ToggleButton>
  )
}

export type CamState = FaceEngineStatus | 'off'

export function CameraToggle({ on, status, noFace, onToggle }: { on: boolean; status: CamState; noFace: boolean; onToggle: () => void }) {
  const t = useT()
  const failed = on && (status === 'denied' || status === 'no-camera' || status === 'no-model' || status === 'camera-lost')
  const busy = on && (status === 'starting' || status === 'loading' || status === 'reconnecting')
  const tone: Tone = failed || (on && noFace) ? 'warn' : busy ? 'busy' : on ? 'on' : 'off'
  const tip = failed ? t('media.cam.blocked') : on && noFace ? t('media.cam.noFace') : on ? t('media.cam.on') : t('media.cam.off')
  return (
    <ToggleButton tone={tone} pressed={on && !failed} label={t('media.cam')} tip={tip} onClick={onToggle}>
      {on && !failed ? <Video className="size-[18px]" /> : <VideoOff className="size-[18px]" />}
    </ToggleButton>
  )
}

/** One quiet line under the header (mic blocked, camera blocked, face not seen). */
export function MediaNote({ text }: { text: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      role="status"
      className="frosted max-w-72 rounded-xl px-3 py-2 text-sm leading-relaxed text-amber-100 shadow-xl shadow-black/30"
    >
      {text}
    </motion.div>
  )
}

/** ?facedebug: what the camera sees and what it decided. */
export function FaceDebugOverlay({ stream, debug, status, mirror }: { stream: MediaStream | null; debug: FaceDebug; status: CamState; mirror: boolean }) {
  const m = debug.lastMove
  const tr = debug.track
  const pct = (b: { x: number; y: number; w: number; h: number }) => ({ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` })
  return (
    <div className="pointer-events-none fixed start-3 bottom-3 z-50 w-64 overflow-hidden rounded-xl border border-white/20 bg-black/80 font-mono text-[11px] leading-snug text-white" dir="ltr">
      <div className={cn('relative aspect-[4/3] w-full', mirror && '-scale-x-100')}>
        {stream && <DebugVideo stream={stream} />}
        {debug.ignored.map((d, i) => (
          <div key={i} className="absolute border border-white/50" style={pct(d.box)} />
        ))}
        {debug.matched && !tr && <div className="absolute border-2 border-dashed border-sky-300" style={pct(debug.matched.box)} />}
        {tr && <div className={cn('absolute border-2', debug.matched ? 'border-emerald-400' : 'border-emerald-400/40 border-dashed')} style={pct(tr)} />}
      </div>
      <div className="space-y-0.5 p-2">
        <div>cam: {status}</div>
        <div>
          track: {tr ? <b className="text-emerald-300">#{tr.id} locked</b> : <span className="text-sky-300">confirming…</span>} {debug.matched ? `score ${debug.matched.score.toFixed(2)} h ${debug.matched.box.h.toFixed(2)}` : 'no match'}
        </div>
        <div>ignored: {debug.ignored.length}</div>
        <div>
          state: <b className={debug.state === 'found' ? 'text-emerald-300' : debug.state === 'lost' ? 'text-amber-300' : ''}>{debug.state}</b> · wait {(debug.waitMs / 1000).toFixed(1)} s
        </div>
        <div>last move: {m ? `${m.reason} -> step ${m.index} at ${new Date(performance.timeOrigin + m.at).toLocaleTimeString()}` : 'none'}</div>
      </div>
    </div>
  )
}

function DebugVideo({ stream }: { stream: MediaStream }) {
  return (
    <video
      autoPlay
      muted
      playsInline
      className="absolute inset-0 size-full object-fill"
      ref={(v) => {
        if (v && v.srcObject !== stream) v.srcObject = stream
      }}
    />
  )
}
