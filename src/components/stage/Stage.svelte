<script lang="ts">
  import { untrack, type Snippet } from 'svelte'
  import { fade } from 'svelte/transition'
  import BACKDROPS from '@/content/backdrops.json'
  import { t } from '@/i18n/i18n.svelte'
  import type { Palette } from '@/lib/brand'
  import type { PrayerId } from '@/sequence/types'
  import type { CharacterInfo } from './characters'
  import type { PoseName } from './rig/prayer-poses'
  import type { CompanionStage } from './stage'

  let {
    prayer,
    posture,
    character,
    palette = 'plum',
    outfit = '',
    reducedMotion = false,
    azimuth,
    children,
  }: {
    prayer: PrayerId
    posture: PoseName
    character: CharacterInfo
    /** The rug is woven in the brand palette. */
    palette?: Palette
    /** The colour of the companion's clothes (CSS hex). */
    outfit?: string
    reducedMotion?: boolean
    azimuth?: number
    children?: Snippet
  } = $props()

  let canvas: HTMLCanvasElement
  let stage = $state.raw<CompanionStage | null>(null)
  let ready = $state(false)
  let failed = $state(false)

  const base = import.meta.env.BASE_URL
  const srcset = (list: (string | number)[][]) => list.map(([file, w]) => `${base}backgrounds/${file} ${w}w`).join(', ')
  const photo = $derived(BACKDROPS[prayer])

  // three.js is the heaviest part of the app: the photo paints first, the companion follows.
  $effect(() => {
    let alive = true
    let created: CompanionStage | null = null
    import('./stage').then(({ CompanionStage }) => {
      if (!alive) return
      created = new CompanionStage(canvas, untrack(() => palette))
      stage = created
    })
    return () => {
      alive = false
      created?.dispose()
      stage = null
    }
  })

  $effect(() => {
    if (!stage) return
    ready = false
    stage
      .setCharacter(character)
      .then(() => (ready = true))
      .catch((err) => {
        console.error('[stage] character failed', err)
        failed = true
      })
  })
  $effect(() => stage?.setPosture(posture))
  $effect(() => stage?.setPalette(palette))
  $effect(() => stage?.setOutfit(outfit))
  $effect(() => stage?.setReducedMotion(reducedMotion))
  $effect(() => stage?.setAzimuth(azimuth))
</script>

<div class="stage" role="img" aria-label={t('stage.companion')}>
  {#key prayer}
    <picture transition:fade={{ duration: 240 }}>
      <source type="image/jxl" srcset={srcset(photo.jxl)} sizes="100vw" />
      <source type="image/avif" srcset={srcset(photo.avif)} sizes="100vw" />
      <img src="{base}backgrounds/{photo.fallback}" alt="" fetchpriority="high" decoding="async" />
    </picture>
  {/key}
  <canvas bind:this={canvas} aria-hidden="true"></canvas>
  {#if !ready && !failed}
    <p class="preparing" out:fade={{ duration: 160 }}>{t('stage.preparing')}</p>
  {/if}
  {@render children?.()}
</div>

<style>
  .stage {
    position: relative;
    height: 100%;
    overflow: hidden;
    border-radius: var(--radius-container);
    background: var(--surface);
    isolation: isolate;
  }
  picture,
  img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  img {
    object-fit: cover;
    object-position: center 62%;
  }
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
  .preparing {
    position: absolute;
    inset-inline: 0;
    bottom: 16px;
    margin-inline: auto;
    width: fit-content;
    padding: 4px 12px;
    border-radius: var(--radius-word);
    background: var(--raised);
    font-size: 13px;
    color: var(--ink-muted);
  }
</style>
