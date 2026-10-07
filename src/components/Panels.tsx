import { Coordinates, Qibla } from 'adhan'
import { Navigation, Play, RotateCcw } from 'lucide-react'
import { motion } from 'motion/react'
import { PRAYER_BY_ID } from '@/content/prayers'
import { resolveLine } from '@/content/lines'
import { useLocale, useT } from '@/i18n'
import { formatTime } from '@/lib/prayer-times'
import { useMedia } from '@/lib/use-media'
import type { PrayerClock } from '@/lib/use-prayer-clock'
import { display, useSession } from '@/state/session'
import { ModePicker } from './ModePicker'
import { Button, Kbd } from './ui/primitives'

// Glass arriving: it rises a little and settles, then its contents follow one after another.
// (No filter on the glass itself: that would blur it twice.)
const EASE = [0.23, 1, 0.32, 1] as const
const panel = {
  hidden: { opacity: 0, y: 10, scale: 0.985 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, ease: EASE, staggerChildren: 0.05, delayChildren: 0.08 } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] as const } },
}
const item = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } },
}
const reveal = { variants: panel, initial: 'hidden', animate: 'show', exit: 'exit' } as const

function QiblaChip({ clock }: { clock: PrayerClock }) {
  const t = useT()
  const deg = Math.round(Qibla(new Coordinates(clock.place.latitude, clock.place.longitude)))
  return (
    <span className="glass-chip inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm text-ink-muted">
      <Navigation className="size-3.5 text-mint" style={{ transform: `rotate(${deg - 45}deg)` }} aria-hidden />
      {t('ready.qibla', { deg })}
    </span>
  )
}

export function ReadyPanel({ clock, handsFree }: { clock: PrayerClock; handsFree: boolean; onHandsFree?: () => void }) {
  const t = useT()
  const compact = useMedia('(max-width: 639px)')
  const { prayer, begin } = useSession()
  const info = PRAYER_BY_ID[prayer]
  const name = t(`prayer.${prayer}`)
  const { detected } = clock
  const when =
    prayer === detected.id
      ? detected.status === 'now'
        ? t('ready.until', { time: formatTime(detected.endsAt) })
        : t('ready.from', { time: formatTime(detected.startsAt) })
      : t('ready.at', { time: formatTime(clock.times[prayer]) })

  return (
    <motion.div {...reveal} className="glass-panel mx-3 flex max-w-xl flex-col items-center rounded-[1.75rem] px-4 py-5 text-center sm:mx-auto sm:rounded-[2rem] sm:px-9 sm:py-8 short:py-4">
      <motion.div variants={item} className="mb-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[length:var(--text-meta)] text-ink-muted">
        <span className="font-semibold text-mint">{name}</span>
        <span>{t('ready.rakahs', { n: info.rakahs })}</span>
        <span className="tabular">{when}</span>
      </motion.div>
      <motion.h1 variants={item} className="text-[length:var(--text-hero-long)] leading-tight font-semibold tracking-[-0.02em] text-ink">{t('ready.title')}</motion.h1>
      <motion.p variants={item} className="mt-3 [@media(max-width:639px)_and_(max-height:860px)]:hidden max-w-md font-serif text-[length:var(--text-body)] leading-relaxed text-balance text-ink-soft">
        {t('ready.body')} {handsFree ? t('ready.bodyHandsFree') : t('ready.bodyListen')}
      </motion.p>
      <motion.div variants={item} className="mt-6 w-full max-w-[30rem] max-sm:mt-4">
        <ModePicker compact={compact} />
      </motion.div>
      <motion.div variants={item} className="mt-5 flex flex-wrap items-center justify-center gap-2.5 max-sm:mt-4">
        <Button variant="primary" size="lg" onClick={begin}>
          <Play className="size-4 fill-current" />
          {t('ready.begin', { prayer: name })}
        </Button>
      </motion.div>
      <motion.div variants={item} className="mt-3.5 flex items-center gap-3">
        <QiblaChip clock={clock} />
        <span className="hidden items-center gap-1.5 text-sm text-ink-muted md:flex">
          {t('ready.orPress')} <Kbd>Space</Kbd>
        </span>
      </motion.div>
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
    <motion.div {...reveal} className="glass-panel mx-3 flex max-w-xl flex-col items-center rounded-[2rem] px-5 py-6 text-center sm:mx-auto sm:px-9 sm:py-8" aria-live="polite">
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
      <p className="mt-3 text-sm text-ink-faint">{t('complete.next', { prayer: t(`prayer.${next}`), time: formatTime(clock.times[next]) })}</p>
    </motion.div>
  )
}
