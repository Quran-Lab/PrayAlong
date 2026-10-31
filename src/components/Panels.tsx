import { Coordinates, Qibla } from 'adhan'
import { Navigation, Play, RotateCcw } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { PRAYER_BY_ID } from '@/content/prayers'
import { resolveLine } from '@/content/lines'
import { useLocale, useT } from '@/i18n'
import { formatTime } from '@/lib/prayer-times'
import type { PrayerClock } from '@/lib/use-prayer-clock'
import { cn } from '@/lib/cn'
import { display, useSession } from '@/state/session'
import { ModePicker } from './ModePicker'
import { Button, Kbd } from './ui/primitives'

const rise = {
  initial: { opacity: 0, y: 12, filter: 'blur(6px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, y: -8, filter: 'blur(4px)' },
  transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const },
}

function QiblaChip({ clock }: { clock: PrayerClock }) {
  const t = useT()
  const deg = Math.round(Qibla(new Coordinates(clock.place.latitude, clock.place.longitude)))
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-sm text-ink-muted short:px-2 short:py-0.5 short:text-xs">
      <Navigation className="size-3.5 text-mint" style={{ transform: `rotate(${deg - 45}deg)` }} aria-hidden />
      {t('ready.qibla', { deg })}
    </span>
  )
}

const SEEN_KEY = 'prayalong:howItWorks'

function seenHowItWorks() {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return false
  }
}

/** Phones, upright or on their side (a phone in landscape is wider than 820 px but never tall). */
const PHONE = '(pointer: coarse) and (max-width: 820px), (pointer: coarse) and (max-height: 540px)'

/** Three lines for a first visit: where the laptop goes, that it waits, the close-ups. */
function HowItWorks({ onDone }: { onDone: () => void }) {
  const t = useT()
  const phone = typeof matchMedia !== 'undefined' && matchMedia(PHONE).matches
  const done = () => {
    try {
      localStorage.setItem(SEEN_KEY, '1')
    } catch {
      /* no storage */
    }
    onDone()
  }
  return (
    // On a phone on its side the card gives way first: it shrinks and scrolls so Begin always shows.
    <div className="mt-3 w-full max-w-[30rem] rounded-2xl border border-line bg-white/[0.03] px-4 py-3 text-start low:mt-2.5 low:py-2.5 short:mt-0 short:flex short:min-h-[5.5rem] short:flex-col short:px-3 short:py-2">
      <div className="mb-1.5 flex items-center justify-between gap-3 low:mb-1 short:shrink-0">
        <span className="text-[length:var(--text-meta)] font-semibold text-ink short:text-sm">{t('onboard.title')}</span>
        <button onClick={done} className="cursor-pointer rounded-full bg-white/[0.08] px-3 py-1 text-sm font-semibold text-ink hover:bg-white/[0.12] short:py-0.5">
          {t('onboard.ok')}
        </button>
      </div>
      {/* When it has to scroll, the last line fades out at the bottom edge. */}
      <ol className="space-y-1 text-sm leading-snug text-ink-soft low:space-y-0.5 short:min-h-0 short:overflow-y-auto short:pb-1.5 short:text-[0.8125rem] short:leading-tight short:[mask-image:linear-gradient(to_bottom,black_calc(100%-0.5rem),transparent)]">
        {([phone ? 'onboard.floorPhone' : 'onboard.floor', 'onboard.waits', 'onboard.show'] as const).map((k, i) => (
          <li key={k} className="flex gap-2.5 short:gap-2">
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-mint/15 text-xs font-semibold text-mint short:size-4 short:text-[0.625rem]">{i + 1}</span>
            <span>{t(k)}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function ReadyPanel({ clock, handsFree }: { clock: PrayerClock; handsFree: boolean; onHandsFree?: () => void }) {
  const t = useT()
  const locale = useLocale()
  const { prayer, begin } = useSession()
  const [onboard, setOnboard] = useState(() => !seenHowItWorks())
  const info = PRAYER_BY_ID[prayer]
  const name = t(`prayer.${prayer}`)
  const { detected } = clock
  const when =
    prayer === detected.id
      ? detected.status === 'now'
        ? t('ready.until', { time: formatTime(detected.endsAt, locale) })
        : t('ready.from', { time: formatTime(detected.startsAt, locale) })
      : t('ready.at', { time: formatTime(clock.times[prayer], locale) })

  return (
    // Nastaliq (Urdu) is tall: its lines sit a little closer here (--ur-leading, index.css) so Begin fits.
    // On a phone on its side the panel never grows past the window: the first-visit card gives way instead.
    <motion.div {...rise} className="mx-auto flex max-w-xl flex-col items-center px-5 text-center [--ur-leading:1.75] short:max-h-full short:px-3">
      {/* A phone on its side, first visit: the header already names the prayer and its time, the dock counts the rak'ahs. */}
      <div className={cn('mb-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[length:var(--text-meta)] text-ink-muted low:mb-1.5 short:mb-1', onboard && 'short:hidden')}>
        <span className="font-semibold text-mint">{name}</span>
        <span>{t('ready.rakahs', { n: info.rakahs })}</span>
        <span className="tabular">{when}</span>
      </div>
      {/* A phone on its side has no room for both headings on a first visit: the card's title leads. */}
      <h1 className={cn('text-[length:var(--text-hero-long)] leading-tight font-semibold tracking-[-0.02em] text-ink [--ur-leading:1.5] low:text-[length:var(--text-hero-low)] short:shrink-0 short:text-[1.375rem]', onboard && 'short:sr-only')}>{t('ready.title')}</h1>
      {onboard ? (
        <HowItWorks onDone={() => setOnboard(false)} />
      ) : (
        <p className="mt-3 max-w-md font-serif low:mt-2 text-[length:var(--text-body)] leading-relaxed text-balance text-ink-soft short:hidden">
          {t('ready.body')} {handsFree ? t('ready.bodyHandsFree') : t('ready.bodyListen')}
        </p>
      )}
      <div className="mt-6 w-full max-w-[30rem] low:mt-4 short:mt-2.5 short:shrink-0">
        {/* On a phone's first visit the card explains enough: the modes go by name, leaving the companion room. */}
        <ModePicker brief={onboard} />
      </div>
      {/* On short windows, Begin and the qibla share one row. */}
      <div className="flex flex-col items-center low:mt-4 low:flex-row low:gap-3 short:mt-2.5 short:shrink-0 short:flex-row short:flex-wrap short:justify-center short:gap-x-2.5 short:gap-y-1.5">
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5 low:mt-0 short:mt-0">
          <Button variant="primary" size="lg" onClick={begin} className="short:h-10 short:px-4">
            <Play className="size-4 fill-current" />
            {t('ready.begin', { prayer: name })}
          </Button>
        </div>
        <div className="mt-3.5 flex items-center gap-3 low:mt-0 short:mt-0">
          <QiblaChip clock={clock} />
          {/* Only where the window is tall enough that it can't crowd the dock. */}
          <span className="hidden items-center gap-1.5 text-sm text-ink-faint md:flex low:hidden short:hidden">
            {t('ready.orPress')} <Kbd>{t('key.space')}</Kbd>
          </span>
        </div>
      </div>
    </motion.div>
  )
}

export function CompletePanel({ clock }: { clock: PrayerClock }) {
  const t = useT()
  const locale = useLocale()
  const settings = useSession((s) => s.settings)
  const show = display(settings, locale)
  const { prayer, restart } = useSession()
  const line = resolveLine('taqabbal', locale)
  const order = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const
  const next = order[(order.indexOf(prayer) + 1) % order.length]!

  return (
    <motion.div {...rise} className="mx-auto flex max-w-xl flex-col items-center px-5 text-center" aria-live="polite">
      <div className="mb-2 text-sm font-semibold text-mint">{t('complete.done', { prayer: t(`prayer.${prayer}`) })}</div>
      {show.arabic && (
        <p lang="ar" dir="rtl" className="arabic text-[1.9rem] text-ink sm:text-[2.3rem]">
          {line.arabic}
        </p>
      )}
      {show.transliteration && <p className="text-[1.6rem] font-semibold tracking-[-0.015em] text-ink sm:text-[2rem]">{line.transliteration}</p>}
      {show.translation && line.meaning && <p className="mt-1.5 text-base text-ink-soft sm:text-lg">{line.meaning}</p>}
      <div className="mt-5 flex items-center gap-2.5">
        <Button variant="ghost" onClick={restart}>
          <RotateCcw className="size-4" />
          {t('complete.again')}
        </Button>
      </div>
      <p className="mt-3 text-[length:var(--text-meta)] text-ink-muted">{t('complete.next', { prayer: t(`prayer.${next}`), time: formatTime(clock.times[next], locale) })}</p>
    </motion.div>
  )
}
