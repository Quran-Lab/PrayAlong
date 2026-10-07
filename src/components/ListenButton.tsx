import { Mic, MicOff } from 'lucide-react'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import type { VoiceError, VoiceStatus } from '@/voice/types'
import { Tooltip } from './ui/primitives'

/**
 * Listen: PrayAlong follows your recitation through the microphone, with no
 * camera. While the model downloads (first time only) the button shows
 * progress; if listening fails, the prayer carries on by time.
 */
const ERROR_KEY: Record<VoiceError, 'listen.denied' | 'listen.missing' | 'listen.model' | 'listen.unsupported' | 'listen.failed'> = {
  'mic-denied': 'listen.denied',
  'mic-missing': 'listen.missing',
  'model-unreachable': 'listen.model',
  'engine-failed': 'listen.model',
  unsupported: 'listen.unsupported',
}

export function ListenButton({ on, status, error, progress, onToggle, compact }: { on: boolean; status: VoiceStatus; error?: VoiceError; progress: number; onToggle: () => void; compact?: boolean }) {
  const t = useT()
  const loading = on && status === 'loading'
  const failed = on && status === 'error'
  const label = !on ? t('listen.off') : loading ? t('listen.loading', { p: Math.round(progress * 100) }) : failed ? t(error ? ERROR_KEY[error] : 'listen.failed') : t('listen.on')
  return (
    <Tooltip content={t('listen.hint')} side="bottom">
      <button
        onClick={onToggle}
        aria-pressed={on}
        className={cn(
          'relative flex h-11 min-w-11 cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-full px-3 sm:h-10 sm:px-3.5 text-sm font-medium transition-[color,background-color,scale] duration-150 ease-out active:scale-[0.97]',
          on && !failed ? 'glass-tint text-ink' : 'text-ink-soft hover:bg-white/[0.07] hover:text-ink',
          failed && 'text-ink-soft',
        )}
      >
        {loading && <span className="absolute inset-y-0 start-0 bg-mint/15" style={{ width: `${progress * 100}%` }} />}
        {on && status === 'listening' && <span className="relative size-2 rounded-full bg-mint" />}
        {on ? <Mic className="relative size-[18px] text-mint" /> : <MicOff className="relative size-[18px]" />}
        {!compact && <span className="relative">{label}</span>}
      </button>
    </Tooltip>
  )
}
