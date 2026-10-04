import { CheckCircle2, Footprints, Hand, RefreshCw, Smartphone, SwitchCamera } from 'lucide-react'
import { isFallback, type Framing, type HandsFreeStatus } from '@/handsfree/types'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { CameraPreview, useFallbackText, useStatusText } from './HandsFree'
import { Sheet } from './ui/Sheet'
import { Button } from './ui/primitives'

/**
 * Getting hands-free right the first time: where to put the device, a live
 * framing check, and a way out (demo) if there's no camera.
 */
export function SetupSheet({
  open,
  onOpenChange,
  status,
  stream,
  framing,
  facingMode,
  onFlip,
  onRetry,
  onDemo,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  status: HandsFreeStatus
  stream: MediaStream | null
  framing: Framing
  facingMode: 'user' | 'environment'
  onFlip: () => void
  onRetry: () => void
  onDemo: () => void
}) {
  const t = useT()
  const statusText = useStatusText()
  const fallback = useFallbackText()(status)
  const watching = status === 'watching'

  const check = !watching
    ? { tone: 'muted', text: statusText(status) }
    : framing === 'full'
      ? { tone: 'ok', text: t('setup.seeYou') }
      : framing === 'partial'
        ? { tone: 'warn', text: t('hf.msg.noPerson') }
        : { tone: 'muted', text: t('setup.lookingForYou') }

  const steps = [
    { icon: Smartphone, text: t('setup.step1') },
    { icon: Footprints, text: t('setup.step2') },
    { icon: Hand, text: t('setup.step3') },
  ]

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('setup.title')} description={t('setup.body')}>
      <div className="relative mt-2 overflow-hidden rounded-2xl border border-line bg-black/40">
        {stream ? (
          <CameraPreview stream={stream} mirror={facingMode === 'user'} className="aspect-[3/4] w-full sm:aspect-[4/5]" />
        ) : (
          <div className="grid aspect-[3/4] w-full place-items-center p-6 text-center text-sm text-ink-muted sm:aspect-[4/5]">
            {fallback ?? <span className="animate-breathe">{statusText(status)}</span>}
          </div>
        )}
        {/* A soft guide for where the body should be. */}
        {stream && (
          <div
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-x-[22%] inset-y-[8%] rounded-[45%_45%_18%_18%/30%_30%_10%_10%] border-2 border-dashed transition-colors duration-500',
              framing === 'full' ? 'border-mint/70' : 'border-white/30',
            )}
          />
        )}
        <div
          className={cn(
            'absolute inset-x-3 bottom-3 flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm backdrop-blur-md',
            check.tone === 'ok' ? 'bg-mint/20 text-mint' : check.tone === 'warn' ? 'bg-amber-400/15 text-amber-100' : 'bg-black/45 text-ink-soft',
          )}
        >
          {check.tone === 'ok' && <CheckCircle2 className="size-4" />}
          {check.text}
        </div>
        {stream && (
          <button
            onClick={onFlip}
            className="absolute end-3 top-3 flex size-10 cursor-pointer items-center justify-center rounded-full bg-black/45 text-ink backdrop-blur-md hover:bg-black/60"
            aria-label="Switch camera"
          >
            <SwitchCamera className="size-[18px]" />
          </button>
        )}
      </div>

      <ol className="mt-4 space-y-2.5">
        {steps.map(({ icon: Icon, text }, i) => (
          <li key={i} className="flex items-center gap-3 text-sm text-ink-soft">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-mint">
              <Icon className="size-4" />
            </span>
            {text}
          </li>
        ))}
      </ol>

      <div className="mt-5 flex flex-col gap-2">
        {isFallback(status) && status !== 'no-model' ? (
          <Button variant="primary" size="lg" onClick={onRetry}>
            <RefreshCw className="size-4" />
            {t('hf.retry')}
          </Button>
        ) : (
          <Button variant="primary" size="lg" onClick={() => onOpenChange(false)}>
            {t('setup.done')}
          </Button>
        )}
        <Button variant="quiet" onClick={onDemo}>
          {t('setup.tryDemo')}
        </Button>
      </div>
    </Sheet>
  )
}
