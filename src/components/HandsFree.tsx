import { Pause, Play, RefreshCw, Sparkles, Video, VideoOff } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef } from 'react'
import type { Blocker } from '@/handsfree/advice'
import { isFallback, isFollowing, type Framing, type HandsFreeStatus } from '@/handsfree/types'
import { postureKey } from '@/content/postures'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import type { PoseClass, Posture } from '@/sequence/types'
import { PostureIcon } from './PostureIcon'
import { Tooltip } from './ui/primitives'

export function HandsFreeButton({ on, status, onToggle, compact }: { on: boolean; status: HandsFreeStatus; onToggle: () => void; compact?: boolean }) {
  const t = useT()
  const live = on && isFollowing(status)
  return (
    <Tooltip
      content={
        <span className="block max-w-56 leading-relaxed">
          {on ? t('hf.tipOn') : t('hf.tipOff')} <span className="text-ink-muted">{t('hf.private')}</span> <span className="text-ink-faint">(H)</span>
        </span>
      }
    >
      <button
        onClick={onToggle}
        aria-pressed={on}
        aria-label={t('hf.button')}
        className={cn(
          'relative flex h-10 cursor-pointer items-center gap-2.5 rounded-full text-sm font-medium whitespace-nowrap transition-[color,background-color,scale] duration-150 ease-out active:scale-[0.97]',
          compact ? 'h-11 w-11 justify-center sm:h-10 sm:w-10' : 'ps-4 pe-3.5',
          on ? 'glass-tint text-ink' : 'text-ink-soft hover:bg-white/[0.07] hover:text-ink',
        )}
      >
        {!compact && <span>{t('hf.button')}</span>}
        {on ? <Video className="size-[18px] text-mint" /> : <VideoOff className="size-[18px] opacity-70" />}
        {live && <span className="absolute end-1.5 top-1.5 size-1.5 animate-breathe rounded-full bg-mint" />}
      </button>
    </Tooltip>
  )
}

export function CameraPreview({ stream, className, mirror = true }: { stream: MediaStream | null; className?: string; mirror?: boolean }) {
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (video.current) video.current.srcObject = stream
  }, [stream])
  return <video ref={video} autoPlay muted playsInline className={cn('bg-black/40 object-cover', mirror && '-scale-x-100', className)} />
}

export function useStatusText() {
  const t = useT()
  return (status: HandsFreeStatus) =>
    ({
      off: t('hf.status.off'),
      starting: t('hf.status.starting'),
      loading: t('hf.status.loading'),
      watching: t('hf.status.watching'),
      reconnecting: t('hf.status.reconnecting'),
      'camera-lost': t('hf.status.fallback'),
      demo: t('hf.status.demo'),
      denied: t('hf.status.fallback'),
      'no-camera': t('hf.status.fallback'),
      'no-model': t('hf.status.fallback'),
    })[status]
}

export function useFallbackText() {
  const t = useT()
  return (status: HandsFreeStatus) =>
    status === 'denied'
      ? t('hf.msg.denied')
      : status === 'no-camera'
        ? t('hf.msg.noCamera')
        : status === 'no-model'
          ? t('hf.msg.noModel')
          : status === 'camera-lost'
            ? t('hf.msg.cameraLost')
            : null
}

export function useBlockerText() {
  const t = useT()
  return (b: Blocker) => (b ? t(`hf.block.${b}`) : null)
}

/** A thin ring that fills as the camera grows sure of the next movement. */
export function ConfidenceRing({ value, className }: { value: number; className?: string }) {
  const r = 7
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 18 18" className={cn('size-[18px] shrink-0 -rotate-90', className)} aria-hidden>
      <circle cx="9" cy="9" r={r} fill="none" strokeWidth="2" className="stroke-white/15" />
      <circle
        cx="9"
        cy="9"
        r={r}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.max(0, Math.min(1, value)))}
        className="stroke-mint transition-[stroke-dashoffset] duration-200"
      />
    </svg>
  )
}

/** A small, friendly mirror so people trust what the camera sees. No skeletons. */
export function CameraBubble({
  stream,
  status,
  pose,
  expected,
  progress = 0,
  blocker = null,
  onOpen,
  onRetry,
  onDemo,
}: {
  stream: MediaStream | null
  status: HandsFreeStatus
  pose: PoseClass | null
  /** How much of the person the camera sees (kept for callers; the blocker says why). */
  framing?: Framing
  /** The movement the camera waits for next. */
  expected?: Posture | null
  /** 0..1: how sure the camera is getting about it. */
  progress?: number
  /** What is stopping the camera from following, if anything. */
  blocker?: Blocker
  onOpen: () => void
  onRetry: () => void
  onDemo: () => void
}) {
  const t = useT()
  const statusText = useStatusText()
  const fallback = useFallbackText()(status)
  const blockerText = useBlockerText()(blocker)
  const watching = status === 'watching'

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.97 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="glass-panel w-40 overflow-hidden rounded-2xl sm:w-52"
    >
      {stream && (
        <button onClick={onOpen} className="block w-full cursor-pointer" aria-label={t('setup.title')}>
          <CameraPreview stream={stream} className="aspect-[4/3] w-full opacity-90" />
        </button>
      )}
      <div className="flex items-start gap-2 px-3 py-2.5 text-sm">
        <span className={cn('mt-1 size-1.5 shrink-0 rounded-full', isFollowing(status) ? 'animate-breathe bg-mint' : isFallback(status) ? 'bg-amber-300/80' : 'animate-breathe bg-white/50')} />
        <div className="min-w-0 leading-relaxed">
          <div className="text-ink-soft">{statusText(status)}</div>
          {fallback ? (
            <>
              <div className="text-ink-muted">{fallback}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {status !== 'no-model' && (
                  <button onClick={onRetry} className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-white/[0.08] px-2.5 py-1 text-ink hover:bg-white/[0.12]">
                    <RefreshCw className="size-3" /> {t('hf.retry')}
                  </button>
                )}
                <button onClick={onDemo} className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-mint/15 px-2.5 py-1 text-mint hover:bg-mint/20">
                  <Sparkles className="size-3" /> {t('hf.useDemo')}
                </button>
              </div>
            </>
          ) : watching && blockerText ? (
            <div className="text-amber-200/90">{blockerText}</div>
          ) : watching && expected ? (
            <div className="mt-0.5 flex items-center gap-1.5 text-mint">
              <ConfidenceRing value={progress} />
              <span>{t('hf.next', { posture: t(`posture.${postureKey(expected)}`) })}</span>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div key={pose ?? 'none'} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-mint">
                {pose ? t(`pose.${pose}`) : status === 'watching' || status === 'demo' ? t('setup.lookingForYou') : ''}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </div>
    </motion.div>
  )
}

const DEMO_POSES: { pose: PoseClass; icon: Posture }[] = [
  { pose: 'hands-raised', icon: 'takbir' },
  { pose: 'standing', icon: 'qiyam' },
  { pose: 'bowing', icon: 'ruku' },
  { pose: 'prostrating', icon: 'sujud' },
  { pose: 'sitting', icon: 'jalsah' },
]

/** Act out movements on screen — the hands-free flow without a camera. */
export function DemoBar({
  current,
  expected,
  auto,
  onAct,
  onAuto,
}: {
  current: PoseClass | null
  /** The movement PrayAlong is waiting for next — highlighted to guide. */
  expected: PoseClass | null
  auto: boolean
  onAct: (pose: PoseClass) => void
  onAuto: (on: boolean) => void
}) {
  const t = useT()
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="glass-panel flex items-center gap-1 rounded-2xl p-1.5"
      role="toolbar"
      aria-label={t('demo.title')}
    >
      <span className="hidden ps-2 pe-1 text-sm font-medium text-ink-muted sm:inline">{t('demo.title')}</span>
      {DEMO_POSES.map(({ pose, icon }) => (
        <Tooltip key={pose} content={`${t(`pose.${pose}`)} · ${t('demo.keys')}`} side="top">
          <button
            onClick={() => onAct(pose)}
            aria-label={t(`pose.${pose}`)}
            className={cn(
              'relative flex size-11 cursor-pointer items-center justify-center rounded-xl transition-colors',
              current === pose ? 'bg-mint/15 text-mint' : 'text-ink-soft hover:bg-white/[0.07] hover:text-ink',
              expected === pose && current !== pose && 'ring-1 ring-mint/50',
            )}
          >
            <PostureIcon posture={icon} className="size-6" />
            {expected === pose && current !== pose && <span className="absolute end-1 top-1 size-1.5 animate-breathe rounded-full bg-mint" />}
          </button>
        </Tooltip>
      ))}
      <span className="mx-0.5 h-7 w-px bg-line" />
      <button
        onClick={() => onAuto(!auto)}
        className={cn('flex h-11 cursor-pointer items-center gap-1.5 rounded-xl px-3 text-sm font-medium', auto ? 'bg-mint/15 text-mint' : 'text-ink-soft hover:bg-white/[0.07]')}
      >
        {auto ? <Pause className="size-4 fill-current" /> : <Play className="size-4 fill-current" />}
        <span className="hidden sm:inline">{auto ? t('demo.stop') : t('demo.auto')}</span>
      </button>
    </motion.div>
  )
}
