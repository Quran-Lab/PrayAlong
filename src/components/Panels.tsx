import { Coordinates, Qibla } from 'adhan'
import { Navigation, Play, RotateCcw } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { PRAYER_BY_ID } from '@/content/prayers'
import { resolveLine } from '@/content/lines'
import { useLocale, useT } from '@/i18n'
import { formatTime } from '@/lib/prayer-times'
import type { PrayerClock } from '@/lib/use-prayer-clock'
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
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-sm text-ink-muted">
      <Navigation className="size-3.5 text-mint" style={{ transform: `rotate(${deg - 45}deg)` }} aria-hidden />
      {t('ready.qibla', { deg })}
    </span>
  )
}

const SEEN_KEY = 'prayalong:howItWorks'

/** Three lines for a first visit: where the laptop goes, that it waits, the close-ups. */
function HowItWorks({ fallback }: { fallback: React.ReactNode }) {
  const t = useT()
  const [show, setShow] = useState(() => {
    try {
      return localStorage.getItem(SEEN_KEY) !== '1'
    } catch {
      return true
    }
  })
  if (!show) return <>{fallback}</>
  const done = () => {
    try {
      localStorage.setItem(SEEN_KEY, '1')
    } catch {
      /* no storage */
    }
    setShow(false)
  }
  return (
    <div className="mt-3 w-full max-w-[30rem] rounded-2xl border border-line bg-white/[0.03] px-4 py-3 text-start">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="text-[length:var(--text-meta)] font-semibold text-ink">{t('onboard.title')}</span>
        <button onClick={done} className="cursor-pointer rounded-full bg-white/[0.08] px-3 py-1 text-sm font-semibold text-ink hover:bg-white/[0.12]">
          {t('onboard.ok')}
        </button>
      </div>
      <ol className="space-y-1 text-sm leading-snug text-ink-soft">
        {(['onboard.floor', 'onboard.waits', 'onboard.show'] as const).map((k, i) => (
          <li key={k} className="flex gap-2.5">
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-mint/15 text-xs font-semibold text-mint">{i + 1}</span>
            <span>{t(k)}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function ReadyPanel({ clock, handsFree }: { clock: PrayerClock; handsFree: boolean; onHandsFree?: () => void }) {
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
      <HowItWorks fallback={
        <p className="mt-3 max-w-md font-serif text-[length:var(--text-body)] leading-relaxed text-balance text-ink-soft">
          {t('ready.body')} {handsFree ? t('ready.bodyHandsFree') : t('ready.bodyListen')}
        </p>
      } />
      <div className="mt-6 w-full max-w-[30rem]">
        <ModePicker />
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
        <Button variant="primary" size="lg" onClick={begin}>
          <Play className="size-4 fill-current" />
          {t('ready.begin', { prayer: name })}
        </Button>
      </div>
      <div className="mt-3.5 flex items-center gap-3">
        <QiblaChip clock={clock} />
        <span className="hidden items-center gap-1.5 text-sm text-ink-faint md:flex">
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
      <p className="mt-3 text-[length:var(--text-meta)] text-ink-muted">{t('complete.next', { prayer: t(`prayer.${next}`), time: formatTime(clock.times[next]) })}</p>
    </motion.div>
  )
}
