<script lang="ts">
  import ChevronLeft from '@lucide/svelte/icons/chevron-left'
  import ChevronRight from '@lucide/svelte/icons/chevron-right'
  import Pause from '@lucide/svelte/icons/pause'
  import Play from '@lucide/svelte/icons/play'
  import { postureKey } from '@/content/postures'
  import { t } from '@/i18n/i18n.svelte'
  import { postureSegments } from '@/sequence/build'
  import { session } from '@/state/session.svelte'
  import PostureIcon from './PostureIcon.svelte'

  let { following }: { following: boolean } = $props()

  const segments = $derived(postureSegments(session.sequence.steps))
  const praying = $derived(session.phase === 'praying')
  const rakah = $derived(session.phase === 'ready' ? 1 : session.phase === 'complete' ? session.sequence.rakahs : session.step.rakah)
  const inRakah = $derived(segments.filter((s) => s.rakah === rakah))
  let list = $state<HTMLOListElement>()

  // Keep the current movement in view on narrow screens (scroll only the list).
  $effect(() => {
    void session.index
    const item = list?.querySelector<HTMLElement>('[aria-current="step"]')
    if (!list || !item) return
    // Visual offsets work the same left-to-right and right-to-left.
    const box = list.getBoundingClientRect()
    const at = item.getBoundingClientRect()
    list.scrollTo({ left: list.scrollLeft + (at.left - box.left) - (box.width - at.width) / 2, behavior: 'smooth' })
  })

  // One highlight that slides from movement to movement (it jumps when a new rak'ah begins).
  let pill = $state({ x: 0, w: 0, on: false, glide: false })
  let pillRakah = 0
  function place() {
    const item = list?.querySelector<HTMLElement>('[aria-current="step"]')
    const glide = pill.on && pillRakah === rakah
    pillRakah = rakah
    pill = item ? { x: item.offsetLeft, w: item.offsetWidth, on: true, glide } : { ...pill, on: false, glide: false }
  }
  $effect(() => {
    void session.index
    void inRakah
    void praying
    const id = requestAnimationFrame(place)
    return () => cancelAnimationFrame(id)
  })
  $effect(() => {
    if (!list) return
    const ro = new ResizeObserver(() => place())
    ro.observe(list)
    return () => ro.disconnect()
  })
</script>

<div class="dock">
  <div class="rakah">
    <span class="label">{t('dock.rakah')}</span>
    <span class="of num">{t('dock.rakahOf', { r: rakah, n: session.sequence.rakahs })}</span>
    <span class="bars" aria-hidden="true">
      {#each { length: session.sequence.rakahs } as _, i (i)}
        <i class:done={i + 1 < rakah || session.phase === 'complete'} class:now={i + 1 === rakah && praying}></i>
      {/each}
    </span>
  </div>

  <ol bind:this={list} class="moves">
    <li class="pill" class:on={pill.on} class:glide={pill.glide} style:translate="{pill.x}px 0" style:width="{pill.w}px" aria-hidden="true"></li>
    {#each inRakah as seg (`${seg.rakah}-${seg.start}`)}
      {@const active = praying && session.index >= seg.start && session.index < seg.end}
      {@const done = session.phase === 'complete' || (praying && session.index >= seg.end)}
      {@const key = postureKey(seg.posture)}
      <li>
        <button
          type="button"
          class="move"
          class:done
          aria-current={active ? 'step' : undefined}
          title="{t(`posture.${key}`)} · {t(`hint.${key}`)}"
          onclick={() => session.goTo(seg.start)}
        >
          <PostureIcon posture={seg.posture} size={26} />
          <span class="name" class:sr-only-phone={!active}>{t(`posture.${key}`)}</span>
        </button>
      </li>
    {/each}
  </ol>

  <div class="controls">
    <button type="button" class="btn quiet icon lg hide-phone" aria-label={t('dock.previous')} title={t('dock.previous')} onclick={() => session.prev()} disabled={session.phase === 'ready' || (praying && session.index === 0)}>
      <ChevronLeft size={20} class="flip-rtl" />
    </button>
    {#if session.handsFree && following}
      <span class="following hide-phone"><i aria-hidden="true"></i>{t('dock.following')}</span>
    {:else}
      <button type="button" class="btn quiet icon lg" aria-pressed={session.autoplay} aria-label={session.autoplay ? t('dock.pause') : t('dock.guide')} title={session.autoplay ? t('dock.pause') : t('dock.guide')} onclick={() => session.setAutoplay(!session.autoplay)} disabled={session.phase === 'complete'}>
        {#if session.autoplay}<Pause size={18} fill="currentColor" />{:else}<Play size={18} fill="currentColor" />{/if}
      </button>
    {/if}
    <button type="button" class="btn quiet icon lg" aria-label={t('dock.next')} title={t('dock.next')} onclick={() => session.next()} disabled={session.phase === 'complete'}>
      <ChevronRight size={20} class="flip-rtl" />
    </button>
  </div>
</div>

<style>
  .dock {
    display: flex;
    align-items: stretch;
    gap: var(--space-2);
    width: 100%;
    padding: 6px;
    border-radius: var(--radius-surface);
    background: var(--surface);
  }
  .rakah {
    flex: none;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 4px;
    padding-inline: 10px 14px;
    border-inline-end: 1px solid var(--line);
  }
  .label {
    font-size: 14px;
    font-weight: 600;
    line-height: 1.2;
  }
  .of {
    font-size: 12px;
    line-height: 1.2;
    color: var(--ink-muted);
  }
  .bars {
    display: flex;
    gap: 3px;
  }
  .bars i {
    width: 12px;
    height: 4px;
    border-radius: var(--radius-inset);
    background: var(--line-strong);
    transition:
      background var(--dur-standard) var(--ease-out),
      width 420ms cubic-bezier(0.32, 0.72, 0, 1);
  }
  .bars i.now {
    width: 20px;
  }
  .bars i.done {
    background: var(--ink-muted);
  }
  .bars i.now {
    background: var(--brand);
  }
  .moves {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
    overflow-x: auto;
    scrollbar-width: none;
    scroll-padding-inline: 8px;
    /* Moves that don't fit fade at the edges instead of being cut mid-word. */
    mask-image: linear-gradient(to right, transparent, #000 10px, #000 calc(100% - 10px), transparent);
  }
  .moves::-webkit-scrollbar {
    display: none;
  }
  li {
    flex: none;
  }
  .pill {
    position: absolute;
    top: 50%;
    left: 0;
    height: 64px;
    margin-top: -32px;
    border-radius: var(--radius-control);
    background: var(--brand-tint);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--dur-standard) var(--ease-out);
  }
  .pill.on {
    opacity: 1;
  }
  .pill.glide {
    transition:
      translate 460ms cubic-bezier(0.32, 0.72, 0, 1),
      width 460ms cubic-bezier(0.32, 0.72, 0, 1),
      opacity var(--dur-standard) var(--ease-out);
  }
  .move {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-width: 68px;
    height: 64px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--ink-faint);
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-standard) var(--ease-out);
  }
  .move:hover {
    background: var(--surface-hover);
    color: var(--ink-muted);
  }
  .move.done {
    color: var(--ink-muted);
  }
  .move[aria-current='step'] {
    background: transparent;
    color: var(--brand);
  }
  .name {
    font-size: 12px;
    font-weight: 500;
    line-height: 1;
    white-space: nowrap;
  }
  .move[aria-current='step'] .name {
    font-weight: 600;
  }
  .controls {
    flex: none;
    display: flex;
    align-items: center;
    gap: 2px;
    padding-inline-start: 6px;
    border-inline-start: 1px solid var(--line);
  }
  .controls .btn {
    color: var(--ink);
  }
  .controls .btn:hover {
    background: var(--surface-hover);
  }
  .controls .btn[aria-pressed='true'] {
    background: var(--brand-tint);
    color: var(--brand);
  }
  .following {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding-inline: 8px;
    font-size: 13px;
    color: var(--ink-muted);
    white-space: nowrap;
  }
  .following i {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full);
    background: var(--brand);
  }
  @media (max-width: 639px) {
    .hide-phone {
      display: none;
    }
    .rakah {
      padding-inline: 6px 10px;
    }
    .rakah .label {
      display: none;
    }
    .move {
      min-width: 52px;
      height: 56px;
    }
    .pill {
      height: 56px;
      margin-top: -28px;
    }
    .sr-only-phone {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
    }
  }
</style>
