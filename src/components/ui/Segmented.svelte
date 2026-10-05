<script lang="ts" generics="V extends string">
  let { value, options, label, onchange }: { value: V; options: readonly { value: V; label: string; size?: number }[]; label: string; onchange: (v: V) => void } = $props()

  const at = $derived(Math.max(0, options.findIndex((o) => o.value === value)))
</script>

<!-- Surface track; a raised thumb slides to the selected item. -->
<div class="seg" role="radiogroup" aria-label={label} style:--n={options.length} style:--i={at}>
  <span class="thumb" aria-hidden="true"></span>
  {#each options as o (o.value)}
    <button type="button" role="radio" aria-checked={o.value === value} onclick={() => onchange(o.value)} style:font-size={o.size ? `${o.size}px` : undefined}>
      {o.label}
    </button>
  {/each}
</div>

<style>
  .seg {
    --dir: 1;
    position: relative;
    display: grid;
    grid-auto-columns: 1fr;
    grid-auto-flow: column;
    gap: 4px;
    padding: 4px;
    border-radius: var(--radius-control);
    background: var(--surface);
  }
  .seg:dir(rtl) {
    --dir: -1;
  }
  .thumb {
    position: absolute;
    top: 4px;
    bottom: 4px;
    inset-inline-start: 4px;
    width: calc((100% - 8px - (var(--n) - 1) * 4px) / var(--n));
    border-radius: 7px;
    background: var(--raised);
    box-shadow: 0 1px 2px var(--shadow-soft);
    translate: calc(var(--i) * (100% + 4px) * var(--dir)) 0;
    transition: translate 380ms cubic-bezier(0.32, 0.72, 0, 1);
  }
  button {
    position: relative;
    min-height: 36px;
    padding: 0 12px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--ink-muted);
    font-size: 13px;
    font-weight: 500;
    transition: color var(--dur-standard) var(--ease-out);
  }
  button:hover {
    color: var(--ink);
  }
  button[aria-checked='true'] {
    color: var(--ink);
    font-weight: 600;
  }
</style>
