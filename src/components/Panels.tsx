import { Coordinates, Qibla } from 'adhan'
import { Navigation, Play, RotateCcw, Video } from 'lucide-react'
import { motion } from 'motion/react'
import { PRAYER_BY_ID } from '@/content/prayers'
import { resolveLine } from '@/content/lines'
import { useLocale, useT } from '@/i18n'
import { formatTime } from '@/lib/prayer-times'
import type { PrayerClock } from '@/lib/use-prayer-clock'
import { display, useSession } from '@/state/session'
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
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-ink-muted">
      <Navigation className="size-3.5 text-mint" style={{ transform: `rotate(${deg - 45}deg)` }} aria-hidden />
      {t('ready.qibla', { deg })}
    </span>
  )
}

export function ReadyPanel({ clock, handsFree, onHandsFree }: { clock: PrayerClock; handsFree: boolean; onHandsFree: () => void }) {
  const t = useT()
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
    <motion.div {...rise} className="mx-auto flex max-w-xl flex-col items-center px-5 text-center">
      <div className="mb-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[length:var(--text-meta)] text-ink-muted">
        <span className="font-semibold text-mint">{name}</span>
        <span>{t('ready.rakahs', { n: info.rakahs })}</span>
        <span className="tabular">{when}</span>
      </div>
      <h1 className="text-[length:var(--text-hero-long)] leading-tight font-semibold tracking-[-0.02em] text-ink">{t('ready.title')}</h1>
      <p className="mt-3 max-w-md font-serif text-[length:var(--text-body)] leading-relaxed text-balance text-ink-soft">
        {t('ready.body')} {handsFree ? t('ready.bodyHandsFree') : t('ready.bodyManual')}
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
        <Button variant="primary" size="lg" onClick={begin}>
          <Play className="size-4 fill-current" />
          {t('ready.begin', { prayer: name })}
        </Button>
        {!handsFree && (
          <Button variant="ghost" size="lg" onClick={onHandsFree}>
            <Video className="size-[18px] text-mint" />
            {t('hf.button')}
          </Button>
        )}
      </div>
      <div className="mt-3.5 flex items-center gap-3">
        <QiblaChip clock={clock} />
        <span className="hidden items-center gap-1.5 text-xs text-ink-faint md:flex">
          {t('ready.orPress')} <Kbd>Space</Kbd>
        </span>
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
      <div className="mb-2 text-[11px] font-medium tracking-[0.14em] text-mint uppercase">{t('complete.done', { prayer: t(`prayer.${prayer}`) })}</div>
      {show.arabic && (
        <p lang="ar" dir="rtl" className="arabic text-[1.9rem] text-ink sm:text-[2.3rem]">
          {line.arabic}
        </p>
      )}
      {show.transliteration && <p className="text-[1.6rem] font-semibold tracking-[-0.015em] text-ink sm:text-[2rem]">{line.transliteration}</p>}
      {show.translation && line.meaning && <p className="mt-1.5 text-[15px] text-ink-soft sm:text-[17px]">{line.meaning}</p>}
      <div className="mt-5 flex items-center gap-2.5">
        <Button variant="ghost" onClick={restart}>
          <RotateCcw className="size-4" />
          {t('complete.again')}
        </Button>
      </div>
      <p className="mt-3 text-xs text-ink-faint">{t('complete.next', { prayer: t(`prayer.${next}`), time: formatTime(clock.times[next]) })}</p>
    </motion.div>
  )
}
