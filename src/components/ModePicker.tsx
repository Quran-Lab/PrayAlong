import { AudioLines, BookOpen } from 'lucide-react'
import { motion } from 'motion/react'
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
    <div role="radiogroup" aria-label={t('settings.mode')} className={cn('grid w-full grid-cols-2', compact ? 'gap-1.5' : 'gap-2.5 short:gap-2')}>
      {MODES.map(({ id, icon: Icon }) => {
        const on = mode === id
        return (
          <button
            key={id}
            role="radio"
            aria-checked={on}
            onClick={() => update({ mode: id })}
            className={cn(
              'group relative flex cursor-pointer flex-col items-start rounded-2xl border text-start transition-colors duration-200',
              'focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2',
              compact ? 'gap-1 p-3' : 'gap-1.5 p-4 low:gap-1 low:px-3.5 low:py-3',
              on ? 'border-mint/50 text-ink' : 'border-line text-ink-soft hover:border-white/20 hover:bg-white/[0.03]',
            )}
          >
            {on && (
              <motion.span
                layoutId={compact ? 'mode-on-compact' : 'mode-on'}
                className="absolute inset-0 rounded-2xl bg-mint/[0.09]"
                transition={{ type: 'spring', bounce: 0.15, duration: 0.45 }}
              />
            )}
            <span className="relative flex items-center gap-2">
              <span className={cn('grid size-7 place-items-center rounded-full transition-colors', on ? 'bg-mint/20 text-mint' : 'bg-white/[0.06] text-ink-muted')}>
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="text-[length:var(--text-body)] leading-tight font-semibold">{t(`mode.${id}`)}</span>
            </span>
            <span className={cn('relative leading-snug text-pretty', compact ? 'text-sm text-ink-muted' : 'text-[0.95rem] text-ink-muted low:text-sm short:hidden [@media(min-width:900px)_and_(max-width:1199px)_and_(max-height:700px)]:hidden')}>
              {t(`mode.${id}Hint`)}
            </span>
          </button>
        )
      })}
    </div>
  )
}
