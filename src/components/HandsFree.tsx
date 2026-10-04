import { Video, VideoOff } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef } from 'react'
import type { HandsFreeStatus } from '@/handsfree/types'
import { cn } from '@/lib/cn'
import type { PoseClass } from '@/sequence/types'
import { Tooltip } from './ui/primitives'

const STATUS_TEXT: Record<HandsFreeStatus, string> = {
  off: 'Off',
  starting: 'Starting…',
  watching: 'Following you',
  simulated: 'Simulated · keys 1–5',
  'no-camera': 'Camera unavailable',
  'no-model': 'Guiding by time',
  error: 'Guiding by time',
}

const POSE_TEXT: Record<PoseClass, string> = {
  'hands-raised': 'Hands raised',
  standing: 'Standing',
  bowing: 'Bowing',
  prostrating: 'Prostrating',
  sitting: 'Sitting',
}

export const isFollowing = (s: HandsFreeStatus) => s === 'watching' || s === 'simulated'

export function HandsFreeButton({ on, status, onToggle, compact }: { on: boolean; status: HandsFreeStatus; onToggle: () => void; compact?: boolean }) {
  const live = on && isFollowing(status)
  return (
    <Tooltip
      content={
        <span className="block max-w-56 leading-relaxed">
          {on ? 'Turn off hands-free' : 'Follow your movements with the camera.'} <span className="text-ink-muted">Video never leaves this device.</span> <span className="text-ink-faint">(H)</span>
        </span>
      }
    >
      <button
        onClick={onToggle}
        aria-pressed={on}
        aria-label="Hands-free"
        className={cn(
          'relative flex h-10 cursor-pointer items-center gap-2.5 rounded-full border text-sm font-medium transition-all duration-300',
          compact ? 'w-10 justify-center' : 'pr-3.5 pl-4',
          on ? 'border-mint/50 bg-mint/[0.1] text-ink shadow-[0_0_26px_-8px_oklch(0.86_0.12_166/0.7)]' : 'glass text-ink-soft hover:text-ink',
        )}
      >
        {!compact && <span>Hands-Free</span>}
        {on ? <Video className="size-[18px] text-mint" /> : <VideoOff className="size-[18px] opacity-70" />}
        {live && <span className="absolute top-1.5 right-1.5 size-1.5 animate-breathe rounded-full bg-mint" />}
      </button>
    </Tooltip>
  )
}

/** A small, friendly mirror so people trust what the camera sees. No skeletons. */
export function CameraBubble({ stream, status, pose }: { stream: MediaStream | null; status: HandsFreeStatus; pose: PoseClass | null }) {
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (video.current) video.current.srcObject = stream
  }, [stream])

  const message =
    status === 'no-model'
      ? 'Pose model not installed yet — moving on by time instead.'
      : status === 'no-camera'
        ? 'Allow camera access to pray hands-free. Moving on by time for now.'
        : status === 'error'
          ? 'Hands-free hit a problem — moving on by time instead.'
          : null

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.97 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="frosted w-44 overflow-hidden rounded-2xl shadow-2xl shadow-black/40 sm:w-52"
    >
      {stream && (
        <video ref={video} autoPlay muted playsInline className="aspect-[4/3] w-full -scale-x-100 bg-black/40 object-cover opacity-90" />
      )}
      <div className="flex items-start gap-2 px-3 py-2.5 text-xs">
        <span className={cn('mt-1 size-1.5 shrink-0 rounded-full', isFollowing(status) ? 'animate-breathe bg-mint' : 'bg-amber-300/80')} />
        <div className="min-w-0 leading-relaxed">
          <div className="text-ink-soft">{STATUS_TEXT[status]}</div>
          {message ? (
            <div className="text-ink-muted">{message}</div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div key={pose ?? 'none'} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-mint">
                {pose ? POSE_TEXT[pose] : 'Step onto your mat'}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </div>
    </motion.div>
  )
}
