<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import { PRAYERS } from '@/content/prayers'
  import { t } from '@/i18n/i18n.svelte'
  import { clock } from '@/lib/prayer-clock.svelte'
  import { formatTime } from '@/lib/prayer-times'
  import type { PrayerId } from '@/sequence/types'
  import { session } from '@/state/session.svelte'

  let { wide, onrequestswitch }: { wide: boolean; onrequestswitch: (id: PrayerId) => void } = $props()
  let menu = $state<HTMLElement>()

  function choose(id: PrayerId) {
    menu?.hidePopover()
    if (id === session.prayer) return
    // Don't throw away progress silently.
    if (session.phase === 'praying' && session.index > 0) onrequestswitch(id)
    else session.choosePrayer(id)
  }

  function sublabel(id: PrayerId, short = false) {
    const { detected, times } = clock
    if (id === detected.id) {
      if (detected.status === 'next') return t('prayer.next', { time: formatTime(detected.startsAt) })
      return short ? t('prayer.now') : t('prayer.activeAuto')
    }
    return formatTime(times[id])
  }
</script>

{#if wide}
  <nav aria-label={t('prayer.label')} class="chips">
    {#each PRAYERS as p (p.id)}
      {@const active = p.id === session.prayer}
      <button type="button" class="chip" aria-pressed={active} onclick={() => choose(p.id)} title="{t(`prayer.${p.id}`)} · {formatTime(clock.times[p.id])}">
        <span class="name">{t(`prayer.${p.id}`)}</span>
        <span class="sub num">{active ? sublabel(p.id) : formatTime(clock.times[p.id])}</span>
        {#if !active && p.id === clock.detected.id}<span class="dot" aria-label={t('prayer.now')}></span>{/if}
      </button>
    {/each}
  </nav>
{:else}
  <button type="button" class="chip trigger" aria-pressed="true" popovertarget="prayer-menu">
    <span class="name">{t(`prayer.${session.prayer}`)}</span>
    <span class="sub">{sublabel(session.prayer, true)}</span>
    <ChevronDown size={16} />
  </button>
  <div id="prayer-menu" popover bind:this={menu} class="menu">
    {#each PRAYERS as p (p.id)}
      <button type="button" class="item" aria-pressed={p.id === session.prayer} onclick={() => choose(p.id)}>
        <span>
          {t(`prayer.${p.id}`)}
          {#if p.id === clock.detected.id}<span class="dot inline" aria-label={t('prayer.now')}></span>{/if}
        </span>
        <span class="num muted">{formatTime(clock.times[p.id])}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .chips {
    display: flex;
    gap: 4px;
    padding: 4px;
    border-radius: var(--radius-control);
    background: var(--surface);
  }
  .chip {
    position: relative;
    display: inline-flex;
    align-items: baseline;
    gap: 8px;
    height: 36px;
    align-items: center;
    padding: 0 12px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--ink-muted);
    font-size: 14px;
    white-space: nowrap;
    transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  }
  .chip:hover {
    background: var(--surface-hover);
  }
  .chip .name {
    font-weight: 500;
    color: var(--ink);
  }
  .chip .sub {
    font-size: 12px;
  }
  .chip[aria-pressed='true'] {
    background: var(--raised);
    box-shadow: 0 1px 2px var(--shadow-soft);
  }
  .chip[aria-pressed='true'] .name {
    font-weight: 600;
  }
  .chip[aria-pressed='true'] .sub {
    color: var(--brand);
    font-weight: 500;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full);
    background: var(--brand);
  }
  .dot.inline {
    display: inline-block;
    margin-inline-start: 6px;
    vertical-align: middle;
  }
  .trigger {
    height: 40px;
    background: var(--surface);
    box-shadow: none;
  }
  .trigger[aria-pressed='true'] {
    background: var(--surface);
    box-shadow: none;
  }
  .trigger :global(svg) {
    color: var(--ink-muted);
  }
  .menu {
    position: fixed;
    inset: 64px auto auto 50%;
    translate: -50% 0;
    width: min(280px, calc(100vw - 32px));
    margin: 0;
    padding: 6px;
    border: 0;
    border-radius: var(--radius-surface);
    background: var(--raised);
    color: var(--ink);
    box-shadow: var(--shadow-2);
  }
  .item {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: space-between;
    min-height: 44px;
    padding: 0 12px;
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    font-size: 15px;
    text-align: start;
  }
  .item:hover {
    background: var(--surface);
  }
  .item[aria-pressed='true'] {
    background: var(--brand-tint);
    color: var(--brand);
    font-weight: 600;
  }
</style>
