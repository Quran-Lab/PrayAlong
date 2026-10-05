import { Mic, MicOff } from 'lucide-react'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import type { VoiceStatus } from '@/voice/types'
import { Tooltip } from './ui/primitives'

/**
 * Listen: PrayAlong follows your recitation through the microphone, with no
 * camera. While the model downloads (first time only) the button shows
 * progress; if listening fails, the prayer carries on by time.
 */
export function ListenButton({ on, status, progress, onToggle, compact }: { on: boolean; status: VoiceStatus; progress: number; onToggle: () => void; compact?: boolean }) {
  const t = useT()
  const loading = on && status === 'loading'
  const failed = on && status === 'error'
  const label = !on ? t('listen.off') : loading ? t('listen.loading', { p: Math.round(progress * 100) }) : failed ? t('listen.failed') : t('listen.on')
  return (
    <Tooltip content={t('listen.hint')} side="bottom">
      <button
        onClick={onToggle}
        aria-pressed={on}
        className={cn(
          'relative flex h-10 cursor-pointer items-center gap-2 overflow-hidden rounded-full border px-3.5 text-sm font-medium transition-colors',
          on && !failed ? 'border-mint/50 bg-mint/[0.1] text-ink' : 'border-line text-ink-soft hover:text-ink',
          failed && 'border-red-400/40 text-red-200',
        )}
      >
        {loading && <span className="absolute inset-y-0 start-0 bg-mint/15" style={{ width: `${progress * 100}%` }} />}
        {on && status === 'listening' && <span className="relative size-2 animate-breathe rounded-full bg-mint" />}
        {on ? <Mic className="relative size-[18px] text-mint" /> : <MicOff className="relative size-[18px]" />}
        {!compact && <span className="relative">{label}</span>}
      </button>
    </Tooltip>
  )
}
