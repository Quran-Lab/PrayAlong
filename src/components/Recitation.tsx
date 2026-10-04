import { ArrowDownRight, Volume1, VolumeX } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { resolveLine } from '@/content/lines'
import { useLocale, useT } from '@/i18n'
import { cn } from '@/lib/cn'
import type { Step } from '@/sequence/types'
import { display, useSession, type TextSize } from '@/state/session'

/** [hero, hero when long] sizes for the main line. */
const HERO: Record<TextSize, [string, string]> = {
  m: ['text-[1.6rem] sm:text-[2rem] short:text-[1.5rem]', 'text-[1.3rem] sm:text-[1.6rem] short:text-[1.25rem]'],
  l: ['text-[1.9rem] sm:text-[2.45rem] short:text-[1.75rem]', 'text-[1.45rem] sm:text-[1.85rem] short:text-[1.4rem]'],
  xl: ['text-[2.25rem] sm:text-[2.9rem] short:text-[2rem]', 'text-[1.7rem] sm:text-[2.2rem] short:text-[1.6rem]'],
}
/** Reading from across the room (hands-free): one size up. */
const LARGER: Record<TextSize, TextSize> = { m: 'l', l: 'xl', xl: 'xl' }
const ARABIC: Record<TextSize, string> = {
  m: 'text-[1.5rem] sm:text-[1.8rem]',
  l: 'text-[1.75rem] sm:text-[2.15rem]',
  xl: 'text-[2.05rem] sm:text-[2.5rem]',
}

const enter = { opacity: 0, y: 10, filter: 'blur(6px)' }
const shown = { opacity: 1, y: 0, filter: 'blur(0px)' }
const leave = { opacity: 0, y: -8, filter: 'blur(4px)' }
const calm = { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const }

/**
 * One line at a time. Dawah-first: the hero is *how to say it*, with its
 * meaning beneath in the reader's language. Arabic script is opt-in (and on
 * by default only for people who read it).
 */
export function Recitation({ step, timedMs, distance = false }: { step: Step; timedMs: number | null; distance?: boolean }) {
  const t = useT()
  const locale = useLocale()
  const settings = useSession((s) => s.settings)
  const size = distance ? LARGER[settings.textSize] : settings.textSize
  const show = display(settings, locale)
  const line = resolveLine(step.recitationId, locale)
  // With Arabic as the only script, it becomes the hero.
  const arabicHero = show.arabic && !show.transliteration
  const long = (arabicHero ? line.arabic : line.transliteration).length > 42

  return (
    // Lines crossfade in one grid cell — no waiting on exits, so rapid taps
    // can never leave a line stuck half-animated.
    <div className="relative mx-auto grid w-full max-w-3xl px-4 text-center" aria-live="polite">
      <AnimatePresence initial={false}>
        <motion.div
          key={step.id}
          initial={enter}
          animate={shown}
          exit={{ ...leave, transition: { duration: 0.25 } }}
          transition={calm}
          className="col-start-1 row-start-1 flex w-full flex-col items-center"
        >
          <div className="mb-2 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1.5 text-[11px] font-medium tracking-[0.14em] text-ink-muted uppercase">
            <span>{t(`group.${step.group}`)}</span>
            {step.groupSize > 1 && <span className="tabular text-ink-faint">{t('line.of', { i: step.groupIndex + 1, n: step.groupSize })}</span>}
            {line.ref && <span className="tracking-normal text-ink-faint normal-case">{t('line.quran', { ref: line.ref })}</span>}
            {step.repeat > 1 && <span className="rounded-md bg-white/[0.07] px-1.5 py-0.5 tracking-normal text-ink-soft normal-case">{t('line.times', { n: step.repeat })}</span>}
            <span className="flex items-center gap-1 tracking-normal text-ink-faint normal-case">
              {step.voice === 'aloud' ? <Volume1 className="size-3.5" /> : <VolumeX className="size-3.5" />}
              {step.voice === 'aloud' ? t('line.aloud') : t('line.quietly')}
            </span>
          </div>

          {step.cue && (
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1, ...calm }}
              className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-mint/25 bg-mint/[0.07] px-3 py-1 text-xs text-mint"
            >
              <ArrowDownRight className="size-3.5 rtl:-scale-x-100" />
              {t(`cue.${step.cue}`, { n: step.rakah })}
            </motion.div>
          )}

          {show.arabic && (
            <p lang="ar" dir="rtl" className={cn('arabic text-balance text-ink', arabicHero ? HERO[size][long ? 1 : 0] : ARABIC[size])}>
              {line.arabic}
            </p>
          )}
          {show.transliteration && (
            <p
              lang="ar-Latn"
              className={cn(
                'font-sans leading-tight font-semibold tracking-[-0.015em] text-balance text-ink',
                HERO[size][long ? 1 : 0],
                show.arabic && 'mt-1 text-ink-soft',
              )}
            >
              {line.transliteration}
            </p>
          )}
          {show.translation && line.meaning && (
            <p className="mt-2.5 max-w-2xl text-[15px] leading-relaxed text-balance text-ink-soft sm:text-[17px]">
              {line.meaning}
              {line.credit && <span className="ms-2 text-[11px] whitespace-nowrap text-ink-faint">— {line.credit}</span>}
            </p>
          )}

          {timedMs !== null && (
            <div className="mt-4 h-[3px] w-20 overflow-hidden rounded-full bg-white/[0.07]">
              <motion.div className="h-full origin-left rounded-full bg-mint/70 rtl:origin-right" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: timedMs / 1000, ease: 'linear' }} />
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
