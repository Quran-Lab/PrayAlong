<script lang="ts">
  /**
   * The PrayAlong mark: a crescent, the moon that times the prayers, with tips as round as the
   * Quran Lab bars. In ink, monochrome (docs/DESIGN.md).
   */
  import { CRESCENT, CRESCENT_BOX as B } from '@/lib/brand'

  let { size = 24 }: { size?: number } = $props()
</script>

<svg viewBox="{B.x} {B.y} {B.w} {B.h}" width={size * (B.w / B.h)} height={size} aria-hidden="true">
  <path d={CRESCENT} fill="currentColor" />
</svg>
