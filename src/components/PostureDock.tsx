import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react'
import { motion } from 'motion/react'
import { Fragment, useEffect, useMemo, useRef } from 'react'
import { postureKey } from '@/content/postures'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { postureSegments } from '@/sequence/build'
import { useSession } from '@/state/session'
import { PostureIcon } from './PostureIcon'
import { Tooltip } from './ui/primitives'

/**
 * The bottom dock: which rak'ah you're in, the movements of that rak'ah, and
 * quiet manual controls. Mirrors the mockup on laptops; condenses on phones.
 */
export function PostureDock({ following }: { following: boolean }) {
  const t = useT()
  const { sequence, index, phase, autoplay, handsFree, next, prev, goTo, setAutoplay } = useSession()
  const segments = useMemo(() => postureSegments(sequence.steps), [sequence])
  const praying = phase === 'praying'
  const step = sequence.steps[index]!
  const rakah = phase === 'ready' ? 1 : phase === 'complete' ? sequence.rakahs : step.rakah
  const inRakah = segments.filter((s) => s.rakah === rakah)
  const activeRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLOListElement>(null)

  // Keep the current movement in view on narrow screens. (Scroll only the
  // list — scrollIntoView would also nudge the page.)
  useEffect(() => {
    const list = listRef.current
    const item = activeRef.current
    if (!list || !item) return
    const left = item.offsetLeft - list.clientWidth / 2 + item.clientWidth / 2
    list.scrollTo({ left: getComputedStyle(list).direction === 'rtl' ? left - list.scrollWidth + list.clientWidth : left, behavior: 'smooth' })
  }, [index])

  return (
    <div className="glass mx-auto flex w-full max-w-[52rem] items-stretch gap-1 rounded-[1.35rem] p-1.5 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.6)] sm:gap-2 sm:p-2">
      {/* Rak'ah */}
      <div className="flex shrink-0 flex-col justify-center gap-1.5 py-1 pr-2 pl-2.5 sm:pr-4 sm:pl-3.5">
        <div className="text-[13px] leading-none font-semibold text-ink">{t('dock.rakah')}</div>
        <div className="tabular text-xs leading-none text-ink-muted">{t('dock.rakahOf', { r: rakah, n: sequence.rakahs })}</div>
        <div className="flex gap-1" aria-hidden>
          {Array.from({ length: sequence.rakahs }, (_, i) => (
            <span key={i} className={cn('h-1 w-3 rounded-full transition-colors duration-500', i + 1 < rakah || phase === 'complete' ? 'bg-mint/70' : i + 1 === rakah && praying ? 'bg-mint' : 'bg-white/10')} />
          ))}
        </div>
      </div>
      <div className="my-2 w-px shrink-0 bg-line" />

      {/* Movements of this rak'ah */}
      <ol ref={listRef} className="relative flex min-w-0 flex-1 items-center overflow-x-auto [mask-image:linear-gradient(to_right,transparent,black_14px,black_calc(100%-14px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {inRakah.map((seg, i) => {
          const active = praying && index >= seg.start && index < seg.end
          const done = phase === 'complete' || (praying && index >= seg.end)
          const key = postureKey(seg.posture)
          const label = t(`posture.${key}`)
          return (
            <Fragment key={`${seg.rakah}-${seg.start}`}>
              {i > 0 && <li aria-hidden className={cn('h-px w-2 shrink-0 transition-colors sm:w-3', done || active ? 'bg-mint/40' : 'bg-white/10')} />}
              <li className="shrink-0">
                <Tooltip content={<span><span className="text-ink">{label}</span> · {t(`hint.${key}`)}</span>} side="top">
                  <button
                    ref={active ? activeRef : undefined}
                    onClick={() => goTo(seg.start)}
                    aria-current={active ? 'step' : undefined}
                    className={cn(
                      'relative flex h-[3.6rem] cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl px-2.5 transition-colors duration-300 sm:h-16 sm:min-w-[4.5rem] sm:px-3',
                      active ? 'text-mint' : done ? 'text-ink-soft hover:text-ink' : 'text-ink-muted/80 hover:text-ink-soft',
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="dock-active"
                        className="absolute inset-0 rounded-2xl border border-mint/25 bg-mint/[0.09] shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_0_28px_-10px_color-mix(in_oklab,var(--accent)_80%,transparent)]"
                        transition={{ type: 'spring', bounce: 0.15, duration: 0.55 }}
                      />
                    )}
                    <PostureIcon posture={seg.posture} className="relative size-6 sm:size-7" />
                    <span className={cn('relative text-[11px] leading-none font-medium whitespace-nowrap sm:text-xs', !active && 'max-sm:sr-only')}>{label}</span>
                  </button>
                </Tooltip>
              </li>
            </Fragment>
          )
        })}
      </ol>

      <div className="my-2 w-px shrink-0 bg-line" />
      {/* Controls */}
      <div className="flex shrink-0 items-center gap-0.5 pr-0.5 sm:gap-1 sm:pr-1">
        <IconButton label={t('dock.previous')} onClick={prev} disabled={phase === 'ready' || (praying && index === 0)} className="max-sm:hidden">
          <ChevronLeft className="size-5 rtl:rotate-180" />
        </IconButton>
        {handsFree && following ? (
          <div className="flex h-10 items-center gap-1.5 px-1.5 text-xs text-ink-muted max-sm:hidden">
            <span className="size-1.5 animate-breathe rounded-full bg-mint" />
            {t('dock.following')}
          </div>
        ) : (
          <IconButton label={autoplay ? t('dock.pause') : t('dock.guide')} onClick={() => setAutoplay(!autoplay)} active={autoplay} disabled={phase === 'complete'}>
            {autoplay ? <Pause className="size-[18px] fill-current" /> : <Play className="size-[18px] fill-current" />}
          </IconButton>
        )}
        <IconButton label={t('dock.next')} onClick={next} disabled={phase === 'complete'}>
          <ChevronRight className="size-5 rtl:rotate-180" />
        </IconButton>
      </div>
    </div>
  )
}

function IconButton({
  label,
  children,
  active,
  className,
  ...props
}: React.ComponentProps<'button'> & { label: string; active?: boolean }) {
  return (
    <Tooltip content={label} side="top">
      <button
        {...props}
        aria-label={label}
        className={cn(
          'flex size-10 cursor-pointer items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-white/[0.07] hover:text-ink disabled:pointer-events-none disabled:opacity-30',
          active && 'bg-mint/[0.12] text-mint',
          className,
        )}
      >
        {children}
      </button>
    </Tooltip>
  )
}
