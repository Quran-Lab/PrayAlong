import { CheckCircle2, Footprints, Laptop, MonitorUp, RefreshCw, ScanFace, SwitchCamera } from 'lucide-react'
import type { Blocker } from '@/handsfree/advice'
import { isFallback, type Framing, type HandsFreeStatus } from '@/handsfree/types'
import type { CheckState } from '@/handsfree/use-hands-free'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { CameraPreview, useBlockerText, useFallbackText, useStatusText } from './HandsFree'
import { Sheet } from './ui/Sheet'
import { Button } from './ui/primitives'

/**
 * Getting hands-free right the first time, for the real setup: a laptop on
 * the floor at the front of the rug. Live coaching on the placement (what
 * the camera can't see and what to change), a standing calibration, a
 * ten-second "quick ruku and sit" check, and a way out (demo).
 */
/** A phone held in the hand-sized way: small touch screen. */
const isPhone = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse) and (max-width: 820px)').matches

export function SetupSheet({
  open,
  onOpenChange,
  status,
  stream,
  framing,
  blocker = null,
  calibrated = false,
  check = { state: 'idle' },
  onCheck,
  engineLabel,
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
  blocker?: Blocker
  calibrated?: boolean
  check?: CheckState
  onCheck?: () => void
  engineLabel: string | null
  facingMode: 'user' | 'environment'
  onFlip: () => void
  onRetry: () => void
  onDemo: () => void
}) {
  const t = useT()
  const statusText = useStatusText()
  const fallback = useFallbackText()(status)
  const blockerText = useBlockerText()(blocker)
  const watching = status === 'watching'

  const coach = !watching
    ? { tone: 'muted', text: statusText(status) }
    : blockerText
      ? { tone: 'warn', text: blockerText }
      : framing === 'none'
        ? { tone: 'muted', text: t('setup.lookingForYou') }
        : !calibrated
          ? { tone: 'muted', text: t('setup.standStill') }
          : { tone: 'ok', text: t('setup.seeYou') }

  const steps = [
    { icon: Laptop, text: t('setup.step1') },
    { icon: MonitorUp, text: t('setup.step2') },
    { icon: Footprints, text: t('setup.step3') },
  ]

  const checkText =
    check.state === 'running'
      ? check.stage === 'bowing'
        ? t('setup.check.bow')
        : t('setup.check.sit')
      : check.state === 'done'
        ? check.result.ok
          ? t('setup.check.ok')
          : t('setup.check.missed', { what: check.result.missing.map((m) => t(m === 'bowing' ? 'posture.ruku' : 'posture.jalsah')).join(', ') })
        : null

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('setup.title')} description={t(isPhone() ? 'setup.bodyPhone' : 'setup.body')}>
      <div className="relative mt-2 overflow-hidden rounded-2xl border border-line bg-black/40">
        {stream ? (
          <CameraPreview stream={stream} mirror={facingMode === 'user'} className="aspect-[4/3] w-full" />
        ) : (
          <div className="grid aspect-[4/3] w-full place-items-center p-6 text-center text-sm text-ink-muted">
            {fallback ?? <span className="animate-breathe">{statusText(status)}</span>}
          </div>
        )}
        {/* Where the head and shoulders should be when standing (the legs may be cut off). */}
        {stream && (
          <div
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-x-[30%] top-[5%] h-[45%] rounded-[50%_50%_22%_22%/42%_42%_14%_14%] border-2 border-dashed transition-colors duration-500',
              coach.tone === 'ok' ? 'border-mint/70' : 'border-white/30',
            )}
          />
        )}
        <div
          role="status"
          className={cn(
            'absolute inset-x-3 bottom-3 flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-center text-sm backdrop-blur-md',
            coach.tone === 'ok' ? 'bg-mint/20 text-mint' : coach.tone === 'warn' ? 'bg-amber-400/15 text-amber-100' : 'bg-black/45 text-ink-soft',
          )}
        >
          {coach.tone === 'ok' && <CheckCircle2 className="size-4 shrink-0" />}
          {coach.text}
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

      {engineLabel && watching && (
        <p className="mt-2 text-center text-sm text-ink-faint">{engineLabel} · {t('hf.private')}</p>
      )}

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

      {watching && onCheck && (
        <div className="mt-4 flex items-center gap-3 rounded-xl bg-white/[0.04] px-3 py-2.5 text-sm">
          <ScanFace className="size-4 shrink-0 text-mint" />
          <span className={cn('flex-1', check.state === 'done' && !check.result.ok ? 'text-amber-100' : 'text-ink-soft')}>
            {checkText ?? t('setup.check.intro')}
          </span>
          {check.state !== 'running' && (
            <Button variant="quiet" onClick={onCheck} disabled={!calibrated}>
              {check.state === 'done' ? t('hf.retry') : t('setup.check.start')}
            </Button>
          )}
        </div>
      )}

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
