import { ArrowDownRight, Volume1, VolumeX } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { resolveLine } from '@/content/lines'
import { useLocale, useT } from '@/i18n'
import { cn } from '@/lib/cn'
import type { Step } from '@/sequence/types'
import { display, useSession, type TextSize } from '@/state/session'
import { useSpokenWord, type Speaking } from '@/audio/use-companion-audio'
import align from '@/content/align.json'

type Span = [number, number] | null
const ALIGN = align as unknown as Record<string, Record<string, { t: Span[]; m: Span[] }>>

/** Which words of this text go with the Arabic word being spoken: [first, last]. */
function litRange(lit: number, spans: Span[] | undefined, count: number, arabicCount: number): [number, number] | null {
  if (lit < 0) return null
  if (spans?.length) {
    // Words with no counterpart keep the last lit range.
    for (let i = Math.min(lit, spans.length - 1); i >= 0; i--) if (spans[i]) return spans[i]!
    return null
  }
  const at = Math.min(count - 1, Math.floor(((lit + 0.5) * count) / Math.max(1, arabicCount)))
  return [at, at]
}

/** Words of a line, with the ones being spoken lit (whole words keep Arabic letters joined). */
function Words({ text, range }: { text: string; range: [number, number] | null }) {
  const parts = text.split(/(\s+)/)
  let k = -1
  return (
    <>
      {parts.map((w, i) => {
        if (!w.trim()) return w
        k++
        return (
          <span
            key={i}
            className={cn('transition-colors duration-200', range && (k >= range[0] && k <= range[1] ? 'text-mint' : k < range[0] ? 'text-ink' : 'text-ink-muted'))}
          >
            {w}
          </span>
        )
      })}
    </>
  )
}

/** Size steps on top of the fluid scale (settings: medium, large, extra large). */
const SCALE: Record<TextSize, number> = { m: 0.86, l: 1, xl: 1.16 }
/** Reading from across the room (hands-free): one step up. */
const LARGER: Record<TextSize, TextSize> = { m: 'l', l: 'xl', xl: 'xl' }

const enter = { opacity: 0, y: 14, filter: 'blur(6px)' }
const shown = { opacity: 1, y: 0, filter: 'blur(0px)' }
const leave = { opacity: 0, y: -10, filter: 'blur(4px)' }
const calm = { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const }

/**
 * One line at a time, set large enough to read from the prayer mat. The hero
 * is how to say it; its meaning sits beneath in the reader's language, and
 * the next line waits quietly below so nobody is caught off guard.
 */
export function Recitation({
  step,
  next,
  timedMs,
  distance = false,
  speaking = null,
}: {
  step: Step
  next?: Step
  timedMs: number | null
  distance?: boolean
  speaking?: Speaking | null
}) {
  const t = useT()
  const locale = useLocale()
  const settings = useSession((s) => s.settings)
  const size = distance ? LARGER[settings.textSize] : settings.textSize
  const k = SCALE[size]
  const show = display(settings, locale)
  const line = resolveLine(step.recitationId, locale)
  const quran = Boolean(line.ref)
  // With Arabic as the only script, it becomes the hero.
  const arabicHero = show.arabic && !show.transliteration
  const long = (arabicHero ? line.arabic : line.transliteration).length > 46
  const upcoming = next && next.recitationId !== step.recitationId ? resolveLine(next.recitationId, locale) : null
  const live = speaking?.stepId === step.id ? speaking : null
  const word = useSpokenWord(live)
  const count = (x: string) => x.split(/\s+/).filter(Boolean).length
  const arabicWords = count(line.arabic)
  const al = ALIGN[locale]?.[step.recitationId]

  return (
    <div className="relative mx-auto grid w-full max-w-[46rem] px-5 text-center" aria-live="polite">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.div
          key={step.id}
          initial={enter}
          animate={shown}
          exit={{ ...leave, transition: { duration: 0.22 } }}
          transition={calm}
          className="col-start-1 row-start-1 flex w-full flex-col items-center"
        >
          {/* Where we are, in plain words. */}
          <div className="mb-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-[length:var(--text-meta)] text-ink-muted">
            <span className="font-medium text-ink-soft">{t(`group.${step.group}`)}</span>
            {step.groupSize > 1 && <span className="tabular">{t('line.of', { i: step.groupIndex + 1, n: step.groupSize })}</span>}
            {line.ref && <span className="tabular text-ink-faint">{t('line.quran', { ref: line.ref })}</span>}
            {step.repeat > 1 && <span className="rounded-full bg-mint/[0.12] px-2.5 py-0.5 font-medium text-mint">{t('line.times', { n: step.repeat })}</span>}
            <span className="inline-flex items-center gap-1 text-ink-faint">
              {step.voice === 'aloud' ? <Volume1 className="size-4" /> : <VolumeX className="size-4" />}
              {step.voice === 'aloud' ? t('line.aloud') : t('line.quietly')}
            </span>
          </div>

          {step.cue && (
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1, ...calm }}
              className="mb-4 inline-flex items-center gap-2 rounded-full border border-mint/30 bg-mint/[0.09] px-4 py-1.5 text-[length:var(--text-body)] font-medium text-mint"
            >
              <ArrowDownRight className="size-4 rtl:-scale-x-100" />
              {t(`cue.${step.cue}`, { n: step.rakah })}
            </motion.div>
          )}

          {show.arabic && (
            <p
              lang="ar"
              dir="rtl"
              className={cn('text-balance text-ink', quran ? 'quran' : 'arabic')}
              style={{ fontSize: `calc(${arabicHero ? 'var(--text-arabic)' : 'var(--text-arabic-sub)'} * ${k * (long && arabicHero ? 0.82 : 1)})` }}
            >
              <Words text={line.arabic} range={word < 0 ? null : [word, word]} />
            </p>
          )}
          {show.transliteration && (
            <p
              lang="ar-Latn"
              className={cn('leading-[1.12] font-semibold tracking-[-0.018em] text-balance text-ink', show.arabic && 'mt-2 text-ink-soft')}
              style={{ fontSize: `calc(${long ? 'var(--text-hero-long)' : 'var(--text-hero)'} * ${k * (show.arabic ? 0.72 : 1)})` }}
            >
              <Words text={line.transliteration} range={litRange(word, al?.t, count(line.transliteration), arabicWords)} />
            </p>
          )}
          {show.translation && line.meaning && (
            <p className="mt-4 max-w-[38ch] font-serif leading-[1.45] text-balance text-ink-soft" style={{ fontSize: `calc(var(--text-meaning) * ${k})` }}>
              <Words text={line.meaning} range={al?.m?.length ? litRange(word, al.m, count(line.meaning), arabicWords) : null} />
            </p>
          )}

          {timedMs !== null && (
            <div className="mt-6 h-1 w-24 overflow-hidden rounded-full bg-white/[0.08]">
              <motion.div className="h-full origin-left rounded-full bg-mint/75 rtl:origin-right" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: timedMs / 1000, ease: 'linear' }} />
            </div>
          )}

          {upcoming && (
            <p className="mt-6 max-w-[40ch] truncate text-[length:var(--text-meta)] text-ink-faint max-sm:hidden short:hidden">
              <span className="me-2 text-ink-muted">{t('line.next')}</span>
              {show.transliteration ? upcoming.transliteration : upcoming.arabic}
            </p>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
