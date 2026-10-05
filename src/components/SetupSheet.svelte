<script lang="ts">
  import CircleCheck from '@lucide/svelte/icons/circle-check'
  import Footprints from '@lucide/svelte/icons/footprints'
  import Hand from '@lucide/svelte/icons/hand'
  import Mic from '@lucide/svelte/icons/mic'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import Smartphone from '@lucide/svelte/icons/smartphone'
  import SwitchCamera from '@lucide/svelte/icons/switch-camera'
  import { handsFree } from '@/handsfree/hands-free.svelte'
  import { isFallback } from '@/handsfree/types'
  import { t } from '@/i18n/i18n.svelte'
  import { session } from '@/state/session.svelte'
  import { voice } from '@/voice/voice.svelte'
  import CameraPreview from './CameraPreview.svelte'
  import { fallbackText, statusText } from './HandsFree.svelte'
  import Skeleton from './Skeleton.svelte'
  import Sheet from './ui/Sheet.svelte'

  /** Getting hands-free right the first time: placement, a live framing check, then begin. */
  let { open = $bindable(false), onbegin }: { open: boolean; onbegin: () => void } = $props()

  const fallback = $derived(fallbackText(handsFree.status))
  const failed = $derived(isFallback(handsFree.status))
  // While the browser asks for the camera and microphone, the camera is about to start.
  const waiting = $derived(handsFree.status === 'off' ? 'starting' : handsFree.status)
  const listener = $derived(
    voice.asr === 'off' ? null : voice.asr === 'loading' ? t('voice.loading', { p: voice.progress }) : t(`voice.${voice.asr}`),
  )
  const mirror = $derived(handsFree.facingMode === 'user')
  const check = $derived(
    handsFree.status !== 'watching'
      ? { tone: '', text: statusText(waiting) }
      : handsFree.framing === 'full'
        ? { tone: 'ok', text: t('setup.seeYou') }
        : handsFree.framing === 'partial'
          ? { tone: 'warn', text: t('hf.msg.noPerson') }
          : { tone: '', text: t('setup.lookingForYou') },
  )
  const steps = [
    { icon: Smartphone, key: 'setup.step1' },
    { icon: Footprints, key: 'setup.step2' },
    { icon: Hand, key: 'setup.step3' },
  ] as const
</script>

<Sheet bind:open title={t('setup.title')} description={t('setup.body')}>
  <div class="frame">
    {#if handsFree.stream}
      <CameraPreview stream={handsFree.stream} {mirror} />
      <Skeleton keypoints={handsFree.keypoints} {mirror} />
      <button type="button" class="btn icon flip" aria-label="Switch camera" onclick={handsFree.flip}><SwitchCamera size={18} /></button>
    {:else}
      <p class="empty">{fallback ?? statusText(waiting)}</p>
    {/if}
    <p class="check tag {check.tone}">
      {#if check.tone === 'ok'}<CircleCheck size={16} />{/if}
      {check.text}
    </p>
  </div>

  {#if handsFree.engineLabel && handsFree.status === 'watching'}
    <p class="engine">{handsFree.engineLabel} · {t('hf.private')}</p>
  {/if}

  <ol class="steps">
    {#each steps as s, i (s.key)}
      <li style:--i={i}><span class="disc"><s.icon size={16} /></span>{t(s.key)}</li>
    {/each}
  </ol>

  {#if listener}
    <p class="listener" class:warn={voice.asr === 'blocked' || voice.asr === 'error'}>
      <Mic size={15} />{listener}
      {#if voice.asr === 'loading'}<span class="progress" aria-hidden="true"><i style:width="{voice.progress}%"></i></span>{/if}
    </p>
  {/if}

  <div class="actions">
    <button type="button" class="btn primary lg" onclick={onbegin}>
      {session.phase !== 'ready' ? t('setup.done') : failed ? t('setup.withoutCamera') : t('ready.begin', { prayer: t(`prayer.${session.prayer}`) })}
    </button>
    {#if failed && handsFree.status !== 'no-model'}
      <button type="button" class="btn quiet" onclick={handsFree.retry}><RefreshCw size={16} />{t('hf.retry')}</button>
    {/if}
  </div>
</Sheet>

<style>
  .frame {
    position: relative;
    overflow: hidden;
    margin-top: var(--space-2);
    border-radius: var(--radius-surface);
    background: var(--media);
    aspect-ratio: 4 / 5;
  }
  .frame :global(video) {
    height: 100%;
  }
  .empty {
    display: grid;
    place-items: center;
    height: 100%;
    padding: var(--space-5);
    text-align: center;
    font-size: 14px;
    color: var(--on-photo);
  }
  .flip {
    position: absolute;
    top: 12px;
    inset-inline-end: 12px;
    background: var(--raised);
  }
  .check {
    position: absolute;
    inset: auto 12px 12px 12px;
    justify-content: center;
    min-height: 40px;
    background: var(--raised);
    color: var(--ink);
    font-size: 14px;
  }
  .check.ok {
    color: var(--state-correct);
  }
  .check.warn {
    color: var(--state-khafi);
  }
  .engine {
    margin-top: var(--space-2);
    text-align: center;
    font-size: 12px;
    color: var(--ink-muted);
  }
  .steps {
    display: grid;
    gap: var(--space-3);
    margin: var(--space-4) 0 0;
    padding: 0;
    list-style: none;
    font-size: 15px;
  }
  .steps li {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    animation: rise 520ms var(--ease-out) both;
    animation-delay: calc(120ms + var(--i) * 70ms);
  }
  @keyframes rise {
    from {
      opacity: 0;
      translate: 0 8px;
    }
  }
  .listener {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 8px;
    margin-top: var(--space-4);
    font-size: 13px;
    color: var(--ink-muted);
  }
  .listener.warn {
    color: var(--state-khafi);
  }
  .progress {
    flex-basis: 100%;
    height: 3px;
    border-radius: var(--radius-full);
    background: var(--surface);
    overflow: hidden;
  }
  .progress i {
    display: block;
    height: 100%;
    background: var(--brand);
    transition: width var(--dur-standard) var(--ease-out);
  }
  .disc {
    display: grid;
    place-items: center;
    flex: none;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-full);
    background: var(--brand-tint);
    color: var(--brand);
  }
  .actions {
    display: grid;
    gap: var(--space-2);
    margin-top: var(--space-5);
  }
</style>
