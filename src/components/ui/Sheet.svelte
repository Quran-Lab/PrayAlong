<script lang="ts">
  import X from '@lucide/svelte/icons/x'
  import type { Snippet } from 'svelte'
  import { t } from '@/i18n/i18n.svelte'

  let {
    open = $bindable(false),
    title,
    description,
    children,
  }: { open: boolean; title: string; description?: string; children: Snippet } = $props()

  let dialog: HTMLDialogElement
  let closing = $state(false)

  // Open at once; close after the sheet has slid away.
  $effect(() => {
    if (open && !dialog.open) {
      closing = false
      dialog.showModal()
    } else if (!open && dialog.open && !closing) {
      closing = true
      const done = () => {
        if (!open) dialog.close()
        closing = false
      }
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) done()
      else setTimeout(done, 220)
    }
  })
</script>

<!-- Bottom sheet on phones, a side panel from 720 px. Level 3: raised, shadow, scrim. -->
<dialog
  bind:this={dialog}
  class:closing
  onclose={() => (open = false)}
  oncancel={(e) => {
    e.preventDefault()
    open = false
  }}
  onclick={(e) => e.target === dialog && (open = false)}
  aria-labelledby="sheet-title"
>
  <div class="sheet">
    <span class="handle" aria-hidden="true"></span>
    <header>
      <div>
        <h2 id="sheet-title">{title}</h2>
        {#if description}<p>{description}</p>{/if}
      </div>
      <button class="btn quiet icon" type="button" aria-label={t('ui.close')} onclick={() => (open = false)}>
        <X size={18} />
      </button>
    </header>
    <div class="body">{@render children()}</div>
  </div>
</dialog>

<style>
  dialog {
    position: fixed;
    inset: auto 0 0 0;
    width: 100%;
    max-width: none;
    max-height: 92dvh;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: var(--radius-container) var(--radius-container) 0 0;
    background: var(--raised);
    color: var(--ink);
    box-shadow: var(--shadow-3);
  }
  /* Phones: up from the bottom edge. From 720 px: in from the side. */
  dialog[open] {
    animation: rise 460ms cubic-bezier(0.32, 0.72, 0, 1);
  }
  dialog.closing {
    animation: sink 220ms var(--ease-in) forwards;
  }
  dialog::backdrop {
    background: var(--scrim);
    animation: scrim 320ms var(--ease-out);
  }
  dialog.closing::backdrop {
    animation: scrim 220ms var(--ease-in) reverse forwards;
  }
  @keyframes rise {
    from {
      translate: 0 100%;
    }
  }
  @keyframes sink {
    to {
      translate: 0 100%;
    }
  }
  @keyframes scrim {
    from {
      opacity: 0;
    }
  }
  .sheet {
    display: flex;
    flex-direction: column;
    max-height: 92dvh;
  }
  .handle {
    width: 36px;
    height: 4px;
    margin: 10px auto 0;
    border-radius: var(--radius-full);
    background: var(--line-strong);
  }
  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-5) var(--space-2);
  }
  h2 {
    font-size: 20px;
    font-weight: 500;
    line-height: 1.35;
  }
  header p {
    margin-top: var(--space-1);
    font-size: 14px;
    line-height: 1.5;
    color: var(--ink-muted);
  }
  header .btn {
    margin-inline-end: -8px;
    color: var(--ink-muted);
  }
  .body {
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-2) var(--space-5) max(var(--space-5), env(safe-area-inset-bottom));
  }
  @media (min-width: 720px) {
    dialog[open] {
      animation-name: slide-in;
    }
    dialog.closing {
      animation-name: slide-out;
    }
    @keyframes slide-in {
      from {
        opacity: 0;
        translate: 32px 0;
      }
    }
    @keyframes slide-out {
      to {
        opacity: 0;
        translate: 32px 0;
      }
    }
    dialog {
      inset: 12px 12px 12px auto;
      width: 420px;
      max-height: calc(100dvh - 24px);
      border-radius: var(--radius-container);
    }
    .sheet {
      max-height: calc(100dvh - 24px);
      height: 100%;
    }
    .handle {
      display: none;
    }
    header {
      padding-top: var(--space-5);
    }
  }
</style>
