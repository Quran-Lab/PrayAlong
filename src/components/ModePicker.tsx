import { AudioLines, BookOpen } from 'lucide-react'
import { LiquidPill } from './ui/LiquidGlass'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { useSession, type Mode } from '@/state/session'

const MODES: { id: Mode; icon: typeof BookOpen }[] = [
  { id: 'teach', icon: BookOpen },
  { id: 'pray', icon: AudioLines },
]

/**
 * The one choice that shapes a prayer: be taught (the companion shows and says
 * each step, you repeat it) or be followed (you recite, PrayAlong keeps up).
 */
export function ModePicker({ compact = false }: { compact?: boolean }) {
  const t = useT()
  const mode = useSession((s) => s.settings.mode)
  const update = useSession((s) => s.updateSettings)
  return (
    <div role="radiogroup" aria-label={t('settings.mode')} className={cn('grid w-full grid-cols-2', compact ? 'gap-1.5' : 'gap-2.5')}>
      {MODES.map(({ id, icon: Icon }) => {
        const on = mode === id
        return (
          <button
            key={id}
            role="radio"
            aria-checked={on}
            onClick={() => update({ mode: id })}
            className={cn(
              'glass-chip group relative flex cursor-pointer flex-col items-start rounded-2xl text-start transition-[color,background-color,scale] duration-150 ease-out duration-200 active:scale-[0.98]',
              'focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2',
              compact ? 'gap-1 p-3' : 'gap-1.5 p-4',
              on ? 'text-ink' : 'text-ink-soft',
            )}
          >
            {/* The chosen way: a drop of light that flows between the two. */}
            {on && <LiquidPill layoutId={compact ? 'mode-on-compact' : 'mode-on'} className="rounded-2xl" />}
            <span className="relative flex items-center gap-2">
              <span className={cn('grid size-7 place-items-center rounded-full transition-colors', on ? 'bg-mint/20 text-mint' : 'bg-white/[0.06] text-ink-muted')}>
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="text-[length:var(--text-body)] leading-tight font-semibold">{t(`mode.${id}`)}</span>
            </span>
            <span className={cn('relative leading-snug text-pretty', compact ? 'text-sm' : 'text-[0.95rem]', on ? 'text-ink-soft' : 'text-ink-muted')}>
              {t(`mode.${id}Hint`)}
            </span>
          </button>
        )
      })}
    </div>
  )
}
