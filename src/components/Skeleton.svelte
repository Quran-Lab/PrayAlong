<script lang="ts">
  import type { Keypoint } from '@/handsfree/types'

  /** Nodes and edges on the body, so people see what the camera follows. */
  let { keypoints, mirror = true }: { keypoints: Keypoint[] | null; mirror?: boolean } = $props()
  const EDGES: [number, number][] = [
    [5, 6], [5, 7], [7, 9], [6, 8], [8, 10], [5, 11], [6, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [0, 5], [0, 6],
  ]
  const seen = (p: Keypoint | undefined) => !!p && (p.v ?? 1) > 0.4
</script>

{#if keypoints}
  <svg viewBox="0 0 1 1" preserveAspectRatio="none" class:mirror aria-hidden="true">
    {#each EDGES as [a, b] (`${a}-${b}`)}
      {#if seen(keypoints[a]) && seen(keypoints[b])}
        <line x1={keypoints[a]!.x} y1={keypoints[a]!.y} x2={keypoints[b]!.x} y2={keypoints[b]!.y} />
      {/if}
    {/each}
    {#each keypoints as p, i (i)}
      {#if seen(p) && (i === 0 || i >= 5)}<circle cx={p.x} cy={p.y} r="0.012" />{/if}
    {/each}
  </svg>
{/if}

<style>
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .mirror {
    transform: scaleX(-1);
  }
  line {
    stroke: var(--photo-accent);
    stroke-width: 3px;
    vector-effect: non-scaling-stroke;
    stroke-linecap: round;
  }
  circle {
    fill: var(--on-photo);
  }
</style>
