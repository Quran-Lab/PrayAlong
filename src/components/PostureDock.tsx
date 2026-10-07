import { ChevronLeft, ChevronRight, Mic, Pause, Play } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo } from 'react'
import { postureKey } from '@/content/postures'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { postureSegments } from '@/sequence/build'
import { useSession } from '@/state/session'
import { PostureIcon } from './PostureIcon'
import { LiquidPill, SETTLE } from './ui/LiquidGlass'
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
  hearing = false,
  onListen,
}: {
  following: boolean
  /** Listen mode is on (following the user's voice). */
  listening?: boolean
  /** The voice model is still loading. */
  listenLoading?: boolean
  /** Your voice is being heard right now (the mic button answers it, so you can tell from the mat). */
  hearing?: boolean
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
  const current = praying ? inRakah.find((s) => index >= s.start && index < s.end) : undefined

  return (
    <motion.nav
      layout
      transition={{ layout: { ...SETTLE, duration: 0.6 } }}
      aria-label={t('dock.rakah')}
      // Compact until the prayer begins, then it widens as the controls arrive.
      className={cn(
        // Phones: two rows, so every movement gets a full-size touch target (the track spans the width).
        'astro-bar pointer-events-auto mx-auto flex w-full flex-wrap items-center gap-x-2.5 gap-y-1 rounded-[1.75rem] px-2 py-2 sm:flex-nowrap sm:gap-5 sm:px-5 sm:py-2.5 short:py-1.5',
        phase === 'ready' ? 'max-w-[42rem]' : 'max-w-[60rem]',
      )}
    >
      {/* Rak'ah: a ring that fills over the whole prayer, the number inside. */}
      <div className="flex min-w-0 flex-1 items-center gap-3 ps-1 sm:flex-none sm:ps-0">
        <div className="relative grid size-12 shrink-0 place-items-center sm:size-14">
          <svg viewBox="0 0 48 48" className="absolute inset-0 -rotate-90" aria-hidden>
            <circle cx="24" cy="24" r="21" fill="none" stroke="rgb(255 255 255 / 0.1)" strokeWidth="3.5" />
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
        {/* Phones: the movement's name sits up here (the track below has room for icons only). */}
        {current && <span className="truncate text-base font-semibold text-mint sm:hidden">{t(`posture.${postureKey(current.posture)}`)}</span>}
      </div>

      {/* This rak'ah's movements. */}
      <ol className="order-last flex w-full min-w-0 items-stretch sm:order-none sm:w-auto sm:flex-1 sm:items-end sm:gap-1.5">
        {inRakah.map((seg) => {
          const active = praying && index >= seg.start && index < seg.end
          const done = phase === 'complete' || (praying && index >= seg.end)
          const fill = done ? 1 : active ? (index - seg.start + 1) / (seg.end - seg.start) : 0
          const key = postureKey(seg.posture)
          const label = t(`posture.${key}`)
          return (
            <li
              key={`${seg.rakah}-${seg.start}`}
              className={cn('min-w-0 transition-[flex-grow] duration-500 max-sm:flex-1!', active && 'sm:min-w-max')}
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
                  className="group relative flex min-h-12 w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl px-1.5 pt-1.5 pb-1 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-4 sm:min-h-0"
                >
                  {/* Where you are: one lit capsule that flows from movement to movement. */}
                  {active && <LiquidPill layoutId="dock-current" className="rounded-2xl" />}
                  <span
                    className={cn(
                      'relative flex items-center gap-1.5 transition-colors duration-300',
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
                    {/* Scaled, not resized: the fill stays on the compositor. */}
                    <motion.span
                      className="absolute inset-0 origin-left rounded-full bg-mint rtl:origin-right"
                      initial={false}
                      animate={{ scaleX: fill, opacity: active ? 1 : 0.55 }}
                      transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
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
                  className="relative grid size-12 cursor-pointer place-items-center rounded-full glass-solid text-canvas transition-transform duration-200 hover:brightness-110 active:scale-95 sm:size-14"
                >
                  {listenLoading ? (
                    <span className="absolute inset-1 animate-spin rounded-full border-2 border-canvas/30 border-t-canvas" aria-hidden />
                  ) : (
                    // A ring that swells only while your voice is heard: still when you are silent.
                    <span
                      className={cn(
                        'absolute -inset-1 rounded-full border-2 border-mint transition-[transform,opacity] duration-200 ease-out',
                        hearing ? 'scale-110 opacity-70' : 'scale-95 opacity-0',
                      )}
                      aria-hidden
                    />
                  )}
                  <Mic className="relative size-6" />
                </button>
              </Tooltip>
            ) : leading ? (
              <div className="flex h-12 items-center gap-2 rounded-full bg-mint/[0.1] px-4 text-sm font-medium text-mint max-sm:hidden">
                <span className="size-2 rounded-full bg-mint" />
                {t('dock.following')}
              </div>
            ) : (
              <Tooltip content={autoplay ? t('dock.pause') : t('dock.guide')} side="top">
                <button
                  onClick={() => setAutoplay(!autoplay)}
                  disabled={phase === 'complete'}
                  aria-label={autoplay ? t('dock.pause') : t('dock.guide')}
                  className="grid size-12 cursor-pointer place-items-center rounded-full glass-solid sm:size-14 text-canvas transition-transform duration-200 hover:brightness-110 active:scale-95 disabled:opacity-30"
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
