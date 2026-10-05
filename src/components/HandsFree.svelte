<script lang="ts" module>
  import type { HandsFreeStatus } from '@/handsfree/types'
  import { t } from '@/i18n/i18n.svelte'

  export const statusText = (status: HandsFreeStatus) =>
    ({
      off: t('hf.status.off'),
      starting: t('hf.status.starting'),
      loading: t('hf.status.loading'),
      watching: t('hf.status.watching'),
      demo: t('hf.status.demo'),
      denied: t('hf.status.fallback'),
      'no-camera': t('hf.status.fallback'),
      'no-model': t('hf.status.fallback'),
    })[status]

  export const fallbackText = (status: HandsFreeStatus) =>
    status === 'denied' ? t('hf.msg.denied') : status === 'no-camera' ? t('hf.msg.noCamera') : status === 'no-model' ? t('hf.msg.noModel') : null
</script>

<script lang="ts">
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import { cubicOut } from 'svelte/easing'
  import { fly } from 'svelte/transition'
  import { isFallback, isFollowing } from '@/handsfree/types'
  import { handsFree } from '@/handsfree/hands-free.svelte'
  import CameraPreview from './CameraPreview.svelte'
  import Skeleton from './Skeleton.svelte'

  /** A small mirror of what the camera sees, with the body it follows. */
  let { onopen }: { onopen: () => void } = $props()
  const fallback = $derived(fallbackText(handsFree.status))
  const mirror = $derived(handsFree.facingMode === 'user')
</script>

<div class="bubble" transition:fly={{ y: -6, duration: 240, easing: cubicOut }}>
  {#if handsFree.stream}
    <button type="button" class="view" onclick={onopen} aria-label={t('setup.title')}>
      <CameraPreview stream={handsFree.stream} {mirror} />
      <Skeleton keypoints={handsFree.keypoints} {mirror} />
    </button>
  {/if}
  <div class="status">
    <span class="dot" class:live={isFollowing(handsFree.status)} class:off={isFallback(handsFree.status)}></span>
    <div>
      <p>{statusText(handsFree.status)}</p>
      {#if fallback}
        <p class="muted">{fallback}</p>
        {#if handsFree.status !== 'no-model'}
          <p class="row"><button type="button" class="btn sm" onclick={handsFree.retry}><RefreshCw size={14} />{t('hf.retry')}</button></p>
        {/if}
      {:else if handsFree.status === 'watching' && handsFree.framing !== 'full'}
        <p class="warn">{t('hf.msg.noPerson')}</p>
      {:else if handsFree.pose}
        <p class="pose">{t(`pose.${handsFree.pose}`)}</p>
      {:else if handsFree.status === 'watching' || handsFree.status === 'demo'}
        <p class="muted">{t('setup.lookingForYou')}</p>
      {/if}
    </div>
  </div>
</div>

<style>
  .bubble {
    width: 208px;
    overflow: hidden;
    border-radius: var(--radius-surface);
    background: var(--raised);
    color: var(--ink);
    box-shadow: var(--shadow-2);
  }
  .view {
    position: relative;
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    aspect-ratio: 4 / 3;
    background: var(--media);
  }
  .view :global(video) {
    height: 100%;
  }
  .status {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 12px;
    font-size: 13px;
    line-height: 1.45;
  }
  .dot {
    flex: none;
    width: 6px;
    height: 6px;
    margin-top: 7px;
    border-radius: var(--radius-full);
    background: var(--ink-faint);
  }
  .dot.live {
    background: var(--brand);
  }
  .dot.off {
    background: var(--state-khafi);
  }
  .pose {
    color: var(--brand);
    font-weight: 600;
  }
  .warn {
    color: var(--state-khafi);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }
  .row .btn {
    height: 32px;
    padding: 0 10px;
    font-size: 13px;
  }
  @media (max-width: 639px) {
    .bubble {
      width: 148px;
    }
  }
</style>
