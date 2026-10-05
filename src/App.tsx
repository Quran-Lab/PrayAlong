import { Settings2, Wind } from 'lucide-react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { AlertDialog, Direction, Tooltip as RadixTooltip } from 'radix-ui'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { CameraBubble, DemoBar, HandsFreeButton } from '@/components/HandsFree'
import { ListenButton } from '@/components/ListenButton'
import { Logo } from '@/components/Logo'
import { useCompanionSpeaking } from '@/audio/engine'
import { useCompanionAudio } from '@/audio/use-companion-audio'
import { CompletePanel, ReadyPanel } from '@/components/Panels'
import { PostureDock } from '@/components/PostureDock'
import { PrayerChips, PrayerMenu } from '@/components/PrayerSelector'
import { Recitation } from '@/components/Recitation'
import { SettingsSheet } from '@/components/SettingsSheet'
import { SetupSheet } from '@/components/SetupSheet'
import { CHARACTERS, DEFAULT_CHARACTER } from '@/components/stage/characters'
import { Scenery } from '@/components/stage/Scenery'
import type { PoseName } from '@/components/stage/rig/prayer-poses'
import { Button } from '@/components/ui/primitives'
import { PRAYER_BY_ID } from '@/content/prayers'
import { getLine } from '@/content/recitations'
import { isFollowing } from '@/handsfree/types'
import { useHandsFree } from '@/handsfree/use-hands-free'
import { LOCALES, useLocale, useT } from '@/i18n'
import { chime } from '@/lib/chime'
import { useMedia, useReducedMotion } from '@/lib/use-media'
import { usePrayerClock } from '@/lib/use-prayer-clock'
import { useWakeLock } from '@/lib/use-wake-lock'
import type { PrayerId, Step } from '@/sequence/types'
import { PACE_FACTOR, currentStep, useSession } from '@/state/session'
import { optionalWords, useBurstFollow } from '@/voice/burst'
import { useVoiceFollow } from '@/voice/use-voice' // [voice]
import { prefetchVoiceModelWhenIdle } from '@/voice/engine' // [voice]

// The 3D stack is the heaviest part of the app; let the UI paint first.
const CompanionStage = lazy(() => import('@/components/stage/CompanionStage').then((m) => ({ default: m.CompanionStage })))

/** How long hands-free waits for a movement it cannot see before moving on anyway. */
const BODY_GRACE_MS = 6000
/** Listen mode: after the line before a movement is done, how long to wait for its takbir. */
const MOVE_GRACE_MS = 3000
/** Listen mode: no progress after the last word of a line for this long: move on. */
const STUCK_MS = 7000
/** Listen mode: how long a finished line stays on screen, fully lit, after the next starts. */
const LINE_HOLD_MS = 260

const stepMs = (step: Step, pace: keyof typeof PACE_FACTOR) => Math.max(step.timing.minMs, step.timing.expectedMs * PACE_FACTOR[pace])

/** Wind with a slash: ambience muted. */
function WindOff({ className }: { className?: string }) {
  return (
    <span className={`relative inline-grid ${className ?? ''}`}>
      <Wind className="size-full" />
      <span className="absolute top-1/2 left-1/2 h-[2px] w-[120%] -translate-x-1/2 -translate-y-1/2 -rotate-45 rounded bg-current" />
    </span>
  )
}

export function App() {
  const t = useT()
  const locale = useLocale()
  const dir = LOCALES[locale].dir
  const clock = usePrayerClock()
  const session = useSession()
  const { phase, prayer, settings, handsFree, demo, index, sequence } = session
  const step = currentStep(session)
  const wide = useMedia('(min-width: 1024px)')
  const wideLayout = useMedia('(min-width: 1100px) and (min-aspect-ratio: 5/4)')
  const short = useMedia('(orientation: landscape) and (max-height: 540px)')
  const reducedMotion = useReducedMotion()
  const character = CHARACTERS.find((c) => c.id === settings.characterId) ?? DEFAULT_CHARACTER
  const [stageReady, setStageReady] = useState(false)
  // The page's window follows where the companion is drawn (any language direction).
  const [anchorX, setAnchorX] = useState<number | null>(null)
  const [pendingSwitch, setPendingSwitch] = useState<PrayerId | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user')
  const [demoAuto, setDemoAuto] = useState(false)

  const hands = useHandsFree({
    enabled: handsFree,
    demo,
    facingMode,
    steps: sequence.steps,
    phase,
    index,
    onPose: session.onPose,
    onAdvance: session.followTo,
  })
  const following = handsFree && isFollowing(hands.status)

  // [voice] begin: microphone engine (src/voice, docs/voice.md). Mic only: the
  // voice leads lines and postures; with the camera following: lines only.
  // Turned on from the Listen button (a click, so the microphone can start).
  const [voiceOn, setVoiceOn] = useState(() => new URLSearchParams(location.search).has('voice'))
  // Pausing listening pauses the prayer (it waits for you); it never silently switches to the timer.
  const setListen = useCallback((on: boolean | ((v: boolean) => boolean)) => {
    setVoiceOn((prev) => {
      const next = typeof on === 'function' ? on(prev) : on
      if (!next) useSession.getState().setAutoplay(false)
      return next
    })
  }, [])
  const companionSpeaking = useCompanionSpeaking()
  // The step whose line was last heard finished (for the short wait before a movement).
  const [doneStep, setDoneStep] = useState(-1)
  const voice = useVoiceFollow({
    enabled: voiceOn,
    mode: following ? 'lines' : 'full',
    ignoreCompanion: true,
    companionSpeaking,
    record: settings.recordSessions,
    onEvent: (e) => {
      if (e.kind === 'lineDone') setDoneStep(e.step)
    },
    // [hands-free] heard movement phrases help the camera decide (lines stay with the voice driver).
    onEvidence: (e) => (e.kind === 'takbir' || e.kind === 'tasmi' || e.kind === 'salam') && hands.addEvidence({ kind: e.kind, confidence: e.confidence, at: e.at }),
  })
  const voiceDriving = voiceOn && voice.status === 'listening'
  // [voice] Load the speech model while the page is idle (and again after listening
  // stops), so Listen is ready at once and nothing said after Begin is lost to loading.
  useEffect(() => (voiceOn ? undefined : prefetchVoiceModelWhenIdle()), [voiceOn])
  // Speech-burst follow: counts lines and repetitions from when you speak, for the
  // moments the phoneme follower loses you (short lines, garbled takbirs, tasbih x3).
  const onStep = voiceDriving && voice.cursor?.step === index ? voice.cursor : null
  const burst = useBurstFollow({
    enabled: voiceDriving && phase === 'praying',
    index,
    speaking: voice.speaking,
    follower: onStep ? { wordIndex: onStep.wordIndex, repsDone: onStep.repsDone } : null,
    followerDone: doneStep === index,
    log: (m) => localStorage.getItem('prayalong:voiceDebug') !== '0' && console.log(`%c${m}`, 'color:#e0a050'),
  })
  // The follower counts the optional basmala before a surah as words of its first verse.
  const skip = optionalWords(sequence.steps[index]?.recitationId ?? '')
  // Listen mode: when a line is finished and the next begins, keep the finished line on
  // screen fully green for a moment, so the last word is seen as said.
  const [shownIndex, setShownIndex] = useState(index)
  useEffect(() => {
    if (voiceDriving && index === shownIndex + 1) {
      const id = setTimeout(() => setShownIndex(index), LINE_HOLD_MS)
      return () => clearTimeout(id)
    }
    setShownIndex(index)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, voiceDriving])
  const held = shownIndex !== index && phase === 'praying'
  // Listen mode safety net: the last word of the line is done (fill 1) but the follower has
  // made no progress for a while (e.g. a repeated tasbih it fails to count): move on.
  const cursorKey = voice.cursor ? `${voice.cursor.step}:${voice.cursor.rep}:${voice.cursor.wordIndex}:${voice.cursor.fill >= 0.99}` : ''
  useEffect(() => {
    if (!voiceDriving || phase !== 'praying' || !voice.cursor || voice.cursor.step !== index || voice.cursor.fill < 0.99) return
    const s = useSession.getState()
    const step = s.sequence.steps[index]
    if (!step || voice.cursor.wordIndex < getLine(step.recitationId).arabic.split(/\s+/).filter(Boolean).length - 1) return
    // Repeated lines: the voice driver waits for every repetition (or 6 s of silence).
    if (voice.cursor.repsDone < step.repeat) return
    const at = index
    const id = setTimeout(() => {
      if (useSession.getState().index === at) {
        if (localStorage.getItem('prayalong:voiceDebug') !== '0') console.log('[voice] stuck after last word, advancing', at)
        useSession.getState().next()
      }
    }, STUCK_MS)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceDriving, phase, index, cursorKey])

  // Listen mode: the line before a movement is finished but "Allāhu Akbar" (or the tasmi') was
  // not heard: move on after a short pause rather than making anyone wait.
  useEffect(() => {
    if (!voiceDriving || phase !== 'praying' || doneStep !== index) return
    const s = useSession.getState()
    const step = s.sequence.steps[index]
    const after = s.sequence.steps[index + 1]
    if (!step || !after || after.posture === step.posture) return
    const at = index
    const id = setTimeout(() => {
      if (useSession.getState().index === at) {
        if (localStorage.getItem('prayalong:voiceDebug') !== '0') console.log('[voice] movement fallback advance after line done', at)
        useSession.getState().next()
      }
    }, MOVE_GRACE_MS)
    return () => clearTimeout(id)
  }, [voiceDriving, phase, doneStep, index])
  // Every prayer starts in Listen mode, with or without the camera (the click or key that begins it lets the mic start).
  const prevPhase = useRef(phase)
  useEffect(() => {
    if (prevPhase.current === 'ready' && phase === 'praying') setVoiceOn(true)
    prevPhase.current = phase
  }, [phase])
  // If listening cannot start (no mic, permission denied, model failed), guide by time instead.
  useEffect(() => {
    if (voiceOn && voice.status === 'error' && phase === 'praying') useSession.getState().setAutoplay(true)
  }, [voiceOn, voice.status, phase])
  // [voice] end

  const toggleHandsFree = useCallback(() => {
    const s = useSession.getState()
    if (s.handsFree) return s.setHandsFree(false)
    s.setHandsFree(true)
    if (!s.demo) setSetupOpen(true)
  }, [])

  // Deep link: /?prayer=maghrib opens that prayer.
  useEffect(() => {
    const p = new URLSearchParams(location.search).get('prayer') as PrayerId | null
    if (p && p in PRAYER_BY_ID) useSession.getState().choosePrayer(p)
  }, [])

  // Language and direction for the whole document.
  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = dir
  }, [locale, dir])

  // Each prayer tints the room like its time of day.
  const ambient = PRAYER_BY_ID[prayer].ambient
  useEffect(() => {
    document.documentElement.dataset.prayer = prayer
  }, [prayer])

  useWakeLock(phase === 'praying')
  const { speaking, audioMs } = useCompanionAudio({ phase, step, next: sequence.steps[index + 1], prayer, voice: character.id, locale, settings, listen: voiceOn })
  // [hands-free] The body decides when to change posture. If the camera has
  // lost the person for 8 s, time takes over again, except in sujud (a head
  // too close to the lens is normal there): hold.
  const appTimedMs = useStepTimer(following && (!hands.lost || hands.hold), audioMs, voiceDriving)
  // In Listen mode you lead: no countdown on screen (the quiet timer fallback still runs underneath).
  const timedMs = voiceDriving ? null : appTimedMs

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
            <header className="relative z-20 flex h-16 shrink-0 items-center gap-3 px-4 sm:h-[4.5rem] sm:px-6 short:h-12">
              <div className="flex flex-1 items-center">
                <button
                  onClick={() => useSession.getState().restart()}
                  aria-label={t('nav.home')}
                  className="cursor-pointer rounded-xl focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-4"
                >
                  <Logo compact={!wide} />
                </button>
              </div>
              {wide ? <PrayerChips clock={clock} onRequestSwitch={setPendingSwitch} /> : <PrayerMenu clock={clock} onRequestSwitch={setPendingSwitch} />}
              <div className="flex flex-1 items-center justify-end gap-1.5 sm:gap-2">
                <Button
                  variant="quiet"
                  size="icon"
                  aria-label={settings.ambience ? t('ambience.mute') : t('ambience.unmute')}
                  aria-pressed={!settings.ambience}
                  onClick={() => session.updateSettings({ ambience: !settings.ambience })}
                >
                  {settings.ambience ? <Wind className="size-[18px]" /> : <WindOff className="size-[18px] opacity-60" />}
                </Button>
                <Button variant="quiet" size="icon" aria-label={t('settings.title')} onClick={() => setSettingsOpen(true)}>
                  <Settings2 className="size-[18px]" />
                </Button>
                {voice.recording && (
                  <Button variant="ghost" size="md" onClick={() => void voice.saveRecording()} aria-label={t('listen.save')}>
                    <span className="size-2 rounded-full bg-red-400" />
                    {wide && t('listen.save')}
                  </Button>
                )}
                <ListenButton on={voiceOn} status={voice.status} error={voice.error} progress={voice.progress} onToggle={() => setListen((v) => !v)} compact={!wide} />
                <HandsFreeButton on={handsFree} status={hands.status} onToggle={toggleHandsFree} compact={!wide} />
              </div>
            </header>

            {/* Stage */}
            <main className="relative flex min-h-0 flex-1 flex-col short:flex-row wide:flex-row">
              {/* The room spans the page; on wide screens its window sits behind the companion. */}
              {(wideLayout || short) && <Scenery prayer={prayer} windowX={anchorX ?? (dir === 'rtl' ? 100 - (wideLayout ? 26.5 : 24) : wideLayout ? 26.5 : 24)} />}
              <div className="relative min-h-0 min-w-0 flex-1 wide:flex-[1.12]">
                <Suspense>
                  <CompanionStage
                    posture={posture}
                    character={character}
                    ambient={ambient}
                    prayer={prayer}
                    scenery={!(wideLayout || short)}
                    onAnchor={wideLayout || short ? setAnchorX : undefined}
                    raiseHands={settings.raiseHands}
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
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-canvas to-transparent wide:hidden" />
                <div className="absolute end-3 top-3 z-10 sm:end-5 sm:top-4">
                  <AnimatePresence>
                    {handsFree && !setupOpen && (
                      <CameraBubble
                        stream={hands.stream}
                        status={hands.status}
                        pose={hands.pose}
                        framing={hands.framing}
                        expected={phase === 'complete' ? null : (hands.expectedPosture ?? null)}
                        progress={hands.progress}
                        blocker={hands.blocker}
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

              <section className="relative z-10 flex min-h-[34%] shrink-0 items-start justify-center pb-3 short:min-h-0 short:w-[52%] short:items-center short:overflow-y-auto short:py-3 wide:min-h-0 wide:flex-1 wide:items-center wide:pe-[3vw] wide:ps-[1vw] wide:pb-0">
                <AnimatePresence mode="wait">
                  {phase === 'ready' && <ReadyPanel key="ready" clock={clock} handsFree={handsFree} onHandsFree={toggleHandsFree} />}
                  {phase === 'praying' && (
                    <motion.div key="praying" className="w-full" exit={{ opacity: 0 }}>
                      <Recitation step={held ? sequence.steps[shownIndex]! : step} next={sequence.steps[shownIndex + 1]} timedMs={timedMs} distance={following} speaking={speaking}
                        heardWord={held ? 9999 : onStep ? (onStep.wordIndex < skip ? -1 : onStep.wordIndex - skip) : null}
                        heardRep={held ? sequence.steps[shownIndex]!.repeat : voiceDriving ? Math.max(onStep?.repsDone ?? 0, burst.reps) : null}
                        heardFill={held ? 1 : onStep ? (onStep.wordIndex < skip ? 0 : onStep.fill) : null}
                        listening={voiceDriving}
                      />
                    </motion.div>
                  )}
                  {phase === 'complete' && <CompletePanel key="complete" clock={clock} />}
                </AnimatePresence>
              </section>
            </main>

            {/* Dock */}
            <footer className="relative z-10 shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-6 short:pb-2">
              <PostureDock following={following} listening={voiceOn && voice.status !== 'error'} listenLoading={voiceOn && voice.status === 'loading'} onListen={setListen} />
            </footer>
          </div>

          <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} clock={clock} />
          <SetupSheet
            open={setupOpen && handsFree && !demo}
            onOpenChange={setSetupOpen}
            status={hands.status}
            stream={hands.stream}
            framing={hands.framing}
            blocker={hands.blocker}
            calibrated={hands.calibrated}
            check={hands.check}
            onCheck={hands.startCheck}
            engineLabel={hands.engineLabel}
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
function useStepTimer(following: boolean, audioMs: number | null, voiceDriving = false): number | null {
  const { phase, index, sequence, autoplay, handsFree, settings, next } = useSession()
  const step = sequence.steps[index]!
  const after = sequence.steps[index + 1]
  // [voice] the voice driver keeps its own (speech-aware) timers.
  const timed = phase === 'praying' && (autoplay || handsFree) && !voiceDriving
  const waitForBody = following && after !== undefined && after.pose !== step.pose
  // When the companion recites, never cut it short; leave a breath after.
  const ms = audioMs !== null ? Math.max(audioMs + 700, step.timing.minMs) : stepMs(step, settings.pace)

  useEffect(() => {
    if (!timed) return
    // Waiting for the body: if the camera misses the movement, never stall;
    // carry on a few seconds after the line is done.
    const id = setTimeout(next, waitForBody ? ms + BODY_GRACE_MS : ms)
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
