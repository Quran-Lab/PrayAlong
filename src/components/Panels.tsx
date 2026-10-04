import { Play, RotateCcw, Video } from 'lucide-react'
import { motion } from 'motion/react'
import { PRAYER_BY_ID } from '@/content/prayers'
import { getRecitation } from '@/content/recitations'
import { formatTime } from '@/lib/prayer-times'
import type { PrayerClock } from '@/lib/use-prayer-clock'
import { useSession } from '@/state/session'
import { Button, Kbd } from './ui/primitives'

const rise = {
  initial: { opacity: 0, y: 12, filter: 'blur(6px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, y: -8, filter: 'blur(4px)' },
  transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const },
}

export function ReadyPanel({ clock, handsFree, onHandsFree }: { clock: PrayerClock; handsFree: boolean; onHandsFree: () => void }) {
  const { prayer, begin } = useSession()
  const info = PRAYER_BY_ID[prayer]
  const { detected } = clock
  const when =
    prayer === detected.id
      ? detected.status === 'now'
        ? `until ${formatTime(detected.endsAt)}`
        : `from ${formatTime(detected.startsAt)}`
      : `at ${formatTime(clock.times[prayer])}`

  return (
    <motion.div {...rise} className="mx-auto flex max-w-xl flex-col items-center px-5 text-center">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-medium tracking-[0.14em] text-ink-muted uppercase">
        <span className="text-mint">{info.name}</span>
        <span className="text-ink-faint">·</span>
        <span>{info.rakahs} rak‘ahs</span>
        <span className="text-ink-faint">·</span>
        <span className="tracking-normal normal-case">{when}</span>
      </div>
      <h1 className="text-[1.75rem] font-semibold tracking-[-0.02em] text-ink sm:text-[2.1rem]">Ready when you are</h1>
      <p className="mt-2 max-w-md text-[15px] leading-relaxed text-balance text-ink-soft">
        Stand on your mat facing the qibla.{' '}
        {handsFree ? 'Raise your hands for takbir and PrayAlong will follow you.' : 'Turn on Hands-Free to pray without touching anything.'}
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
        <Button variant="primary" size="lg" onClick={begin}>
          <Play className="size-4 fill-current" />
          Begin {info.name}
        </Button>
        {!handsFree && (
          <Button variant="ghost" size="lg" onClick={onHandsFree}>
            <Video className="size-[18px] text-mint" />
            Hands-Free
          </Button>
        )}
      </div>
      <p className="mt-3 hidden items-center gap-1.5 text-xs text-ink-faint md:flex">
        or press <Kbd>Space</Kbd>
      </p>
    </motion.div>
  )
}

export function CompletePanel({ clock }: { clock: PrayerClock }) {
  const { prayer, restart } = useSession()
  const info = PRAYER_BY_ID[prayer]
  const line = getRecitation('taqabbal')
  const order = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const
  const next = order[(order.indexOf(prayer) + 1) % order.length]!

  return (
    <motion.div {...rise} className="mx-auto flex max-w-xl flex-col items-center px-5 text-center" aria-live="polite">
      <div className="mb-1 text-[11px] font-medium tracking-[0.14em] text-mint uppercase">{info.name} complete</div>
      <p lang="ar" dir="rtl" className="arabic text-[2.1rem] text-ink sm:text-[2.6rem]">
        {line.arabic}
      </p>
      <p className="text-[15px] text-ink-muted italic">{line.transliteration}</p>
      <p className="mt-1 text-[15px] text-ink-soft sm:text-[17px]">{line.translation}</p>
      <div className="mt-5 flex items-center gap-2.5">
        <Button variant="ghost" onClick={restart}>
          <RotateCcw className="size-4" />
          Pray again
        </Button>
      </div>
      <p className="mt-3 text-xs text-ink-faint">
        Next: {PRAYER_BY_ID[next].name} at {formatTime(clock.times[next])}
      </p>
    </motion.div>
  )
}
