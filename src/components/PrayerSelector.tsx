import { ChevronDown } from 'lucide-react'
import { motion } from 'motion/react'
import { Popover } from 'radix-ui'
import { useState } from 'react'
import { PRAYERS, PRAYER_BY_ID } from '@/content/prayers'
import { cn } from '@/lib/cn'
import { formatTime } from '@/lib/prayer-times'
import type { PrayerClock } from '@/lib/use-prayer-clock'
import type { PrayerId } from '@/sequence/types'
import { useSession } from '@/state/session'
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

function sublabel(id: PrayerId, clock: PrayerClock, short = false) {
  const { detected, times } = clock
  if (id === detected.id) {
    if (detected.status === 'next') return `Next · ${formatTime(detected.startsAt)}`
    return short ? 'Now' : 'Active · Auto-detected'
  }
  return formatTime(times[id])
}

/** Laptop: all five prayers as chips, the active one expanded. */
export function PrayerChips({ clock, onRequestSwitch }: { clock: PrayerClock; onRequestSwitch: (id: PrayerId) => void }) {
  const selected = useSession((s) => s.prayer)
  const choose = useChoose(onRequestSwitch)

  return (
    <nav aria-label="Prayer" className="flex items-center gap-1.5">
      {PRAYERS.map((p) => {
        const active = p.id === selected
        const isNow = p.id === clock.detected.id
        return (
          <Tooltip key={p.id} content={`${p.name} · ${formatTime(clock.times[p.id])}`}>
            <button
              onClick={() => choose(p.id)}
              aria-pressed={active}
              className={cn(
                'relative flex h-9 cursor-pointer items-center gap-2 rounded-xl px-3.5 text-sm transition-colors duration-200',
                active ? 'text-ink' : 'text-ink-muted hover:text-ink-soft',
              )}
            >
              {active ? (
                <motion.span
                  layoutId="prayer-chip"
                  className="absolute inset-0 rounded-xl border border-mint/50 bg-mint/[0.08] shadow-[0_0_24px_-6px_oklch(0.86_0.12_166/0.55)]"
                  transition={{ type: 'spring', bounce: 0.12, duration: 0.5 }}
                />
              ) : (
                <span className="absolute inset-0 rounded-xl border border-line" />
              )}
              <span className="relative font-medium">{p.name}</span>
              {active && (
                <motion.span
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="relative text-[11.5px] whitespace-nowrap text-mint"
                >
                  {sublabel(p.id, clock)}
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
  const selected = useSession((s) => s.prayer)
  const choose = useChoose(onRequestSwitch)
  const [open, setOpen] = useState(false)
  const info = PRAYER_BY_ID[selected]

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button className="flex h-10 min-w-0 cursor-pointer items-center gap-2 rounded-xl border border-mint/45 bg-mint/[0.08] pr-2.5 pl-3.5 text-sm shadow-[0_0_24px_-8px_oklch(0.86_0.12_166/0.6)]">
          <span className="font-medium">{info.name}</span>
          <span className="truncate text-[11.5px] text-mint">{sublabel(selected, clock, true)}</span>
          <ChevronDown className="size-4 shrink-0 text-ink-muted" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={8} align="center" className="z-50 w-64 animate-pop rounded-2xl border border-line bg-raised/95 p-1.5 shadow-2xl shadow-black/50 backdrop-blur-xl">
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
                {p.name}
                {p.id === clock.detected.id && <span className="size-1.5 rounded-full bg-mint" />}
              </span>
              <span className="tabular text-xs text-ink-muted">{formatTime(clock.times[p.id])}</span>
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
