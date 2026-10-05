<script lang="ts">
  let { checked, label, hint, onchange }: { checked: boolean; label: string; hint?: string; onchange: (v: boolean) => void } = $props()
</script>

<label class="row">
  <span class="text">
    <span>{label}</span>
    {#if hint}<small>{hint}</small>{/if}
  </span>
  <input type="checkbox" role="switch" {checked} onchange={(e) => onchange(e.currentTarget.checked)} />
</label>

<style>
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    min-height: 48px;
    cursor: pointer;
    font-size: 15px;
    user-select: none;
  }
  .text {
    display: grid;
    gap: 2px;
  }
  small {
    font-size: 13px;
    line-height: 1.45;
    color: var(--ink-muted);
  }
  input {
    appearance: none;
    flex: none;
    position: relative;
    width: 40px;
    height: 24px;
    margin: 0;
    border-radius: var(--radius-full);
    background: var(--line-strong);
    cursor: pointer;
    transition: background var(--dur-standard) var(--ease-out);
  }
  input::after {
    content: '';
    position: absolute;
    top: 2px;
    inset-inline-start: 2px;
    width: 20px;
    height: 20px;
    border-radius: var(--radius-full);
    background: var(--raised);
    box-shadow: 0 1px 2px var(--shadow-soft);
    /* A little overshoot, so the thumb settles rather than stops. */
    transition:
      transform 320ms cubic-bezier(0.34, 1.4, 0.64, 1),
      width 200ms var(--ease-out);
  }
  /* Pressing stretches the thumb toward where it will go. */
  input:active::after {
    width: 24px;
  }
  input:checked:active::after {
    transform: translateX(12px);
  }
  input:checked:dir(rtl):active::after {
    transform: translateX(-12px);
  }
  input:checked {
    background: var(--brand);
  }
  input:checked::after {
    transform: translateX(16px);
  }
  input:checked:dir(rtl)::after {
    transform: translateX(-16px);
  }
</style>
