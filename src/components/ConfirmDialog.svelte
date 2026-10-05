<script lang="ts">
  import { t } from '@/i18n/i18n.svelte'
  import type { PrayerId } from '@/sequence/types'
  import { session } from '@/state/session.svelte'

  /** Switching prayers mid-prayer starts over, so ask first. */
  let { pending = $bindable(null) }: { pending: PrayerId | null } = $props()
  let dialog: HTMLDialogElement

  $effect(() => {
    if (pending && !dialog.open) dialog.showModal()
    else if (!pending && dialog.open) dialog.close()
  })
  const to = $derived(pending ? t(`prayer.${pending}`) : '')
</script>

<dialog bind:this={dialog} onclose={() => (pending = null)} aria-labelledby="switch-title">
  <h2 id="switch-title">{t('switch.title', { prayer: to })}</h2>
  <p>{t('switch.body', { r: session.step?.rakah ?? 1, from: t(`prayer.${session.prayer}`), to })}</p>
  <div class="actions">
    <button type="button" class="btn quiet" onclick={() => (pending = null)}>{t('switch.keep')}</button>
    <button
      type="button"
      class="btn primary"
      onclick={() => {
        if (pending) session.choosePrayer(pending)
        pending = null
      }}>{t('switch.confirm')}</button
    >
  </div>
</dialog>

<style>
  dialog {
    width: min(400px, calc(100vw - 32px));
    padding: var(--space-5);
    border: 0;
    border-radius: var(--radius-container);
    background: var(--raised);
    color: var(--ink);
    box-shadow: var(--shadow-3);
  }
  dialog::backdrop {
    background: var(--scrim);
  }
  h2 {
    font-size: 20px;
    font-weight: 500;
    line-height: 1.35;
  }
  p {
    margin-top: var(--space-2);
    font-size: 15px;
    line-height: 1.55;
    color: var(--ink-muted);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-5);
  }
</style>
