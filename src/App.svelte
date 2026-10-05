<script lang="ts">
  import Settings2 from '@lucide/svelte/icons/settings-2'
  import Video from '@lucide/svelte/icons/video'
  import VideoOff from '@lucide/svelte/icons/video-off'
  import { untrack } from 'svelte'
  import { expoOut } from 'svelte/easing'
  import { MediaQuery } from 'svelte/reactivity'
  import { fade, fly } from 'svelte/transition'
  import ConfirmDialog from '@/components/ConfirmDialog.svelte'
  import DemoBar from '@/components/DemoBar.svelte'
  import HandsFree from '@/components/HandsFree.svelte'
  import Mark from '@/components/Mark.svelte'
  import Panels from '@/components/Panels.svelte'
  import PostureDock from '@/components/PostureDock.svelte'
  import PrayerPicker from '@/components/PrayerPicker.svelte'
  import Recitation from '@/components/Recitation.svelte'
  import SettingsSheet from '@/components/SettingsSheet.svelte'
  import SetupSheet from '@/components/SetupSheet.svelte'
  import { characterById, outfitColor } from '@/components/stage/characters'
  import type { PoseName } from '@/components/stage/rig/prayer-poses'
  import Stage from '@/components/stage/Stage.svelte'
  import { handsFree } from '@/handsfree/hands-free.svelte'
  import { isFollowing } from '@/handsfree/types'
  import { i18n, t } from '@/i18n/i18n.svelte'
  import { applyPalette } from '@/lib/brand'
  import { chime } from '@/lib/chime'
  import { clock } from '@/lib/prayer-clock.svelte'
  import { holdWakeLock } from '@/lib/wake-lock'
  import type { PrayerId, Step } from '@/sequence/types'
  import { session, type Mode } from '@/state/session.svelte'
  import { resolveLine } from '@/content/lines'
  import { trackable } from '@/voice/asr/words'
  import { exampleOf, voice, type CoachKey } from '@/voice/voice.svelte'

  i18n.sync()
  // Start on the prayer that is due, so the first paint loads the right backdrop.
  session.autoSelectPrayer(clock.detected.id)
  clock.start()

  const wide = new MediaQuery('min-width: 1200px')
  const reducedMotion = new MediaQuery('prefers-reduced-motion: reduce')

  let pendingSwitch = $state<PrayerId | null>(null)
  let settingsOpen = $state(false)
  let setupOpen = $state(false)
  let demoAuto = $state(false)

  const character = $derived(characterById(session.settings.characterId))
  const following = $derived(session.handsFree && isFollowing(handsFree.status))
  const step = $derived(session.step)
  const posture: PoseName = $derived(session.phase === 'ready' ? 'rest' : session.phase === 'complete' ? 'jalsah' : step.posture === 'tashahhud' && step.rakah === session.sequence.rakahs ? 'tawarruk' : step.posture)
  const stepMs = (s: Step) => Math.max(s.timing.minMs, s.timing.expectedMs)

  // ——— hands-free
  handsFree.onPose = (pose) => session.onPose(pose)
  handsFree.connect(() => ({ enabled: session.handsFree, demo: session.demo }))
  // Developers and tests without a camera: ?demo drives hands-free from on-screen buttons.
  const devDemo = new URLSearchParams(location.search).has('demo')

  /** One prompt for the camera and the microphone, before either is opened. */
  async function askForCameraAndMic() {
    const audio = globalThis.crossOriginIsolated === true
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: true, audio })
      media.getTracks().forEach((track) => track.stop())
    } catch {
      /* each one asks again on its own, and falls back on its own */
    }
  }

  /** The learner picked how to pray: set up the camera (hands-free is on by default), then begin. */
  async function start(mode: Mode) {
    session.mode = mode
    if (session.settings.handsFree && devDemo) session.setDemo(true)
    else if (session.settings.handsFree) {
      setupOpen = true
      await askForCameraAndMic()
      session.setHandsFree(true)
    }
    void voice.listen() // follows the recitation wherever the browser can run it
    if (!session.settings.handsFree || devDemo) session.begin()
  }

  function toggleHandsFree() {
    const on = !session.settings.handsFree
    session.updateSettings({ handsFree: on })
    if (!on) return session.setHandsFree(false)
    if (session.phase === 'ready') return
    session.setHandsFree(true)
    setupOpen = true
  }
  // Raising the hands begins the prayer: the setup sheet steps aside.
  let lastPhase = session.phase
  $effect(() => {
    if (lastPhase === 'ready' && session.phase === 'praying') setupOpen = false
    lastPhase = session.phase
  })

  // ——— document language, direction, theme and colour; after the first paint, a change crossfades
  let painted = false
  function morph(change: () => void) {
    if (!painted || reducedMotion.current || !document.startViewTransition) return change()
    document.startViewTransition(change)
  }
  $effect(() => {
    const { locale, dir } = i18n
    morph(() => {
      document.documentElement.lang = locale
      document.documentElement.dir = dir
    })
  })
  $effect(() => {
    const theme = session.settings.theme
    morph(() => {
      if (theme === 'system') delete document.documentElement.dataset.theme
      else document.documentElement.dataset.theme = theme
    })
  })
  $effect(() => {
    const palette = session.settings.palette
    morph(() => applyPalette(palette))
  })
  $effect(() => {
    painted = true
  })

  $effect(() => {
    if (session.phase === 'praying') return holdWakeLock()
  })

  // ——— timed guidance: on request, or within a posture while hands-free follows the body
  const after = $derived(session.sequence.steps[session.index + 1])
  const timed = $derived(session.phase === 'praying' && (session.autoplay || session.handsFree))
  const waitForBody = $derived(following && after !== undefined && after.pose !== step.pose)

  // ——— voice: the coach says the movement and what to recite, then (watching first) the example
  // plays, then it is the learner's turn. Everything is spoken, so nobody has to read from the mat.
  let instructing = $state(false)
  let listening = $state(false)
  let turn = $state(false)
  const line = $derived(session.phase === 'praying' ? resolveLine(step.recitationId, i18n.locale) : null)
  const hearing = $derived(voice.asr === 'on' && line !== null && trackable(step.recitationId) && step.voice === 'aloud')
  const heard = $derived(hearing && line ? voice.heard(step.recitationId, line.arabic) : 0)
  const heardAll = $derived(hearing && line !== null && heard >= line.arabic.split(/\s+/).filter(Boolean).length)

  /** Speak a coach line: the rendered English clip, or the browser's voice for `voice.say.*`. */
  const say = (key: CoachKey, signal: AbortSignal) => voice.coach(key, i18n.locale, t(`voice.say.${key}`), signal)
  /** The coach line for a movement: standing up names the rak'ah. */
  const coachKey = (cue: string, rakah: number) => (cue === 'rise' ? `rise${rakah}` : cue) as CoachKey
  const pause = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      const id = setTimeout(resolve, ms)
      signal.addEventListener('abort', () => (clearTimeout(id), resolve()), { once: true })
    })

  // Each line: the movement (unless it was said ahead) and what to recite; when watching first,
  // the example; then the learner's turn. "Listen first" and "Now you" frame the first example.
  let saidAhead: string | null = null
  let heardExample = false
  $effect(() => {
    if (session.phase !== 'praying') return
    const s = step
    const ac = new AbortController()
    listening = false
    turn = false
    voice.newLine()
    untrack(() => {
      void (async () => {
        instructing = true
        const opening = session.index === 0 && saidAhead !== s.id
        if (opening) heardExample = false
        if (opening) await say('face', ac.signal)
        if (s.cue && saidAhead !== s.id) await say(coachKey(s.cue, s.rakah), ac.signal)
        if (s.say) await say(s.say, ac.signal)
        if (ac.signal.aborted) return
        instructing = false
        if (session.mode !== 'watch' || !exampleOf(s.recitationId)) return
        const first = !heardExample
        heardExample = true
        if (first) await say('listen', ac.signal)
        listening = true
        await voice.example(s.recitationId, ac.signal)
        if (ac.signal.aborted) return
        listening = false
        turn = true
        voice.newLine()
        if (first) await say('yourTurn', ac.signal)
      })()
    })
    return () => ac.abort()
  })

  // Following the body: once a block's lines are done, say the next movement before the learner makes it.
  $effect(() => {
    if (!waitForBody || listening || instructing || !after?.cue) return
    const ac = new AbortController()
    const next = after
    const id = setTimeout(() => {
      saidAhead = next.id
      void say(coachKey(next.cue!, next.rakah), ac.signal)
    }, heardAll ? 400 : stepMs(step))
    return () => {
      clearTimeout(id)
      ac.abort()
    }
  })

  // Hands-free, ready to begin: tell the learner how to stand and how to start.
  $effect(() => {
    if (session.phase !== 'ready' || !following) return
    const ac = new AbortController()
    void (async () => {
      await pause(800, ac.signal)
      if (ac.signal.aborted) return
      saidAhead = session.sequence.steps[0]?.id ?? null
      heardExample = false
      await say('face', ac.signal)
      await say('begin', ac.signal)
    })()
    return () => ac.abort()
  })
  // The prayer is complete: the remembrance right after it, with its example when watching first.
  $effect(() => {
    if (session.phase !== 'complete') return
    const ac = new AbortController()
    const watching = untrack(() => session.mode === 'watch')
    void (async () => {
      await say('complete', ac.signal)
      await say('afterPrayer', ac.signal)
      if (!watching || ac.signal.aborted) return
      await voice.example('istighfar', ac.signal)
      await pause(4500, ac.signal) // the learner's three times
      if (!ac.signal.aborted) await voice.example('antas-salam', ac.signal)
    })()
    return () => ac.abort()
  })

  // Following the recitation is part of praying with PrayAlong: the microphone opens with the prayer.
  $effect(() => {
    if (session.phase === 'praying') untrack(() => void voice.listen())
  })

  // The line's time starts after the qari. A line the ASR heard in full moves on a moment later.
  const timedMs = $derived(timed && !waitForBody && !listening && !instructing ? (heardAll ? 700 : stepMs(step)) : null)
  $effect(() => {
    if (timedMs === null) return
    void session.index
    const id = setTimeout(() => session.next(), timedMs)
    return () => clearTimeout(id)
  })

  // A soft chime when PrayAlong follows a movement, so nobody has to look up.
  let lastPosture: PoseName = 'rest'
  $effect(() => {
    if (posture !== lastPosture && following && session.phase !== 'ready') chime()
    lastPosture = posture
  })

  // The movement PrayAlong is waiting for next (guides the demo bar).
  const nextPose = $derived(
    session.phase === 'ready' ? 'hands-raised' : session.phase === 'praying' ? (session.sequence.steps.slice(session.index + 1).find((s) => s.pose !== step.pose)?.pose ?? null) : null,
  )

  // Demo autopilot: act out each movement once its lines are done.
  $effect(() => {
    if (!session.demo || !demoAuto || !session.handsFree) return
    if (session.phase === 'complete') return void (demoAuto = false)
    if (session.phase === 'praying' && (!after || after.pose === step.pose)) return // lines advance on their own
    const delay = session.phase === 'ready' ? 1200 : stepMs(step)
    const pose = nextPose
    const id = setTimeout(() => pose && handsFree.actOut(pose), delay)
    return () => clearTimeout(id)
  })

  function onKey(e: KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const el = e.target as HTMLElement
    if (el.closest('input, textarea, dialog, [role="radiogroup"], [role="toolbar"], [popover]')) return
    const rtl = document.documentElement.dir === 'rtl'
    if ((e.key === ' ' || e.key === 'Enter') && el.tagName === 'BUTTON') return // let the button handle it
    if (e.key === ' ' || e.key === (rtl ? 'ArrowLeft' : 'ArrowRight') || e.key === 'Enter') {
      e.preventDefault()
      if (session.phase === 'ready') void start(session.mode)
      else session.next()
    } else if (e.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) {
      e.preventDefault()
      session.prev()
    } else if (e.key === 'p' || e.key === 'P') {
      if (!session.handsFree) session.setAutoplay(!session.autoplay)
    } else if (e.key === 'h' || e.key === 'H') toggleHandsFree()
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="app">
  <header class="top">
    <a class="brand" href="./" aria-label="PrayAlong">
      <Mark size={20} />
      <span class="hide-phone">PrayAlong</span>
    </a>
    <PrayerPicker wide={wide.current} onrequestswitch={(id) => (pendingSwitch = id)} />
    <div class="actions">
      <button type="button" class="btn sm label" onclick={() => (settingsOpen = true)} aria-label={t('header.settings')}>
        <Settings2 size={18} /><span class="hide-narrow">{t('header.settings')}</span>
      </button>
      <button type="button" class="btn sm label" aria-pressed={session.settings.handsFree} onclick={toggleHandsFree} title="{session.settings.handsFree ? t('hf.tipOn') : t('hf.tipOff')} {t('hf.private')} (H)">
        {#if session.settings.handsFree}<Video size={18} />{:else}<VideoOff size={18} />{/if}
        <span class="hide-narrow">{t('hf.button')}</span>
        {#if following}<i class="live" aria-hidden="true"></i>{/if}
      </button>
    </div>
  </header>

  <main>
    <div class="stage-area">
      <Stage prayer={session.prayer} {posture} {character} palette={session.settings.palette} outfit={outfitColor(session.settings.outfit)} reducedMotion={reducedMotion.current}>
        <div class="overlay top-end">
          {#if session.handsFree && !setupOpen}
            <HandsFree onopen={() => (setupOpen = true)} />
          {/if}
        </div>
        <div class="overlay bottom">
          {#if session.handsFree && session.demo}
            <DemoBar current={handsFree.pose} expected={nextPose} auto={demoAuto} onact={handsFree.actOut} onauto={(on) => (demoAuto = on)} />
          {/if}
        </div>
      </Stage>
    </div>

    <!-- Ready, praying and complete share one place: each arrives as the last one leaves. -->
    <section class="words" class:complete={session.phase === 'complete'}>
      {#key session.phase}
        <div class="phase" in:fly={{ y: 10, duration: 420, delay: 140, easing: expoOut }} out:fade={{ duration: 140 }}>
          {#if session.phase === 'praying'}
            <Recitation {timedMs} distance={following} {listening} {turn} {heard} {hearing} />
          {:else}
            <Panels kind={session.phase} onstart={start} />
          {/if}
        </div>
      {/key}
    </section>
  </main>

  <footer>
    <PostureDock {following} />
  </footer>
</div>

<SettingsSheet bind:open={settingsOpen} />
<SetupSheet
  bind:open={() => setupOpen && session.settings.handsFree && !session.demo, (v) => (setupOpen = v)}
  onbegin={() => {
    setupOpen = false
    if (session.phase === 'ready') session.begin()
  }}
/>
<ConfirmDialog bind:pending={pendingSwitch} />

<style>
  .app {
    /* One column for the header, the photograph, the line and the dock, so their edges line up;
       one gap between them. */
    --column: 1200px;
    --gap: var(--space-4);
    display: flex;
    flex-direction: column;
    height: 100%;
    height: 100dvh;
    /* clip, not hidden: focus and scrollIntoView must never scroll the whole app. */
    overflow: clip;
  }
  .top,
  main,
  footer {
    width: min(100% - 2 * var(--gutter), var(--column));
    margin-inline: auto;
  }
  .top {
    flex: none;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: var(--space-3);
    height: 64px;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    justify-self: start;
    color: var(--ink);
    font-size: 17px;
    font-weight: 600;
    text-decoration: none;
  }
  .actions {
    display: flex;
    justify-self: end;
    gap: var(--space-2);
  }
  .label {
    position: relative;
  }
  .live {
    position: absolute;
    top: 6px;
    inset-inline-end: 6px;
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full);
    background: var(--brand);
  }
  main {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--gap);
  }
  .stage-area {
    flex: 1 1 0;
    min-height: max(160px, 26svh);
  }
  .overlay {
    position: absolute;
    z-index: 10;
  }
  .top-end {
    top: 12px;
    inset-inline-end: 12px;
  }
  .bottom {
    inset-inline: 0;
    bottom: 12px;
    display: flex;
    justify-content: center;
    padding-inline: 12px;
  }
  /* The same height for every line and both panels: the photograph above never moves while
     praying. Text fits itself to it (lib/fit.ts). */
  .words {
    flex: 0 1 auto;
    height: clamp(220px, 52%, 460px);
    min-height: 200px;
    display: grid;
    grid-template: minmax(0, 1fr) / minmax(0, 1fr);
  }
  .phase {
    grid-area: 1 / 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  footer {
    flex: none;
    padding-block: var(--gap) max(var(--gap), env(safe-area-inset-bottom));
  }
  @media (max-width: 719px) {
    .hide-narrow {
      display: none;
    }
    .label {
      width: 40px;
      padding: 0;
    }
  }
  @media (max-width: 479px) {
    .hide-phone {
      display: none;
    }
    .app {
      --gap: var(--space-3);
    }
    .top {
      height: 56px;
    }
    .words {
      height: clamp(200px, 56%, 460px);
      transition: height 520ms cubic-bezier(0.32, 0.72, 0, 1);
    }
    /* After the prayer the photograph steps back for the remembrance. */
    .words.complete {
      height: clamp(200px, 74%, 580px);
    }
  }
  /* Phones on their side: stage and words side by side. */
  @media (orientation: landscape) and (max-height: 540px) {
    .top {
      height: 48px;
    }
    main {
      flex-direction: row;
    }
    .stage-area {
      min-height: 0;
    }
    .words {
      flex: none;
      width: 52%;
      height: auto;
      min-height: 0;
    }
    footer {
      padding-block: 8px;
    }
  }
</style>
