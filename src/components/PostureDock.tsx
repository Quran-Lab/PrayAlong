import { ChevronLeft, ChevronRight, Mic, Pause, Play } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo } from 'react'
import { postureKey } from '@/content/postures'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { postureSegments } from '@/sequence/build'
import { useSession } from '@/state/session'
import { PostureIcon } from './PostureIcon'
import { Tooltip } from './ui/primitives'

/**
 * The bottom of the screen is the prayer's map: which rak'ah you are in, the
 * movements of this rak'ah as a track that fills as you go (each movement as
 * long as its recitation), and one clear control to lead or pause.
 */
export function PostureDock({
  following,
  listening = false,
  listenLoading = false,
  onListen,
}: {
  following: boolean
  /** Listen mode is on (following the user's voice). */
  listening?: boolean
  /** The voice model is still loading. */
  listenLoading?: boolean
  onListen?: (on: boolean) => void
}) {
  const t = useT()
  const { sequence, index, phase, autoplay, handsFree, next, prev, goTo, setAutoplay } = useSession()
  const segments = useMemo(() => postureSegments(sequence.steps), [sequence])
  const praying = phase === 'praying'
  const step = sequence.steps[index]!
  const rakah = phase === 'ready' ? 1 : phase === 'complete' ? sequence.rakahs : step.rakah
  const inRakah = segments.filter((s) => s.rakah === rakah)
  // Long recitations get a little more room, but every movement stays visible.
  const weight = (s: { start: number; end: number }) => Math.sqrt(Math.max(1, s.end - s.start))
  const total = inRakah.reduce((n, s) => n + weight(s), 0)
  const overall = phase === 'complete' ? 1 : praying ? index / sequence.steps.length : 0
  const leading = handsFree && following

  return (
    <motion.nav
      layout
      transition={{ layout: { type: 'spring', bounce: 0.1, duration: 0.65 } }}
      aria-label={t('dock.rakah')}
      // Compact until the prayer begins, then it widens as the controls arrive.
      className={cn(
        'mx-auto flex w-full items-center gap-2.5 rounded-[1.75rem] border border-line bg-[color-mix(in_oklab,var(--room-2)_88%,transparent)] px-2.5 py-2.5 shadow-[0_24px_70px_-24px_rgba(0,0,0,0.75)] backdrop-blur-md sm:gap-5 sm:px-5 sm:py-3',
        phase === 'ready' ? 'max-w-[42rem]' : 'max-w-[60rem]',
      )}
    >
      {/* Rak'ah: a ring that fills over the whole prayer, the number inside. */}
      <div className="flex shrink-0 items-center gap-3">
        <div className="relative grid size-12 place-items-center sm:size-14">
          <svg viewBox="0 0 48 48" className="absolute inset-0 -rotate-90" aria-hidden>
            <circle cx="24" cy="24" r="21" fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth="3.5" />
            <motion.circle
              cx="24"
              cy="24"
              r="21"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="3.5"
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray="1"
              animate={{ strokeDashoffset: 1 - overall }}
              initial={false}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            />
          </svg>
          <span className="tabular text-lg leading-none font-semibold text-ink">
            {rakah}
            <span className="text-sm font-medium text-ink-muted">/{sequence.rakahs}</span>
          </span>
        </div>
        <span className="text-sm leading-tight font-medium text-ink-soft max-md:hidden">{t('dock.rakah')}</span>
      </div>

      {/* This rak'ah's movements. */}
      <ol className="flex min-w-0 flex-1 items-end gap-1 sm:gap-1.5">
        {inRakah.map((seg) => {
          const active = praying && index >= seg.start && index < seg.end
          const done = phase === 'complete' || (praying && index >= seg.end)
          const fill = done ? 1 : active ? (index - seg.start + 1) / (seg.end - seg.start) : 0
          const key = postureKey(seg.posture)
          const label = t(`posture.${key}`)
          return (
            <li
              key={`${seg.rakah}-${seg.start}`}
              className={cn('min-w-0 transition-[flex-grow] duration-500', active && 'sm:min-w-max')}
              // The current movement makes room for its name.
              style={{
                flex: `${weight(seg) / total + (active ? 0.35 : 0)} 1 0%`,
              }}
            >
              <Tooltip
                content={
                  <span>
                    <span className="text-ink">{label}</span>: {t(`hint.${key}`)}
                  </span>
                }
                side="top"
              >
                <button
                  onClick={() => goTo(seg.start)}
                  aria-current={active ? 'step' : undefined}
                  aria-label={label}
                  className="group flex w-full cursor-pointer flex-col items-center gap-1.5 rounded-xl px-0.5 pt-1 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-4"
                >
                  <span
                    className={cn(
                      'flex items-center gap-1.5 transition-colors duration-300',
                      active ? 'text-mint' : done ? 'text-ink-soft' : 'text-ink-muted group-hover:text-ink-soft',
                    )}
                  >
                    <PostureIcon posture={seg.posture} className={cn('shrink-0 transition-transform duration-300', active ? 'size-7 sm:size-8' : 'size-5 sm:size-6')} />
                    {active && (
                      <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-base font-semibold whitespace-nowrap max-sm:hidden">
                        {label}
                      </motion.span>
                    )}
                  </span>
                  <span className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
                    <motion.span
                      className="absolute inset-y-0 start-0 rounded-full bg-mint"
                      initial={false}
                      animate={{
                        width: `${fill * 100}%`,
                        opacity: active ? 1 : 0.55,
                      }}
                      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                    />
                  </span>
                </button>
              </Tooltip>
            </li>
          )
        })}
      </ol>

      {/* Controls: back, lead/pause (or "following you"), forward. Only once the prayer has begun. */}
      <AnimatePresence initial={false}>
        {phase !== 'ready' && (
          <motion.div
            key="controls"
            layout
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.35 }}
            className="flex shrink-0 items-center gap-1.5"
          >
            <IconButton label={t('dock.previous')} onClick={prev} disabled={praying && index === 0} className="max-sm:hidden">
              <ChevronLeft className="size-6 rtl:rotate-180" />
            </IconButton>
            {listening ? (
              // Your voice leads: one control to pause listening (the prayer then waits for you).
              <Tooltip content={t('dock.pauseListening')} side="top">
                <button
                  onClick={() => onListen?.(false)}
                  aria-label={t('dock.pauseListening')}
                  className="relative grid size-12 cursor-pointer place-items-center rounded-full bg-mint text-canvas shadow-[0_10px_30px_-10px_color-mix(in_oklab,var(--accent)_70%,transparent)] transition-transform duration-200 hover:brightness-110 active:scale-95 sm:size-14"
                >
                  {listenLoading ? (
                    <span className="absolute inset-1 animate-spin rounded-full border-2 border-canvas/30 border-t-canvas" aria-hidden />
                  ) : (
                    <span className="absolute inset-0 animate-ping rounded-full bg-mint/30 [animation-duration:2.4s]" aria-hidden />
                  )}
                  <Mic className="relative size-6" />
                </button>
              </Tooltip>
            ) : leading ? (
              <div className="flex h-12 items-center gap-2 rounded-full bg-mint/[0.1] px-4 text-sm font-medium text-mint max-sm:hidden">
                <span className="size-2 animate-breathe rounded-full bg-mint" />
                {t('dock.following')}
              </div>
            ) : (
              <Tooltip content={autoplay ? t('dock.pause') : t('dock.guide')} side="top">
                <button
                  onClick={() => setAutoplay(!autoplay)}
                  disabled={phase === 'complete'}
                  aria-label={autoplay ? t('dock.pause') : t('dock.guide')}
                  className="grid size-12 cursor-pointer place-items-center rounded-full bg-mint sm:size-14 text-canvas shadow-[0_10px_30px_-10px_color-mix(in_oklab,var(--accent)_70%,transparent)] transition-transform duration-200 hover:brightness-110 active:scale-95 disabled:opacity-30"
                >
                  {autoplay ? <Pause className="size-6 fill-current" /> : <Play className="ms-0.5 size-6 fill-current" />}
                </button>
              </Tooltip>
            )}
            <IconButton label={t('dock.next')} onClick={next} disabled={phase === 'complete'} className="max-sm:hidden">
              <ChevronRight className="size-6 rtl:rotate-180" />
            </IconButton>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  )
}

function IconButton({ label, children, className, ...props }: React.ComponentProps<'button'> & { label: string }) {
  return (
    <Tooltip content={label} side="top">
      <button
        {...props}
        aria-label={label}
        className={cn(
          'flex size-12 cursor-pointer items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-white/[0.08] hover:text-ink focus:outline-none focus-visible:outline-2 disabled:pointer-events-none disabled:opacity-30',
          className,
        )}
      >
        {children}
      </button>
    </Tooltip>
  )
}
