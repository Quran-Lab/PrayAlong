import { Settings2 } from 'lucide-react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { AlertDialog, Direction, Tooltip as RadixTooltip } from 'radix-ui'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { CameraBubble, DemoBar, HandsFreeButton } from '@/components/HandsFree'
import { Logo } from '@/components/Logo'
import { CompletePanel, ReadyPanel } from '@/components/Panels'
import { PostureDock } from '@/components/PostureDock'
import { PrayerChips, PrayerMenu } from '@/components/PrayerSelector'
import { Recitation } from '@/components/Recitation'
import { SettingsSheet } from '@/components/SettingsSheet'
import { SetupSheet } from '@/components/SetupSheet'
import { CHARACTERS, DEFAULT_CHARACTER } from '@/components/stage/characters'
import type { PoseName } from '@/components/stage/rig/prayer-poses'
import { Button } from '@/components/ui/primitives'
import { PRAYER_BY_ID } from '@/content/prayers'
import { isFollowing } from '@/handsfree/types'
import { useHandsFree } from '@/handsfree/use-hands-free'
import { LOCALES, useLocale, useT } from '@/i18n'
import { chime } from '@/lib/chime'
import { useMedia, useReducedMotion } from '@/lib/use-media'
import { usePrayerClock } from '@/lib/use-prayer-clock'
import { useWakeLock } from '@/lib/use-wake-lock'
import type { PrayerId, Step } from '@/sequence/types'
import { PACE_FACTOR, currentStep, useSession } from '@/state/session'

// The 3D stack is the heaviest part of the app; let the UI paint first.
const CompanionStage = lazy(() => import('@/components/stage/CompanionStage').then((m) => ({ default: m.CompanionStage })))

const stepMs = (step: Step, pace: keyof typeof PACE_FACTOR) => Math.max(step.timing.minMs, step.timing.expectedMs * PACE_FACTOR[pace])

export function App() {
  const t = useT()
  const locale = useLocale()
  const dir = LOCALES[locale].dir
  const clock = usePrayerClock()
  const session = useSession()
  const { phase, prayer, settings, handsFree, demo, index, sequence } = session
  const step = currentStep(session)
  const wide = useMedia('(min-width: 1024px)')
  const reducedMotion = useReducedMotion()
  const character = CHARACTERS.find((c) => c.id === settings.characterId) ?? DEFAULT_CHARACTER
  const [stageReady, setStageReady] = useState(false)
  const [pendingSwitch, setPendingSwitch] = useState<PrayerId | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user')
  const [demoAuto, setDemoAuto] = useState(false)

  const hands = useHandsFree({ enabled: handsFree, demo, facingMode, onPose: session.onPose })
  const following = handsFree && isFollowing(hands.status)

  const toggleHandsFree = useCallback(() => {
    const s = useSession.getState()
    if (s.handsFree) return s.setHandsFree(false)
    s.setHandsFree(true)
    if (!s.demo) setSetupOpen(true)
  }, [])

  // Language and direction for the whole document.
  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = dir
  }, [locale, dir])

  // Each prayer tints the room like its time of day.
  const ambient = PRAYER_BY_ID[prayer].ambient
  useEffect(() => document.documentElement.style.setProperty('--ambient', ambient), [ambient])

  useWakeLock(phase === 'praying')
  const timedMs = useStepTimer(following)
  useKeyboard(toggleHandsFree)

  // A soft chime when PrayAlong follows a movement, so nobody has to look up.
  const posture: PoseName = phase === 'ready' ? 'rest' : phase === 'complete' ? 'jalsah' : step.posture
  const lastPosture = useRef(posture)
  useEffect(() => {
    if (posture !== lastPosture.current && following && settings.sounds && phase !== 'ready') chime()
    lastPosture.current = posture
  }, [posture, following, settings.sounds, phase])

  // The movement PrayAlong is waiting for next (guides the demo bar).
  const nextPose =
    phase === 'ready' ? 'hands-raised' : phase === 'praying' ? (sequence.steps.slice(index + 1).find((s) => s.pose !== step.pose)?.pose ?? null) : null

  // Demo autopilot: act out each movement once its lines are done.
  const actOut = hands.actOut
  useEffect(() => {
    if (!demo || !demoAuto || !handsFree) return
    if (phase === 'complete') return setDemoAuto(false)
    const after = sequence.steps[index + 1]
    if (phase === 'praying' && (!after || after.pose === step.pose)) return // lines advance on their own
    const delay = phase === 'ready' ? 1200 : stepMs(step, settings.pace)
    const id = setTimeout(() => nextPose && actOut(nextPose), delay)
    return () => clearTimeout(id)
  }, [demo, demoAuto, handsFree, phase, index, step, sequence, nextPose, settings.pace, actOut])

  return (
    <Direction.Provider dir={dir}>
      <MotionConfig reducedMotion="user">
        <RadixTooltip.Provider>
          <div className="relative flex h-full flex-col overflow-hidden bg-canvas">
            {/* Header */}
            <header className="relative z-20 flex h-16 shrink-0 items-center gap-3 border-b border-line px-4 sm:h-[4.5rem] sm:px-6 short:h-12">
              <div className="flex flex-1 items-center">
                <Logo compact={!wide} />
              </div>
              {wide ? <PrayerChips clock={clock} onRequestSwitch={setPendingSwitch} /> : <PrayerMenu clock={clock} onRequestSwitch={setPendingSwitch} />}
              <div className="flex flex-1 items-center justify-end gap-1.5 sm:gap-2">
                <Button variant="quiet" size="icon" aria-label={t('settings.title')} onClick={() => setSettingsOpen(true)}>
                  <Settings2 className="size-[18px]" />
                </Button>
                <HandsFreeButton on={handsFree} status={hands.status} onToggle={toggleHandsFree} compact={!wide} />
              </div>
            </header>

            {/* Stage */}
            <main className="relative flex min-h-0 flex-1 flex-col short:flex-row">
              <div className="relative min-h-0 min-w-0 flex-1">
                <Suspense>
                  <CompanionStage
                    posture={posture}
                    character={character}
                    ambient={ambient}
                    reducedMotion={reducedMotion}
                    onLoaded={() => setStageReady(true)}
                  />
                </Suspense>
                <AnimatePresence>
                  {!stageReady && (
                    <motion.div exit={{ opacity: 0 }} className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-ink-faint">
                      <span className="animate-breathe">{t('stage.preparing')}</span>
                    </motion.div>
                  )}
                </AnimatePresence>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-canvas to-transparent" />
                <div className="absolute end-3 top-3 z-10 sm:end-5 sm:top-4">
                  <AnimatePresence>
                    {handsFree && !setupOpen && (
                      <CameraBubble
                        stream={hands.stream}
                        status={hands.status}
                        pose={hands.pose}
                        framing={hands.framing}
                        onOpen={() => setSetupOpen(true)}
                        onRetry={hands.retry}
                        onDemo={() => session.setDemo(true)}
                      />
                    )}
                  </AnimatePresence>
                </div>
                <div className="absolute inset-x-0 bottom-3 z-10 flex justify-center px-3">
                  <AnimatePresence>
                    {handsFree && demo && <DemoBar current={hands.pose} expected={nextPose} auto={demoAuto} onAct={actOut} onAuto={setDemoAuto} />}
                  </AnimatePresence>
                </div>
              </div>

              <section className="relative z-10 flex min-h-[13rem] shrink-0 items-start justify-center pb-3 sm:min-h-[14rem] short:min-h-0 short:w-[52%] short:items-center short:overflow-y-auto short:py-3">
                <AnimatePresence mode="wait">
                  {phase === 'ready' && <ReadyPanel key="ready" clock={clock} handsFree={handsFree} onHandsFree={toggleHandsFree} />}
                  {phase === 'praying' && (
                    <motion.div key="praying" className="w-full" exit={{ opacity: 0 }}>
                      <Recitation step={step} timedMs={timedMs} distance={following} />
                    </motion.div>
                  )}
                  {phase === 'complete' && <CompletePanel key="complete" clock={clock} />}
                </AnimatePresence>
              </section>
            </main>

            {/* Dock */}
            <footer className="relative z-10 shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-6 short:pb-2">
              <PostureDock following={following} />
            </footer>
          </div>

          <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} clock={clock} />
          <SetupSheet
            open={setupOpen && handsFree && !demo}
            onOpenChange={setSetupOpen}
            status={hands.status}
            stream={hands.stream}
            framing={hands.framing}
            facingMode={facingMode}
            onFlip={() => setFacingMode((m) => (m === 'user' ? 'environment' : 'user'))}
            onRetry={hands.retry}
            onDemo={() => {
              setSetupOpen(false)
              session.setDemo(true)
            }}
          />
          <SwitchPrayerDialog pending={pendingSwitch} onClose={() => setPendingSwitch(null)} />
        </RadixTooltip.Provider>
      </MotionConfig>
    </Direction.Provider>
  )
}

/**
 * Moves through lines on its own when the user asked for guidance, or when
 * hands-free is on (within a posture — the body decides when to move on).
 * Hands-free without a working camera falls back to timed guidance.
 * Returns the current line's duration so the UI can show a gentle timer.
 */
function useStepTimer(following: boolean): number | null {
  const { phase, index, sequence, autoplay, handsFree, settings, next } = useSession()
  const step = sequence.steps[index]!
  const after = sequence.steps[index + 1]
  const timed = phase === 'praying' && (autoplay || handsFree)
  const waitForBody = following && after !== undefined && after.pose !== step.pose
  const ms = stepMs(step, settings.pace)

  useEffect(() => {
    if (!timed || waitForBody) return
    const id = setTimeout(next, ms)
    return () => clearTimeout(id)
  }, [timed, waitForBody, ms, index, next])

  return timed && !waitForBody ? ms : null
}

function useKeyboard(toggleHandsFree: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, [role="dialog"], [role="radiogroup"], [role="toolbar"]')) return
      const s = useSession.getState()
      const rtl = document.documentElement.dir === 'rtl'
      const forward = rtl ? 'ArrowLeft' : 'ArrowRight'
      const back = rtl ? 'ArrowRight' : 'ArrowLeft'
      if ((e.key === ' ' || e.key === 'Enter') && el.tagName === 'BUTTON') return // let the button handle it
      if (e.key === ' ' || e.key === forward || e.key === 'Enter') {
        e.preventDefault()
        s.next()
      } else if (e.key === back) {
        e.preventDefault()
        s.prev()
      } else if (e.key === 'p' || e.key === 'P') {
        if (!s.handsFree) s.setAutoplay(!s.autoplay)
      } else if (e.key === 'h' || e.key === 'H') {
        toggleHandsFree()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleHandsFree])
}

function SwitchPrayerDialog({ pending, onClose }: { pending: PrayerId | null; onClose: () => void }) {
  const t = useT()
  const { prayer, sequence, index, choosePrayer } = useSession()
  const rakah = sequence.steps[index]?.rakah ?? 1
  const to = pending ? t(`prayer.${pending}`) : ''
  return (
    <AlertDialog.Root open={pending !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="sheet-overlay fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 animate-pop rounded-2xl border border-line bg-raised p-5 shadow-2xl">
          <AlertDialog.Title className="text-base font-semibold text-ink">{t('switch.title', { prayer: to })}</AlertDialog.Title>
          <AlertDialog.Description className="mt-1.5 text-sm leading-relaxed text-ink-soft">
            {t('switch.body', { r: rakah, from: t(`prayer.${prayer}`), to })}
          </AlertDialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="quiet">{t('switch.keep')}</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button variant="primary" onClick={() => pending && choosePrayer(pending)}>
                {t('switch.confirm')}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
