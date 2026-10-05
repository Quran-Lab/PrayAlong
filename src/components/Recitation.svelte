<script lang="ts">
  import CornerDownRight from '@lucide/svelte/icons/corner-down-right'
  import Mic from '@lucide/svelte/icons/mic'
  import Volume1 from '@lucide/svelte/icons/volume-1'
  import Volume2 from '@lucide/svelte/icons/volume-2'
  import VolumeX from '@lucide/svelte/icons/volume-x'
  import { resolveLine } from '@/content/lines'
  import { isQuran } from '@/content/recitations'
  import { i18n, t } from '@/i18n/i18n.svelte'
  import { fitText } from '@/lib/fit'
  import { sourceText } from '@/lib/source-text'
  import { display, session } from '@/state/session.svelte'
  import { arabicWords } from '@/voice/asr/words'

  let {
    timedMs,
    distance = false,
    listening = false,
    turn = false,
    heard = 0,
    hearing = false,
  }: {
    timedMs: number | null
    /** Reading from across the room (hands-free): one size up. */
    distance?: boolean
    /** The qari is reciting this line. */
    listening?: boolean
    /** The learner's turn, after the qari. */
    turn?: boolean
    /** Arabic words of this line the ASR has heard. */
    heard?: number
    /** The ASR is listening. */
    hearing?: boolean
  } = $props()

  const LARGER = { m: 'l', l: 'xl', xl: 'xl' } as const
  const SCALE = { m: 0.86, l: 1, xl: 1.16 } as const
  const size = $derived(distance ? LARGER[session.settings.textSize] : session.settings.textSize)
  const show = $derived(display(session.settings, i18n.locale))
  // What changes a card's text without changing the card: fit it again.
  const fitKey = $derived(`${size}|${show.arabic}|${show.transliteration}|${show.translation}|${i18n.locale}`)

  // The current line and its neighbours, as cards on a track one card wide. The neighbours wait
  // just outside it and slide in; a swipe pulls them into view. A jump (from the dock) pushes the
  // whole set the way the prayer went, so cards never pile up in one place.
  let lastIndex = session.index
  let travel = 1
  const steps = $derived(session.sequence.steps)
  const cards = $derived.by(() => {
    const index = session.index
    if (index !== lastIndex) {
      travel = index > lastIndex ? 1 : -1
      lastIndex = index
    }
    return [-1, 0, 1]
      .map((o) => ({ o, i: index + o }))
      .filter(({ i }) => i >= 0 && i < steps.length)
      .map(({ o, i }) => {
        const step = steps[i]!
        const line = resolveLine(step.recitationId, i18n.locale)
        const arabicHero = show.arabic && !show.transliteration
        return {
          o,
          i,
          step,
          line,
          arabicHero,
          long: (arabicHero ? line.arabic : line.transliteration).length > 42,
          source: sourceText(line.source, t, show.translation ? line.credit : undefined),
        }
      })
  })

  const EASE = (x: number) => 1 - Math.pow(1 - x, 4)
  /** In from the side the prayer is heading to; out to the side it came from. */
  function push(_node: Element, { from }: { from: 'ahead' | 'behind' }) {
    const side = (from === 'ahead' ? travel : -travel) * (i18n.dir === 'rtl' ? -1 : 1)
    return {
      duration: 520,
      easing: EASE,
      css: (_t: number, u: number) => `transform: translateX(calc(${(u * side).toFixed(4)} * (100% + var(--gap))))`,
    }
  }

  // ——— swipe (touch, pen or mouse drag) to move between lines
  let drag = $state(0)
  let dragging = $state(false)
  let start: { x: number; y: number; id: number } | null = null
  const SWIPE = 56

  function down(e: PointerEvent) {
    if (e.button !== 0) return
    start = { x: e.clientX, y: e.clientY, id: e.pointerId }
  }
  function move(e: PointerEvent) {
    if (!start || e.pointerId !== start.id) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (!dragging && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      dragging = true
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    }
    // Nothing before the first line: the card gives a little, then holds.
    const back = (i18n.dir === 'rtl' ? -1 : 1) * Math.sign(dx) > 0
    if (dragging) drag = back && session.index === 0 ? dx * 0.25 : dx
  }
  function up(e: PointerEvent) {
    if (!start || e.pointerId !== start.id) return
    start = null
    if (!dragging) return
    const forward = (i18n.dir === 'rtl' ? 1 : -1) * Math.sign(drag)
    if (Math.abs(drag) > SWIPE) forward > 0 ? session.next() : session.prev()
    dragging = false
    drag = 0
  }
</script>

<div
  class="viewport"
  class:dragging
  style:--scale={SCALE[size]}
  style:--drag="{drag}px"
  role="group"
  aria-roledescription={t('line.carousel')}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
>
  <div class="track">
    {#each cards as c (c.step.id)}
      {@const current = c.o === 0}
      <article
        class="card"
        class:current
        data-line={c.step.recitationId}
        data-rakah={c.step.rakah}
        style:--o={c.o}
        aria-hidden={!current}
        aria-live={current ? 'polite' : undefined}
        in:push={{ from: 'ahead' }}
        out:push={{ from: 'behind' }}
        onclick={() => !current && !dragging && session.goTo(c.i)}
        {@attach fitText(fitKey)}
      >
        <div class="content">
          <p class="meta">
            <span class="group">{t(`group.${c.step.group}`)}</span>
            {#if c.step.groupSize > 1}<span class="num">{t('line.of', { i: c.step.groupIndex + 1, n: c.step.groupSize })}</span>{/if}
            {#if c.step.repeat > 1 && !show.arabic}<span class="tag num">{t('line.times', { n: c.step.repeat })}</span>{/if}
            <span class="voice">
              {#if c.step.voice === 'aloud'}<Volume1 size={14} />{:else}<VolumeX size={14} />{/if}
              {c.step.voice === 'aloud' ? t('line.aloud') : t('line.quietly')}
            </span>
          </p>

          {#if c.step.cue}
            <p class="tag brand cue"><CornerDownRight size={15} class="flip-rtl" />{t(`cue.${c.step.cue}`, { n: c.step.rakah })}</p>
          {/if}

          {#if show.arabic}
            <p lang="ar" dir="rtl" class="quran arabic" class:hero={c.arabicHero} class:long={c.long}>
              {#if current && hearing}
                {#each arabicWords(c.line.arabic) as w, k (k)}<span class:heard={k < heard}>{w}</span>{' '}{/each}
              {:else}
                {c.line.arabic}
              {/if}
              {#if c.step.repeat > 1}<span class="times tag num">{t('line.times', { n: c.step.repeat })}</span>{/if}
            </p>
          {/if}
          {#if show.transliteration}
            <p lang="ar-Latn" class="say" class:long={c.long} class:alone={!show.arabic}>{c.line.transliteration}</p>
          {/if}
          {#if show.translation && c.line.meaning}
            <p class="meaning">{c.line.meaning}</p>
          {/if}
          {#if c.source}
            <p class="source">{c.source}</p>
          {/if}

          <!-- Always here, so the line never moves when a chip or the timer appears. -->
          <div class="status">
            {#if current && listening}
              <span class="tag brand chip"><Volume2 size={15} />{isQuran(c.step.recitationId) ? t('voice.listen', { name: t('qari.name') }) : t('voice.listenOnly')}</span>
            {:else if current && turn}
              <span class="tag brand chip">
                {#if hearing}<Mic size={15} />{/if}{t('voice.turn')}
              </span>
            {/if}
            {#if current && timedMs !== null && !listening}
              {#key c.step.id + timedMs}
                <span class="timer" aria-hidden="true"><i style:animation-duration="{timedMs}ms"></i></span>
              {/key}
            {/if}
          </div>
        </div>
      </article>
    {/each}
  </div>
</div>

<style>
  /* The track is exactly the column's width and the words area's height: the line under the
     photograph never changes size, so the stage above never jumps. */
  .viewport {
    --gap: 40px;
    --slide: 520ms;
    --ease-slide: cubic-bezier(0.32, 0.72, 0, 1);
    flex: 1;
    min-height: 0;
    overflow-x: clip;
    /* Room for the current card's shadow; the neighbours wait further out than this. */
    overflow-clip-margin: 28px;
    touch-action: pan-y;
    user-select: none;
  }
  .track {
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    height: 100%;
  }
  /*
   * One unit sets the type: --a, the size of the Arabic. The pronunciation is about half of it
   * and the meaning a third, so the three always read as one line in three voices.
   */
  .card {
    --dir: 1;
    --fit: 1;
    --a: calc(clamp(30px, min(7.4cqi, 18cqb), 76px) * var(--scale) * var(--fit));
    grid-area: 1 / 1;
    container-type: size;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    padding: clamp(14px, 6cqb, 32px) clamp(18px, 5cqi, 56px);
    overflow: hidden;
    border-radius: var(--radius-container);
    background: var(--raised);
    box-shadow: var(--shadow-2);
    text-align: center;
    translate: calc(var(--o) * (100% + var(--gap)) * var(--dir) + var(--drag)) 0;
    opacity: 0.5;
    cursor: pointer;
    will-change: translate, transform;
    transition:
      translate var(--slide) var(--ease-slide),
      opacity var(--slide) var(--ease-slide);
  }
  .card:dir(rtl) {
    --dir: -1;
  }
  .card.current {
    opacity: 1;
    cursor: auto;
    overflow-y: auto;
    scrollbar-width: none;
    user-select: text;
  }
  .dragging .card {
    transition: none;
  }
  /* Centred while it fits; from the top (and scrollable) if it ever doesn't. */
  .content {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-block: auto;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 2px 14px;
    font-size: 13px;
    line-height: 1.4;
    color: var(--ink-muted);
  }
  .group {
    font-weight: 600;
    color: var(--ink);
  }
  .voice {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .cue {
    margin-top: calc(10px * var(--fit));
    min-height: 30px;
    font-size: 14px;
  }
  .arabic {
    margin-top: calc(6px * var(--fit));
    font-size: var(--a);
    line-height: 1.75;
    color: var(--ink);
  }
  .arabic.long {
    font-size: calc(var(--a) * 0.84);
  }
  .arabic.hero {
    font-size: calc(var(--a) * 1.15);
  }
  .arabic.hero.long {
    font-size: calc(var(--a) * 0.92);
  }
  .arabic .heard {
    color: var(--state-correct);
    transition: color 320ms var(--ease-out);
  }
  /* The repetition sits with the words it repeats. */
  .times {
    margin-inline-start: 0.4em;
    vertical-align: 0.35em;
    min-height: 22px;
    padding: 0 8px;
    font-family: var(--font-ui);
    font-size: 12px;
    line-height: 1;
  }
  .say {
    max-width: 32ch;
    font-size: max(calc(17px * var(--fit)), calc(var(--a) * 0.46));
    font-weight: 500;
    line-height: 1.3;
    letter-spacing: -0.005em;
    color: var(--ink);
  }
  .say.long {
    max-width: 38ch;
    font-size: max(calc(16px * var(--fit)), calc(var(--a) * 0.4));
  }
  .say.alone {
    font-size: calc(var(--a) * 0.7);
    letter-spacing: -0.012em;
  }
  .meaning {
    max-width: 48ch;
    margin-top: calc(8px * var(--fit));
    font-size: max(calc(14px * var(--fit)), calc(var(--a) * 0.3));
    line-height: 1.5;
    color: var(--ink-muted);
  }
  .source {
    margin-top: calc(12px * var(--fit));
    font-size: 12px;
    line-height: 1.4;
    color: var(--ink-muted);
  }
  .status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    min-height: 28px;
    margin-top: calc(10px * var(--fit));
  }
  .chip {
    animation: chip 360ms cubic-bezier(0.34, 1.3, 0.64, 1) both;
  }
  @keyframes chip {
    from {
      opacity: 0;
      scale: 0.92;
    }
  }
  .timer {
    display: block;
    width: 96px;
    height: 4px;
    border-radius: var(--radius-inset);
    background: var(--surface);
    overflow: hidden;
    animation: chip 360ms var(--ease-out) both;
  }
  .timer i {
    display: block;
    height: 100%;
    background: var(--brand);
    transform-origin: left;
    animation: grow linear forwards;
  }
  .timer i:dir(rtl) {
    transform-origin: right;
  }
  @keyframes grow {
    from {
      transform: scale(0, 1);
    }
  }
  @media (max-width: 479px) {
    .viewport {
      --gap: 32px;
      overflow-clip-margin: 16px;
    }
    .card {
      padding: 14px;
    }
    .meta {
      font-size: 12.5px;
    }
  }
</style>
