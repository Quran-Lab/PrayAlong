<script lang="ts">
  import type { Posture } from '@/sequence/types'

  /**
   * Simple pictograms of each posture, drawn on a 24px grid so they stay crisp
   * at small sizes. Figures face right (towards the qibla in side view).
   */
  const FIGURES: Record<Posture | 'salam', { head: [number, number]; d: string }> = {
    takbir: { head: [12, 4.5], d: 'M12 7.3v7.4M12 14.7 10.7 21M12 14.7l1.3 6.3M12 9.2 8.7 9l-.8-4.4M12 9.2l3.3-.2.8-4.4' },
    qiyam: { head: [12, 4.5], d: 'M12 7.3v7.4M12 14.7 10.7 21M12 14.7l1.3 6.3M12 9.2l-2.8 2.5h5.6L12 9.2' },
    ruku: { head: [18.4, 8.9], d: 'M16 9.4H8.2M8.2 9.4 8.5 21M8.2 9.4l1.3 11.6M14.6 9.6l-3.9 5.9' },
    itidal: { head: [12, 4.5], d: 'M12 7.3v7.4M12 14.7 10.7 21M12 14.7l1.3 6.3M12 9.2l-1.6 5.3M12 9.2l1.6 5.3' },
    sujud: { head: [18.2, 18.2], d: 'M8.6 11.8 9.8 19.6M9.8 19.6H4.2M8.6 11.8l7 4.8M15.4 16.6l-.5 3.8h2.9' },
    jalsah: { head: [10.4, 4.9], d: 'M10.4 7.7v8.2M10.4 15.9l6.4 3.1M16.8 19.4H8.4M10.4 9.6l3.8 6.6' },
    tashahhud: { head: [10.4, 4.9], d: 'M10.4 7.7v8.2M10.4 15.9l6.4 3.1M16.8 19.4H8.4M10.4 9.6l3.8 6.4 1.4-2.4' },
    'salam-right': { head: [10.4, 4.9], d: 'M10.4 7.7v8.2M10.4 15.9l6.4 3.1M16.8 19.4H8.4M10.4 9.6l3.8 6.6M14 3.3c1 .9 1 2.4 0 3.3' },
    'salam-left': { head: [10.4, 4.9], d: 'M10.4 7.7v8.2M10.4 15.9l6.4 3.1M16.8 19.4H8.4M10.4 9.6l3.8 6.6M14 3.3c1 .9 1 2.4 0 3.3' },
    salam: { head: [10.4, 4.9], d: 'M10.4 7.7v8.2M10.4 15.9l6.4 3.1M16.8 19.4H8.4M10.4 9.6l3.8 6.6M14 3.3c1 .9 1 2.4 0 3.3' },
  }

  let { posture, size = 24 }: { posture: Posture; size?: number } = $props()
  const f = $derived(FIGURES[posture])
</script>

<svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none">
  <circle cx={f.head[0]} cy={f.head[1]} r="2.3" fill="currentColor" />
  <path d={f.d} stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
</svg>
