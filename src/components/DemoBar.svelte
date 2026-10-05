<script lang="ts">
  import Pause from '@lucide/svelte/icons/pause'
  import Play from '@lucide/svelte/icons/play'
  import { cubicOut } from 'svelte/easing'
  import { fly } from 'svelte/transition'
  import { t } from '@/i18n/i18n.svelte'
  import type { PoseClass, Posture } from '@/sequence/types'
  import PostureIcon from './PostureIcon.svelte'

  /** Act out movements on screen — the hands-free flow without a camera. */
  let { current, expected, auto, onact, onauto }: { current: PoseClass | null; expected: PoseClass | null; auto: boolean; onact: (p: PoseClass) => void; onauto: (on: boolean) => void } = $props()

  const POSES: { pose: PoseClass; icon: Posture }[] = [
    { pose: 'hands-raised', icon: 'takbir' },
    { pose: 'standing', icon: 'qiyam' },
    { pose: 'bowing', icon: 'ruku' },
    { pose: 'prostrating', icon: 'sujud' },
    { pose: 'sitting', icon: 'jalsah' },
  ]
</script>

<div class="bar" role="toolbar" aria-label={t('demo.title')} transition:fly={{ y: 6, duration: 240, easing: cubicOut }}>
  <span class="title">{t('demo.title')}</span>
  {#each POSES as { pose, icon } (pose)}
    <button type="button" class="btn icon lg" aria-pressed={current === pose} class:expected={expected === pose && current !== pose} aria-label={t(`pose.${pose}`)} title="{t(`pose.${pose}`)} · {t('demo.keys')}" onclick={() => onact(pose)}>
      <PostureIcon posture={icon} />
    </button>
  {/each}
  <span class="sep" aria-hidden="true"></span>
  <button type="button" class="btn sm" aria-pressed={auto} onclick={() => onauto(!auto)}>
    {#if auto}<Pause size={16} fill="currentColor" />{:else}<Play size={16} fill="currentColor" />{/if}
    <span class="hide-phone">{auto ? t('demo.stop') : t('demo.auto')}</span>
  </button>
</div>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px;
    border-radius: var(--radius-surface);
    background: var(--raised);
    box-shadow: var(--shadow-2);
  }
  .title {
    padding-inline: 8px 4px;
    font-size: 13px;
    font-weight: 600;
    color: var(--ink-muted);
  }
  .btn {
    background: transparent;
    color: var(--ink-muted);
  }
  .btn:hover {
    background: var(--surface);
  }
  .btn.expected {
    background: var(--state-reading);
    color: var(--brand);
  }
  .btn[aria-pressed='true'] {
    background: var(--brand-tint);
    color: var(--brand);
  }
  .sep {
    width: 1px;
    height: 28px;
    margin-inline: 2px;
    background: var(--line);
  }
  @media (max-width: 639px) {
    .title,
    .hide-phone {
      display: none;
    }
  }
</style>
