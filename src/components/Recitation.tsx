import { ArrowDownRight, Mic, Volume1, VolumeX } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useRef } from 'react'
import { resolveLine } from '@/content/lines'
import { useLocale, useT } from '@/i18n'
import { cn } from '@/lib/cn'
import type { Step } from '@/sequence/types'
import { display, useSession, type TextSize } from '@/state/session'
import { useSpokenWord, type Speaking } from '@/audio/use-companion-audio'
import align from '@/content/align.json'

type Span = [number, number] | null
const ALIGN = align as unknown as Record<string, Record<string, { t: Span[]; m: Span[] }>>

/**
 * Which words of this text are being said: [first, last]. Always moves left
 * to right: the words linked to the Arabic word so far extend a reading
 * front, and the lit range is what that front just covered. Translations
 * that reorder words therefore never make the highlight jump backwards.
 */
function litRange(lit: number, spans: Span[] | undefined, count: number, arabicCount: number): [number, number] | null {
  if (lit < 0 || count === 0) return null
  const last = Math.max(1, arabicCount) - 1
  // Proportional fallback when there is no alignment.
  const ends = Array.from({ length: arabicCount }, (_, i) => {
    const linked = spans?.[i]?.[1]
    return linked ?? Math.floor(((i + 1) * count) / Math.max(1, arabicCount)) - 1
  })
  ends[last] = count - 1 // the last Arabic word finishes the line
  let front = -1
  let start = 0
  for (let i = 0; i <= Math.min(lit, last); i++) {
    const end = Math.max(front, Math.min(count - 1, ends[i]!))
    if (end > front) {
      start = front + 1
      front = end
    }
  }
  return front < 0 ? null : [start, front]
}

/** Words of a line, with the ones being spoken lit (whole words keep Arabic letters joined). */
/** Split into highlightable words; pronunciation also splits after hyphens (Sirāṭal-|ladhīna). */
const tokens = (text: string, hyphens = false) => text.split(hyphens ? /(\s+|(?<=-))/ : /(\s+)/).filter((w) => w !== undefined && w !== '')
const countTokens = (text: string, hyphens = false) => tokens(text, hyphens).filter((w) => w.trim()).length

function Words({
  text,
  range,
  you = false,
  hyphens = false,
  fill = null,
  rtl = false,
}: {
  text: string
  range: [number, number] | null
  /** The user's own recitation (a different colour from the companion's). */
  you?: boolean
  hyphens?: boolean
  /** How far through the current word (0..1), from the recognizer's phonemes. */
  fill?: number | null
  rtl?: boolean
}) {
  const parts = tokens(text, hyphens)
  let k = -1
  return (
    <>
      {parts.map((w, i) => {
        if (!w.trim()) return w
        k++
        const lit = range && k >= range[0] && k <= range[1]
        const colour = you ? 'var(--you)' : 'var(--accent)'
        // Partly said: fill the word from its start with a gradient clipped to the
        // text, which keeps Arabic letters joined (no per-letter spans).
        // Spread the progress across the pieces of the current word (rabbil- | 'ālamīn).
        const span = range ? range[1] - range[0] + 1 : 1
        const pos = fill === null ? null : fill * span
        const piece = range ? k - range[0] : 0
        if (lit && pos !== null && fill! < 0.98 && piece >= Math.floor(pos)) {
          if (piece > Math.floor(pos)) {
            return (
              <span key={i} className="text-ink-muted transition-colors duration-200">
                {w}
              </span>
            )
          }
          const p = Math.round((pos - Math.floor(pos)) * 100)
          return (
            <span
              key={i}
              style={{
                backgroundImage: `linear-gradient(to ${rtl ? 'left' : 'right'}, ${colour} ${p}%, var(--color-ink-muted) ${p}%)`,
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              {w}
            </span>
          )
        }
        return (
          <span
            key={i}
            className={cn('transition-colors duration-200', range && (lit ? (you ? 'text-[var(--you)]' : 'text-mint') : k < range[0] ? (you ? 'text-[var(--you)]' : 'text-[color-mix(in_oklab,var(--accent)_60%,var(--color-ink))]') : 'text-ink-muted'))}
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
  heardWord = null,
  heardRep = null,
  heardFill = null,
  listening = false,
}: {
  step: Step
  next?: Step
  timedMs: number | null
  distance?: boolean
  speaking?: Speaking | null
  /** Listen mode: the last Arabic word the user was heard saying (-1 before the first). */
  heardWord?: number | null
  /** Listen mode: which repetition the user is on (0-based). */
  heardRep?: number | null
  /** Listen mode: how far through the current word (0..1), from the phonemes heard. */
  heardFill?: number | null
  /** Listen mode is on: show what to say to move on. */
  listening?: boolean
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
  const spoken = useSpokenWord(live)
  // The companion's voice leads while it speaks; otherwise follow the user's own recitation.
  // A word in progress with nothing of it heard yet is not lit: the light starts with its first sound.
  const started = heardFill === null || heardFill > 0.02
  const word = spoken >= 0 ? spoken : heardWord === null ? -1 : started ? heardWord : heardWord - 1
  const fillNow = started ? heardFill : null
  const you = spoken < 0 && heardWord !== null && heardWord >= 0
  // How many times a repeated line (tasbih ×3) has been said: from the companion
  // or from what was heard. It only ever goes up within a line.
  const repSeen = live ? live.rep : (heardRep ?? 0)
  const repMax = useRef({ id: '', n: 0 })
  if (repMax.current.id !== step.id) repMax.current = { id: step.id, n: 0 }
  repMax.current.n = Math.max(repMax.current.n, repSeen)
  const repsDone = repMax.current.n
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
            {step.repeat > 1 && (
              <span className="inline-flex items-center gap-2 rounded-full bg-mint/[0.12] px-3 py-1 font-medium text-mint" aria-label={t('line.times', { n: step.repeat })}>
                <span className="tabular">{t('line.times', { n: step.repeat })}</span>
                <span className="flex gap-1" aria-hidden>
                  {Array.from({ length: step.repeat }, (_, i) => (
                    <span
                      key={i}
                      // Filled = said; ringed = the one being said now; faint = still to come.
                      className={cn(
                        'size-2.5 rounded-full transition-all duration-300',
                        i < repsDone ? 'bg-mint' : i === repsDone ? 'animate-breathe ring-2 ring-mint ring-inset' : 'ring-1 ring-mint/35 ring-inset',
                      )}
                    />
                  ))}
                </span>
              </span>
            )}
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
              <Words you={you} rtl fill={you ? fillNow : null} text={line.arabic} range={word < 0 ? null : [word, word]} />
            </p>
          )}
          {show.transliteration && (
            <p
              lang="ar-Latn"
              className={cn('leading-[1.12] font-semibold tracking-[-0.018em] text-balance text-ink', show.arabic && 'mt-2 text-ink-soft')}
              style={{ fontSize: `calc(${long ? 'var(--text-hero-long)' : 'var(--text-hero)'} * ${k * (show.arabic ? 0.72 : 1)})` }}
            >
              <Words you={you} hyphens fill={you ? fillNow : null} text={line.transliteration} range={litRange(word, al?.t, countTokens(line.transliteration, true), arabicWords)} />
            </p>
          )}
          {show.translation && line.meaning && (
            <p className="mt-4 max-w-[38ch] font-serif leading-[1.45] text-balance text-ink-soft" style={{ fontSize: `calc(var(--text-meaning) * ${k})` }}>
              <Words you={you} text={line.meaning} range={litRange(word, al?.m, count(line.meaning), arabicWords)} />
            </p>
          )}

          {timedMs !== null && (
            <div className="mt-6 h-1 w-24 overflow-hidden rounded-full bg-white/[0.08]">
              <motion.div className="h-full origin-left rounded-full bg-mint/75 rtl:origin-right" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: timedMs / 1000, ease: 'linear' }} />
            </div>
          )}

          {/* Listen mode: before a movement, say exactly what moves the prayer on (e.g. "Allāhu Akbar, bow"). */}
          {listening && next?.cue && next.posture !== step.posture ? (
            <motion.p
              key="move"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="mt-6 inline-flex items-center gap-2 rounded-full border border-[var(--you)]/40 bg-[color-mix(in_oklab,var(--you)_10%,transparent)] px-4 py-1.5 text-[length:var(--text-body)] font-medium text-[var(--you)]"
            >
              <Mic className="size-4" />
              {t('line.thenSay')} {t(`cue.${next.cue}`, { n: next.rakah })}
            </motion.p>
          ) : upcoming && (
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
