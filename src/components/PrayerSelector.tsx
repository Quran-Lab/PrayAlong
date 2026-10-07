import { ChevronDown } from 'lucide-react'
import { motion } from 'motion/react'
import { Popover } from 'radix-ui'
import { useState } from 'react'
import { PRAYERS } from '@/content/prayers'
import { useT, type T } from '@/i18n'
import { cn } from '@/lib/cn'
import { formatTime } from '@/lib/prayer-times'
import type { PrayerClock } from '@/lib/use-prayer-clock'
import type { PrayerId } from '@/sequence/types'
import { useSession } from '@/state/session'
import { LiquidPill } from './ui/LiquidGlass'
import { Tooltip } from './ui/primitives'

function useChoose(onRequestSwitch: (id: PrayerId) => void) {
  const { prayer, phase, index, choosePrayer } = useSession()
  return (id: PrayerId) => {
    if (id === prayer) return
    // Don't throw away progress silently.
    if (phase === 'praying' && index > 0) onRequestSwitch(id)
    else choosePrayer(id)
  }
}

function sublabel(t: T, id: PrayerId, clock: PrayerClock, short = false) {
  const { detected, times } = clock
  if (id === detected.id) {
    if (detected.status === 'next') return t('prayer.next', { time: formatTime(detected.startsAt) })
    return short ? t('prayer.now') : t('prayer.activeAuto')
  }
  return formatTime(times[id])
}

/** Laptop: all five prayers as chips, the active one expanded. */
export function PrayerChips({ clock, onRequestSwitch }: { clock: PrayerClock; onRequestSwitch: (id: PrayerId) => void }) {
  const t = useT()
  const selected = useSession((s) => s.prayer)
  const choose = useChoose(onRequestSwitch)

  return (
    <nav aria-label={t('prayer.label')} className="flex items-center gap-0.5">
      {PRAYERS.map((p) => {
        const active = p.id === selected
        const isNow = p.id === clock.detected.id
        return (
          <Tooltip key={p.id} content={`${t(`prayer.${p.id}`)} · ${formatTime(clock.times[p.id])}`}>
            <button
              onClick={() => choose(p.id)}
              aria-pressed={active}
              className={cn(
                'relative flex h-10 cursor-pointer items-center gap-2 rounded-full px-4 text-sm transition-colors duration-200 active:scale-[0.97]',
                active ? 'text-ink' : 'text-ink-muted hover:text-ink-soft',
              )}
            >
              {/* The selected prayer: one lit capsule that flows between them. */}
              {active && <LiquidPill layoutId="prayer-chip" className="rounded-full" />}
              <span className="relative font-medium">{t(`prayer.${p.id}`)}</span>
              {active && (
                <motion.span
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="relative text-sm whitespace-nowrap text-mint"
                >
                  {sublabel(t, p.id, clock)}
                </motion.span>
              )}
              {!active && isNow && <span className="relative size-1.5 rounded-full bg-mint" aria-label="now" />}
            </button>
          </Tooltip>
        )
      })}
    </nav>
  )
}

/** Phone: one chip that opens the list. */
export function PrayerMenu({ clock, onRequestSwitch }: { clock: PrayerClock; onRequestSwitch: (id: PrayerId) => void }) {
  const t = useT()
  const selected = useSession((s) => s.prayer)
  const choose = useChoose(onRequestSwitch)
  const [open, setOpen] = useState(false)

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button className="astro-pill flex h-11 max-w-full min-w-0 cursor-pointer items-center gap-2 overflow-hidden rounded-full ps-4 pe-3 text-sm transition-[scale] duration-150 ease-out active:scale-[0.97]">
          <span className="shrink-0 font-medium">{t(`prayer.${selected}`)}</span>
          <span className="min-w-0 truncate text-sm text-mint tabular max-[399px]:hidden">{sublabel(t, selected, clock, true)}</span>
          <ChevronDown className="size-4 shrink-0 text-ink-muted" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={8} align="center" className="glass-panel glass-sheet z-50 w-64 animate-pop rounded-2xl p-1.5">
          {PRAYERS.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setOpen(false)
                choose(p.id)
              }}
              className={cn(
                'flex w-full cursor-pointer items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm',
                p.id === selected ? 'bg-mint/10 text-ink' : 'text-ink-soft hover:bg-white/[0.05]',
              )}
            >
              <span className="flex items-center gap-2">
                {t(`prayer.${p.id}`)}
                {p.id === clock.detected.id && <span className="size-1.5 rounded-full bg-mint" />}
              </span>
              <span className="tabular text-sm text-ink-muted">{formatTime(clock.times[p.id])}</span>
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
