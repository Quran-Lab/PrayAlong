import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { AlertDialog, Tooltip as RadixTooltip } from 'radix-ui'
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { CameraBubble, HandsFreeButton, isFollowing } from '@/components/HandsFree'
import { Logo } from '@/components/Logo'
import { CompletePanel, ReadyPanel } from '@/components/Panels'
import { PostureDock } from '@/components/PostureDock'
import { PrayerChips, PrayerMenu } from '@/components/PrayerSelector'
import { Recitation } from '@/components/Recitation'
import { SettingsPopover } from '@/components/SettingsPopover'
import { CHARACTERS, DEFAULT_CHARACTER } from '@/components/stage/characters'
import type { PoseName } from '@/components/stage/rig/prayer-poses'
import { Button } from '@/components/ui/primitives'
import { PRAYER_BY_ID } from '@/content/prayers'
import { useHandsFree } from '@/handsfree/use-hands-free'
import { useMedia, useReducedMotion } from '@/lib/use-media'
import { usePrayerClock } from '@/lib/use-prayer-clock'
import { useWakeLock } from '@/lib/use-wake-lock'
import type { PrayerId } from '@/sequence/types'
import { PACE_FACTOR, currentStep, useSession } from '@/state/session'

// The 3D stack is the heaviest part of the app; let the UI paint first.
const CompanionStage = lazy(() => import('@/components/stage/CompanionStage').then((m) => ({ default: m.CompanionStage })))

export function App() {
  const clock = usePrayerClock()
  const session = useSession()
  const { phase, prayer, settings, handsFree } = session
  const step = currentStep(session)
  const wide = useMedia('(min-width: 900px)')
  const reducedMotion = useReducedMotion()
  const [characterId, setCharacterId] = useState(DEFAULT_CHARACTER.id)
  const character = CHARACTERS.find((c) => c.id === characterId) ?? DEFAULT_CHARACTER
  const [stageReady, setStageReady] = useState(false)
  const [pendingSwitch, setPendingSwitch] = useState<PrayerId | null>(null)

  const hands = useHandsFree(handsFree, session.onPose)
  const following = handsFree && isFollowing(hands.status)
  const toggleHandsFree = useCallback(() => useSession.getState().setHandsFree(!useSession.getState().handsFree), [])

  // Each prayer tints the room like its time of day.
  const ambient = PRAYER_BY_ID[prayer].ambient
  useEffect(() => document.documentElement.style.setProperty('--ambient', ambient), [ambient])

  useWakeLock(phase === 'praying')
  const timedMs = useStepTimer(following)
  useKeyboard(toggleHandsFree)

  const posture: PoseName = phase === 'ready' ? 'rest' : phase === 'complete' ? 'jalsah' : step.posture

  return (
    <MotionConfig reducedMotion="user">
      <RadixTooltip.Provider>
        <div className="relative flex h-dvh flex-col overflow-hidden bg-canvas">
          {/* Header */}
          <header className="relative z-20 flex h-16 shrink-0 items-center gap-3 border-b border-line px-4 sm:h-[4.5rem] sm:px-6">
            <div className="flex flex-1 items-center">
              <Logo compact={!wide} />
            </div>
            {wide ? <PrayerChips clock={clock} onRequestSwitch={setPendingSwitch} /> : <PrayerMenu clock={clock} onRequestSwitch={setPendingSwitch} />}
            <div className="flex flex-1 items-center justify-end gap-1.5 sm:gap-2">
              <SettingsPopover clock={clock} characterId={characterId} onCharacter={setCharacterId} />
              <HandsFreeButton on={handsFree} status={hands.status} onToggle={toggleHandsFree} compact={!wide} />
            </div>
          </header>

          {/* Stage */}
          <main className="relative flex min-h-0 flex-1 flex-col">
            <div className="relative min-h-0 flex-1">
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
                    <span className="animate-breathe">Preparing your companion…</span>
                  </motion.div>
                )}
              </AnimatePresence>
              {/* Soft fade so the stage melts into the text below. */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-canvas to-transparent" />
              <div className="absolute top-3 right-3 z-10 sm:top-4 sm:right-5">
                <AnimatePresence>{handsFree && <CameraBubble stream={hands.stream} status={hands.status} pose={hands.pose} />}</AnimatePresence>
              </div>
            </div>

            <section className="relative z-10 flex min-h-[13rem] shrink-0 items-start justify-center pb-3 sm:min-h-[14rem]">
              <AnimatePresence mode="wait">
                {phase === 'ready' && <ReadyPanel key="ready" clock={clock} handsFree={handsFree} onHandsFree={toggleHandsFree} />}
                {phase === 'praying' && (
                  <motion.div key="praying" className="w-full" exit={{ opacity: 0 }}>
                    <Recitation step={step} settings={settings} timedMs={timedMs} />
                  </motion.div>
                )}
                {phase === 'complete' && <CompletePanel key="complete" clock={clock} />}
              </AnimatePresence>
            </section>
          </main>

          {/* Dock */}
          <footer className="relative z-10 shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-6">
            <PostureDock following={following} />
          </footer>
        </div>

        <SwitchPrayerDialog pending={pendingSwitch} onClose={() => setPendingSwitch(null)} />
      </RadixTooltip.Provider>
    </MotionConfig>
  )
}

/**
 * Moves through lines on its own when the user asked for guidance, or when
 * hands-free is on (within a posture — the body decides when to move on).
 * Returns the current line's duration so the UI can show a gentle timer.
 */
function useStepTimer(following: boolean): number | null {
  const { phase, index, sequence, autoplay, handsFree, settings, next } = useSession()
  const step = sequence.steps[index]!
  const after = sequence.steps[index + 1]
  // Hands-free without a working camera/model falls back to timed guidance.
  const timed = phase === 'praying' && (autoplay || handsFree)
  const waitForBody = following && after !== undefined && after.pose !== step.pose
  const ms = Math.max(step.timing.minMs, step.timing.expectedMs * PACE_FACTOR[settings.pace])

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
      if (el.closest('input, textarea, [role="dialog"], [role="radiogroup"]')) return
      const s = useSession.getState()
      const onButton = el.tagName === 'BUTTON'
      if ((e.key === ' ' || e.key === 'Enter') && onButton) return // let the button handle it
      if (e.key === ' ' || e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault()
        s.next()
      } else if (e.key === 'ArrowLeft') {
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
  const { prayer, sequence, index, choosePrayer } = useSession()
  const rakah = sequence.steps[index]?.rakah ?? 1
  return (
    <AlertDialog.Root open={pending !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 animate-pop rounded-2xl border border-line bg-raised p-5 shadow-2xl">
          <AlertDialog.Title className="text-base font-semibold text-ink">Switch to {pending && PRAYER_BY_ID[pending].name}?</AlertDialog.Title>
          <AlertDialog.Description className="mt-1.5 text-sm leading-relaxed text-ink-soft">
            You’re in rak‘ah {rakah} of {PRAYER_BY_ID[prayer].name}. Switching starts {pending && PRAYER_BY_ID[pending].name} from the beginning.
          </AlertDialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="quiet">Keep praying</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button variant="primary" onClick={() => pending && choosePrayer(pending)}>
                Switch
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
